# Chat Agent Design Spec

## Overview

A context-aware global chat agent that runs in the right-side drawer of the PM tool. It helps product managers analyze transcripts, extract insights, and manage tasks through natural conversation. The agent uses Claude's tool_use capability in an agentic loop, streaming step-by-step progress to the UI.

## Key Design Decisions

- **Streaming agentic loop in main process** — Claude API calls are async/non-blocking; no need for a separate worker process. Events stream to the renderer after each step.
- **Context-aware but globally scoped** — the agent knows what screen/transcript the user has open (injected automatically) but can reach any data via tools.
- **Proposals, not actions** — `create_task` and `update_task` return proposals rendered as approvable cards in chat. Nothing writes to DB until the user approves.
- **Global conversation** — one continuous chat thread (not per-transcript). The `chat_messages.transcript_id` column becomes nullable.
- **Prompt caching friendly** — static system prompt + dynamic context in system message; active transcript content injected as a user message so switching transcripts doesn't invalidate the cache.
- **Loop safety** — agentic loop capped at 15 tool calls per turn to prevent runaway API usage.

## Architecture

```
Renderer (React)                    Main Process (Node.js)
┌──────────────────┐                ┌──────────────────────────────┐
│ ChatInterface    │                │  ChatAgent                   │
│                  │  invoke        │                              │
│  send message ───┼──────────────▶│  1. Build system prompt      │
│  + current ctx   │                │  2. Load history from DB     │
│                  │                │  3. Call Claude API w/ tools  │
│                  │  stream events │  4. AGENTIC LOOP:            │
│  update UI  ◀────┼───────────────│     tool_use? → execute,     │
│  (thinking,      │                │       emit event, loop       │
│   tool calls,    │                │     text? → emit deltas,     │
│   text deltas,   │                │       break                  │
│   proposals)     │                │  5. Save messages to DB      │
│                  │                │  6. Return proposals          │
│  cancel ─────────┼──────────────▶│  AbortController.abort()     │
└──────────────────┘                └──────────────────────────────┘
                                       │
                                       ▼
                                    ┌──────────────┐
                                    │ Tool Executor │
                                    │  → SQLite     │
                                    │  → proposals  │
                                    └──────────────┘
```

## Tools

### Data Retrieval

| Tool | Parameters | Returns |
|------|-----------|---------|
| `get_transcript` | `transcript_id: string` | Full transcript with raw_text and analysis JSON |
| `search_transcripts` | `query: string, limit?: number` | Matching excerpts with transcript/meeting IDs |
| `get_meeting` | `meeting_id: string` | Meeting metadata (title, url, status, has_transcript) |
| `list_meetings` | `status?: string, limit?: number` | Filtered meeting list |
| `get_task` | `task_id: string` | Task with full details and originating meeting title |
| `list_tasks` | `status?: string, transcript_id?: string, limit?: number` | Filtered task list |

### Action (Proposal-Based)

| Tool | Parameters | Returns |
|------|-----------|---------|
| `create_task` | `title: string, description: string, transcript_id?: string` | Proposal object with `temp_id` — rendered as approvable card |
| `update_task` | `task_id: string, title?: string, description?: string, reason: string` | Proposal object showing old/new diff — rendered as diff card |

When the agent calls `create_task` or `update_task` multiple times in a single loop, all proposals are collected and rendered as a batch with "Approve All" / "Reject All" buttons. Batch approval loops individual `chat:approve-proposal` calls in the renderer.

Note: `create_task` has `transcript_id` as optional. The `tasks` schema must be updated to make `transcript_id` nullable to support tasks created from general conversation context.

## Streaming Event Protocol

Main process emits events to renderer via `webContents.send('chat:stream-event', event)`:

```typescript
type StreamEvent =
  | { type: "thinking" }
  | { type: "tool_call"; tool: string; args: object }
  | { type: "tool_result"; tool: string; result: unknown }
  | { type: "message_delta"; content: string }
  | { type: "proposal"; proposals: Proposal[] }
  | { type: "done"; message_id: string }
  | { type: "error"; message: string }
```

## Renderer State

```typescript
interface ChatState {
  messages: ChatMessage[]           // { id, role, content, timestamp }
  agentStatus: "idle" | "thinking" | "tool_call" | "streaming"
  activeTool: { name: string; args: object } | null
  pendingProposals: Proposal[]
  streamBuffer: string
}
```

**State transitions:** idle → thinking → tool_call (may cycle) → streaming → idle. Cancel at any non-idle state aborts the loop and flushes partial streamBuffer as a message.

### Proposal Lifecycle

Proposals go through this lifecycle:

1. **Created** — agent calls `create_task`/`update_task` tool, tool executor returns proposal object with a UUID `proposal_id`
2. **Emitted** — proposals are included in the `{ type: "proposal" }` stream event
3. **Persisted** — proposals are stored as JSON in the assistant's `chat_messages.content` alongside the text response (structured as `{ text: string, proposals: Proposal[] }`)
4. **Rendered** — renderer parses the message content and renders proposal cards with approve/reject buttons
5. **Resolved** — user clicks approve → `chat:approve-proposal` writes to `tasks` table, returns the created/updated task; or reject → `chat:reject-proposal` marks it dismissed
6. **Updated** — the proposal's status (approved/rejected) is updated in the stored message content so re-opening the chat shows resolved state, not pending cards

This means proposals survive chat drawer close/reopen — they're part of the message history. Pending proposals show action buttons; resolved ones show their outcome (e.g., "Task created" with a checkmark).

