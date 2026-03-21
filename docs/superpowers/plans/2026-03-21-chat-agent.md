# Chat Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a context-aware chat agent with agentic tool use, streaming UI, and proposal-based task management.

**Architecture:** Streaming agentic loop in Electron main process. Claude API with tool_use iterates until it has enough info to respond. Events stream to the React renderer after each step. Task create/update actions return proposals rendered as approvable cards — no DB writes without user approval.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, @anthropic-ai/sdk 0.80.0, uuid

**Spec:** `docs/superpowers/specs/2026-03-21-chat-agent-design.md`

---

### Task 1: Schema Migration & DB Changes

**Files:**
- Modify: `src/main/db/schema.ts:19-36`
- Modify: `src/main/db/index.ts:8-15`

- [ ] **Step 1: Update schema.ts to make transcript_id nullable**

In `src/main/db/schema.ts`, remove `NOT NULL` from `tasks.transcript_id` (line 21) and `chat_messages.transcript_id` (line 32):

```typescript
// tasks table — line 21
transcript_id TEXT REFERENCES transcripts(id),  // was: TEXT NOT NULL REFERENCES

// chat_messages table — line 32
transcript_id TEXT REFERENCES transcripts(id),  // was: TEXT NOT NULL REFERENCES
```

- [ ] **Step 2: Add migration function to db/index.ts**

Add after the existing `getDb()` function:

```typescript
const CURRENT_VERSION = 1;

export function migrate() {
  const db = getDb();
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE chat_messages_new (
          id TEXT PRIMARY KEY,
          transcript_id TEXT REFERENCES transcripts(id),
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO chat_messages_new SELECT * FROM chat_messages;
        DROP TABLE chat_messages;
        ALTER TABLE chat_messages_new RENAME TO chat_messages;

        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY,
          transcript_id TEXT REFERENCES transcripts(id),
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          linear_issue_id TEXT,
          source TEXT NOT NULL DEFAULT 'auto',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO tasks_new SELECT * FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `);
      db.pragma(`user_version = ${CURRENT_VERSION}`);
    })();
  }
}
```

- [ ] **Step 3: Call migrate() in app startup**

In `src/main/index.ts`, import and call `migrate` after `initDb()`:

```typescript
import { initDb, migrate } from './db';

// In app.whenReady():
initDb();
migrate();
registerAllHandlers();
```

- [ ] **Step 4: Verify the app starts without errors**

Run: `npm start`
Expected: App launches, no errors in console. Check DevTools console for "IPC handlers registered".

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts src/main/db/index.ts src/main/index.ts
git commit -m "feat: add schema migration for nullable transcript_id"
```

---

### Task 2: Preload — Add Listener Support & New Channels

**Files:**
- Modify: `src/main/preload.ts:1-22`

- [ ] **Step 1: Rewrite preload.ts with invoke + listener support**

Replace the entire file:

```typescript
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

const invokeChannels = [
  'meeting:create', 'meeting:list', 'meeting:get-status', 'meeting:paste-transcript',
  'transcript:get', 'transcript:analyze',
  'chat:send-message', 'chat:cancel', 'chat:get-history', 'chat:clear-history',
  'chat:approve-proposal', 'chat:reject-proposal',
  'task:list', 'task:create', 'task:update-status', 'task:push-to-linear',
  'linear:auth', 'linear:status', 'linear:disconnect', 'linear:get-teams', 'linear:get-issues', 'linear:get-states',
  'settings:get', 'settings:set',
  'momtest:generate-questions',
] as const;

const listenChannels = [
  'chat:stream-event',
] as const;

type InvokeChannel = typeof invokeChannels[number];
type ListenChannel = typeof listenChannels[number];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: InvokeChannel, ...args: unknown[]) => {
    if (!(invokeChannels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid invoke channel: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel: ListenChannel, callback: (...args: unknown[]) => void) => {
    if (!(listenChannels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid listen channel: ${channel}`);
    }
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return subscription;
  },
  off: (channel: ListenChannel, subscription: (...args: unknown[]) => void) => {
    if (!(listenChannels as readonly string[]).includes(channel)) {
      throw new Error(`Invalid listen channel: ${channel}`);
    }
    ipcRenderer.removeListener(channel, subscription);
  },
});
```

- [ ] **Step 2: Verify the app starts**

Run: `npm start`
Expected: App launches, no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/preload.ts
git commit -m "feat: add IPC listener support and chat channels to preload"
```

---

### Task 3: Tool Definitions for Claude API

**Files:**
- Create: `src/main/agent/tools.ts`

- [ ] **Step 1: Create the agent directory**

```bash
mkdir -p src/main/agent
```

- [ ] **Step 2: Create the tools.ts file with all 8 tool definitions**

