# Transcript Pipeline & Chat Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire transcript fetching through SQLite persistence, make agent tools work with real data, and replace the global chat with session-based conversations that persist and are resumable.

**Architecture:** Transcripts are fetched from Recall once per meeting and cached in SQLite. Chat is organized into sessions that span screens and persist between app launches. The agent's existing DB-querying tools now return real data because the pipeline populates the tables they query. Sessions flow from renderer → IPC → agent via a `sessionId` parameter.

**Tech Stack:** SQLite (better-sqlite3), Electron IPC, Anthropic Claude API, React 19

**Spec:** `docs/superpowers/specs/2026-03-21-transcript-pipeline-chat-sessions-design.md`

**Testing:** This project has no test framework configured (no Jest/Vitest/Mocha). Verification is done by running `npm start` and testing manually in the Electron app. Each task includes manual verification steps.

---

## File Structure

### Files to Modify

| File | Responsibility | Changes |
|------|---------------|---------|
| `src/main/db/schema.ts` | DDL for all tables | Add `chat_sessions` table; add `session_id`, `transcript_json`, `transcript_id` columns to existing CREATE TABLE statements |
| `src/main/db/index.ts` | DB init + migrations | Add version 2 migration block with ALTER TABLE statements |
| `src/main/ipc/meetings.ts` | Meeting/transcript IPC handlers | Rewrite `meeting:fetch-transcript` to persist to DB with cache; add `transcript:get` handler |
| `src/main/ipc/chat.ts` | Chat IPC handlers | Add session CRUD handlers; modify existing handlers to take `sessionId` |
| `src/main/agent/chat-agent.ts` | Agentic loop | Add `sessionId` to `runAgent()`, `loadHistory()`, `saveMessage()`; remove `analysisJson`; update `chat_sessions.updated_at` |
| `src/main/agent/system-prompt.ts` | System prompt builder | Add `meetingTitle` to `CurrentContext`; use it in transcript context block |
| `src/main/preload.ts` | IPC channel whitelist | Add 3 new channels: `chat:create-session`, `chat:list-sessions`, `chat:update-session-title` |
| `src/renderer/App.tsx` | App layout & state | Add `activeSessionId`, `transcriptId`, `meetingId` state; wire `meetingTitle` into context; remove `transcriptText` |
| `src/renderer/components/ChatInterface.tsx` | Chat UI | Accept `sessionId`; lazy session creation; session-scoped history; transcript context from DB; new header with session controls |
| `src/renderer/components/TranscriptView.tsx` | Transcript display | Change `onTranscriptLoaded` callback signature; pass `meetingTitle` to fetch handler |

### No Changes Needed

- `src/main/agent/tools.ts` — tool definitions unchanged
- `src/main/agent/tool-executor.ts` — tool implementations unchanged (already query DB)
- `src/main/services/recall.ts` — Recall API service unchanged
- `src/renderer/components/chat/MessageBubble.tsx` — rendering unchanged
- `src/renderer/components/TaskReview.tsx` — kanban unchanged

---

## Task 1: Schema & Migration

Add the `chat_sessions` table and new columns to existing tables. Set up the version 2 migration for existing databases.

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/index.ts`

- [ ] **Step 1: Update `schema.ts` — add `chat_sessions` table**

Add after the `chat_messages` table definition (after line 36):

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Update `schema.ts` — add new columns to existing CREATE TABLE statements**

These columns are for fresh installs (existing installs get them via migration).

In the `chat_messages` CREATE TABLE, add after the `content` column:
```sql
session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
```

In the `transcripts` CREATE TABLE, add after `analysis_json`:
```sql
transcript_json TEXT,
```

In the `meeting_bots` CREATE TABLE, add after `error_message`:
```sql
transcript_id TEXT,
```

- [ ] **Step 3: Add `idx_chat_messages_session` index to `schema.ts`**

Add at the end of the SCHEMA string:
```sql
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
```

- [ ] **Step 4: Update `db/index.ts` — add version 2 migration block**

Change `CURRENT_VERSION` from `1` to `2` (line 29).

Add after the `if (version < 1)` block (after line 65 — the closing `}` of that block). **Important:** `migrate()` is already called from `src/main/index.ts` line 47 during app startup, so no wiring needed.

```typescript
if (version < 2) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New chat',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    db.exec(`ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE`);
    db.exec(`ALTER TABLE transcripts ADD COLUMN transcript_json TEXT`);
    db.exec(`ALTER TABLE meeting_bots ADD COLUMN transcript_id TEXT`);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)`);

    db.pragma('user_version = 2');
  })();
}
```

