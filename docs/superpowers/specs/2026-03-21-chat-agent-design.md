# Chat Agent Design Spec

## Overview

A context-aware global chat agent that runs in the right-side drawer of the PM tool. It helps product managers analyze transcripts, extract insights, and manage tasks through natural conversation. The agent uses Claude's tool_use capability in an agentic loop, streaming step-by-step progress to the UI.

## Key Design Decisions

- **Streaming agentic loop in main process** — Claude API calls are async/non-blocking; no need for a separate worker process. Events stream to the renderer after each step.
- **Context-aware but globally scoped** — the agent knows what screen/transcript the user has open (injected automatically) but can reach any data via tools.
- **Proposals, not actions** — `create_task` and `update_task` return proposals rendered as approvable cards in chat. Nothing writes to DB until the user approves.
- **Global conversation** — one continuous chat thread (not per-transcript). The `chat_messages.transcript_id` column becomes nullable.
- **Prompt caching friendly** — static system prompt + dynamic context in system message; active transcript content injected as a user message so switching transcripts doesn't invalidate the cache.

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

When the agent calls `create_task` or `update_task` multiple times in a single loop, all proposals are collected and rendered as a batch with "Approve All" / "Reject All" buttons.

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

## IPC Contract

### New/Modified Channels

```typescript
// Invoke (renderer → main)
'chat:send-message'      // { message: string, context: CurrentContext }
'chat:cancel'            // void — abort current agent loop
'chat:get-history'       // void — returns ChatMessage[]
'chat:approve-proposal'  // { proposal_id: string }
'chat:reject-proposal'   // { proposal_id: string }

// Listener (main → renderer, push)
'chat:stream-event'      // StreamEvent (see above)
```

### Preload Changes

Add `on` and `off` methods to `window.api` for listening to push events from main process:

```typescript
window.api.on(channel: Channel, callback: (...args: unknown[]) => void): void
window.api.off(channel: Channel, callback: (...args: unknown[]) => void): void
```

## Schema Changes

Make `chat_messages.transcript_id` nullable (was required FK). Conversation is global, not per-transcript.

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