### History Management

Conversation history is sent to Claude as prior messages on each turn. To prevent context overflow:
- Load the last 50 messages from DB for the Claude API call
- `chat:clear-history` deletes all rows from `chat_messages` to let the user start fresh
- Message IDs are UUIDs generated via the `uuid` package (already a dependency)

### Agentic Loop Safety

The loop is capped at **15 tool calls per turn**. If the limit is hit, the agent emits `{ type: "error", message: "Reached maximum tool calls for this turn" }` and the loop breaks. The partial response (if any streamed text was already emitted) is still saved.

## IPC Contract

### New/Modified Channels

```typescript
// Invoke (renderer → main)
'chat:send-message'      // { message: string, context: CurrentContext }
'chat:cancel'            // void — abort current agent loop
'chat:get-history'       // void — returns ChatMessage[]
'chat:clear-history'     // void — deletes all chat_messages, returns void
'chat:approve-proposal'  // { proposal_id: string } — returns created/updated task
'chat:reject-proposal'   // { proposal_id: string } — returns void

// Listener (main → renderer, push)
'chat:stream-event'      // StreamEvent (see above)
```

### CurrentContext Type

```typescript
interface CurrentContext {
  screen: 'meetings' | 'transcript' | 'tasks';
  transcriptId?: string;   // set when user has a transcript open
  meetingId?: string;       // set when user has a meeting selected
}
```

App.tsx must track the active transcript/meeting IDs (not just the screen name) and pass them to ChatInterface as props, which includes them in every `chat:send-message` call.

### Preload Changes

Add `on` and `off` methods to `window.api` for listening to push events from main process. This requires a separate listener-channel whitelist since `webContents.send()` uses `ipcRenderer.on()`, not `ipcRenderer.invoke()`:

```typescript
const invokeChannels = ['chat:send-message', 'chat:cancel', ...] as const;
const listenChannels = ['chat:stream-event'] as const;

contextBridge.exposeInMainWorld('api', {
  invoke(channel: InvokeChannel, ...args: unknown[]) { ... },
  on(channel: ListenChannel, callback: (...args: unknown[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, subscription);
    return subscription;  // return ref for cleanup
  },
  off(channel: ListenChannel, subscription: (...args: unknown[]) => void) {
    ipcRenderer.removeListener(channel, subscription);
  },
});
```

## Schema Changes

Two columns become nullable:
- `chat_messages.transcript_id` — conversation is global, not per-transcript
- `tasks.transcript_id` — tasks can be created from general chat without a source transcript

### Migration Strategy

The current DB init uses `CREATE TABLE IF NOT EXISTS`, which won't apply column changes to existing tables. Use SQLite's `pragma user_version` to track schema version and run migrations on startup:

```typescript
const CURRENT_VERSION = 1;

function migrate(db: Database) {
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 1) {
    // Wrap in transaction — if anything fails, no tables are dropped
    db.transaction(() => {
      // SQLite doesn't support ALTER COLUMN, so recreate affected tables
      db.exec(`
        CREATE TABLE chat_messages_new (
          id TEXT PRIMARY KEY,
          transcript_id TEXT REFERENCES transcripts(id),  -- now nullable
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO chat_messages_new SELECT * FROM chat_messages;
        DROP TABLE chat_messages;
        ALTER TABLE chat_messages_new RENAME TO chat_messages;

        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY,
          transcript_id TEXT REFERENCES transcripts(id),  -- now nullable
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

Call `migrate(db)` after `initDb()` in the app startup sequence.

## File Structure

```
src/main/
  agent/
    chat-agent.ts          — agentic loop, Claude API calls, event emitting
    tools.ts               — tool definitions (JSON schema for Claude API)
    tool-executor.ts       — executes tools against SQLite, returns results
    system-prompt.ts       — builds system prompt with dynamic context
  ipc/
    index.ts               — register chat:* handlers (modified)
    chat.ts                — IPC handler glue for chat channels
  db/
    schema.ts              — make transcript_id nullable (modified)
  preload.ts               — add on/off, new channels (modified)

src/renderer/
  components/
    ChatInterface.tsx       — wire to IPC, state machine, stream rendering (modified)
    chat/
      ProposalCard.tsx      — task create/update proposal with approve/reject/edit
      ToolCallIndicator.tsx — "Searching transcripts…" inline indicator
      MessageBubble.tsx     — individual message rendering (user/assistant)
  App.tsx                   — pass current context to ChatInterface (modified)
```

## System Prompt

Three layers, assembled per request:

**1. Identity (static):** Role definition, guidelines (be concise, reference quotes, use tools rather than guess, support bulk proposals).

**2. Current context (dynamic, in system message):** What screen the user is on, which transcript/meeting is open (IDs + title). Tells the agent it doesn't need to fetch the open transcript — it's provided as reference.

**3. Active transcript (dynamic, in user message):** When a transcript is open, its raw text and analysis JSON are injected into the first user message (not system prompt) wrapped in `<reference_transcript>` and `<reference_analysis>` tags. Only sent once when context changes, not on every message. This keeps the system prompt stable for prompt caching.

## What's NOT in Scope

- Pushing tasks to Linear from chat (stays as explicit UI action)
- Approving/rejecting tasks from chat (proposal cards handle create/update only)
- Drag-and-drop in task review
- Recall.ai integration
- Mom Test question generation (separate feature)