- [ ] **Step 5: Verify migration**

Delete the existing dev database to test fresh install:
```bash
rm ~/Library/Application\ Support/pm-tool/pm-tool.db
npm start
```
Expected: App launches without errors. Check DevTools console for no DB errors.

Then test migration path: restore the old DB (or just let the app create a fresh one — migration path is tested if the DB already existed before the schema change).

- [ ] **Step 6: Commit**

```bash
git add src/main/db/schema.ts src/main/db/index.ts
git commit -m "feat: add chat_sessions table and version 2 migration"
```

---

## Task 2: Transcript Pipeline — Persist to DB

Rewrite `meeting:fetch-transcript` to persist transcripts and meetings to SQLite with cache checking. Add `transcript:get` handler.

**Files:**
- Modify: `src/main/ipc/meetings.ts`

**Context:** The current handler (lines 7-39 of `meetings.ts`) fetches from Recall API every time. The new handler checks `meeting_bots.transcript_id` first — if set, returns cached data from the DB. If not, fetches from Recall, persists to DB in a transaction, and returns.

- [ ] **Step 1: Rewrite `meeting:fetch-transcript` handler**

Replace the entire `ipcMain.handle('meeting:fetch-transcript', ...)` block with:

```typescript
ipcMain.handle('meeting:fetch-transcript', async (_e, googleEventId: string, meetingTitle?: string) => {
  const db = getDb();

  // 1. Check cache — if transcript already persisted, return from DB
  const botRow = db.prepare(
    'SELECT recall_bot_id, transcript_id FROM meeting_bots WHERE google_event_id = ?'
  ).get(googleEventId) as { recall_bot_id: string; transcript_id: string | null } | undefined;

  if (!botRow?.recall_bot_id) {
    throw new Error('No Recall bot found for this meeting');
  }

  if (botRow.transcript_id) {
    // Cache hit — load from DB
    const transcript = db.prepare(
      'SELECT t.id, t.meeting_id, t.transcript_json FROM transcripts t WHERE t.id = ?'
    ).get(botRow.transcript_id) as { id: string; meeting_id: string; transcript_json: string } | undefined;

    if (transcript) {
      return {
        status: 'done',
        transcript: JSON.parse(transcript.transcript_json),
        transcriptId: transcript.id,
        meetingId: transcript.meeting_id,
      };
    }
  }

  // 2. Fetch from Recall
  const botId = botRow.recall_bot_id;
  const bot = await getBotStatus(botId);
  const status = mapBotStatus(bot);

  if (status !== 'done') {
    return { status, transcript: [], message: 'Transcript not available yet. Bot is still ' + status };
  }

  const transcriptEntries: TranscriptEntry[] = await getBotTranscript(botId);

  // 3. Persist to DB in a transaction
  const meetingId = uuid();
  const transcriptId = uuid();

  // Flatten to raw_text for agent consumption
  const rawText = transcriptEntries.map((entry) => {
    const speaker = entry.participant?.name || 'Unknown';
    const text = entry.words.map((w) => w.text).join(' ');
    const time = entry.words[0]?.start_timestamp?.relative ?? 0;
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    return `[${m}:${s.toString().padStart(2, '0')}] ${speaker}: ${text}`;
  }).join('\n');

  db.transaction(() => {
    // Create meeting row
    db.prepare(
      'INSERT INTO meetings (id, title, meeting_url, recall_bot_id, status, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
    ).run(meetingId, meetingTitle || 'Untitled Meeting', null, botId, 'done');

    // Insert transcript
    db.prepare(
      'INSERT INTO transcripts (id, meeting_id, raw_text, transcript_json, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
    ).run(transcriptId, meetingId, rawText, JSON.stringify(transcriptEntries));

    // Update meeting_bots with transcript_id for future cache lookups
    db.prepare(
      'UPDATE meeting_bots SET transcript_id = ? WHERE google_event_id = ?'
    ).run(transcriptId, googleEventId);
  })();

  return {
    status: 'done',
    transcript: transcriptEntries,
    transcriptId,
    meetingId,
  };
});
```

- [ ] **Step 2: Add `uuid` import**

Add at the top of `meetings.ts`:
```typescript
import { v4 as uuid } from 'uuid';
```

- [ ] **Step 3: Add `transcript:get` handler**

