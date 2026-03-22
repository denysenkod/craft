import Anthropic from '@anthropic-ai/sdk';
import { BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { getDb } from '../db';
import { AGENT_TOOLS } from './tools';
import { executeTool, Proposal } from './tool-executor';

const MAX_TOOL_CALLS = 15;
const MAX_HISTORY_MESSAGES = 30;
const STREAM_EVENT = 'prep-chat:stream-event';

let abortController: AbortController | null = null;

// Mom Test tool (same as in meeting-chat.ts)
let momTestContent: string | null = null;
function getMomTestContent(): string {
  if (momTestContent) return momTestContent;
  try {
    const paths = [
      path.resolve(__dirname, '../../MOM_TEST_SKILL.md'),
      path.resolve(__dirname, '../../../MOM_TEST_SKILL.md'),
      path.resolve(process.cwd(), 'MOM_TEST_SKILL.md'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        momTestContent = fs.readFileSync(p, 'utf-8');
        return momTestContent;
      }
    }
  } catch { /* ignore */ }
  return '(Mom Test framework file not found)';
}

const MOM_TEST_TOOL: Anthropic.Tool = {
  name: 'get_mom_test_framework',
  description: 'Retrieves the Mom Test framework for customer interview best practices. Use when the user asks about interview techniques, question formulation, or the Mom Test methodology.',
  input_schema: { type: 'object' as const, properties: {}, required: [] },
};

const ADD_NOTE_TOOL: Anthropic.Tool = {
  name: 'add_prep_note',
  description: 'Add a note to the meeting prep notes list. Use this when the user asks to add a note or when you want to suggest a note based on the conversation.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: { type: 'string' as const, description: 'The note text' },
    },
    required: ['text'],
  },
};

const ADD_QUESTION_TOOL: Anthropic.Tool = {
  name: 'add_prep_question',
  description: 'Add a question to the meeting prep questions list. Use this when the user asks to add a question, or when you suggest interview questions for the meeting.',
  input_schema: {
    type: 'object' as const,
    properties: {
      text: { type: 'string' as const, description: 'The question text' },
    },
    required: ['text'],
  },
};

const PREP_TOOLS: Anthropic.Tool[] = [...AGENT_TOOLS, MOM_TEST_TOOL, ADD_NOTE_TOOL, ADD_QUESTION_TOOL];

interface Contact {
  id: string;
  name: string;
  email: string;
  job_title: string | null;
  profile_summary: string | null;
}

function addPrepItem(googleEventId: string, type: 'question' | 'note', text: string): { success: boolean; id: string } {
  const db = getDb();
  const row = db.prepare('SELECT notes_json FROM meeting_prep_notes WHERE google_event_id = ?').get(googleEventId) as { notes_json: string } | undefined;
  const notes = row ? JSON.parse(row.notes_json) as Array<{ id: string; text: string; type: string }> : [];
  const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  notes.push({ id, text, type });
  db.prepare(
    "INSERT INTO meeting_prep_notes (id, google_event_id, notes_json) VALUES (?, ?, ?) ON CONFLICT(google_event_id) DO UPDATE SET notes_json = excluded.notes_json, updated_at = datetime('now')"
  ).run(uuid(), googleEventId, JSON.stringify(notes));
  return { success: true, id };
}

function emit(win: BrowserWindow, event: Record<string, unknown>) {
  if (!win.isDestroyed()) {
    win.webContents.send(STREAM_EVENT, event);
  }
}

function loadHistory(googleEventId: string): Array<{ id: string; role: string; content: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT id, role, content FROM prep_chat_messages WHERE google_event_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(googleEventId, MAX_HISTORY_MESSAGES) as Array<{ id: string; role: string; content: string }>;
}