```typescript
import Anthropic from '@anthropic-ai/sdk';

type Tool = Anthropic.Tool;

export const AGENT_TOOLS: Tool[] = [
  {
    name: 'get_transcript',
    description: 'Fetch a transcript by ID with its raw text and structured analysis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        transcript_id: { type: 'string', description: 'The transcript UUID' },
      },
      required: ['transcript_id'],
    },
  },
  {
    name: 'search_transcripts',
    description: 'Full-text search across all transcript content. Returns matching excerpts with their transcript and meeting context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query to match against transcript text' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_meeting',
    description: 'Fetch metadata for a specific meeting.',
    input_schema: {
      type: 'object' as const,
      properties: {
        meeting_id: { type: 'string', description: 'The meeting UUID' },
      },
      required: ['meeting_id'],
    },
  },
  {
    name: 'list_meetings',
    description: 'List meetings, optionally filtered by status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'recording', 'done', 'failed'], description: 'Filter by meeting status' },
        limit: { type: 'number', description: 'Max results to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'get_task',
    description: 'Fetch a specific task with its full details and the title of the meeting it originated from.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task UUID' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional filters by status or source transcript.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['draft', 'approved', 'rejected', 'pushed'], description: 'Filter by task status' },
        transcript_id: { type: 'string', description: 'Filter to tasks from a specific transcript' },
        limit: { type: 'number', description: 'Max results to return (default 50)' },
      },
      required: [],
    },
  },
  {
    name: 'create_task',
    description: 'Propose creating a new task. This returns a proposal that the user must approve before it is saved. Use this when the user asks to create a task or when you identify actionable work from a transcript.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Clear, actionable task title a developer can act on' },
        description: { type: 'string', description: 'Detailed description with context and acceptance criteria' },
        transcript_id: { type: 'string', description: 'Source transcript ID (if applicable)' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'update_task',
    description: 'Propose updating an existing task. Returns a proposal showing the diff of changes for user review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string', description: 'The task UUID to update' },
        title: { type: 'string', description: 'New title (if changing)' },
        description: { type: 'string', description: 'New description (if changing)' },
        reason: { type: 'string', description: 'Why this update is suggested' },
      },
      required: ['task_id', 'reason'],
    },
  },
];
```

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tools.ts
git commit -m "feat: define chat agent tool schemas for Claude API"
```

---

### Task 4: Tool Executor

**Files:**
- Create: `src/main/agent/tool-executor.ts`

- [ ] **Step 1: Create tool-executor.ts**

```typescript
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';

export interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update';
  status: 'pending' | 'approved' | 'rejected';
  // create fields
  title?: string;
  description?: string;
  transcript_id?: string;
  // update fields
  task_id?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string } };
  reason?: string;
}