Add inside `registerMeetingHandlers()`, after the `meeting:fetch-transcript` handler:

```typescript
ipcMain.handle('transcript:get', async (_e, transcriptId: string) => {
  const db = getDb();
  const row = db.prepare(
    'SELECT id, meeting_id, raw_text, transcript_json, analysis_json, created_at FROM transcripts WHERE id = ?'
  ).get(transcriptId) as { id: string; meeting_id: string; raw_text: string; transcript_json: string | null; analysis_json: string | null; created_at: string } | undefined;

  if (!row) return null;

  return {
    ...row,
    transcript_json: row.transcript_json ? JSON.parse(row.transcript_json) : null,
  };
});
```

- [ ] **Step 4: Verify**

Run `npm start`. Navigate to a meeting with a completed recording. Click to view transcript.
Expected: Transcript loads and displays. Check terminal output — should see the Recall API call on first load.
Close and reopen the transcript view for the same meeting.
Expected: Transcript loads instantly (from cache). No Recall API call in terminal.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/meetings.ts
git commit -m "feat: persist transcripts to SQLite with cache-first lookup"
```

---

## Task 3: Agent Session Support

Add `sessionId` parameter threading through `runAgent()`, `loadHistory()`, `saveMessage()`. Remove dead `analysisJson` parameter. Update `chat_sessions.updated_at` on message save.

**Files:**
- Modify: `src/main/agent/chat-agent.ts`

- [ ] **Step 1: Update `loadHistory()` to accept `sessionId`**

Replace the current `loadHistory()` function (lines 27-33) with:

```typescript
function loadHistory(sessionId: string): ChatMessage[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(sessionId, MAX_HISTORY_MESSAGES) as ChatMessage[];
  return rows.reverse();
}
```

- [ ] **Step 2: Update `saveMessage()` to accept `sessionId` and update session timestamp**

Replace the current `saveMessage()` function (lines 35-42) with:

```typescript
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
```

- [ ] **Step 3: Update `buildMessages()` — remove `analysisJson` parameter**

Replace the `buildMessages()` signature and body (lines 44-68) with:

```typescript
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
```

- [ ] **Step 4: Update `runAgent()` signature — replace `transcriptContent`/`analysisJson` with `sessionId`/`transcriptContent`**

Replace the function signature and the first few lines (lines 70-88) with:

```typescript
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
```

- [ ] **Step 5: Update `saveMessage` calls in the response handling**

In the "Save assistant message" section (around line 185), update:
```typescript
const messageId = saveMessage('assistant', messageContent, sessionId);
```

In the catch block for aborted signal (around line 201), update:
```typescript
const messageId = saveMessage('assistant', fullResponse, sessionId);
```

- [ ] **Step 6: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | grep -E "chat-agent|error TS"
```
Expected: Only pre-existing errors (google-auth, calendar). No new errors in `chat-agent.ts`.
Note: `chat.ts` will have errors because it still calls `runAgent()` with the old signature — this is fixed in Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/main/agent/chat-agent.ts
git commit -m "feat: thread sessionId through agent, remove dead analysisJson"
```

---

## Task 4: Chat IPC — Session Handlers

Add session CRUD IPC handlers. Modify existing `chat:get-history`, `chat:clear-history`, and `chat:send-message` to use `sessionId`.

**Files:**
- Modify: `src/main/ipc/chat.ts`

- [ ] **Step 1: Add `uuid` import**

Add at the top of `chat.ts`:
```typescript
import { v4 as uuid } from 'uuid';
```

- [ ] **Step 2: Update `chat:send-message` handler**

Replace the current handler (lines 8-19) with:

```typescript
ipcMain.handle('chat:send-message', async (event, data: { message: string; context: CurrentContext; sessionId: string; transcriptContent?: string }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  runAgent(win, data.message, data.context, data.sessionId, data.transcriptContent).catch(err => {
    console.error('Agent error:', err);
    if (!win.isDestroyed()) {
      win.webContents.send('chat:stream-event', { type: 'error', message: err.message || 'Unknown error' });
    }
  });
});
```

- [ ] **Step 3: Update `chat:get-history` to accept `sessionId`**

Replace the current handler (lines 25-28) with:

```typescript
ipcMain.handle('chat:get-history', async (_event, sessionId?: string) => {
  const db = getDb();
  if (!sessionId) return [];
  return db.prepare(
    'SELECT id, role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId);
});
```

- [ ] **Step 4: Update `chat:clear-history` to accept `sessionId`**

Replace the current handler (lines 30-33) with:

```typescript
ipcMain.handle('chat:clear-history', async (_event, sessionId?: string) => {
  const db = getDb();
  if (sessionId) {
    // ON DELETE CASCADE handles chat_messages cleanup automatically.
    // This works because initDb() sets PRAGMA foreign_keys = ON (single-connection app).
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
  } else {
    db.prepare('DELETE FROM chat_messages').run();
  }
});
```

- [ ] **Step 5: Add `chat:create-session` handler**

Add inside `registerChatHandlers()`:

```typescript
ipcMain.handle('chat:create-session', async () => {
  const db = getDb();
  const id = uuid();
  db.prepare(
    'INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, datetime(\'now\'), datetime(\'now\'))'
  ).run(id, 'New chat');
  return { id, title: 'New chat', created_at: new Date().toISOString() };
});
```

- [ ] **Step 6: Add `chat:list-sessions` handler**

```typescript
ipcMain.handle('chat:list-sessions', async (_event, limit?: number) => {
  const db = getDb();
  return db.prepare(`
    SELECT s.id, s.title, s.created_at, s.updated_at
    FROM chat_sessions s
    WHERE EXISTS (SELECT 1 FROM chat_messages WHERE session_id = s.id)
    ORDER BY s.updated_at DESC
    LIMIT ?
  `).all(limit || 30);
});
```

- [ ] **Step 7: Add `chat:update-session-title` handler**

```typescript
ipcMain.handle('chat:update-session-title', async (_event, sessionId: string, title: string) => {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, sessionId);
});
```

- [ ] **Step 8: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | grep "chat\.ts"
```
Expected: No errors in `chat.ts`. (Renderer-side errors expected until Tasks 7-8.)