function saveMessage(googleEventId: string, role: 'user' | 'assistant', content: string): string {
  const db = getDb();
  const id = uuid();
  db.prepare(
    "INSERT INTO prep_chat_messages (id, google_event_id, role, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).run(id, googleEventId, role, content);
  return id;
}

function getAttendeeProfiles(googleEventId: string): Contact[] {
  const db = getDb();
  return db.prepare(
    'SELECT c.* FROM meeting_attendees ma JOIN contacts c ON ma.contact_id = c.id WHERE ma.google_event_id = ?'
  ).all(googleEventId) as Contact[];
}

function buildPrepSystemPrompt(meetingTitle: string, meetingDate: string, attendees: Contact[]): string {
  let prompt = `You are a meeting preparation assistant helping the user get ready for their upcoming meeting.

Meeting: "${meetingTitle}"
Date: ${meetingDate}

You have access to tools for searching past transcripts, meetings, tasks, and the Mom Test framework. Use these to help the user:
- Review past interactions with attendees
- Formulate good interview questions
- Identify relevant context from previous meetings
- Suggest talking points based on open tasks or issues

Be concise and actionable. Use bullet points for lists.`;

  if (attendees.length > 0) {
    prompt += '\n\nAttendees:';
    for (const a of attendees) {
      prompt += `\n- ${a.name} (${a.email})`;
      if (a.job_title) prompt += ` — ${a.job_title}`;
      if (a.profile_summary) prompt += `\n  Profile: ${a.profile_summary}`;
    }
  }

  return prompt;
}

export async function runPrepAgent(
  win: BrowserWindow,
  message: string,
  googleEventId: string,
  meetingTitle: string,
  meetingDate: string
): Promise<void> {
  abortController = new AbortController();
  const signal = abortController.signal;

  const client = new Anthropic();
  const attendees = getAttendeeProfiles(googleEventId);
  const systemPrompt = buildPrepSystemPrompt(meetingTitle, meetingDate, attendees);

  const history = loadHistory(googleEventId).reverse();
  saveMessage(googleEventId, 'user', message);

  // Build messages
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));
  messages.push({ role: 'user', content: message });

  emit(win, { type: 'thinking' });

  const collectedProposals: Proposal[] = [];
  let toolCallCount = 0;
  let fullResponse = '';

  try {
    let currentMessages = messages;

    while (true) {
      if (signal.aborted) break;

      const response = await client.messages.create(
        {
          model: process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          system: systemPrompt,
          tools: PREP_TOOLS,
          messages: currentMessages,
        },
        { signal }
      );

      const toolUseBlocks: Anthropic.ContentBlock[] = [];

      for (const block of response.content) {
        if (signal.aborted) break;
        if (block.type === 'text') {
          emit(win, { type: 'message_delta', content: block.text });
          fullResponse += block.text;
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }

      if (toolUseBlocks.length > 0) fullResponse = '';

      if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (signal.aborted) break;
        if (block.type !== 'tool_use') continue;

        toolCallCount++;
        if (toolCallCount > MAX_TOOL_CALLS) break;

        emit(win, { type: 'tool_call', tool: block.name, args: block.input });

        let result: unknown;
        if (block.name === 'get_mom_test_framework') {
          result = getMomTestContent();
        } else if (block.name === 'add_prep_note' || block.name === 'add_prep_question') {
          const input = block.input as { text: string };
          const noteType = block.name === 'add_prep_question' ? 'question' : 'note';
          result = addPrepItem(googleEventId, noteType, input.text);
          emit(win, { type: 'notes_updated', noteType, text: input.text });
        } else {
          result = await executeTool(block.name, block.input as Record<string, unknown>);
        }

        if (block.name === 'create_task' || block.name === 'update_task') {
          const proposal = result as Proposal;
          if (proposal.proposal_id) collectedProposals.push(proposal);
        }

        emit(win, { type: 'tool_result', tool: block.name, result });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      if (toolCallCount > MAX_TOOL_CALLS || signal.aborted) break;

      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];
    }

    const messageContent = collectedProposals.length > 0
      ? JSON.stringify({ text: fullResponse, proposals: collectedProposals })
      : fullResponse;

    const messageId = saveMessage(googleEventId, 'assistant', messageContent);

    if (collectedProposals.length > 0) {
      emit(win, { type: 'proposal', proposals: collectedProposals });
    }

    emit(win, { type: 'done', message_id: messageId });
  } catch (err) {
    if (signal.aborted) {
      if (fullResponse) {
        const messageId = saveMessage(googleEventId, 'assistant', fullResponse);
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

export function cancelPrepAgent() {
  if (abortController) abortController.abort();
}