export function executeTool(name: string, input: Record<string, unknown>): unknown {
  const db = getDb();

  switch (name) {
    case 'get_transcript': {
      const row = db.prepare(`
        SELECT t.id, t.meeting_id, t.raw_text, t.analysis_json, t.created_at,
               m.title as meeting_title
        FROM transcripts t
        JOIN meetings m ON m.id = t.meeting_id
        WHERE t.id = ?
      `).get(input.transcript_id as string) as Record<string, unknown> | undefined;
      if (!row) return { error: 'Transcript not found' };
      return {
        ...row,
        analysis: row.analysis_json ? JSON.parse(row.analysis_json as string) : null,
      };
    }

    case 'search_transcripts': {
      const limit = (input.limit as number) || 10;
      const query = `%${input.query as string}%`;
      const rows = db.prepare(`
        SELECT t.id as transcript_id, t.meeting_id, m.title as meeting_title, t.created_at,
               substr(t.raw_text, max(1, instr(lower(t.raw_text), lower(?)) - 100), 300) as snippet
        FROM transcripts t
        JOIN meetings m ON m.id = t.meeting_id
        WHERE t.raw_text LIKE ?
        LIMIT ?
      `).all(input.query as string, query, limit);
      return rows;
    }

    case 'get_meeting': {
      const row = db.prepare(`
        SELECT m.id, m.title, m.meeting_url, m.status, m.created_at,
               EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = m.id) as has_transcript
        FROM meetings m WHERE m.id = ?
      `).get(input.meeting_id as string);
      if (!row) return { error: 'Meeting not found' };
      return row;
    }

    case 'list_meetings': {
      const limit = (input.limit as number) || 20;
      const status = input.status as string | undefined;
      if (status) {
        return db.prepare(`
          SELECT m.id, m.title, m.status, m.created_at,
                 EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = m.id) as has_transcript
          FROM meetings m WHERE m.status = ? ORDER BY m.created_at DESC LIMIT ?
        `).all(status, limit);
      }
      return db.prepare(`
        SELECT m.id, m.title, m.status, m.created_at,
               EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = m.id) as has_transcript
        FROM meetings m ORDER BY m.created_at DESC LIMIT ?
      `).all(limit);
    }

    case 'get_task': {
      const row = db.prepare(`
        SELECT t.id, t.transcript_id, t.title, t.description, t.status,
               t.source, t.linear_issue_id, t.created_at,
               m.title as meeting_title
        FROM tasks t
        LEFT JOIN transcripts tr ON tr.id = t.transcript_id
        LEFT JOIN meetings m ON m.id = tr.meeting_id
        WHERE t.id = ?
      `).get(input.task_id as string);
      if (!row) return { error: 'Task not found' };
      return row;
    }

    case 'list_tasks': {
      const limit = (input.limit as number) || 50;
      const status = input.status as string | undefined;
      const transcriptId = input.transcript_id as string | undefined;

      let sql = `
        SELECT t.id, t.title, t.description, t.status, t.source,
               t.transcript_id, t.created_at, m.title as meeting_title
        FROM tasks t
        LEFT JOIN transcripts tr ON tr.id = t.transcript_id
        LEFT JOIN meetings m ON m.id = tr.meeting_id
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (status) { conditions.push('t.status = ?'); params.push(status); }
      if (transcriptId) { conditions.push('t.transcript_id = ?'); params.push(transcriptId); }

      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY t.created_at DESC LIMIT ?';
      params.push(limit);

      return db.prepare(sql).all(...params);
    }

    case 'create_task': {
      const proposal: Proposal = {
        proposal_id: uuid(),
        proposal_type: 'create',
        status: 'pending',
        title: input.title as string,
        description: input.description as string,
        transcript_id: input.transcript_id as string | undefined,
      };
      return proposal;
    }

    case 'update_task': {
      const existing = db.prepare('SELECT id, title, description FROM tasks WHERE id = ?')
        .get(input.task_id as string) as { id: string; title: string; description: string } | undefined;
      if (!existing) return { error: 'Task not found' };

      const changes: Proposal['changes'] = {};
      if (input.title) changes.title = { old: existing.title, new: input.title as string };
      if (input.description) changes.description = { old: existing.description, new: input.description as string };

      const proposal: Proposal = {
        proposal_id: uuid(),
        proposal_type: 'update',
        status: 'pending',
        task_id: input.task_id as string,
        changes,
        reason: input.reason as string,
      };
      return proposal;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm start`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/tool-executor.ts
git commit -m "feat: implement tool executor with SQLite queries and proposal generation"
```

---

### Task 5: System Prompt Builder

**Files:**
- Create: `src/main/agent/system-prompt.ts`

- [ ] **Step 1: Create system-prompt.ts**

```typescript
export interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
}

const IDENTITY = `You are a product management assistant embedded in a PM tool.
You help product managers analyze customer interviews, extract insights, and manage development tasks.

You have access to tools that let you read transcripts, meetings, and tasks. You can also propose creating or updating tasks — these proposals will be shown to the user for approval before taking effect.

Guidelines:
- Be concise and actionable
- Reference specific quotes from transcripts when possible
- When proposing tasks, write clear titles and descriptions that a developer can act on
- If asked about something you can look up, use your tools rather than guessing
- You can propose multiple task changes at once when the user's request is broad
- When updating tasks, always explain why you're suggesting the change`;

export function buildSystemPrompt(context: CurrentContext): string {
  let contextBlock = '';

  if (context.screen === 'transcript' && context.transcriptId) {
    contextBlock = `
<current_context>
The user is currently viewing a transcript.
Transcript ID: ${context.transcriptId}
${context.meetingId ? `Meeting ID: ${context.meetingId}` : ''}
If the user asks about "this transcript" or "this meeting", they mean the one above.
You do NOT need to fetch this transcript unless the user asks about a different one — its content will be provided as reference context.
</current_context>`;
  } else if (context.screen === 'meetings') {
    contextBlock = `
<current_context>
The user is on the Meetings screen. No specific transcript is open.
</current_context>`;
  } else if (context.screen === 'tasks') {
    contextBlock = `
<current_context>
The user is on the Tasks screen reviewing their task board.
</current_context>`;
  }

  return IDENTITY + '\n' + contextBlock;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/agent/system-prompt.ts
git commit -m "feat: add system prompt builder with dynamic context injection"
```

---

### Task 6: Chat Agent — Agentic Loop with Streaming

**Files:**
- Create: `src/main/agent/chat-agent.ts`

- [ ] **Step 1: Create chat-agent.ts with the agentic loop**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm start`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/chat-agent.ts
git commit -m "feat: implement agentic loop with tool execution and streaming events"
```

---

### Task 7: IPC Chat Handlers

**Files:**
- Create: `src/main/ipc/chat.ts`
- Modify: `src/main/ipc/index.ts:1-12`

- [ ] **Step 1: Create chat.ts IPC handlers**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { runAgent, cancelAgent } from '../agent/chat-agent';
import { CurrentContext } from '../agent/system-prompt';

export function registerChatHandlers() {
  ipcMain.handle('chat:send-message', async (event, data: { message: string; context: CurrentContext; transcriptContent?: string; analysisJson?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    // Fire-and-forget — streaming events handle the response.
    // We don't await so the invoke resolves immediately.
    runAgent(win, data.message, data.context, data.transcriptContent, data.analysisJson).catch(err => {
      console.error('Agent error:', err);
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream-event', { type: 'error', message: err.message || 'Unknown error' });
      }
    });
  });

  ipcMain.handle('chat:cancel', async () => {
    cancelAgent();
  });

  ipcMain.handle('chat:get-history', async () => {
    const db = getDb();
    return db.prepare('SELECT id, role, content, created_at FROM chat_messages ORDER BY created_at ASC').all();
  });

  ipcMain.handle('chat:clear-history', async () => {
    const db = getDb();
    db.prepare('DELETE FROM chat_messages').run();
  });

  ipcMain.handle('chat:approve-proposal', async (_event, data: { proposal_id: string; proposal: unknown }) => {
    const db = getDb();
    const proposal = data.proposal as {
      proposal_type: string;
      title?: string;
      description?: string;
      transcript_id?: string;
      task_id?: string;
      changes?: { title?: { new: string }; description?: { new: string } };
    };

    if (proposal.proposal_type === 'create') {
      const id = uuid();
      db.prepare(
        'INSERT INTO tasks (id, transcript_id, title, description, source) VALUES (?, ?, ?, ?, ?)'
      ).run(id, proposal.transcript_id || null, proposal.title, proposal.description, 'chat');
      // Update proposal status in chat message
      updateProposalStatus(db, data.proposal_id, 'approved');
      return { id, title: proposal.title };
    }

    if (proposal.proposal_type === 'update' && proposal.task_id) {
      if (proposal.changes?.title) {
        db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(proposal.changes.title.new, proposal.task_id);
      }
      if (proposal.changes?.description) {
        db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(proposal.changes.description.new, proposal.task_id);
      }
      updateProposalStatus(db, data.proposal_id, 'approved');
      return { id: proposal.task_id };
    }
  });

  ipcMain.handle('chat:reject-proposal', async (_event, data: { proposal_id: string }) => {
    const db = getDb();
    updateProposalStatus(db, data.proposal_id, 'rejected');
  });
}

function updateProposalStatus(db: ReturnType<typeof getDb>, proposalId: string, status: 'approved' | 'rejected') {
  // Find the message containing this proposal and update its status
  const rows = db.prepare(
    "SELECT id, content FROM chat_messages WHERE content LIKE '%' || ? || '%'"
  ).all(proposalId) as { id: string; content: string }[];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.content);
      if (parsed.proposals) {
        for (const p of parsed.proposals) {
          if (p.proposal_id === proposalId) {
            p.status = status;
          }
        }
        db.prepare('UPDATE chat_messages SET content = ? WHERE id = ?')
          .run(JSON.stringify(parsed), row.id);
      }
    } catch {
      // Not JSON content, skip
    }
  }
}
```

- [ ] **Step 2: Register chat handlers in ipc/index.ts**

Add to `src/main/ipc/index.ts`:

```typescript
import { ipcMain } from 'electron';
import { registerLinearHandlers } from './linear';
import { registerChatHandlers } from './chat';

export function registerAllHandlers() {
  ipcMain.handle('settings:get', async () => ({}));
  ipcMain.handle('settings:set', async (_e, _data) => {});

  registerLinearHandlers();
  registerChatHandlers();

  console.log('IPC handlers registered');
}
```

- [ ] **Step 3: Verify the app starts**

Run: `npm start`
Expected: App launches, console shows "IPC handlers registered".

- [ ] **Step 4: Commit**

```bash
git add src/main/ipc/chat.ts src/main/ipc/index.ts
git commit -m "feat: register chat IPC handlers for send, cancel, history, proposals"
```

---

### Task 8: App.tsx — Track Context & Pass to ChatInterface

**Files:**
- Modify: `src/renderer/App.tsx:1-92`

- [ ] **Step 1: Add context tracking state to App.tsx**

Add `transcriptId` and `meetingId` state, pass context as props to `ChatInterface`:

```typescript
import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import MeetingList from './components/MeetingList';
import TranscriptView from './components/TranscriptView';
import ChatInterface from './components/ChatInterface';
import TaskReview from './components/TaskReview';
import SettingsModal from './components/SettingsModal';
import MomTestModal from './components/MomTestModal';

type Screen = 'meetings' | 'transcript' | 'tasks';

export interface CurrentContext {
  screen: Screen;
  transcriptId?: string;
  meetingId?: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('meetings');
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [momTestOpen, setMomTestOpen] = useState(false);
  const [transcriptId, setTranscriptId] = useState<string | undefined>();
  const [meetingId, setMeetingId] = useState<string | undefined>();

  const context: CurrentContext = { screen, transcriptId, meetingId };

  const handleOpenTranscript = (tId: string, mId: string) => {
    setTranscriptId(tId);
    setMeetingId(mId);
    setScreen('transcript');
  };

  return (
    <div className="flex h-screen bg-surface-0">
      {/* Titlebar */}
      <div
        className="fixed top-0 left-0 right-0 h-10 z-50 border-b border-border-base"
        style={{ background: '#07070A', WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Sidebar */}
      <div style={{ paddingTop: '40px' }}>
        <Sidebar active={screen} onNavigate={setScreen} onSettings={() => setSettingsOpen(true)} />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface-1" style={{ marginTop: '40px' }}>
        {screen === 'meetings' && (
          <MeetingList
            onOpenTranscript={handleOpenTranscript}
            onOpenMomTest={() => setMomTestOpen(true)}
          />
        )}
        {screen === 'transcript' && (
          <TranscriptView onOpenChat={() => setChatOpen(true)} />
        )}
        {screen === 'tasks' && <TaskReview />}
      </div>

      {/* Chat toggle button */}
      <button
        onClick={() => setChatOpen(!chatOpen)}
        className="fixed bottom-6 right-6 z-40 w-11 h-11 flex items-center justify-center border transition-all duration-200"
        style={{
          background: chatOpen ? '#E8A838' : '#1C1C22',
          borderColor: chatOpen ? '#E8A838' : '#3A3A44',
          right: chatOpen ? 'calc(420px + 24px)' : '24px',
        }}
        title={chatOpen ? 'Close chat' : 'Open chat'}
      >
        <svg fill="none" stroke={chatOpen ? '#07070A' : '#9C9890'} strokeWidth={1.5} viewBox="0 0 24 24" className="w-[18px] h-[18px]">
          <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>

      {/* Chat right sidebar */}
      <div
        className="fixed top-10 right-0 bottom-0 bg-surface-0 border-l border-border-base z-30 flex flex-col transition-transform duration-200"
        style={{
          width: '420px',
          transform: chatOpen ? 'translateX(0)' : 'translateX(100%)',
        }}
      >
        {/* Chat header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-base shrink-0">
          <div>
            <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Chat</div>
            <div className="text-[13px] font-medium text-text-primary mt-0.5">PM Assistant</div>
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ChatInterface context={context} />
      </div>

      {/* Modals */}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MomTestModal open={momTestOpen} onClose={() => setMomTestOpen(false)} />
    </div>
  );
}
```

- [ ] **Step 2: Update MeetingList prop type and click handler**

In `src/renderer/components/MeetingList.tsx`, change the prop type (line 10) and the click handler to pass IDs:

```typescript
// Line 10: change prop type
onOpenTranscript: (transcriptId: string, meetingId: string) => void;
```

Find the meeting click handler (around line 94) and update it to pass the meeting ID. Since the app currently uses mock data, pass the mock meeting's `id` as both transcriptId and meetingId for now:

```typescript
onClick={() => m.status === 'done' && onOpenTranscript(m.id, m.id)}
```

- [ ] **Step 3: Commit (TS errors on ChatInterface props expected until Task 10)**

```bash
git add src/renderer/App.tsx src/renderer/components/MeetingList.tsx
git commit -m "feat: track transcript/meeting context in App and pass to ChatInterface"
```

---

### Task 9: Chat Sub-Components — MessageBubble, ToolCallIndicator, ProposalCard

**Files:**
- Create: `src/renderer/components/chat/MessageBubble.tsx`
- Create: `src/renderer/components/chat/ToolCallIndicator.tsx`
- Create: `src/renderer/components/chat/ProposalCard.tsx`

- [ ] **Step 1: Create the chat components directory**

```bash
mkdir -p src/renderer/components/chat
```

- [ ] **Step 2: Create MessageBubble.tsx**

```typescript
import React from 'react';

interface Props {
  role: 'user' | 'assistant';
  content: string;
}

export default function MessageBubble({ role, content }: Props) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[85%] px-4 py-3 text-[13px] leading-relaxed"
        style={{
          background: role === 'user' ? '#E8A838' : '#1C1C22',
          color: role === 'user' ? '#07070A' : '#F0EDE8',
          borderRadius: role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          whiteSpace: 'pre-line',
        }}
      >
        {content}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ToolCallIndicator.tsx**

```typescript
import React from 'react';

const TOOL_LABELS: Record<string, string> = {
  get_transcript: 'Reading transcript',
  search_transcripts: 'Searching transcripts',
  get_meeting: 'Looking up meeting',
  list_meetings: 'Listing meetings',
  get_task: 'Looking up task',
  list_tasks: 'Listing tasks',
  create_task: 'Drafting task',
  update_task: 'Preparing task update',
};

interface Props {
  tool: string;
  args: Record<string, unknown>;
}

export default function ToolCallIndicator({ tool, args }: Props) {
  const label = TOOL_LABELS[tool] || `Running ${tool}`;
  const detail = args.query ? `"${args.query}"` : args.task_id || args.transcript_id || '';

  return (
    <div className="self-start flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-2 border border-border-base text-[12px] text-text-muted">
      <span
        className="w-1.5 h-1.5 rounded-full bg-honey"
        style={{ animation: 'thinkBounce 1.4s ease-in-out infinite' }}
      />
      <span>{label}</span>
      {detail && <span className="text-text-muted/60 truncate max-w-[200px]">{String(detail)}</span>}
    </div>
  );
}
```

- [ ] **Step 4: Create ProposalCard.tsx**

```typescript
import React from 'react';

interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update';
  status: 'pending' | 'approved' | 'rejected';
  title?: string;
  description?: string;
  transcript_id?: string;
  task_id?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string } };
  reason?: string;
}