- [ ] **Step 9: Commit**

```bash
git add src/main/ipc/chat.ts
git commit -m "feat: add session CRUD handlers, scope chat history to sessions"
```

---

## Task 5: Preload & System Prompt

Add new IPC channels to the preload whitelist. Add `meetingTitle` to `CurrentContext` and use it in the system prompt.

**Files:**
- Modify: `src/main/preload.ts`
- Modify: `src/main/agent/system-prompt.ts`

- [ ] **Step 1: Add new channels to preload whitelist**

In `src/main/preload.ts`, add three channels to the `invokeChannels` array. Add after the `'chat:reject-proposal'` entry (line 8):

```typescript
'chat:create-session', 'chat:list-sessions', 'chat:update-session-title',
```

**Note:** `transcript:get` is already in the whitelist (line 6) — do NOT add it again.

- [ ] **Step 2: Add `meetingTitle` to `CurrentContext` interface**

In `src/main/agent/system-prompt.ts`, update the `CurrentContext` interface (lines 1-5):

```typescript
export interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
  meetingTitle?: string;
}
```

- [ ] **Step 3: Update transcript context block to include meeting title**

In `buildSystemPrompt()`, replace the transcript context block (lines 36-44) with:

```typescript
if (context.screen === 'transcript' && context.transcriptId) {
  contextBlock = `
<current_context>
The user is currently viewing a transcript.
${context.meetingTitle ? `Meeting: "${context.meetingTitle}"` : ''}
Transcript ID: ${context.transcriptId}
${context.meetingId ? `Meeting ID: ${context.meetingId}` : ''}
The transcript content has been provided as reference context below.
You do NOT need to call get_transcript — you already have the content.
If the user asks about "this transcript" or "this meeting", they mean the one above.
</current_context>`;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/main/preload.ts src/main/agent/system-prompt.ts
git commit -m "feat: add session IPC channels to preload, add meetingTitle to context"
```

---

## Task 6: TranscriptView Updates

Change the `onTranscriptLoaded` callback to pass `transcriptId` and `meetingId` instead of raw text. Pass `meetingTitle` as second argument to `meeting:fetch-transcript`.

**Files:**
- Modify: `src/renderer/components/TranscriptView.tsx`

- [ ] **Step 1: Update `TranscriptViewProps` interface**

Replace the interface (lines 3-7) with:

```typescript
interface TranscriptViewProps {
  meetingId: string | null;
  meetingTitle: string;
  onTranscriptLoaded?: (transcriptId: string, meetingId: string) => void;
}
```

- [ ] **Step 2: Update `fetchTranscript` — pass `meetingTitle`, handle new return shape**

