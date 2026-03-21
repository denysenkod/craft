# Transcript Pipeline & Chat Sessions Design

## Goal

Wire the transcript lifecycle end-to-end: fetch from Recall API, persist to SQLite, make available to the agent's tools, and inject into chat context. Replace the global chat with session-based conversations that persist and are resumable.

## Architecture

Transcripts are fetched from Recall once per meeting and cached in the DB. The agent's existing tools (`get_transcript`, `search_transcripts`, `get_meeting`, `list_meetings`) query the DB directly — no new tools needed. Chat is organized into sessions that span across screens and persist between app launches.

## Tech Stack

- SQLite (better-sqlite3) for persistence
- Existing Recall API service (`src/main/services/recall.ts`)
- Anthropic Claude API for the agent (unchanged)
- React frontend (Electron renderer)

---

## 1. Data Model Changes

### New table: `chat_sessions`

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modified table: `chat_messages`

Add `session_id` column referencing `chat_sessions.id` with `ON DELETE CASCADE` (so deleting a session automatically removes its messages). The existing `transcript_id` column is left in place (dead column — not worth a table recreation migration).

### Modified table: `transcripts`

Add `transcript_json` column to store the structured `TranscriptEntry[]` JSON for UI rendering. The existing `raw_text` column stores flattened speaker-labeled text for agent consumption.

### Modified table: `meeting_bots`

Add `transcript_id` column to map from google event → persisted transcript.

### Index

```sql
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
```

### `meetings` table (now populated)

No schema change. The table already exists but is empty. It will be populated when transcripts are fetched — one row per meeting that has a transcript.

Fields used: `id` (UUID), `title` (calendar event summary), `meeting_url`, `status` ('done'), `created_at`.

---

## 2. Transcript Pipeline

### Fetch & persist flow

Triggered by `meeting:fetch-transcript(googleEventId, meetingTitle)` IPC handler.

1. **Check cache:** Look up `meeting_bots` by `google_event_id`. If `transcript_id` is set, fetch from `transcripts` table (join with `meetings` for title/URL) and return cached data. No Recall API call.

2. **Fetch from Recall:** If not cached, proceed with current flow — look up `recall_bot_id`, call `getBotStatus()`, call `getBotTranscript()`.

3. **Create meeting row:** Insert into `meetings` table with UUID, title (from `meetingTitle` parameter), meeting URL (from `meeting_bots` or calendar event), status='done'. Deduplication is handled by the cache check in step 1 — if `meeting_bots.transcript_id` is already set, we return cached data and never reach this step. The `meetings` table does not need a `google_event_id` column; the link is: `meeting_bots.google_event_id` → `meeting_bots.transcript_id` → `transcripts.meeting_id` → `meetings.id`.

4. **Convert to raw_text:** Flatten `TranscriptEntry[]` to timestamped speaker-labeled lines:
   ```
   [0:14] Denys Denysenko: Hey, so what's the updates?...
   [1:02] John: The latest task is...
   ```

5. **Insert transcript:** Save to `transcripts` table with UUID, `meeting_id` (FK to new meetings row), `raw_text` (flattened text), `transcript_json` (JSON string of `TranscriptEntry[]`).

6. **Update meeting_bots:** Set `transcript_id` on the `meeting_bots` row for future cache lookups.

7. **Return to renderer:**
   ```typescript
   {
     status: 'done',
     transcript: TranscriptEntry[],  // for UI rendering (from transcript_json)
     transcriptId: string,           // for chat context
     meetingId: string               // for chat context
   }
   ```

Steps 3–6 are wrapped in a single DB transaction to prevent partial writes.

### Deduplication

To handle concurrent requests for the same transcript (e.g., double-click), the handler checks `meeting_bots.transcript_id` at the start. If two requests race past the cache check, the transaction + UUID primary keys prevent data corruption. The second request will create a duplicate meeting/transcript row, but this is acceptable for a hackathon project. A production system would add a UNIQUE constraint on `meetings(recall_bot_id)`.

### IPC handler: `transcript:get`

New handler, registered in `meetings.ts`. The preload channel `'transcript:get'` already exists in the whitelist — only the handler implementation is needed.