interface Props {
  proposal: Proposal;
  onApprove: (proposal: Proposal) => void;
  onReject: (proposalId: string) => void;
}

export default function ProposalCard({ proposal, onApprove, onReject }: Props) {
  const isResolved = proposal.status !== 'pending';

  if (proposal.proposal_type === 'create') {
    return (
      <div className="max-w-[85%] rounded-2xl overflow-hidden border border-honey/20 bg-surface-2">
        <div className="px-4 py-3">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-honey mb-1.5">
            {isResolved
              ? proposal.status === 'approved' ? 'Task Created' : 'Task Dismissed'
              : 'Create Task?'}
          </div>
          <div className="text-[14px] font-medium text-text-primary mb-1">{proposal.title}</div>
          <div className="text-[12px] text-text-secondary leading-snug">{proposal.description}</div>
        </div>
        {!isResolved && (
          <div className="flex gap-1.5 px-4 py-2.5 border-t border-honey/10">
            <button
              onClick={() => onApprove(proposal)}
              className="font-mono text-[10px] font-semibold px-3 py-1.5 bg-honey text-surface-0 rounded-full uppercase tracking-wider hover:bg-honey-dim transition-all"
            >
              Approve
            </button>
            <button
              onClick={() => onReject(proposal.proposal_id)}
              className="font-mono text-[10px] font-medium px-3 py-1.5 border border-border-strong bg-surface-3 text-text-secondary rounded-full uppercase tracking-wider hover:border-red-400 hover:text-red-400 transition-all"
            >
              Reject
            </button>
          </div>
        )}
        {isResolved && (
          <div className="px-4 py-2 border-t border-honey/10">
            <span className={`font-mono text-[10px] uppercase tracking-wider ${proposal.status === 'approved' ? 'text-green-400' : 'text-text-muted'}`}>
              {proposal.status === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          </div>
        )}
      </div>
    );
  }

  // Update proposal
  return (
    <div className="max-w-[85%] rounded-2xl overflow-hidden border border-blue-400/20 bg-surface-2">
      <div className="px-4 py-3">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-blue-400 mb-1.5">
          {isResolved
            ? proposal.status === 'approved' ? 'Task Updated' : 'Update Dismissed'
            : 'Update Task?'}
        </div>
        {proposal.reason && (
          <div className="text-[12px] text-text-secondary mb-2 italic">{proposal.reason}</div>
        )}
        {proposal.changes?.title && (
          <div className="mb-1.5">
            <div className="font-mono text-[10px] text-text-muted mb-0.5">Title</div>
            <div className="text-[12px] text-red-400/70 line-through">{proposal.changes.title.old}</div>
            <div className="text-[12px] text-green-400">{proposal.changes.title.new}</div>
          </div>
        )}
        {proposal.changes?.description && (
          <div>
            <div className="font-mono text-[10px] text-text-muted mb-0.5">Description</div>
            <div className="text-[11px] text-red-400/70 line-through leading-snug">{proposal.changes.description.old}</div>
            <div className="text-[11px] text-green-400 leading-snug mt-0.5">{proposal.changes.description.new}</div>
          </div>
        )}
      </div>
      {!isResolved && (
        <div className="flex gap-1.5 px-4 py-2.5 border-t border-blue-400/10">
          <button
            onClick={() => onApprove(proposal)}
            className="font-mono text-[10px] font-semibold px-3 py-1.5 bg-blue-500 text-white rounded-full uppercase tracking-wider hover:bg-blue-400 transition-all"
          >
            Approve
          </button>
          <button
            onClick={() => onReject(proposal.proposal_id)}
            className="font-mono text-[10px] font-medium px-3 py-1.5 border border-border-strong bg-surface-3 text-text-secondary rounded-full uppercase tracking-wider hover:border-red-400 hover:text-red-400 transition-all"
          >
            Reject
          </button>
        </div>
      )}
      {isResolved && (
        <div className="px-4 py-2 border-t border-blue-400/10">
          <span className={`font-mono text-[10px] uppercase tracking-wider ${proposal.status === 'approved' ? 'text-green-400' : 'text-text-muted'}`}>
            {proposal.status === 'approved' ? 'Approved' : 'Rejected'}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Commit (app will not compile until Task 10 rewires ChatInterface)**

```bash
git add src/renderer/components/chat/
git commit -m "feat: add MessageBubble, ToolCallIndicator, and ProposalCard components"
```

---

### Task 10: ChatInterface — Wire to Real IPC with State Machine

**Files:**
- Modify: `src/renderer/components/ChatInterface.tsx:1-121`

- [ ] **Step 1: Rewrite ChatInterface.tsx with real IPC integration**

Replace the entire file:

```typescript
import React, { useState, useEffect, useRef } from 'react';
import MessageBubble from './chat/MessageBubble';
import ToolCallIndicator from './chat/ToolCallIndicator';
import ProposalCard from './chat/ProposalCard';

declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on: (channel: string, callback: (...args: unknown[]) => void) => (...args: unknown[]) => void;
      off: (channel: string, subscription: (...args: unknown[]) => void) => void;
    };
  }
}

interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
}

interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update';
  status: 'pending' | 'approved' | 'rejected';
  title?: string;
  description?: string;
  transcript_id?: string;
  task_id?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string } };
  reason?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface ParsedMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposals?: Proposal[];
}

type AgentStatus = 'idle' | 'thinking' | 'tool_call' | 'streaming';

function parseMessage(msg: ChatMessage): ParsedMessage {
  if (msg.role === 'assistant') {
    try {
      const parsed = JSON.parse(msg.content);
      if (parsed.text !== undefined && parsed.proposals) {
        return { id: msg.id, role: msg.role, text: parsed.text, proposals: parsed.proposals };
      }
    } catch {
      // Not JSON, treat as plain text
    }
  }
  return { id: msg.id, role: msg.role, text: msg.content };
}

interface Props {
  context: CurrentContext;
}

export default function ChatInterface({ context }: Props) {
  const [messages, setMessages] = useState<ParsedMessage[]>([]);
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [activeTool, setActiveTool] = useState<{ name: string; args: Record<string, unknown> } | null>(null);
  const [streamBuffer, setStreamBuffer] = useState('');
  const [pendingProposals, setPendingProposals] = useState<Proposal[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load history on mount
  useEffect(() => {
    (async () => {
      const history = await window.api.invoke('chat:get-history') as ChatMessage[];
      setMessages(history.map(parseMessage));
    })();
  }, []);

  // Subscribe to stream events
  useEffect(() => {
    const handler = (event: unknown) => {
      const e = event as Record<string, unknown>;
      switch (e.type) {
        case 'thinking':
          setAgentStatus('thinking');
          break;
        case 'tool_call':
          setAgentStatus('tool_call');
          setActiveTool({ name: e.tool as string, args: e.args as Record<string, unknown> });
          break;
        case 'tool_result':
          setActiveTool(null);
          break;
        case 'message_delta':
          setAgentStatus('streaming');
          setStreamBuffer(prev => prev + (e.content as string));
          break;
        case 'proposal':
          setPendingProposals(prev => [...prev, ...(e.proposals as Proposal[])]);
          break;
        case 'done': {
          setAgentStatus('idle');
          setActiveTool(null);
          // Reload messages from DB to get the persisted state
          (async () => {
            const history = await window.api.invoke('chat:get-history') as ChatMessage[];
            setMessages(history.map(parseMessage));
          })();
          setStreamBuffer('');
          setPendingProposals([]);
          break;
        }
        case 'error':
          setAgentStatus('idle');
          setActiveTool(null);
          setStreamBuffer('');
          break;
      }
    };

    const subscription = window.api.on('chat:stream-event', handler);
    return () => { window.api.off('chat:stream-event', subscription); };
  }, []);

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamBuffer, agentStatus]);

  // Track which transcript context was last sent to avoid re-sending
  const lastSentContextRef = useRef<string | undefined>(undefined);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || agentStatus !== 'idle') return;

    setInput('');
    // Optimistic: add user message immediately
    const tempMsg: ParsedMessage = { id: 'temp-' + Date.now(), role: 'user', text };
    setMessages(prev => [...prev, tempMsg]);

    // Include transcript content on first message after context change
    let transcriptContent: string | undefined;
    let analysisJson: string | undefined;
    if (context.transcriptId && context.transcriptId !== lastSentContextRef.current) {
      try {
        const transcript = await window.api.invoke('transcript:get', context.transcriptId) as
          { raw_text?: string; analysis_json?: string } | undefined;
        if (transcript) {
          transcriptContent = transcript.raw_text;
          analysisJson = transcript.analysis_json;
        }
      } catch {
        // Transcript not available, continue without it
      }
      lastSentContextRef.current = context.transcriptId;
    }

    await window.api.invoke('chat:send-message', { message: text, context, transcriptContent, analysisJson });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCancel = () => {
    window.api.invoke('chat:cancel');
  };

  const handleApprove = async (proposal: Proposal) => {
    await window.api.invoke('chat:approve-proposal', { proposal_id: proposal.proposal_id, proposal });
    // Update local state
    setMessages(prev => prev.map(msg => {
      if (!msg.proposals) return msg;
      return {
        ...msg,
        proposals: msg.proposals.map(p =>
          p.proposal_id === proposal.proposal_id ? { ...p, status: 'approved' as const } : p
        ),
      };
    }));
  };

  const handleReject = async (proposalId: string) => {
    await window.api.invoke('chat:reject-proposal', { proposal_id: proposalId });
    setMessages(prev => prev.map(msg => {
      if (!msg.proposals) return msg;
      return {
        ...msg,
        proposals: msg.proposals.map(p =>
          p.proposal_id === proposalId ? { ...p, status: 'rejected' as const } : p
        ),
      };
    }));
  };

  const handleClearHistory = async () => {
    await window.api.invoke('chat:clear-history');
    setMessages([]);
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden p-3">
      <div className="flex flex-col flex-1 overflow-hidden rounded-2xl border border-border-base bg-surface-1">
        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">
          {messages.length === 0 && agentStatus === 'idle' && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-text-muted text-[13px]">Ask me anything about your meetings and tasks.</p>
            </div>
          )}

          {messages.map((msg) => (
            <React.Fragment key={msg.id}>
              <MessageBubble role={msg.role} content={msg.text} />
              {msg.proposals?.map((p) => (
                <ProposalCard key={p.proposal_id} proposal={p} onApprove={handleApprove} onReject={handleReject} />
              ))}
            </React.Fragment>
          ))}

          {/* Live streaming text */}
          {streamBuffer && (
            <MessageBubble role="assistant" content={streamBuffer} />
          )}

          {/* Live proposals (before done event) */}
          {pendingProposals.map((p) => (
            <ProposalCard key={p.proposal_id} proposal={p} onApprove={handleApprove} onReject={handleReject} />
          ))}

          {/* Batch approve/reject for multiple proposals in a single message */}
          {messages.length > 0 && (() => {
            const lastMsg = messages[messages.length - 1];
            const pending = lastMsg.proposals?.filter(p => p.status === 'pending') || [];
            if (pending.length < 2) return null;
            return (
              <div className="flex gap-2 self-start">
                <button
                  onClick={() => pending.forEach(p => handleApprove(p))}
                  className="font-mono text-[10px] font-semibold px-3 py-1.5 bg-honey text-surface-0 rounded-full uppercase tracking-wider hover:bg-honey-dim transition-all"
                >
                  Approve All ({pending.length})
                </button>
                <button
                  onClick={() => pending.forEach(p => handleReject(p.proposal_id))}
                  className="font-mono text-[10px] font-medium px-3 py-1.5 border border-border-strong bg-surface-3 text-text-secondary rounded-full uppercase tracking-wider hover:border-red-400 hover:text-red-400 transition-all"
                >
                  Reject All
                </button>
              </div>
            );
          })()}

          {/* Tool call indicator */}
          {activeTool && (
            <ToolCallIndicator tool={activeTool.name} args={activeTool.args} />
          )}

          {/* Thinking indicator */}
          {agentStatus === 'thinking' && !activeTool && (
            <div className="self-start px-4 py-3 rounded-2xl bg-surface-2 border border-border-base">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-honey"
                    style={{ animation: 'thinkBounce 1.4s ease-in-out infinite', animationDelay: `${i * 0.16}s` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="px-3 pb-3">
          <div className="relative rounded-xl border border-border-base bg-surface-2 overflow-hidden">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={agentStatus !== 'idle'}
              className="w-full text-[13px] px-4 pt-3 pb-10 bg-transparent text-text-primary outline-none resize-none placeholder:text-text-muted disabled:opacity-50"
              placeholder="Ask about your meetings, transcripts, or tasks..."
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-2">
              {/* Clear history */}
              {messages.length > 0 && agentStatus === 'idle' && (
                <button
                  onClick={handleClearHistory}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-red-400 transition-colors"
                  title="Clear chat history"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
                    <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              )}
              {/* Cancel / Send */}
              {agentStatus !== 'idle' ? (
                <button
                  onClick={handleCancel}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                  title="Cancel"
                >
                  <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" className="w-4 h-4">
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  className="w-8 h-8 flex items-center justify-center rounded-full transition-colors"
                  style={{ background: input.trim() ? '#E8A838' : '#2A2A32' }}
                  disabled={!input.trim()}
                >
                  <svg fill="none" stroke={input.trim() ? '#07070A' : '#5E5B54'} strokeWidth={2} viewBox="0 0 24 24" className="w-4 h-4">
                    <path d="M12 19V5m0 0l-5 5m5-5l5 5" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes thinkBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app starts and the chat UI renders**

Run: `npm start`
Expected: App launches, chat drawer opens with empty state message "Ask me anything about your meetings and tasks."

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/ChatInterface.tsx
git commit -m "feat: wire ChatInterface to real IPC with streaming state machine"
```

---

### Task 11: End-to-End Smoke Test

**Files:** None (manual testing)

- [ ] **Step 1: Start the app and verify it launches**

Run: `npm start`
Expected: App launches without errors.

- [ ] **Step 2: Open chat and send a test message**

Open the chat drawer, type "Hello, what can you help me with?" and press Enter.
Expected: Thinking animation appears → agent responds with a description of its capabilities. Message appears in the chat.

- [ ] **Step 3: Test tool usage**

Type "List all meetings" and send.
Expected: Tool call indicator shows "Listing meetings…" → agent responds (likely with "no meetings found" if DB is empty).

- [ ] **Step 4: Test cancel**

Send a message and immediately click the cancel (X) button.
Expected: Agent stops, partial response (if any) is saved.

- [ ] **Step 5: Test clear history**

Click the trash icon to clear chat history.
Expected: All messages disappear, empty state shows.

- [ ] **Step 6: Verify ANTHROPIC_API_KEY is set**

If the agent returns an error about authentication, ensure `.env` has `ANTHROPIC_API_KEY=sk-ant-...`.

- [ ] **Step 7: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address issues from end-to-end smoke test"
```