Replace the `fetchTranscript` function (lines 41-73) with:

```typescript
const fetchTranscript = async () => {
  if (!meetingId) return;
  setLoading(true);
  setError(null);
  setStatusMsg(null);
  try {
    const result = await window.api.invoke('meeting:fetch-transcript', meetingId, meetingTitle) as {
      status: string;
      transcript: TranscriptEntry[];
      transcriptId?: string;
      meetingId?: string;
      message?: string;
    };
    if (result.status !== 'done') {
      setStatusMsg(result.message || 'Transcript not ready yet');
      setTranscript([]);
    } else {
      const entries = result.transcript || [];
      setTranscript(entries);
      if (entries.length > 0 && onTranscriptLoaded && result.transcriptId && result.meetingId) {
        onTranscriptLoaded(result.transcriptId, result.meetingId);
      }
    }
  } catch (err: unknown) {
    setError((err as Error).message || 'Failed to fetch transcript');
  } finally {
    setLoading(false);
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/TranscriptView.tsx
git commit -m "feat: TranscriptView passes transcriptId/meetingId via callback"
```

---

## Task 7: App.tsx & ChatInterface Props (coordinated)

Add `activeSessionId`, `transcriptId`, `meetingId` state in App.tsx. Wire `meetingTitle` and `transcriptId` into the context object. Remove `transcriptText`. Update ChatInterface props interface simultaneously to avoid compile errors between commits.

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/components/ChatInterface.tsx` (props interface only — full logic changes are in Task 8)

- [ ] **Step 1: Update state declarations**

Replace the state block (lines 19-28) with:

```typescript
const [screen, setScreen] = useState<Screen>('meetings');
const [settingsOpen, setSettingsOpen] = useState(false);
const [momTestOpen, setMomTestOpen] = useState(false);
const [selectedMeeting, setSelectedMeeting] = useState<{ id: string; title: string } | null>(null);
const [taskVersion, setTaskVersion] = useState(0);
const [tasksChatOpen, setTasksChatOpen] = useState(false);
const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
const [transcriptId, setTranscriptId] = useState<string | null>(null);
const [meetingId, setMeetingId] = useState<string | null>(null);

const context: CurrentContext = {
  screen,
  transcriptId: transcriptId || undefined,
  meetingId: meetingId || undefined,
  meetingTitle: selectedMeeting?.title,
};
const showChat = screen === 'transcript' || (screen === 'tasks' && tasksChatOpen);
```

- [ ] **Step 2: Update `openTranscript` — reset transcript IDs**

Replace the `openTranscript` function (lines 30-34) with:

```typescript
const openTranscript = (calendarEventId: string, meetingTitle: string) => {
  setSelectedMeeting({ id: calendarEventId, title: meetingTitle });
  setTranscriptId(null);
  setMeetingId(null);
  setScreen('transcript');
};
```

- [ ] **Step 3: Add `handleTranscriptLoaded` callback**

Add after `openTranscript`:

```typescript
const handleTranscriptLoaded = (tId: string, mId: string) => {
  setTranscriptId(tId);
  setMeetingId(mId);
};
```

- [ ] **Step 4: Update TranscriptView to use new callback**

Replace the TranscriptView JSX (around line 58-62) with:

```tsx
<TranscriptView
  meetingId={selectedMeeting?.id || null}
  meetingTitle={selectedMeeting?.title || 'Transcript'}
  onTranscriptLoaded={handleTranscriptLoaded}
/>
```

- [ ] **Step 5: Update ChatInterface props**

Replace the ChatInterface JSX (around line 96) with:

```tsx
<ChatInterface
  context={context}
  activeSessionId={activeSessionId}
  onSessionChange={setActiveSessionId}
  onTaskChanged={() => setTaskVersion(v => v + 1)}