```typescript
ipcMain.handle('transcript:get', async (_e, transcriptId: string) => {
  // Query: SELECT * FROM transcripts WHERE id = ?
  // Returns: { id, meeting_id, raw_text, transcript_json: TranscriptEntry[], analysis_json, created_at }
  // Note: transcript_json is stored as a JSON string in the DB but parsed to TranscriptEntry[] before returning
});
```

### Meeting title propagation

The `meeting:fetch-transcript` handler currently only receives `googleEventId`. It needs the meeting title to populate the `meetings` table.

Updated handler signature: `meeting:fetch-transcript(googleEventId, meetingTitle)`

The renderer (TranscriptView) already has `meetingTitle` as a prop — pass it as the second argument.

**Note on naming:** In `App.tsx`, the value passed to TranscriptView as `meetingId` is actually the Google Calendar event ID (from MeetingList). The handler in `meetings.ts` correctly names it `googleEventId`. These are the same value — the naming is inconsistent in the renderer but does not require a rename.

### Removing `analysisJson`

The `analysisJson` parameter in `runAgent()` and `buildMessages()` is dead code — the Analysis pane was removed from the UI. The new `runAgent()` signature replaces it with `sessionId` and `transcriptContent`:

```typescript
// Old: runAgent(win, userMessage, context, transcriptContent?, analysisJson?)
// New: runAgent(win, userMessage, context, sessionId, transcriptContent?)
```

The `<reference_analysis>` block in `buildMessages()` is also removed. If analysis is reintroduced later, it should be fetched from the DB (like transcripts) rather than passed as a parameter.

---

## 3. Chat Session Lifecycle

### App launch — lazy session creation

Sessions are created lazily on first message, not on app mount. This avoids orphan "New chat" sessions from app launches where the user never sends a message.

