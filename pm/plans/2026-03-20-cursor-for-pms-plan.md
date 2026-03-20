# Cursor for PMs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app that records customer interviews, analyzes transcripts with Claude, lets PMs chat with transcripts, and pushes tasks to Linear — in 1 day.

**Architecture:** Electron app with React+Tailwind renderer communicating via IPC to a Node.js main process. Main process handles all external APIs (Recall.ai, Claude, Linear) and local SQLite storage. No separate backend server.

**Tech Stack:** Electron Forge, React, TypeScript, Tailwind CSS, shadcn/ui, better-sqlite3, Anthropic SDK, Linear SDK, Recall.ai REST API

**Testing note:** This is a 1-day hackathon. No formal test suite — the live demo IS the test. Each task includes a manual verification step instead.

**Spec:** `docs/superpowers/specs/2026-03-20-cursor-for-pms-design.md`

---

## File Structure

```
pm/
├── package.json
├── forge.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main/
│   │   ├── index.ts                  # Electron main process entry, window creation
│   │   ├── preload.ts                # contextBridge — exposes IPC channels to renderer
│   │   ├── db/
│   │   │   ├── schema.ts             # CREATE TABLE statements, migrations
│   │   │   └── index.ts              # DB connection singleton + query helpers
│   │   ├── ipc/
│   │   │   ├── index.ts              # Registers all IPC handlers
│   │   │   ├── meetings.ts           # meeting:create, meeting:list, meeting:get-status
│   │   │   ├── transcripts.ts        # transcript:get, transcript:analyze
│   │   │   ├── chat.ts               # chat:send-message
│   │   │   ├── tasks.ts              # task:list, task:update-status, task:push-to-linear
│   │   │   ├── settings.ts           # settings:get, settings:set
│   │   │   └── momtest.ts            # momtest:generate-questions
│   │   └── services/
│   │       ├── recall.ts             # Recall.ai API client
│   │       ├── claude.ts             # Claude analysis + chat (tool_use)
│   │       ├── linear.ts             # Linear GraphQL client
│   │       └── momtest.ts            # Mom Test question generation
│   └── renderer/
│       ├── index.html
│       ├── index.tsx                  # React entry point
│       ├── App.tsx                    # Root component, sidebar routing
│       ├── globals.css                # Tailwind imports, dark theme variables
│       ├── components/
│       │   ├── ui/                    # shadcn/ui components (auto-generated)
│       │   ├── Sidebar.tsx            # Icon sidebar nav (56px)
│       │   ├── MeetingList.tsx        # Meetings screen
│       │   ├── MeetingCard.tsx        # Individual meeting card
│       │   ├── TranscriptView.tsx     # Split-pane: transcript + analysis
│       │   ├── AnalysisPanel.tsx      # Collapsible analysis sections
│       │   ├── ChatInterface.tsx      # Chat screen with message input
│       │   ├── ChatMessage.tsx        # Individual chat bubble
│       │   ├── TaskReview.tsx         # Task list with approve/reject
│       │   ├── TaskCard.tsx           # Individual task card (editable)
│       │   ├── SettingsModal.tsx      # API keys + Linear team config
│       │   └── MomTestQuestions.tsx   # Question generation modal
│       ├── hooks/
│       │   └── useIpc.ts             # Generic hook for IPC invoke calls
│       └── lib/
│           └── utils.ts              # shadcn/ui cn() helper
```

---

## Person B Tasks (Backend + Integrations)

### Task 1: Scaffold Electron + Project Setup

**Files:**
- Create: `package.json`, `forge.config.ts`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`
- Create: `src/main/index.ts`, `src/main/preload.ts`
- Create: `src/renderer/index.html`, `src/renderer/index.tsx`, `src/renderer/globals.css`

**Why this is Task 1:** Both people need a running Electron app before they can do anything. Person B sets this up, pushes, Person A pulls and starts on UI.

- [ ] **Step 1: Create Electron Forge project with React + TypeScript**

```bash
cd /Users/denysdenysenko/Desktop/pm
npx create-electron-app@latest . --template=webpack-typescript
```

If the directory isn't empty, init in a subdirectory and move files. The Forge template gives us: `package.json`, `forge.config.ts`, `tsconfig.json`, `src/index.ts`, `src/preload.ts`, `src/renderer.ts`.

- [ ] **Step 2: Install core dependencies**

```bash
npm install react react-dom better-sqlite3 @anthropic-ai/sdk @linear/sdk uuid
npm install -D @types/react @types/react-dom @types/better-sqlite3 @types/uuid tailwindcss @tailwindcss/postcss postcss postcss-loader
```

- [ ] **Step 3: Configure Tailwind**

Create `tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      colors: {
        surface: {
          0: '#0a0a0b',
          1: '#111113',
          2: '#1a1a1f',
          3: '#232329',
        },
        accent: '#7c5cff',
      },
    },
  },
  plugins: [],
};
```

Create `postcss.config.js`:
```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

Create `src/renderer/globals.css`:
```css
@import "tailwindcss";

body {
  @apply bg-surface-0 text-gray-100 font-mono;
  margin: 0;
  overflow: hidden;
}
```

- [ ] **Step 4: Set up preload script with IPC bridge**

Create `src/main/preload.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron';

const channels = [
  'meeting:create', 'meeting:list', 'meeting:get-status', 'meeting:paste-transcript',
  'transcript:get', 'transcript:analyze',
  'chat:send-message',
  'task:list', 'task:create', 'task:update-status', 'task:push-to-linear',
  'linear:get-teams',
  'settings:get', 'settings:set',
  'momtest:generate-questions',
] as const;

type Channel = typeof channels[number];

contextBridge.exposeInMainWorld('api', {
  invoke: (channel: Channel, ...args: unknown[]) => {
    if (!channels.includes(channel)) throw new Error(`Invalid channel: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
});
```

- [ ] **Step 5: Set up main process entry**

Update `src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron';
import path from 'path';
import { registerAllHandlers } from './ipc';
import { initDb } from './db';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

