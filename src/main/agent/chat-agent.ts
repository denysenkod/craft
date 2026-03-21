import Anthropic from '@anthropic-ai/sdk';
import { BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { AGENT_TOOLS } from './tools';
import { executeTool, Proposal } from './tool-executor';
import { buildSystemPrompt, CurrentContext } from './system-prompt';

const MAX_TOOL_CALLS = 15;
const MAX_HISTORY_MESSAGES = 50;

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

let abortController: AbortController | null = null;

function emit(win: BrowserWindow, event: Record<string, unknown>) {
  if (!win.isDestroyed()) {
    win.webContents.send('chat:stream-event', event);
  }
}

function loadHistory(): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, role, content, created_at FROM chat_messages ORDER BY created_at DESC LIMIT ?'
  ).all(MAX_HISTORY_MESSAGES) as ChatMessage[];
  return rows.reverse();
}

function saveMessage(role: 'user' | 'assistant', content: string): string {
  const db = getDb();
  const id = uuid();
  db.prepare(
    'INSERT INTO chat_messages (id, role, content, created_at) VALUES (?, ?, ?, datetime(\'now\'))'
  ).run(id, role, content);
  return id;
}

function buildMessages(
  history: ChatMessage[],
  userMessage: string,
  context: CurrentContext,
  transcriptContent?: string,
  analysisJson?: string
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  // Convert history to API format
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Build current user message — inject transcript + analysis if provided
  let content = userMessage;
  if (transcriptContent && context.transcriptId) {
    content = `<reference_transcript>\n${transcriptContent}\n</reference_transcript>\n\n`
      + (analysisJson ? `<reference_analysis>\n${analysisJson}\n</reference_analysis>\n\n` : '')
      + userMessage;
  }
  messages.push({ role: 'user', content });

  return messages;
}

export async function runAgent(
  win: BrowserWindow,
  userMessage: string,
  context: CurrentContext,
  transcriptContent?: string,
  analysisJson?: string
): Promise<void> {
  abortController = new AbortController();
  const signal = abortController.signal;

  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(context);
  const history = loadHistory();

  // Save user message
  saveMessage('user', userMessage);

  // Build messages array
  let messages = buildMessages(history, userMessage, context, transcriptContent, analysisJson);

  emit(win, { type: 'thinking' });

  const collectedProposals: Proposal[] = [];
  let toolCallCount = 0;
  let fullResponse = '';

  try {
    // Agentic loop
    while (true) {
      if (signal.aborted) break;

      const response = await client.messages.create(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          tools: AGENT_TOOLS,
          messages,
        },
        { signal }
      );

      // Process response content blocks
      const toolUseBlocks: Anthropic.ContentBlock[] = [];

      for (const block of response.content) {
        if (signal.aborted) break;

        if (block.type === 'text') {
          fullResponse += block.text;
          emit(win, { type: 'message_delta', content: block.text });
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }

      // If no tool calls, we're done
      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
        break;
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (signal.aborted) break;
        if (block.type !== 'tool_use') continue;

        toolCallCount++;
        if (toolCallCount > MAX_TOOL_CALLS) {
          emit(win, { type: 'error', message: 'Reached maximum tool calls for this turn' });
          break;
        }

        emit(win, { type: 'tool_call', tool: block.name, args: block.input });

        const result = executeTool(block.name, block.input as Record<string, unknown>);

        // Collect proposals
        if (block.name === 'create_task' || block.name === 'update_task') {
          const proposal = result as Proposal;
          if (proposal.proposal_id) {
            collectedProposals.push(proposal);
          }
        }

        emit(win, { type: 'tool_result', tool: block.name, result });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      if (toolCallCount > MAX_TOOL_CALLS || signal.aborted) break;

      // Append assistant response + tool results for next iteration
      messages = [
        ...messages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];
    }

    // Save assistant message (with proposals embedded)
    const messageContent = collectedProposals.length > 0
      ? JSON.stringify({ text: fullResponse, proposals: collectedProposals })
      : fullResponse;

    const messageId = saveMessage('assistant', messageContent);

    // Emit proposals if any
    if (collectedProposals.length > 0) {
      emit(win, { type: 'proposal', proposals: collectedProposals });
    }

    emit(win, { type: 'done', message_id: messageId });
  } catch (err) {
    if (signal.aborted) {
      // Save partial response on cancel
      if (fullResponse) {
        const messageId = saveMessage('assistant', fullResponse);
        emit(win, { type: 'done', message_id: messageId });
      }
    } else {
      const message = err instanceof Error ? err.message : 'Unknown error';
      emit(win, { type: 'error', message });
    }
  } finally {
    abortController = null;
  }
}

export function cancelAgent() {
  if (abortController) {
    abortController.abort();
  }
}
