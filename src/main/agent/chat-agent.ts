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

function loadHistory(sessionId: string): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(sessionId, MAX_HISTORY_MESSAGES) as ChatMessage[];
  return rows.reverse();
}

function saveMessage(role: 'user' | 'assistant', content: string, sessionId: string): string {
  const db = getDb();
  const id = uuid();
  db.prepare(
    'INSERT INTO chat_messages (id, role, content, session_id, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).run(id, role, content, sessionId);
  db.prepare(
    'UPDATE chat_sessions SET updated_at = datetime(\'now\') WHERE id = ?'
  ).run(sessionId);
  return id;
}

function buildMessages(
  history: ChatMessage[],
  userMessage: string,
  context: CurrentContext,
  transcriptContent?: string
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  let content = userMessage;
  if (transcriptContent && context.transcriptId) {
    content = `<reference_transcript>\n${transcriptContent}\n</reference_transcript>\n\n` + userMessage;
  }
  messages.push({ role: 'user', content });

  return messages;
}

export async function runAgent(
  win: BrowserWindow,
  userMessage: string,
  context: CurrentContext,
  sessionId: string,
  transcriptContent?: string
): Promise<void> {
  abortController = new AbortController();
  const signal = abortController.signal;

  const client = new Anthropic();
  const systemPrompt = buildSystemPrompt(context);
  const history = loadHistory(sessionId);

  // Save user message
  saveMessage('user', userMessage, sessionId);

  // Build messages array
  let messages = buildMessages(history, userMessage, context, transcriptContent);

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
          model: process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-20250514',
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
          emit(win, { type: 'message_delta', content: block.text });
          // Only keep text for the saved message; intermediate text is discarded
          // when a tool_call arrives (below)
          fullResponse += block.text;
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }

      // If tools are about to be called, discard intermediate text
      if (toolUseBlocks.length > 0) {
        fullResponse = '';
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

        const result = await executeTool(block.name, block.input as Record<string, unknown>);

        // Collect proposals (only when not auto-executed)
        if (block.name === 'create_task' || block.name === 'update_task' || block.name === 'delete_task') {
          const resultObj = result as Record<string, unknown>;
          if (resultObj.auto_executed) {
            emit(win, { type: 'task_changed' });
          } else if (resultObj.proposal_id) {
            collectedProposals.push(result as Proposal);
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

    const messageId = saveMessage('assistant', messageContent, sessionId);

    // Emit proposals if any
    if (collectedProposals.length > 0) {
      emit(win, { type: 'proposal', proposals: collectedProposals });
    }

    emit(win, { type: 'done', message_id: messageId });
  } catch (err) {
    if (signal.aborted) {
      // Save partial response on cancel
      if (fullResponse) {
        const messageId = saveMessage('assistant', fullResponse, sessionId);
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