/>
```

- [ ] **Step 6: Update `CurrentContext` interface in `App.tsx`**

The `CurrentContext` interface at the top of `App.tsx` (lines 12-16) needs `meetingTitle`:

```typescript
interface CurrentContext {
  screen: Screen;
  transcriptId?: string;
  meetingId?: string;
  meetingTitle?: string;
}
```

Also delete the `transcriptText` state line:
```typescript
const [transcriptText, setTranscriptText] = useState<string | undefined>(undefined);
```

- [ ] **Step 7: Update ChatInterface Props interface (to match new App.tsx props)**

In `src/renderer/components/ChatInterface.tsx`, update the `CurrentContext` interface (lines 25-29):

```typescript
interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
  meetingTitle?: string;
}
```

Replace the `Props` interface (lines 73-77):

```typescript
interface Props {
  context: CurrentContext;
  activeSessionId: string | null;
  onSessionChange: (sessionId: string | null) => void;
  onTaskChanged?: () => void;
}
```

Update the function signature (line 79):

```typescript
export default function ChatInterface({ context, activeSessionId, onSessionChange, onTaskChanged }: Props) {
```

**Note:** This step only updates the interfaces and signature. The internal logic (history loading, handleSend, etc.) still uses the old patterns — those are updated in Task 8. The component will work but sessions won't be functional until Task 8.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/ChatInterface.tsx
git commit -m "feat: wire session and transcript state through App.tsx"
```

---

## Task 8: ChatInterface — Session Logic

Implement lazy session creation, session-scoped history loading, transcript context injection from DB. This is the core session wiring task.

**Prerequisites:** Task 7 already updated the `CurrentContext` interface, `Props` interface, and function signature in `ChatInterface.tsx`. This task only modifies the internal logic.

**Files:**
- Modify: `src/renderer/components/ChatInterface.tsx`

- [ ] **Step 1: Update history loading — scope to session**

Replace the "Load history on mount" useEffect (lines 101-107) with:

```typescript
// Load history when session changes
useEffect(() => {
  if (!activeSessionId) {
    setMessages([]);
    return;
  }
  (async () => {
    const history = await window.api.invoke('chat:get-history', activeSessionId) as ChatMessage[];
    setMessages(history.map(parseMessage));
  })();
}, [activeSessionId]);
```

- [ ] **Step 2: Update stream event handler — scope `chat:get-history` calls to session**

In the `'done'` case of the stream event handler (around lines 139-149), replace the history reload with:

```typescript
case 'done': {
  setAgentStatus('idle');
  setActiveTool(null);
  setStreamBuffer('');
  if (activeSessionId) {
    (async () => {
      const history = await window.api.invoke('chat:get-history', activeSessionId) as ChatMessage[];
      setMessages(history.map(parseMessage));
      setPendingProposals([]);
    })();
  }
  break;
}
```

Add `activeSessionId` to the useEffect dependency array (line 161):
```typescript
}, [debouncedTaskRefresh, activeSessionId]);
```

- [ ] **Step 3: Rewrite `handleSend` — lazy session creation + transcript context from DB**

Replace the `lastSentContextRef` and `handleSend` (lines 168-190) with:

```typescript
// Track which transcript context was last sent to avoid re-sending
const lastSentContextRef = useRef<string | undefined>(undefined);

const handleSend = async () => {
  const text = input.trim();
  if (!text || agentStatus !== 'idle') return;

  setInput('');
  setAgentStatus('thinking');
  const tempMsg: ParsedMessage = { id: 'temp-' + Date.now(), role: 'user', text };
  setMessages(prev => [...prev, tempMsg]);

  // Lazy session creation — create on first message
  let sessionId = activeSessionId;
  if (!sessionId) {
    const session = await window.api.invoke('chat:create-session') as { id: string };
    sessionId = session.id;
    onSessionChange(sessionId);
  }

  // Update session title on first user message
  const currentMessages = messages;
  if (currentMessages.length === 0) {
    const title = text.substring(0, 60);
    window.api.invoke('chat:update-session-title', sessionId, title);
  }

  // Include transcript content on first message after context change
  let transcriptContent: string | undefined;
  const contextKey = context.transcriptId || '';
  if (contextKey && contextKey !== lastSentContextRef.current) {
    try {
      const transcript = await window.api.invoke('transcript:get', contextKey) as { raw_text: string } | null;
      if (transcript) {
        transcriptContent = transcript.raw_text;
      }
    } catch (err) {
      console.error('Failed to fetch transcript for context:', err);
    }
    lastSentContextRef.current = contextKey;
  }

  await window.api.invoke('chat:send-message', {
    message: text,
    context,
    sessionId,
    transcriptContent,
  });
};
```

- [ ] **Step 4: Update `handleClearHistory` — scope to session**

Replace `handleClearHistory` (lines 242-245) with:

```typescript
const handleClearHistory = async () => {
  if (activeSessionId) {
    await window.api.invoke('chat:clear-history', activeSessionId);
  }
  setMessages([]);
  onSessionChange(null);
};
```

- [ ] **Step 5: Verify compilation and basic function**

```bash
npm start
```
Expected: App launches. Chat works — first message creates a session lazily. Messages persist to the session. Clearing history works.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/ChatInterface.tsx
git commit -m "feat: session-scoped chat with lazy creation and DB transcript context"
```

---

## Task 9: ChatInterface — Session UI

Add the new chat header with session title, "+" (new chat) button, and clock (history) button. Implement the chat history dropdown.

**Files:**
- Modify: `src/renderer/components/ChatInterface.tsx`
- Modify: `src/renderer/App.tsx` (move header into ChatInterface)

- [ ] **Step 1: Add session UI state**

Add after the existing state declarations (around line 86):

```typescript
const [showHistory, setShowHistory] = useState(false);
const [sessions, setSessions] = useState<Array<{ id: string; title: string; updated_at: string }>>([]);
const [sessionTitle, setSessionTitle] = useState('New chat');
const historyRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 2: Add `handleNewChat` function**

Add after `handleClearHistory`:

```typescript
const handleNewChat = () => {
  // Don't eagerly create a session — just reset to null.
  // The next handleSend will lazily create one, avoiding orphan sessions.
  onSessionChange(null);
  setMessages([]);
  setSessionTitle('New chat');
  lastSentContextRef.current = undefined;
};
```

- [ ] **Step 3: Add `handleLoadSession` function**

```typescript
const handleLoadSession = async (sessionId: string) => {
  onSessionChange(sessionId);
  setShowHistory(false);
  const history = await window.api.invoke('chat:get-history', sessionId) as ChatMessage[];
  setMessages(history.map(parseMessage));
  const session = sessions.find(s => s.id === sessionId);
  if (session) setSessionTitle(session.title);
};
```

- [ ] **Step 4: Add `toggleHistory` function**

```typescript
const toggleHistory = async () => {
  if (!showHistory) {
    const list = await window.api.invoke('chat:list-sessions') as Array<{ id: string; title: string; updated_at: string }>;
    setSessions(list);
  }
  setShowHistory(!showHistory);
};
```

- [ ] **Step 5: Add click-outside handler for history dropdown**

```typescript
useEffect(() => {
  if (!showHistory) return;
  const handleClickOutside = (e: MouseEvent) => {
    if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
      setShowHistory(false);
    }
  };
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setShowHistory(false);
  };
  document.addEventListener('mousedown', handleClickOutside);
  document.addEventListener('keydown', handleEscape);
  return () => {
    document.removeEventListener('mousedown', handleClickOutside);
    document.removeEventListener('keydown', handleEscape);
  };
}, [showHistory]);
```

- [ ] **Step 6: Update session title when it changes via handleSend**

In `handleSend`, after the `chat:update-session-title` call, add:
```typescript
setSessionTitle(title);
```

Also update `sessionTitle` when loading history in the `activeSessionId` useEffect:
```typescript
useEffect(() => {
  if (!activeSessionId) {
    setMessages([]);
    setSessionTitle('New chat');
    return;
  }
  (async () => {
    const history = await window.api.invoke('chat:get-history', activeSessionId) as ChatMessage[];
    setMessages(history.map(parseMessage));
  })();
}, [activeSessionId]);
```

- [ ] **Step 7: Move chat header into ChatInterface and add session controls**

Remove the static chat header from `App.tsx` (lines 92-95 — the `px-5 py-3 border-b` div with "Chat" and "PM Assistant"). The header now lives inside ChatInterface.

In `ChatInterface`, replace the outer container JSX. The new structure wraps the existing messages + input with a header:

```tsx
return (
  <div className="flex flex-col flex-1 overflow-hidden">
    {/* Chat header with session controls */}
    <div className="px-5 py-3 border-b border-border-base shrink-0 relative">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-text-muted">Chat</div>
          <div className="text-[13px] font-medium text-text-primary mt-0.5 truncate max-w-[260px]">{sessionTitle}</div>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {/* New chat */}
          <button
            onClick={handleNewChat}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
            title="New chat"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
          {/* Chat history */}
          <button
            onClick={toggleHistory}
            className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
            title="Chat history"
          >
            <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-4 h-4">
              <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* History dropdown */}
      {showHistory && (
        <div
          ref={historyRef}
          className="absolute top-full right-3 mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-border-base bg-surface-1 shadow-lg z-50 chat-scroll"
        >
          {sessions.length === 0 && (
            <div className="px-4 py-3 text-[12px] text-text-muted">No chat history</div>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => handleLoadSession(s.id)}
              className={`w-full text-left px-4 py-2.5 hover:bg-surface-2 transition-colors border-b border-border-base last:border-b-0 ${
                s.id === activeSessionId ? 'bg-surface-2' : ''
              }`}
            >
              <div className="text-[13px] text-text-primary truncate">{s.title}</div>
              <div className="text-[11px] text-text-muted mt-0.5">{formatRelativeTime(s.updated_at)}</div>
            </button>
          ))}
        </div>
      )}
    </div>

    {/* Messages and input — keep the existing content from the current return statement.
        Specifically, keep everything currently inside the outermost div (lines 248-358 of the
        pre-Task-8 file), which includes:
        - The messages scroll container (div with ref={scrollRef})
        - The input area (div with className="px-3 pb-3")
        - The <style> block with chat-scroll and thinkBounce keyframes
        The only change is the outer wrapper: the existing outermost div (line 248) becomes
        a child of the new header wrapper instead of being the root return element. */}
    <div className="flex flex-col flex-1 overflow-hidden p-3">
      <div className="flex flex-col flex-1 overflow-hidden rounded-2xl border border-border-base bg-surface-1">
        {/* Messages scroll container — unchanged from existing code */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4 chat-scroll">
          {/* ... all existing message rendering, status indicator, stream buffer ... */}
        </div>

        {/* Input area — unchanged from existing code */}
        <div className="px-3 pb-3">
          {/* ... existing textarea + buttons ... */}
        </div>
      </div>

      {/* Style block — unchanged from existing code */}
      <style>{`
        .chat-scroll::-webkit-scrollbar { width: 5px; }
        /* ... rest of existing styles ... */
      `}</style>
    </div>
  </div>
);
```

- [ ] **Step 8: Add `formatRelativeTime` helper**

Add above the component function:

```typescript
function formatRelativeTime(dateStr: string): string {
  // SQLite datetime('now') returns 'YYYY-MM-DD HH:MM:SS' without Z suffix.
  // Append Z so JS parses it as UTC, matching the DB timezone.
  const date = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z');
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
```

- [ ] **Step 9: Update App.tsx — remove the static chat header**

In `src/renderer/App.tsx`, remove the chat header div inside the chat sidebar section. Replace the chat sidebar block (lines 86-98) with:

```tsx
{showChat && (
  <div
    className="flex flex-col bg-surface-0 border-l border-border-base shrink-0"
    style={{ width: '420px', marginTop: '40px' }}
  >
    <ChatInterface
      context={context}
      activeSessionId={activeSessionId}
      onSessionChange={setActiveSessionId}
      onTaskChanged={() => setTaskVersion(v => v + 1)}
    />
  </div>
)}
```

- [ ] **Step 10: Verify the full flow**

Run `npm start`. Test:
1. Open transcript → chat appears → send a message → session created lazily → title updates
2. Click `+` → new chat starts, old messages gone
3. Click clock icon → dropdown shows previous session
4. Click previous session → messages reload, chat is resumable
5. Send another message in resumed session → works
6. Click trash → session deleted, chat resets
7. Navigate to tasks screen → open chat → same session persists
8. Close and reopen app → click clock → old sessions visible and resumable

- [ ] **Step 11: Commit**

```bash
git add src/renderer/components/ChatInterface.tsx src/renderer/App.tsx
git commit -m "feat: chat session UI with new chat, history dropdown, and resumable sessions"
```

---

## Summary

| Task | Description | Files | Depends On |
|------|-------------|-------|------------|
| 1 | Schema & Migration | `db/schema.ts`, `db/index.ts` | — |
| 2 | Transcript Pipeline | `ipc/meetings.ts` | Task 1 |
| 3 | Agent Session Support | `agent/chat-agent.ts` | Task 1 |
| 4 | Chat IPC Session Handlers | `ipc/chat.ts` | Task 1, 3 |
| 5 | Preload & System Prompt | `preload.ts`, `system-prompt.ts` | — |
| 6 | TranscriptView Updates | `TranscriptView.tsx` | Task 2 |
| 7 | App.tsx & ChatInterface Props | `App.tsx`, `ChatInterface.tsx` (props only) | Task 5, 6 |
| 8 | ChatInterface Session Logic | `ChatInterface.tsx` | Task 4, 7 |
| 9 | ChatInterface Session UI | `ChatInterface.tsx`, `App.tsx` | Task 8 |
