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

Add `session_id` column referencing `chat_sessions.id`. Drop the existing unused `transcript_id` column.

```sql
ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id);
```

### Modified table: `transcripts`

Add `transcript_json` column to store the structured `TranscriptEntry[]` JSON for UI rendering. The existing `raw_text` column stores flattened speaker-labeled text for agent consumption.

```sql
ALTER TABLE transcripts ADD COLUMN transcript_json TEXT;
```

### Modified table: `meeting_bots`

Add `transcript_id` column to map from google event → persisted transcript.

```sql
ALTER TABLE meeting_bots ADD COLUMN transcript_id TEXT;
```

### `meetings` table (now populated)

No schema change. The table already exists but is empty. It will be populated when transcripts are fetched — one row per meeting that has a transcript.

Fields used: `id` (UUID), `title` (calendar event summary), `meeting_url`, `status` ('done'), `created_at`.

---

## 2. Transcript Pipeline

### Fetch & persist flow

Triggered by `meeting:fetch-transcript(googleEventId)` IPC handler.

1. **Check cache:** Look up `meeting_bots` by `google_event_id`. If `transcript_id` is set, fetch from `transcripts` table and return cached data. No Recall API call.

2. **Fetch from Recall:** If not cached, proceed with current flow — look up `recall_bot_id`, call `getBotStatus()`, call `getBotTranscript()`.

3. **Create meeting row:** Insert into `meetings` table with UUID, title (from calendar event summary passed as parameter), meeting URL, status='done'.

4. **Convert to raw_text:** Flatten `TranscriptEntry[]` to speaker-labeled lines:
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
     transcript: TranscriptEntry[],  // for UI rendering
     transcriptId: string,           // for chat context
     meetingId: string               // for chat context
   }
   ```

### IPC handler: `transcript:get`

New handler. Fetches transcript from DB by ID.

```typescript
ipcMain.handle('transcript:get', async (_e, transcriptId: string) => {
  // Returns { id, meeting_id, raw_text, transcript_json, analysis_json, created_at }
});
```

### Meeting title propagation

The `meeting:fetch-transcript` handler currently only receives `googleEventId`. It needs the meeting title to populate the `meetings` table. Options:
- Pass title as a second parameter from the renderer (TranscriptView already has `meetingTitle` prop)
- Look it up from Google Calendar API

Use the first approach — simpler, no extra API call.

Update handler signature: `meeting:fetch-transcript(googleEventId, meetingTitle)`

---

## 3. Chat Session Lifecycle

### App launch

- On mount, create a new `chat_session` row (UUID, title='New chat')
- Store `activeSessionId` in `App.tsx` state
- Load messages for this session (empty on first launch)

### During usage

- All messages saved with `session_id` = active session ID
- After first user message, update session `title` to first 60 characters of the message
- Update `updated_at` on every new message
- Navigating between screens keeps the same session
- Transcript context injection is tracked per-session (ref tracks which transcript was already injected in this session)

### New chat

- User clicks `+` button in chat header
- Creates new `chat_session` row
- Sets as `activeSessionId`
- Clears message list in UI
- Resets context tracking (transcript injection ref)

### Chat history

- User clicks clock icon in chat header
- Shows a panel listing past sessions ordered by `updated_at` desc
- Each entry: session title (truncated) + relative timestamp
- Click to switch: loads that session's messages, sets as `activeSessionId`
- Active session highlighted in the list
- Resumable — new messages append to the loaded session

### Clear/delete

- Existing trash button deletes all messages in the current session and the session record itself
- After deletion, automatically creates a new empty session

### IPC handlers (new/modified)

- `chat:create-session()` → creates session row, returns `{ id, title, created_at }`
- `chat:list-sessions(limit?)` → returns sessions ordered by `updated_at` desc
- `chat:get-history(sessionId)` → returns messages for a specific session (modified from current no-arg version)
- `chat:clear-history(sessionId)` → deletes messages + session row (modified)
- `chat:send-message` → add `sessionId` to the data payload
- `chat:update-session-title(sessionId, title)` → updates title after first message

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

**Other screens:** unchanged from current implementation.

### Context injection

- `App.tsx` holds `transcriptId` and `meetingId` from the `meeting:fetch-transcript` response
- These are passed to `ChatInterface` via the `context` prop (add `transcriptId` to `CurrentContext` interface)
- On first message after `transcriptId` changes, `ChatInterface` fetches `raw_text` from DB via `transcript:get` and includes it as `transcriptContent` in `chat:send-message`
- `lastSentContextRef` tracks which `transcriptId` was already injected to avoid re-sending
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

- Left: "CHAT" label (mono, muted) + session title below (13px, editable)
- Right: two icon buttons
  - `+` — create new chat session
  - Clock icon — toggle chat history panel

### Chat history panel

- Appears below the header, above the messages (pushes messages down)
- Or as an overlay/dropdown
- List of past sessions: title (truncated) + relative time ("2h ago", "Yesterday")
- Active session highlighted
- Click to switch
- Scrollable if many sessions

### TranscriptView

- No visual changes
- `meeting:fetch-transcript` call updated to pass `meetingTitle` as second arg
- Callback `onTranscriptLoaded(transcriptId, meetingId)` passes IDs up to `App.tsx`

### App.tsx state

- Add `activeSessionId: string`
- Add `transcriptId: string | undefined`
- Remove `transcriptText: string | undefined` (was partially implemented, replaced by DB approach)
- Pass `activeSessionId` to `ChatInterface`
- Pass `transcriptId` in `context` to `ChatInterface`

---

## 6. Migration Strategy

Since the app is pre-production (hackathon project), migrations can be applied by modifying `schema.ts` directly:

1. Add `chat_sessions` CREATE TABLE to schema
2. Add `session_id` column to `chat_messages` (nullable for backward compat with existing messages)
3. Add `transcript_json` column to `transcripts`
4. Add `transcript_id` column to `meeting_bots`
5. Existing data: orphaned chat messages (no session_id) can be ignored or bulk-assigned to a "Legacy" session on first launch

---

## 7. File Impact Summary

### Backend (main process)

| File | Change |
|------|--------|
| `src/main/db/schema.ts` | Add `chat_sessions` table, add columns to `chat_messages`, `transcripts`, `meeting_bots` |
| `src/main/ipc/meetings.ts` | Rewrite `meeting:fetch-transcript` to persist to DB, add `transcript:get` handler |
| `src/main/ipc/chat.ts` | Add session CRUD handlers, modify existing handlers to take `sessionId` |
| `src/main/agent/chat-agent.ts` | Pass `sessionId` through, load session-scoped history |
| `src/main/agent/system-prompt.ts` | Update transcript context block to use `transcriptId`/`meetingId` |
| `src/main/preload.ts` | Add new IPC channels |

### Frontend (renderer)

| File | Change |
|------|--------|
| `src/renderer/App.tsx` | Add `activeSessionId`, `transcriptId` state; remove `transcriptText`; create session on mount |
| `src/renderer/components/ChatInterface.tsx` | Accept `sessionId` prop; session-scoped history loading; transcript context injection from DB; new chat / history UI in header |
| `src/renderer/components/TranscriptView.tsx` | Pass `meetingTitle` to fetch handler; callback with `transcriptId`/`meetingId` |

### No changes needed

- `src/main/agent/tools.ts` — tool definitions unchanged
- `src/main/agent/tool-executor.ts` — tool implementations unchanged (already query DB)
- `src/main/services/recall.ts` — Recall API service unchanged
- `src/renderer/components/chat/MessageBubble.tsx` — rendering unchanged
- `src/renderer/components/TaskReview.tsx` — kanban unchanged