app.whenReady().then(() => {
  initDb();
  registerAllHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- [ ] **Step 6: Create minimal renderer entry**

Create `src/renderer/index.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './globals.css';

function App() {
  return (
    <div className="flex h-screen">
      <div className="w-14 bg-surface-1 border-r border-surface-3" />
      <div className="flex-1 flex items-center justify-center text-gray-500">
        PM Tool — Loading...
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

Create `src/renderer/index.html`:
```html
<!DOCTYPE html>
<html class="dark">
  <head>
    <meta charset="UTF-8" />
    <title>PM Tool</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

- [ ] **Step 7: Create stub IPC handler registry**

Create `src/main/ipc/index.ts`:
```ts
import { ipcMain } from 'electron';

export function registerAllHandlers() {
  // Stub — each module will register its own handlers
  ipcMain.handle('settings:get', async () => ({}));
  ipcMain.handle('settings:set', async (_e, data) => {});
  console.log('IPC handlers registered');
}
```

- [ ] **Step 8: Verify the app launches**

```bash
npm start
```

Expected: Electron window opens with dark background, sidebar placeholder on left, "PM Tool — Loading..." centered.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: scaffold Electron app with React, Tailwind, IPC bridge"
```

---

### Task 2: SQLite Database + Query Helpers

**Files:**
- Create: `src/main/db/schema.ts`
- Create: `src/main/db/index.ts`

- [ ] **Step 1: Create database schema**

Create `src/main/db/schema.ts`:
```ts
export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    meeting_url TEXT,
    recall_bot_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id),
    raw_text TEXT NOT NULL,
    analysis_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL REFERENCES transcripts(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    linear_issue_id TEXT,
    source TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL REFERENCES transcripts(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;
```

- [ ] **Step 2: Create DB connection + helpers**

Create `src/main/db/index.ts`:
```ts
import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { SCHEMA } from './schema';

let db: Database.Database;

export function initDb(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'pm-tool.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}
```

- [ ] **Step 3: Verify DB initializes on app start**

`npm start` — app should launch without DB errors in the console.

- [ ] **Step 4: Commit**

```bash
git add src/main/db && git commit -m "feat: add SQLite database with schema and helpers"
```

---

### Task 3: Meeting IPC Handlers + Recall.ai Integration

**Files:**
- Create: `src/main/services/recall.ts`
- Create: `src/main/ipc/meetings.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create Recall.ai service**

Create `src/main/services/recall.ts`:
```ts
import { getDb } from '../db';

const RECALL_API_BASE = 'https://us-west-2.recall.ai/api/v1';

function getApiKey(): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('recall_api_key') as { value: string } | undefined;
  if (!row) throw new Error('Recall.ai API key not configured');
  return row.value;
}

export async function createBot(meetingUrl: string): Promise<{ id: string; status: string }> {
  const res = await fetch(`${RECALL_API_BASE}/bot`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: 'PM Tool Recorder',
      transcription_options: { provider: 'default' },
    }),
  });
  if (!res.ok) throw new Error(`Recall API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { id: data.id, status: data.status_changes?.[0]?.code ?? 'unknown' };
}

export async function getBotStatus(botId: string): Promise<string> {
  const res = await fetch(`${RECALL_API_BASE}/bot/${botId}`, {
    headers: { 'Authorization': `Token ${getApiKey()}` },
  });
  if (!res.ok) throw new Error(`Recall API error: ${res.status}`);
  const data = await res.json();
  const changes = data.status_changes ?? [];
  return changes.length > 0 ? changes[changes.length - 1].code : 'unknown';
}

export async function getTranscript(botId: string): Promise<string> {
  const res = await fetch(`${RECALL_API_BASE}/bot/${botId}/transcript`, {
    headers: { 'Authorization': `Token ${getApiKey()}` },
  });
  if (!res.ok) throw new Error(`Recall API error: ${res.status}`);
  const data = await res.json();
  // Recall returns array of { speaker, words: [{text, start_time, end_time}] }
  return data
    .map((segment: { speaker: string; words: { text: string }[] }) =>
      `${segment.speaker}: ${segment.words.map((w) => w.text).join(' ')}`
    )
    .join('\n');
}
```

- [ ] **Step 2: Create meeting IPC handlers**

Create `src/main/ipc/meetings.ts`:
```ts
import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { createBot, getBotStatus, getTranscript } from '../services/recall';

export function registerMeetingHandlers() {
  ipcMain.handle('meeting:create', async (_e, { title, meetingUrl }: { title: string; meetingUrl: string }) => {
    const id = uuid();
    const db = getDb();

    // Try to send Recall bot
    let recallBotId: string | null = null;
    let status = 'pending';
    try {
      const bot = await createBot(meetingUrl);
      recallBotId = bot.id;
      status = 'recording';
    } catch (err) {
      console.error('Recall bot failed:', err);
      status = 'failed';
    }

    db.prepare(
      'INSERT INTO meetings (id, title, meeting_url, recall_bot_id, status) VALUES (?, ?, ?, ?, ?)'
    ).run(id, title, meetingUrl, recallBotId, status);

    return { id, title, meetingUrl, recallBotId, status };
  });

  ipcMain.handle('meeting:list', async () => {
    return getDb().prepare('SELECT * FROM meetings ORDER BY created_at DESC').all();
  });

  ipcMain.handle('meeting:get-status', async (_e, { meetingId }: { meetingId: string }) => {
    const db = getDb();
    const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as any;
    if (!meeting) throw new Error('Meeting not found');
    if (!meeting.recall_bot_id) return meeting;

    try {
      const recallStatus = await getBotStatus(meeting.recall_bot_id);

      // Map Recall statuses to our statuses
      let appStatus = meeting.status;
      if (recallStatus === 'done') {
        appStatus = 'done';
        // Fetch and store transcript
        const rawText = await getTranscript(meeting.recall_bot_id);
        const existingTranscript = db.prepare('SELECT id FROM transcripts WHERE meeting_id = ?').get(meeting.id);
        if (!existingTranscript) {
          const transcriptId = require('uuid').v4();
          db.prepare('INSERT INTO transcripts (id, meeting_id, raw_text) VALUES (?, ?, ?)').run(transcriptId, meeting.id, rawText);
        }
      } else if (recallStatus === 'fatal') {
        appStatus = 'failed';
      } else if (['ready', 'joining_call', 'in_waiting_room', 'in_call_not_recording', 'in_call_recording'].includes(recallStatus)) {
        appStatus = 'recording';
      }

      db.prepare('UPDATE meetings SET status = ? WHERE id = ?').run(appStatus, meeting.id);
      return { ...meeting, status: appStatus };
    } catch (err) {
      console.error('Status check failed:', err);
      return meeting;
    }
  });

  // Fallback: manual transcript paste
  ipcMain.handle('meeting:paste-transcript', async (_e, { meetingId, rawText }: { meetingId: string; rawText: string }) => {
    const db = getDb();
    const transcriptId = require('uuid').v4();
    db.prepare('INSERT INTO transcripts (id, meeting_id, raw_text) VALUES (?, ?, ?)').run(transcriptId, meetingId, rawText);
    db.prepare('UPDATE meetings SET status = ? WHERE id = ?').run('done', meetingId);
    return { id: transcriptId, meetingId, rawText };
  });
}
```

- [ ] **Step 3: Register meeting handlers in index**

Update `src/main/ipc/index.ts`:
```ts
import { ipcMain } from 'electron';
import { registerMeetingHandlers } from './meetings';

export function registerAllHandlers() {
  registerMeetingHandlers();
  // Stub settings for now
  ipcMain.handle('settings:get', async () => ({}));
  ipcMain.handle('settings:set', async (_e, data) => {});
  console.log('IPC handlers registered');
}
```

- [ ] **Step 4: Verify app still launches**

```bash
npm start
```

- [ ] **Step 5: Commit**

```bash
git add src/main/services/recall.ts src/main/ipc/meetings.ts src/main/ipc/index.ts
git commit -m "feat: add Recall.ai integration and meeting IPC handlers"
```

---

### Task 4: Claude Analysis Service + Transcript IPC

**Files:**
- Create: `src/main/services/claude.ts`
- Create: `src/main/ipc/transcripts.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create Claude analysis service**

Create `src/main/services/claude.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';

function getClient(): Anthropic {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('anthropic_api_key') as { value: string } | undefined;
  if (!row) throw new Error('Anthropic API key not configured');
  return new Anthropic({ apiKey: row.value });
}

export interface TranscriptAnalysis {
  summary: string[];
  pain_points: { text: string; transcript_ref: string }[];
  feature_requests: { text: string; transcript_ref: string }[];
  key_quotes: { text: string; speaker: string; transcript_ref: string }[];
  competitive_mentions: { text: string; competitor: string; transcript_ref: string }[];
  sentiment_highlights: { text: string; sentiment: 'positive' | 'negative' | 'neutral'; transcript_ref: string }[];
  draft_tasks: { title: string; description: string }[];
}

const ANALYSIS_SYSTEM_PROMPT = `You are a product management assistant analyzing customer interview transcripts.

Analyze the transcript and return a JSON object with these fields:
- summary: array of 3-5 bullet point strings summarizing the conversation
- pain_points: array of {text, transcript_ref} — frustrations and problems mentioned
- feature_requests: array of {text, transcript_ref} — explicit and implied feature requests
- key_quotes: array of {text, speaker, transcript_ref} — important verbatim quotes
- competitive_mentions: array of {text, competitor, transcript_ref} — mentions of competing products
- sentiment_highlights: array of {text, sentiment, transcript_ref} — notable emotional moments (sentiment is "positive", "negative", or "neutral")
- draft_tasks: array of {title, description} — actionable development tasks derived from the conversation

For transcript_ref, include the relevant line or quote from the transcript so the PM can find it.

Return ONLY valid JSON, no markdown fences, no explanation.`;

export async function analyzeTranscript(rawText: string): Promise<TranscriptAnalysis> {
  const client = getClient();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: rawText }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return JSON.parse(text) as TranscriptAnalysis;
}

export interface ChatResult {
  message: string;
  tasks: { title: string; description: string }[];
}

const CHAT_SYSTEM_PROMPT = `You are a product management assistant. The PM is chatting with you about a customer interview transcript.

You have access to the full transcript below. Answer questions about it, surface insights, and help the PM understand what the customer said.

When the PM asks you to create a task (e.g., "create a task for X", "add a ticket for Y", "we should build Z"), use the create_task tool.

Be concise and specific. Reference exact quotes from the transcript when possible.`;

const CREATE_TASK_TOOL: Anthropic.Messages.Tool = {
  name: 'create_task',
  description: 'Create a development task based on the conversation. Use when the PM asks to create a task, ticket, or action item.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short task title' },
      description: { type: 'string', description: 'Detailed task description with context from the transcript' },
    },
    required: ['title', 'description'],
  },
};

export async function chatWithTranscript(
  rawText: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<ChatResult> {
  const client = getClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: `${CHAT_SYSTEM_PROMPT}\n\n--- TRANSCRIPT ---\n${rawText}\n--- END TRANSCRIPT ---`,
    tools: [CREATE_TASK_TOOL],
    messages,
  });

  let message = '';
  const tasks: { title: string; description: string }[] = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      message += block.text;
    } else if (block.type === 'tool_use' && block.name === 'create_task') {
      const input = block.input as { title: string; description: string };
      tasks.push(input);
    }
  }

  // If Claude stopped to call a tool (stop_reason: 'tool_use') but also provided text,
  // we have the text + tasks. If it only called the tool with no text, provide a default message.
  if (!message && tasks.length > 0) {
    message = `Created ${tasks.length} task${tasks.length > 1 ? 's' : ''} from the conversation.`;
  }

  return { message, tasks };
}
```

- [ ] **Step 2: Create transcript IPC handlers**

Create `src/main/ipc/transcripts.ts`:
```ts
import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { analyzeTranscript, TranscriptAnalysis } from '../services/claude';

export function registerTranscriptHandlers() {
  ipcMain.handle('transcript:get', async (_e, { meetingId }: { meetingId: string }) => {
    const db = getDb();
    const transcript = db.prepare('SELECT * FROM transcripts WHERE meeting_id = ?').get(meetingId) as any;
    if (!transcript) return null;
    return {
      ...transcript,
      analysis: transcript.analysis_json ? JSON.parse(transcript.analysis_json) : null,
    };
  });

  ipcMain.handle('transcript:analyze', async (_e, { transcriptId }: { transcriptId: string }) => {
    const db = getDb();
    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(transcriptId) as any;
    if (!transcript) throw new Error('Transcript not found');

    const analysis = await analyzeTranscript(transcript.raw_text);

    // Save analysis
    db.prepare('UPDATE transcripts SET analysis_json = ? WHERE id = ?').run(JSON.stringify(analysis), transcriptId);

    // Create draft tasks
    for (const task of analysis.draft_tasks) {
      db.prepare(
        'INSERT INTO tasks (id, transcript_id, title, description, source) VALUES (?, ?, ?, ?, ?)'
      ).run(uuid(), transcriptId, task.title, task.description, 'auto');
    }

    return analysis;
  });
}
```

- [ ] **Step 3: Register transcript handlers**

Update `src/main/ipc/index.ts` to import and call `registerTranscriptHandlers()`.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/claude.ts src/main/ipc/transcripts.ts src/main/ipc/index.ts
git commit -m "feat: add Claude transcript analysis and transcript IPC handlers"
```

---

### Task 5: Chat IPC Handlers

**Files:**
- Create: `src/main/ipc/chat.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create chat IPC handler**

Create `src/main/ipc/chat.ts`:
```ts
import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { chatWithTranscript } from '../services/claude';

export function registerChatHandlers() {
  ipcMain.handle('chat:send-message', async (_e, { transcriptId, message }: { transcriptId: string; message: string }) => {
    const db = getDb();

    // Get transcript
    const transcript = db.prepare('SELECT * FROM transcripts WHERE id = ?').get(transcriptId) as any;
    if (!transcript) throw new Error('Transcript not found');

    // Save user message
    db.prepare('INSERT INTO chat_messages (id, transcript_id, role, content) VALUES (?, ?, ?, ?)').run(uuid(), transcriptId, 'user', message);

    // Build chat history for Claude — only send user/assistant text pairs
    // We intentionally exclude tool_use/tool_result from history replay to avoid
    // API errors. Each turn is independent for task creation.
    const history = db.prepare('SELECT role, content FROM chat_messages WHERE transcript_id = ? ORDER BY created_at ASC').all(transcriptId) as { role: 'user' | 'assistant'; content: string }[];

    // Call Claude
    const result = await chatWithTranscript(transcript.raw_text, history);

    // Save assistant message (text only — tool_use results are handled separately)
    db.prepare('INSERT INTO chat_messages (id, transcript_id, role, content) VALUES (?, ?, ?, ?)').run(uuid(), transcriptId, 'assistant', result.message);

    // Create any tasks from tool_use
    const createdTasks = [];
    for (const task of result.tasks) {
      const taskId = uuid();
      db.prepare(
        'INSERT INTO tasks (id, transcript_id, title, description, source) VALUES (?, ?, ?, ?, ?)'
      ).run(taskId, transcriptId, task.title, task.description, 'chat');
      createdTasks.push({ id: taskId, ...task, status: 'draft', source: 'chat' });
    }

    return { message: result.message, createdTasks };
  });
}
```

- [ ] **Step 2: Register chat handlers in index**

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc/chat.ts src/main/ipc/index.ts
git commit -m "feat: add chat IPC with Claude tool_use for task creation"
```

---

### Task 6: Task IPC + Linear Integration

**Files:**
- Create: `src/main/services/linear.ts`
- Create: `src/main/ipc/tasks.ts`
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create Linear service**

Create `src/main/services/linear.ts`:
```ts
import { LinearClient } from '@linear/sdk';
import { getDb } from '../db';

function getClient(): LinearClient {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('linear_api_key') as { value: string } | undefined;
  if (!row) throw new Error('Linear API key not configured');
  return new LinearClient({ apiKey: row.value });
}

export async function getTeams(): Promise<{ id: string; name: string }[]> {
  const client = getClient();
  const teams = await client.teams();
  return teams.nodes.map((t) => ({ id: t.id, name: t.name }));
}

export async function createIssue(teamId: string, title: string, description: string): Promise<string> {
  const client = getClient();
  const issue = await client.createIssue({ teamId, title, description });
  const created = await issue.issue;
  return created?.id ?? '';
}
```

- [ ] **Step 2: Create task IPC handlers**

Create `src/main/ipc/tasks.ts`:
```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { createIssue, getTeams } from '../services/linear';

export function registerTaskHandlers() {
  ipcMain.handle('task:create', async (_e, { transcriptId, title, description }: { transcriptId: string; title: string; description: string }) => {
    const db = getDb();
    const id = require('uuid').v4();
    db.prepare('INSERT INTO tasks (id, transcript_id, title, description, source) VALUES (?, ?, ?, ?, ?)').run(id, transcriptId, title, description ?? '', 'manual');
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  });

  ipcMain.handle('task:list', async (_e, { transcriptId }: { transcriptId?: string } = {}) => {
    const db = getDb();
    if (transcriptId) {
      return db.prepare('SELECT * FROM tasks WHERE transcript_id = ? ORDER BY created_at ASC').all(transcriptId);
    }
    return db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  });

  ipcMain.handle('task:update-status', async (_e, { taskId, status, title, description }: { taskId: string; status?: string; title?: string; description?: string }) => {
    const db = getDb();
    if (status) db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
    if (title) db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(title, taskId);
    if (description) db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(description, taskId);
    return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  });

  ipcMain.handle('task:push-to-linear', async (_e, { taskIds }: { taskIds: string[] }) => {
    const db = getDb();
    const teamRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('linear_team_id') as { value: string } | undefined;
    if (!teamRow) throw new Error('Linear team not configured');

    const results = [];
    for (const taskId of taskIds) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
      if (!task || task.status === 'pushed') continue;

      const linearId = await createIssue(teamRow.value, task.title, task.description ?? '');
      db.prepare('UPDATE tasks SET status = ?, linear_issue_id = ? WHERE id = ?').run('pushed', linearId, taskId);
      results.push({ taskId, linearId });
    }
    return results;
  });

  ipcMain.handle('linear:get-teams', async () => {
    return getTeams();
  });
}
```

- [ ] **Step 3: Register task handlers in index**

- [ ] **Step 4: Commit**

```bash
git add src/main/services/linear.ts src/main/ipc/tasks.ts src/main/ipc/index.ts
git commit -m "feat: add Linear integration and task IPC handlers"
```

---

### Task 7: Settings IPC + Mom Test

**Files:**
- Create: `src/main/services/momtest.ts`
- Create: `src/main/ipc/momtest.ts`
- Modify: `src/main/ipc/settings.ts` (replace stub)
- Modify: `src/main/ipc/index.ts`

- [ ] **Step 1: Create proper settings handler**

Create `src/main/ipc/settings.ts`:
```ts
import { ipcMain } from 'electron';
import { getDb } from '../db';

export function registerSettingsHandlers() {
  ipcMain.handle('settings:get', async () => {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  ipcMain.handle('settings:set', async (_e, { key, value }: { key: string; value: string }) => {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    return { key, value };
  });
}
```

- [ ] **Step 2: Create Mom Test service**

Create `src/main/services/momtest.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db';

const MOMTEST_SYSTEM_PROMPT = `You are a product management coach helping prepare for customer interviews using the Mom Test framework.

The Mom Test rules:
1. Talk about their life instead of your idea
2. Ask about specifics in the past instead of generics or opinions about the future
3. Talk less and listen more

Generate 5-7 questions that:
- Focus on the customer's actual behavior and past experiences
- Avoid leading questions or pitching your product
- Dig into specific problems they've faced
- Uncover how they currently solve the problem
- Understand the emotional and financial impact

Return a JSON array of objects: [{"question": "...", "purpose": "..."}]
The "purpose" field explains what this question helps you learn.

Return ONLY valid JSON, no markdown fences.`;

export async function generateMomTestQuestions(context: string): Promise<{ question: string; purpose: string }[]> {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get('anthropic_api_key') as { value: string } | undefined;
  if (!row) throw new Error('Anthropic API key not configured');

  const client = new Anthropic({ apiKey: row.value });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: MOMTEST_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Meeting context: ${context}` }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  return JSON.parse(text);
}
```

- [ ] **Step 3: Create Mom Test IPC handler**

Create `src/main/ipc/momtest.ts`:
```ts
import { ipcMain } from 'electron';
import { generateMomTestQuestions } from '../services/momtest';

export function registerMomTestHandlers() {
  ipcMain.handle('momtest:generate-questions', async (_e, { context }: { context: string }) => {
    return generateMomTestQuestions(context);
  });
}
```

- [ ] **Step 4: Update IPC index to register all handlers**

**IMPORTANT:** Remove the inline `ipcMain.handle('settings:get', ...)` and `ipcMain.handle('settings:set', ...)` stubs that were added in Task 1. These are now handled by `registerSettingsHandlers()`. Leaving them will cause a "handler already registered" error.

Update `src/main/ipc/index.ts`:
```ts
import { registerMeetingHandlers } from './meetings';
import { registerTranscriptHandlers } from './transcripts';
import { registerChatHandlers } from './chat';
import { registerTaskHandlers } from './tasks';
import { registerSettingsHandlers } from './settings';
import { registerMomTestHandlers } from './momtest';

export function registerAllHandlers() {
  registerSettingsHandlers();
  registerMeetingHandlers();
  registerTranscriptHandlers();
  registerChatHandlers();
  registerTaskHandlers();
  registerMomTestHandlers();
  console.log('All IPC handlers registered');
}
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc src/main/services/momtest.ts
git commit -m "feat: add settings, Mom Test question generation, and complete IPC registry"
```

---

## Person A Tasks (Electron Shell + UI)

> **Prerequisite:** Person A starts after Task 1 is committed and pushed. Person A works with mock data until Person B's backend is ready (around hour 5).

### Task 8: Sidebar + App Shell + Routing

**Files:**
- Create: `src/renderer/App.tsx`
- Create: `src/renderer/components/Sidebar.tsx`
- Create: `src/renderer/hooks/useIpc.ts`
- Create: `src/renderer/lib/utils.ts`

- [ ] **Step 1: Create IPC hook**

Create `src/renderer/hooks/useIpc.ts`:
```ts
declare global {
  interface Window {
    api: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };
  }
}

export function useIpc() {
  return {
    invoke: <T = unknown>(channel: string, data?: unknown): Promise<T> => {
      return window.api.invoke(channel, data) as Promise<T>;
    },
  };
}
```

- [ ] **Step 2: Create shadcn/ui utils**

Create `src/renderer/lib/utils.ts`:
```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Install: `npm install clsx tailwind-merge`

- [ ] **Step 3: Create Sidebar component**

Create `src/renderer/components/Sidebar.tsx`:
```tsx
import React from 'react';
import { cn } from '../lib/utils';

type Screen = 'meetings' | 'transcript' | 'chat' | 'tasks';

interface SidebarProps {
  active: Screen;
  onNavigate: (screen: Screen) => void;
  onOpenSettings: () => void;
}

const NAV_ITEMS: { id: Screen; label: string; icon: string }[] = [
  { id: 'meetings', label: 'Meetings', icon: '📋' },
  { id: 'transcript', label: 'Transcripts', icon: '📝' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
];

export function Sidebar({ active, onNavigate, onOpenSettings }: SidebarProps) {
  return (
    <div className="w-14 bg-surface-1 border-r border-surface-3 flex flex-col items-center py-3 gap-2">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white text-sm font-bold mb-4">
        PM
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-colors',
            active === item.id
              ? 'bg-surface-3 text-white'
              : 'text-gray-500 hover:text-gray-300 hover:bg-surface-2'
          )}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={onOpenSettings}
        className="w-10 h-10 rounded-lg flex items-center justify-center text-lg text-gray-500 hover:text-gray-300 hover:bg-surface-2"
        title="Settings"
      >
        ⚙️
      </button>
    </div>
  );
}
```

Note: Replace emoji icons with Lucide React icons (`npm install lucide-react`) if time allows for a more polished look. Use `<Calendar />`, `<FileText />`, `<MessageSquare />`, `<CheckSquare />`, `<Settings />`.

- [ ] **Step 4: Create App shell with routing**

Update `src/renderer/App.tsx`:
```tsx
import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MeetingList } from './components/MeetingList';
import { TranscriptView } from './components/TranscriptView';
import { ChatInterface } from './components/ChatInterface';
import { TaskReview } from './components/TaskReview';
import { SettingsModal } from './components/SettingsModal';

type Screen = 'meetings' | 'transcript' | 'chat' | 'tasks';

export function App() {
  const [screen, setScreen] = useState<Screen>('meetings');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const handleSelectMeeting = (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setScreen('transcript');
  };

  return (
    <div className="flex h-screen bg-surface-0">
      <Sidebar
        active={screen}
        onNavigate={setScreen}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="flex-1 overflow-hidden">
        {screen === 'meetings' && <MeetingList onSelectMeeting={handleSelectMeeting} />}
        {screen === 'transcript' && <TranscriptView meetingId={selectedMeetingId} />}
        {screen === 'chat' && <ChatInterface meetingId={selectedMeetingId} />}
        {screen === 'tasks' && <TaskReview />}
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
```

Update `src/renderer/index.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './globals.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

- [ ] **Step 5: Create stub components for each screen**

Create stub versions of `MeetingList.tsx`, `TranscriptView.tsx`, `ChatInterface.tsx`, `TaskReview.tsx`, `SettingsModal.tsx` — each just renders a placeholder div with the screen name so routing works.

Example `src/renderer/components/MeetingList.tsx`:
```tsx
import React from 'react';

interface MeetingListProps {
  onSelectMeeting: (meetingId: string) => void;
}

export function MeetingList({ onSelectMeeting }: MeetingListProps) {
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold text-white mb-4">Meetings</h1>
      <p className="text-gray-500">No meetings yet.</p>
    </div>
  );
}
```

- [ ] **Step 6: Verify sidebar navigation works**

```bash
npm start
```

Expected: Dark app with sidebar, clicking icons switches content area.

- [ ] **Step 7: Commit**

```bash
git add src/renderer
git commit -m "feat: add sidebar navigation, app shell, and screen routing"
```

---

### Task 9: Meeting List Screen

**Files:**
- Modify: `src/renderer/components/MeetingList.tsx`
- Create: `src/renderer/components/MeetingCard.tsx`

- [ ] **Step 1: Build MeetingCard component**

Create `src/renderer/components/MeetingCard.tsx`:
```tsx
import React from 'react';
import { cn } from '../lib/utils';

interface Meeting {
  id: string;
  title: string;
  meeting_url: string;
  status: string;
  created_at: string;
}

interface MeetingCardProps {
  meeting: Meeting;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  recording: 'bg-red-500/20 text-red-400',
  done: 'bg-green-500/20 text-green-400',
  failed: 'bg-gray-500/20 text-gray-400',
};

export function MeetingCard({ meeting, onClick }: MeetingCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 rounded-lg bg-surface-1 border border-surface-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-white font-medium truncate">{meeting.title}</h3>
        <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[meeting.status] ?? STATUS_COLORS.pending)}>
          {meeting.status}
        </span>
      </div>
      <p className="text-gray-500 text-sm truncate">{meeting.meeting_url || 'No URL'}</p>
      <p className="text-gray-600 text-xs mt-1">{new Date(meeting.created_at).toLocaleDateString()}</p>
    </button>
  );
}
```

- [ ] **Step 2: Build MeetingList with create dialog and polling**

Update `src/renderer/components/MeetingList.tsx`:
```tsx
import React, { useState, useEffect } from 'react';
import { useIpc } from '../hooks/useIpc';
import { MeetingCard } from './MeetingCard';

interface Meeting {
  id: string;
  title: string;
  meeting_url: string;
  recall_bot_id: string | null;
  status: string;
  created_at: string;
}

interface MeetingListProps {
  onSelectMeeting: (meetingId: string) => void;
}

export function MeetingList({ onSelectMeeting }: MeetingListProps) {
  const { invoke } = useIpc();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const loadMeetings = async () => {
    const list = await invoke<Meeting[]>('meeting:list');
    setMeetings(list);
  };

  useEffect(() => { loadMeetings(); }, []);

  // Poll recording meetings for status updates
  useEffect(() => {
    const recording = meetings.filter((m) => m.status === 'recording');
    if (recording.length === 0) return;
    const interval = setInterval(async () => {
      for (const m of recording) {
        await invoke('meeting:get-status', { meetingId: m.id });
      }
      loadMeetings();
    }, 5000);
    return () => clearInterval(interval);
  }, [meetings]);

  const handleCreate = async () => {
    setCreating(true);
    await invoke('meeting:create', { title: title || 'Untitled Meeting', meetingUrl: url });
    setTitle('');
    setUrl('');
    setShowCreate(false);
    setCreating(false);
    loadMeetings();
  };

  const handleSelectMeeting = async (meeting: Meeting) => {
    if (meeting.status !== 'done') return;
    onSelectMeeting(meeting.id);
  };

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Meetings</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/80 transition-colors"
        >
          + Join Meeting
        </button>
      </div>

      {showCreate && (
        <div className="mb-6 p-4 bg-surface-1 border border-surface-3 rounded-lg space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Meeting title"
            className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste Google Meet / Zoom URL"
            className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50"
            >
              {creating ? 'Joining...' : 'Send Bot to Meeting'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 bg-surface-2 text-gray-400 rounded text-sm hover:bg-surface-3"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {meetings.length === 0 && <p className="text-gray-500 text-sm">No meetings yet. Join a meeting to get started.</p>}
        {meetings.map((m) => (
          <MeetingCard key={m.id} meeting={m} onClick={() => handleSelectMeeting(m)} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify meeting creation UI**

```bash
npm start
```

Expected: Meetings screen shows, "+ Join Meeting" opens a form, cards render.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/MeetingList.tsx src/renderer/components/MeetingCard.tsx
git commit -m "feat: add meeting list screen with create form and status polling"
```

---

### Task 10: Transcript View + Analysis Panel

**Files:**
- Modify: `src/renderer/components/TranscriptView.tsx`
- Create: `src/renderer/components/AnalysisPanel.tsx`

- [ ] **Step 1: Build AnalysisPanel**

Create `src/renderer/components/AnalysisPanel.tsx`:
```tsx
import React, { useState } from 'react';
import { cn } from '../lib/utils';

interface AnalysisPanelProps {
  analysis: {
    summary: string[];
    pain_points: { text: string; transcript_ref: string }[];
    feature_requests: { text: string; transcript_ref: string }[];
    key_quotes: { text: string; speaker: string; transcript_ref: string }[];
    competitive_mentions: { text: string; competitor: string; transcript_ref: string }[];
    sentiment_highlights: { text: string; sentiment: string; transcript_ref: string }[];
  } | null;
  onCreateTask: (title: string, description: string) => void;
  loading: boolean;
}

interface SectionProps {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function Section({ title, count, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-surface-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-sm hover:bg-surface-2"
      >
        <span className="text-gray-300 font-medium">{title}</span>
        <span className="text-gray-500 text-xs">{count} {open ? '▼' : '▶'}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

export function AnalysisPanel({ analysis, onCreateTask, loading }: AnalysisPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <div className="text-center">
          <div className="animate-pulse text-2xl mb-2">🔍</div>
          <p className="text-sm">Analyzing transcript...</p>
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        <p className="text-sm">No analysis yet.</p>
      </div>
    );
  }

  const SENTIMENT_COLORS: Record<string, string> = {
    positive: 'text-green-400',
    negative: 'text-red-400',
    neutral: 'text-gray-400',
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* Summary */}
      <Section title="Summary" count={analysis.summary.length} defaultOpen>
        <ul className="list-disc list-inside space-y-1">
          {analysis.summary.map((s, i) => (
            <li key={i} className="text-gray-300 text-sm">{s}</li>
          ))}
        </ul>
      </Section>

      {/* Pain Points */}
      <Section title="Pain Points" count={analysis.pain_points.length}>
        {analysis.pain_points.map((p, i) => (
          <div key={i} className="bg-surface-2 rounded p-2 text-sm">
            <p className="text-gray-300">{p.text}</p>
            <p className="text-gray-600 text-xs mt-1 italic">"{p.transcript_ref}"</p>
            <button
              onClick={() => onCreateTask(`Fix: ${p.text}`, `Pain point from customer interview:\n${p.text}\n\nRef: "${p.transcript_ref}"`)}
              className="text-accent text-xs mt-1 hover:underline"
            >
              + Create task
            </button>
          </div>
        ))}
      </Section>

      {/* Feature Requests */}
      <Section title="Feature Requests" count={analysis.feature_requests.length}>
        {analysis.feature_requests.map((f, i) => (
          <div key={i} className="bg-surface-2 rounded p-2 text-sm">
            <p className="text-gray-300">{f.text}</p>
            <p className="text-gray-600 text-xs mt-1 italic">"{f.transcript_ref}"</p>
            <button
              onClick={() => onCreateTask(`Feature: ${f.text}`, `Feature request from customer interview:\n${f.text}\n\nRef: "${f.transcript_ref}"`)}
              className="text-accent text-xs mt-1 hover:underline"
            >
              + Create task
            </button>
          </div>
        ))}
      </Section>

      {/* Key Quotes */}
      <Section title="Key Quotes" count={analysis.key_quotes.length}>
        {analysis.key_quotes.map((q, i) => (
          <div key={i} className="bg-surface-2 rounded p-2 text-sm">
            <p className="text-gray-300 italic">"{q.text}"</p>
            <p className="text-gray-500 text-xs mt-1">— {q.speaker}</p>
          </div>
        ))}
      </Section>

      {/* Competitive Mentions */}
      <Section title="Competitive Mentions" count={analysis.competitive_mentions.length}>
        {analysis.competitive_mentions.map((c, i) => (
          <div key={i} className="bg-surface-2 rounded p-2 text-sm">
            <span className="text-yellow-400 text-xs font-medium">{c.competitor}</span>
            <p className="text-gray-300 mt-1">{c.text}</p>
          </div>
        ))}
      </Section>

      {/* Sentiment */}
      <Section title="Sentiment Highlights" count={analysis.sentiment_highlights.length}>
        {analysis.sentiment_highlights.map((s, i) => (
          <div key={i} className="bg-surface-2 rounded p-2 text-sm">
            <p className={cn('text-sm', SENTIMENT_COLORS[s.sentiment] ?? 'text-gray-400')}>{s.text}</p>
            <p className="text-gray-600 text-xs mt-1 italic">"{s.transcript_ref}"</p>
          </div>
        ))}
      </Section>
    </div>
  );
}
```

- [ ] **Step 2: Build TranscriptView with split pane**

Update `src/renderer/components/TranscriptView.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { useIpc } from '../hooks/useIpc';
import { AnalysisPanel } from './AnalysisPanel';

interface TranscriptViewProps {
  meetingId: string | null;
}

interface Transcript {
  id: string;
  meeting_id: string;
  raw_text: string;
  analysis: any | null;
}

export function TranscriptView({ meetingId }: TranscriptViewProps) {
  const { invoke } = useIpc();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!meetingId) return;
    invoke<Transcript>('transcript:get', { meetingId }).then(setTranscript);
  }, [meetingId]);

  const handleAnalyze = async () => {
    if (!transcript) return;
    setAnalyzing(true);
    const analysis = await invoke('transcript:analyze', { transcriptId: transcript.id });
    setTranscript((prev) => prev ? { ...prev, analysis } : null);
    setAnalyzing(false);
  };

  const handleCreateTask = async (title: string, description: string) => {
    if (!transcript) return;
    await invoke('task:create', { transcriptId: transcript.id, title, description });
  };

  if (!meetingId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Select a meeting to view its transcript.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Transcript pane */}
      <div className="flex-1 border-r border-surface-3 flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-surface-3">
          <h2 className="text-white font-medium">Transcript</h2>
          {transcript && !transcript.analysis && (
            <button
              onClick={handleAnalyze}
              disabled={analyzing}
              className="px-3 py-1.5 bg-accent text-white rounded text-sm hover:bg-accent/80 disabled:opacity-50"
            >
              {analyzing ? 'Analyzing...' : 'Analyze with AI'}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {transcript ? (
            <pre className="text-gray-300 text-sm whitespace-pre-wrap font-mono leading-relaxed">
              {transcript.raw_text}
            </pre>
          ) : (
            <p className="text-gray-500 text-sm">Loading transcript...</p>
          )}
        </div>
      </div>

      {/* Analysis pane */}
      <div className="w-[400px] bg-surface-1">
        <div className="p-4 border-b border-surface-3">
          <h2 className="text-white font-medium">Analysis</h2>
        </div>
        <AnalysisPanel
          analysis={transcript?.analysis ?? null}
          onCreateTask={handleCreateTask}
          loading={analyzing}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify transcript view renders**

```bash
npm start
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TranscriptView.tsx src/renderer/components/AnalysisPanel.tsx
git commit -m "feat: add transcript view with split-pane analysis panel"
```

---

### Task 11: Chat Interface

**Files:**
- Modify: `src/renderer/components/ChatInterface.tsx`
- Create: `src/renderer/components/ChatMessage.tsx`

- [ ] **Step 1: Build ChatMessage component**

Create `src/renderer/components/ChatMessage.tsx`:
```tsx
import React from 'react';
import { cn } from '../lib/utils';

interface ChatMessageProps {
  role: 'user' | 'assistant';
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  return (
    <div className={cn('flex', role === 'user' ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-lg px-4 py-2.5 text-sm',
          role === 'user'
            ? 'bg-accent text-white'
            : 'bg-surface-2 text-gray-300'
        )}
      >
        <pre className="whitespace-pre-wrap font-mono text-sm">{content}</pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build ChatInterface**

Update `src/renderer/components/ChatInterface.tsx`:
```tsx
import React, { useState, useEffect, useRef } from 'react';
import { useIpc } from '../hooks/useIpc';
import { ChatMessage } from './ChatMessage';

interface ChatInterfaceProps {
  meetingId: string | null;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface TaskFromChat {
  id: string;
  title: string;
  description: string;
  status: string;
}

export function ChatInterface({ meetingId }: ChatInterfaceProps) {
  const { invoke } = useIpc();
  const [transcriptId, setTranscriptId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [createdTasks, setCreatedTasks] = useState<TaskFromChat[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!meetingId) return;
    invoke<{ id: string } | null>('transcript:get', { meetingId }).then((t) => {
      setTranscriptId(t?.id ?? null);
    });
  }, [meetingId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!meetingId || !transcriptId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Select a meeting first, then chat about its transcript.
      </div>
    );
  }

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setSending(true);

    try {
      const result = await invoke<{ message: string; createdTasks: TaskFromChat[] }>(
        'chat:send-message',
        { transcriptId, message: userMessage }
      );
      setMessages((prev) => [...prev, { role: 'assistant', content: result.message }]);
      if (result.createdTasks.length > 0) {
        setCreatedTasks((prev) => [...prev, ...result.createdTasks]);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
    }

    setSending(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-surface-3">
        <h2 className="text-white font-medium">Chat with Transcript</h2>
        <p className="text-gray-500 text-xs mt-1">Ask questions, request tasks, explore insights</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 text-sm mt-8">
            <p>Ask anything about the transcript.</p>
            <p className="mt-1 text-gray-600">Try: "What were the main pain points?" or "Create a task for the billing issue"</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-surface-2 rounded-lg px-4 py-2.5 text-gray-500 text-sm animate-pulse">
              Thinking...
            </div>
          </div>
        )}

        {/* Inline task cards */}
        {createdTasks.map((task) => (
          <div key={task.id} className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
            <p className="text-green-400 text-xs font-medium mb-1">Task Created</p>
            <p className="text-white text-sm font-medium">{task.title}</p>
            <p className="text-gray-400 text-xs mt-1">{task.description}</p>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-surface-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="Ask about the transcript..."
            className="flex-1 bg-surface-2 border border-surface-3 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-accent"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="px-4 py-2.5 bg-accent text-white rounded-lg text-sm hover:bg-accent/80 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify chat UI**

```bash
npm start
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/ChatInterface.tsx src/renderer/components/ChatMessage.tsx
git commit -m "feat: add chat interface with inline task creation cards"
```

---

### Task 12: Task Review Screen

**Files:**
- Modify: `src/renderer/components/TaskReview.tsx`
- Create: `src/renderer/components/TaskCard.tsx`

- [ ] **Step 1: Build TaskCard**

Create `src/renderer/components/TaskCard.tsx`:
```tsx
import React, { useState } from 'react';
import { cn } from '../lib/utils';

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  source: string;
  linear_issue_id: string | null;
}

interface TaskCardProps {
  task: Task;
  onUpdateStatus: (taskId: string, status: string) => void;
  onEdit: (taskId: string, title: string, description: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-500/20 text-yellow-400',
  approved: 'bg-blue-500/20 text-blue-400',
  rejected: 'bg-red-500/20 text-red-400',
  pushed: 'bg-green-500/20 text-green-400',
};

export function TaskCard({ task, onUpdateStatus, onEdit }: TaskCardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);

  const handleSave = () => {
    onEdit(task.id, title, description);
    setEditing(false);
  };

  return (
    <div className="bg-surface-1 border border-surface-3 rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        {editing ? (
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 bg-surface-2 border border-surface-3 rounded px-2 py-1 text-white text-sm mr-2"
          />
        ) : (
          <h3 className="text-white text-sm font-medium flex-1">{task.title}</h3>
        )}
        <div className="flex items-center gap-2">
          <span className="text-gray-600 text-xs">{task.source}</span>
          <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[task.status])}>
            {task.status}
          </span>
        </div>
      </div>

      {editing ? (
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-surface-2 border border-surface-3 rounded px-2 py-1 text-gray-300 text-sm mb-2 h-20"
        />
      ) : (
        <p className="text-gray-400 text-sm mb-3">{task.description}</p>
      )}

      <div className="flex gap-2">
        {task.status === 'draft' && (
          <>
            <button
              onClick={() => onUpdateStatus(task.id, 'approved')}
              className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded text-xs hover:bg-blue-500/30"
            >
              Approve
            </button>
            <button
              onClick={() => onUpdateStatus(task.id, 'rejected')}
              className="px-3 py-1 bg-red-500/20 text-red-400 rounded text-xs hover:bg-red-500/30"
            >
              Reject
            </button>
          </>
        )}
        {task.status !== 'pushed' && (
          <button
            onClick={() => editing ? handleSave() : setEditing(true)}
            className="px-3 py-1 bg-surface-2 text-gray-400 rounded text-xs hover:bg-surface-3"
          >
            {editing ? 'Save' : 'Edit'}
          </button>
        )}
        {task.status === 'pushed' && task.linear_issue_id && (
          <span className="text-green-400 text-xs">Pushed to Linear</span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build TaskReview screen**

Update `src/renderer/components/TaskReview.tsx`:
```tsx
import React, { useState, useEffect } from 'react';
import { useIpc } from '../hooks/useIpc';
import { TaskCard } from './TaskCard';

interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  source: string;
  linear_issue_id: string | null;
}

export function TaskReview() {
  const { invoke } = useIpc();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pushing, setPushing] = useState(false);

  const loadTasks = async () => {
    const list = await invoke<Task[]>('task:list', {});
    setTasks(list);
  };

  useEffect(() => { loadTasks(); }, []);

  const handleUpdateStatus = async (taskId: string, status: string) => {
    await invoke('task:update-status', { taskId, status });
    loadTasks();
  };

  const handleEdit = async (taskId: string, title: string, description: string) => {
    await invoke('task:update-status', { taskId, title, description });
    loadTasks();
  };

  const approvedTasks = tasks.filter((t) => t.status === 'approved');

  const handlePushToLinear = async () => {
    if (approvedTasks.length === 0) return;
    setPushing(true);
    try {
      await invoke('task:push-to-linear', { taskIds: approvedTasks.map((t) => t.id) });
      loadTasks();
    } catch (err) {
      alert(`Failed to push to Linear: ${err}`);
    }
    setPushing(false);
  };

  const draft = tasks.filter((t) => t.status === 'draft');
  const approved = tasks.filter((t) => t.status === 'approved');
  const pushed = tasks.filter((t) => t.status === 'pushed');

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-white">Tasks</h1>
        {approved.length > 0 && (
          <button
            onClick={handlePushToLinear}
            disabled={pushing}
            className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-500 disabled:opacity-50"
          >
            {pushing ? 'Pushing...' : `Push ${approved.length} to Linear`}
          </button>
        )}
      </div>

      {tasks.length === 0 && (
        <p className="text-gray-500 text-sm">No tasks yet. Analyze a transcript to generate tasks.</p>
      )}

      {draft.length > 0 && (
        <div className="mb-6">
          <h2 className="text-gray-400 text-sm font-medium mb-3">Draft ({draft.length})</h2>
          <div className="space-y-3">
            {draft.map((t) => (
              <TaskCard key={t.id} task={t} onUpdateStatus={handleUpdateStatus} onEdit={handleEdit} />
            ))}
          </div>
        </div>
      )}

      {approved.length > 0 && (
        <div className="mb-6">
          <h2 className="text-blue-400 text-sm font-medium mb-3">Approved ({approved.length})</h2>
          <div className="space-y-3">
            {approved.map((t) => (
              <TaskCard key={t.id} task={t} onUpdateStatus={handleUpdateStatus} onEdit={handleEdit} />
            ))}
          </div>
        </div>
      )}

      {pushed.length > 0 && (
        <div className="mb-6">
          <h2 className="text-green-400 text-sm font-medium mb-3">Pushed to Linear ({pushed.length})</h2>
          <div className="space-y-3">
            {pushed.map((t) => (
              <TaskCard key={t.id} task={t} onUpdateStatus={handleUpdateStatus} onEdit={handleEdit} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify task review screen**

```bash
npm start
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/TaskReview.tsx src/renderer/components/TaskCard.tsx
git commit -m "feat: add task review screen with approve/reject/edit and Linear push"
```

---

### Task 13: Settings Modal + Mom Test Questions

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`
- Create: `src/renderer/components/MomTestQuestions.tsx`

- [ ] **Step 1: Build SettingsModal**

Update `src/renderer/components/SettingsModal.tsx`:
```tsx
import React, { useState, useEffect } from 'react';
import { useIpc } from '../hooks/useIpc';

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { invoke } = useIpc();
  const [anthropicKey, setAnthropicKey] = useState('');
  const [recallKey, setRecallKey] = useState('');
  const [linearKey, setLinearKey] = useState('');
  const [linearTeamId, setLinearTeamId] = useState('');
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<Record<string, string>>('settings:get').then((settings) => {
      setAnthropicKey(settings.anthropic_api_key ?? '');
      setRecallKey(settings.recall_api_key ?? '');
      setLinearKey(settings.linear_api_key ?? '');
      setLinearTeamId(settings.linear_team_id ?? '');
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    await invoke('settings:set', { key: 'anthropic_api_key', value: anthropicKey });
    await invoke('settings:set', { key: 'recall_api_key', value: recallKey });
    await invoke('settings:set', { key: 'linear_api_key', value: linearKey });
    if (linearTeamId) await invoke('settings:set', { key: 'linear_team_id', value: linearTeamId });
    setSaving(false);
    onClose();
  };

  const handleLoadTeams = async () => {
    try {
      // Save the key first so the service can use it
      await invoke('settings:set', { key: 'linear_api_key', value: linearKey });
      const loadedTeams = await invoke<{ id: string; name: string }[]>('linear:get-teams');
      setTeams(loadedTeams);
    } catch (err) {
      alert(`Failed to load teams: ${err}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-1 border border-surface-3 rounded-xl w-[500px] p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-white text-lg font-bold mb-4">Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="text-gray-400 text-sm block mb-1">Anthropic API Key</label>
            <input
              type="password"
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
              className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
              placeholder="sk-ant-..."
            />
          </div>

          <div>
            <label className="text-gray-400 text-sm block mb-1">Recall.ai API Key</label>
            <input
              type="password"
              value={recallKey}
              onChange={(e) => setRecallKey(e.target.value)}
              className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="text-gray-400 text-sm block mb-1">Linear API Key</label>
            <div className="flex gap-2">
              <input
                type="password"
                value={linearKey}
                onChange={(e) => setLinearKey(e.target.value)}
                className="flex-1 bg-surface-2 border border-surface-3 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-accent"
              />
              <button onClick={handleLoadTeams} className="px-3 py-2 bg-surface-2 text-gray-400 rounded text-sm hover:bg-surface-3">
                Load Teams
              </button>
            </div>
          </div>

          {teams.length > 0 && (
            <div>
              <label className="text-gray-400 text-sm block mb-1">Linear Team</label>
              <select
                value={linearTeamId}
                onChange={(e) => setLinearTeamId(e.target.value)}
                className="w-full bg-surface-2 border border-surface-3 rounded px-3 py-2 text-white text-sm"
              >
                <option value="">Select a team</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-surface-2 text-gray-400 rounded-lg text-sm hover:bg-surface-3">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/80 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build MomTestQuestions component**

Create `src/renderer/components/MomTestQuestions.tsx`:
```tsx
import React, { useState } from 'react';
import { useIpc } from '../hooks/useIpc';

interface MomTestQuestionsProps {
  onClose: () => void;
}

export function MomTestQuestions({ onClose }: MomTestQuestionsProps) {
  const { invoke } = useIpc();
  const [context, setContext] = useState('');
  const [questions, setQuestions] = useState<{ question: string; purpose: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    if (!context.trim()) return;
    setLoading(true);
    try {
      const result = await invoke<{ question: string; purpose: string }[]>(
        'momtest:generate-questions',
        { context: context.trim() }
      );
      setQuestions(result);
    } catch (err) {
      alert(`Failed to generate questions: ${err}`);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface-1 border border-surface-3 rounded-xl w-[600px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-surface-3">
          <h2 className="text-white text-lg font-bold">Meeting Prep — Mom Test Questions</h2>
          <p className="text-gray-500 text-sm mt-1">Generate non-leading questions based on the Mom Test framework</p>
        </div>

        <div className="p-6 flex-1 overflow-y-auto">
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Describe the meeting context: who are you talking to, what topic, what you want to learn..."
            className="w-full bg-surface-2 border border-surface-3 rounded-lg px-4 py-3 text-white text-sm h-24 focus:outline-none focus:border-accent resize-none"
          />
          <button
            onClick={handleGenerate}
            disabled={loading || !context.trim()}
            className="mt-3 px-4 py-2 bg-accent text-white rounded-lg text-sm hover:bg-accent/80 disabled:opacity-50"
          >
            {loading ? 'Generating...' : 'Generate Questions'}
          </button>

          {questions.length > 0 && (
            <div className="mt-6 space-y-3">
              {questions.map((q, i) => (
                <div key={i} className="bg-surface-2 rounded-lg p-3">
                  <p className="text-white text-sm font-medium">{i + 1}. {q.question}</p>
                  <p className="text-gray-500 text-xs mt-1">Purpose: {q.purpose}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-surface-3 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-surface-2 text-gray-400 rounded-lg text-sm hover:bg-surface-3">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add Mom Test button to MeetingList**

Add a "Prepare Questions" button to the MeetingList header area, and import/render the `MomTestQuestions` modal when it's clicked. Add state: `const [showMomTest, setShowMomTest] = useState(false);`

- [ ] **Step 4: Verify settings and Mom Test modals**

```bash
npm start
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx src/renderer/components/MomTestQuestions.tsx src/renderer/components/MeetingList.tsx
git commit -m "feat: add settings modal, Mom Test question generator, and meeting prep"
```

---

## Integration & Demo Tasks (Both People)

### Task 14: Integration + Paste Transcript Fallback

**Files:**
- Modify: `src/renderer/components/MeetingList.tsx` (add paste transcript option)
- Modify: `src/main/preload.ts` (add `meeting:paste-transcript` channel)

- [ ] **Step 1: Add paste transcript UI to MeetingList**

Note: `meeting:paste-transcript` is already in the preload channel whitelist (added in Task 1).

Add a "Paste Transcript" button to each meeting card that's in `pending` or `failed` status. When clicked, show a textarea modal where the PM can paste a raw transcript. On submit, call `meeting:paste-transcript`.

- [ ] **Step 3: End-to-end manual test**

1. Open app → Settings → enter API keys
2. Go to Meetings → create a meeting (or use paste transcript)
3. Once transcript is available, click meeting → view transcript
4. Click "Analyze with AI" → wait for analysis
5. Review auto-generated tasks in the analysis panel
6. Go to Chat → ask questions about the transcript → request task creation
7. Go to Tasks → review all tasks → approve some → push to Linear
8. Verify tasks appear in Linear

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add paste transcript fallback and complete integration"
```

---

### Task 15: Polish + Demo Prep

- [ ] **Step 1: Add app title bar area**

Add a draggable title bar region at the top of the window (for macOS `titleBarStyle: 'hiddenInset'`). Add `-webkit-app-region: drag` CSS to a top bar div.

- [ ] **Step 2: Add loading states and error handling**

Make sure all async operations show loading spinners and catch errors with user-friendly messages.

- [ ] **Step 3: Prepare demo transcript**

Create a sample transcript file at `demo/sample-transcript.txt` with a realistic customer interview (can be AI-generated). This is the fallback if Recall.ai has issues during the demo.

- [ ] **Step 4: Final smoke test**

Run through the full demo flow twice. Fix any rough edges.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: polish UI and add demo fallback transcript"
```