- `App.tsx` initializes `activeSessionId` as `null`
- On first `handleSend`, if `activeSessionId` is null:
  1. `const session = await window.api.invoke('chat:create-session')` — async IPC, must complete first
  2. `setActiveSessionId(session.id)` — update state
  3. `await window.api.invoke('chat:send-message', { message, context, sessionId: session.id, transcriptContent })` — use the new session ID directly (not from state, which hasn't re-rendered yet)
- On subsequent messages, use the existing `activeSessionId`

### During usage

- All messages saved with `session_id` = active session ID
- After first user message, update session `title` to first 60 characters of the message via `chat:update-session-title`
- `saveMessage()` in `chat-agent.ts` also updates `chat_sessions.updated_at` via: `UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`
- Navigating between screens keeps the same session
- Transcript context injection is tracked per-session (ref tracks which transcript was already injected in this session)

### New chat

- User clicks `+` button in chat header
- Creates new `chat_session` row via `chat:create-session()`
- Sets as `activeSessionId`
- Clears message list in UI
- Resets context tracking (transcript injection ref)

### Chat history

- User clicks clock icon in chat header
- Shows a dropdown overlay listing past sessions ordered by `updated_at` desc (max 30 sessions)
- Each entry: session title (truncated) + relative timestamp ("2h ago", "Yesterday")
- Click to switch: loads that session's messages via `chat:get-history(sessionId)`, sets as `activeSessionId`
- Active session highlighted in the list
- Resumable — new messages append to the loaded session
- Empty sessions (0 messages) are excluded from the list

### Clear/delete

- Existing trash button deletes all messages in the current session and the session record itself
- After deletion, sets `activeSessionId` to null (next message creates a new session lazily)

### Session ID data flow through the agent

The `sessionId` must flow from the renderer through the IPC layer into the agent loop:

1. **Renderer:** `ChatInterface` passes `sessionId` in the `chat:send-message` payload:
   ```typescript
   { message, context, sessionId, transcriptContent }
   ```

2. **IPC handler** (`chat.ts`): `chat:send-message` extracts `data.sessionId` and passes it to `runAgent()`:
   ```typescript
   runAgent(win, data.message, data.context, data.sessionId, data.transcriptContent)
   ```

3. **Agent** (`chat-agent.ts`): Updated `runAgent()` signature:
   ```typescript
   async function runAgent(win, userMessage, context, sessionId, transcriptContent?)
   ```
   - `loadHistory(sessionId)` → `WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
   - `saveMessage(role, content, sessionId)` → `INSERT ... (id, role, content, session_id, created_at)`
   - After `saveMessage`, update `chat_sessions.updated_at`

### IPC handlers (new/modified)

- `chat:create-session()` → creates session row, returns `{ id, title, created_at }`
- `chat:list-sessions(limit?)` → returns sessions ordered by `updated_at` desc, default limit 30, excludes sessions with 0 messages. SQL:
  ```sql
  SELECT s.* FROM chat_sessions s
  WHERE EXISTS (SELECT 1 FROM chat_messages WHERE session_id = s.id)
  ORDER BY s.updated_at DESC LIMIT ?
  ```
- `chat:get-history(sessionId)` → returns messages for a specific session (modified from current no-arg version)
- `chat:clear-history(sessionId)` → deletes messages first (`DELETE FROM chat_messages WHERE session_id = ?`), then session row (`DELETE FROM chat_sessions WHERE id = ?`). Order matters due to FK constraint. Alternatively, the FK uses `ON DELETE CASCADE` (see migration section).
- `chat:send-message` → add `sessionId` to the data payload
- `chat:update-session-title(sessionId, title)` → updates title

### Preload changes

Add new channels: `chat:create-session`, `chat:list-sessions`, `chat:update-session-title`.
Modify existing: `chat:get-history` and `chat:clear-history` now take `sessionId` parameter.

---

## 4. Agent Context & Tools

### System prompt context blocks

**Transcript screen (with transcript loaded):**
```
<current_context>
The user is currently viewing a transcript.
Meeting: "{meeting_title}"
Transcript ID: {transcript_id}
Meeting ID: {meeting_id}
The transcript content has been provided as reference context below.
You do NOT need to call get_transcript — you already have the content.
If the user asks about "this transcript" or "this meeting", they mean the one above.
</current_context>
```

To make `meeting_title` available, add it to the `CurrentContext` interface:

```typescript
export interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;
  meetingId?: string;
  meetingTitle?: string;  // new — for system prompt injection
}
```

`App.tsx` already has `selectedMeeting.title` — wire it into the `context` object alongside `meetingId`.

**Other screens:** unchanged from current implementation.

### Context injection

- `App.tsx` holds `transcriptId` and `meetingId` from the `meeting:fetch-transcript` response
- These are passed to `ChatInterface` via the `context` prop (wire `transcriptId` into the `context` object — the `CurrentContext` interface field already exists but is never populated)
- On first message after `transcriptId` changes, `ChatInterface` fetches `raw_text` from DB via `transcript:get` and includes it as `transcriptContent` in `chat:send-message`
- **Why fetch from DB instead of passing in-memory?** When a user resumes an old chat session after app restart, the transcript text is no longer in memory. Fetching from DB ensures it's always available regardless of how the session was reached.
- `lastSentContextRef` tracks which `transcriptId` was already injected to avoid re-sending (keyed by `transcriptId`, not `meetingId`)
- In `chat-agent.ts`, `buildMessages()` wraps the content in `<reference_transcript>` tags (already implemented, just not wired)

### Existing tools that now work

No new tools needed. These existing tools now return real data because the DB is populated:

- **`get_transcript(transcript_id)`** — returns full raw_text + analysis_json from `transcripts` table
- **`search_transcripts(query)`** — full-text LIKE search across `transcripts.raw_text`
- **`get_meeting(meeting_id)`** — returns meeting metadata from `meetings` table
- **`list_meetings(status?, limit?)`** — lists meetings with `has_transcript` flag

---

## 5. UI Changes

### Chat header (modified)

Replace the current static header with:

```
┌─────────────────────────────────────┐
│ CHAT                                │
│ Session Title          [+]  [🕐]   │
└─────────────────────────────────────┘
```

- Left: "CHAT" label (mono, muted) + session title below (13px)
- Right: two icon buttons
  - `+` — create new chat session
  - Clock icon — toggle chat history dropdown

### Chat history dropdown

- Overlay dropdown anchored to the clock button, positioned below the header
- Does not push messages down — overlays on top of them
- List of past sessions (max 30): title (truncated) + relative time ("2h ago", "Yesterday")
- Active session highlighted
- Click to switch
- Scrollable if many sessions
- Clicking outside or pressing Escape closes the dropdown

### TranscriptView

- No visual changes
- `meeting:fetch-transcript` call updated to pass `meetingTitle` as second arg
- Callback signature changes from `onTranscriptLoaded?: (text: string) => void` to:
  ```typescript
  onTranscriptLoaded?: (transcriptId: string, meetingId: string) => void;
  ```
  The raw transcript text is no longer passed up to `App.tsx` — `ChatInterface` fetches it from DB when needed.

### App.tsx state

- Add `activeSessionId: string | null` (null until first message)
- Add `transcriptId: string | null` and `meetingId: string | null` state (set by `onTranscriptLoaded` callback)
- Wire `transcriptId` and `meetingTitle` into the `context` object (fields exist on interface, just never populated): `{ screen, transcriptId, meetingId, meetingTitle: selectedMeeting?.title }`
- Remove `transcriptText: string | undefined` (partially implemented ephemeral approach, replaced by DB)
- Pass `activeSessionId` and `onSessionChange` callback to `ChatInterface`

---

## 6. Migration Strategy

The codebase uses `pragma user_version` with a `migrate()` function in `src/main/db/index.ts`. Current version is 1.

### Changes to `schema.ts`

Add `chat_sessions` CREATE TABLE to the schema string (gets `IF NOT EXISTS` treatment on every launch).

### Changes to `db/index.ts`

Add a `version < 2` migration block, bump `CURRENT_VERSION` to 2:

```typescript
if (version < 2) {
  db.transaction(() => {
    // New table (also in schema.ts with IF NOT EXISTS for fresh installs)
    db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (...)`);

    // Add columns to existing tables
    db.exec(`ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE`);
    db.exec(`ALTER TABLE transcripts ADD COLUMN transcript_json TEXT`);
    db.exec(`ALTER TABLE meeting_bots ADD COLUMN transcript_id TEXT`);

    // Index for session-scoped queries
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)`);

    db.pragma(`user_version = 2`);
  })();
}
```

Existing `chat_messages` rows (no `session_id`) are ignored — they won't appear in any session's history. This is acceptable since the app is pre-production.

---

## 7. File Impact Summary

### Backend (main process)

| File | Change |
|------|--------|
| `src/main/db/schema.ts` | Add `chat_sessions` table, add new columns to `chat_messages`, `transcripts`, `meeting_bots` in CREATE TABLE statements |
| `src/main/db/index.ts` | Add version 2 migration block for ALTER TABLE statements and index, bump `CURRENT_VERSION` to 2 |
| `src/main/ipc/meetings.ts` | Rewrite `meeting:fetch-transcript` to persist to DB with cache check; add `transcript:get` handler |
| `src/main/ipc/chat.ts` | Add session CRUD handlers (`create-session`, `list-sessions`, `update-session-title`); modify `get-history`, `clear-history`, `send-message` to take `sessionId` |
| `src/main/agent/chat-agent.ts` | Add `sessionId` parameter to `runAgent()`, `loadHistory()`, `saveMessage()`; remove `analysisJson` parameter and `<reference_analysis>` block from `buildMessages()`; update `chat_sessions.updated_at` on save |
| `src/main/agent/system-prompt.ts` | Update transcript context block to reference `transcriptId`/`meetingId` when on transcript screen |
| `src/main/preload.ts` | Add new IPC channels: `chat:create-session`, `chat:list-sessions`, `chat:update-session-title` |

### Frontend (renderer)

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Add `activeSessionId` state (null initially); wire `transcriptId` into context; remove `transcriptText`; pass `sessionId` to ChatInterface |
| `src/renderer/components/ChatInterface.tsx` | Accept `sessionId` prop; lazy session creation on first send; session-scoped history loading; transcript context injection from DB; new chat / history UI in header |
| `src/renderer/components/TranscriptView.tsx` | Pass `meetingTitle` to fetch handler; callback with `transcriptId`/`meetingId` on successful fetch |

### No changes needed

- `src/main/agent/tools.ts` — tool definitions unchanged
- `src/main/agent/tool-executor.ts` — tool implementations unchanged (already query DB)
- `src/main/services/recall.ts` — Recall API service unchanged
- `src/renderer/components/chat/MessageBubble.tsx` — rendering unchanged
- `src/renderer/components/TaskReview.tsx` — kanban unchanged
