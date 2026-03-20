# Cursor for Product Managers — Design Spec

**Date:** 2026-03-20
**Context:** 1-day hackathon, 2 experienced Imperial CS students
**Scope:** Sub-project B — Interview Analysis → Task Generation (with chat)

## Overview

An Electron desktop app that helps product managers turn customer interview transcripts into actionable development tasks. The app records meetings via Recall.ai, analyzes transcripts with Claude, lets PMs chat with the transcript to extract deeper insights, and pushes approved tasks to Linear.

## Product Flow

### Screens (sidebar-nav layout, Cursor/Slack-style)

1. **Meetings** — List of past/upcoming meetings. "Join Meeting" button where PM pastes a Google Meet/Zoom link → Recall bot joins. Shows recording status live. "Prepare questions" button opens Mom Test question generator for upcoming meetings.

2. **Transcript View** — Full transcript on the left. Right panel shows auto-generated analysis:
   - Summary (3-5 bullet points)
   - Pain points
   - Feature requests
   - Key quotes
   - Competitive mentions
   - Sentiment highlights
   - Auto-generated draft Linear tasks at the bottom

3. **Chat** — Chat interface scoped to the selected transcript. PM can ask questions, request tasks from conversation. New tasks generated from chat appear in the tasks panel.

4. **Tasks Review** — All draft tasks across all transcripts. PM can approve/reject/edit each one. "Push to Linear" button sends approved tasks.

## Architecture

```
┌─────────────────────────────────────┐
│         Electron App                │
│  ┌───────────────────────────────┐  │
│  │   Renderer (React + Tailwind) │  │
│  │   - Sidebar nav               │  │
│  │   - Meeting list              │  │
│  │   - Transcript viewer         │  │
│  │   - Chat interface            │  │
│  │   - Task review board         │  │
│  └──────────┬────────────────────┘  │
│             │ IPC                    │
│  ┌──────────▼────────────────────┐  │
│  │   Main Process (Node.js)      │  │
│  │   - Recall.ai API client      │  │
│  │   - Claude API (analysis+chat)│  │
│  │   - Linear API client         │  │
│  │   - SQLite (local storage)    │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Key Decisions

- **SQLite via `better-sqlite3`** for local storage. No external database.
- **All API calls from main process** — keeps API keys out of the renderer.
- **IPC bridge** — renderer sends commands, main process handles them and sends results back. Channel contract:
  - `meeting:create`, `meeting:list`, `meeting:get-status`
  - `transcript:get`, `transcript:analyze`
  - `chat:send-message`
  - `task:list`, `task:update-status`, `task:push-to-linear`
  - `settings:get`, `settings:set`
  - `momtest:generate-questions`
- **Claude API** — use `claude-sonnet-4-20250514` for both analysis and chat (fast, good structured output). Two different system prompts.
- **Chat-to-task extraction** — use Claude's `tool_use` feature: define a `create_task` tool in the chat system prompt. When the PM asks to create a task, Claude calls the tool with `{title, description}`. This gives reliable structured extraction without parsing hacks.
- **No separate backend server** — everything runs inside Electron.

### Tech Stack

- Electron (via `electron-forge` with React template)
- React + TypeScript
- Tailwind CSS + shadcn/ui
- better-sqlite3
- Anthropic SDK (Claude API)
- Linear SDK / GraphQL
- Recall.ai REST API

## Data Model (SQLite)

### meetings
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT (UUID) | Primary key |
| title | TEXT | Meeting title |
| meeting_url | TEXT | Google Meet/Zoom URL |
| recall_bot_id | TEXT | Recall.ai bot ID |
| status | TEXT | pending/recording/done/failed |
| created_at | TEXT | ISO timestamp |

### transcripts
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT (UUID) | Primary key |
| meeting_id | TEXT | FK → meetings.id |
| raw_text | TEXT | Full transcript text |
| analysis_json | TEXT | Structured Claude output (JSON) |
| created_at | TEXT | ISO timestamp |

### tasks
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT (UUID) | Primary key |
| transcript_id | TEXT | FK → transcripts.id |
| title | TEXT | Task title |
| description | TEXT | Task description |
| status | TEXT | draft/approved/rejected/pushed |
| linear_issue_id | TEXT | Null until pushed to Linear |
| source | TEXT | auto/chat |
| created_at | TEXT | ISO timestamp |

### chat_messages
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT (UUID) | Primary key |
| transcript_id | TEXT | FK → transcripts.id |
| role | TEXT | user/assistant |
| content | TEXT | Message content |
| created_at | TEXT | ISO timestamp |

## API Integrations

### Recall.ai
- `POST /api/v1/bot` — send bot to join a meeting (pass meeting URL)
- Poll `GET /api/v1/bot/{id}` for status (or webhook if time allows)
- `GET /api/v1/bot/{id}/transcript` — fetch transcript when recording is done
- **Fallback:** "Paste transcript" button if Recall setup has issues during demo

### Claude API (Anthropic SDK)
- **Analysis call:** System prompt instructs Claude to return structured JSON:
  ```json
  {
    "summary": ["bullet1", "bullet2", "..."],
    "pain_points": [{"text": "...", "transcript_ref": "..."}],
    "feature_requests": [{"text": "...", "transcript_ref": "..."}],
    "key_quotes": [{"text": "...", "speaker": "...", "transcript_ref": "..."}],
    "competitive_mentions": [{"text": "...", "competitor": "...", "transcript_ref": "..."}],
    "sentiment_highlights": [{"text": "...", "sentiment": "positive|negative|neutral", "transcript_ref": "..."}],
    "draft_tasks": [{"title": "...", "description": "..."}]
  }
  ```
- **Chat call:** System prompt includes full transcript as context. Uses `tool_use` with a `create_task` tool definition (`{title: string, description: string}`) so Claude can reliably create tasks when the PM requests them, alongside its conversational response.

### Linear API
- GraphQL endpoint for creating issues (title, description, team ID)
- Personal API key for hackathon auth (no OAuth flow needed)
- PM selects Linear team once in settings

### Mom Test Question Generation
- PM clicks "Prepare questions" before a meeting
- Sends meeting context to Claude with Mom Test system prompt
- Returns 5-7 suggested non-leading questions

## UI Design

### Theme
Dark theme, monospace-accented, Cursor-inspired. Minimal chrome.

### Layout
- **Left sidebar** (56px wide, icon-only) — 4 icons: Meetings, Transcripts, Chat, Tasks. Settings gear icon at bottom. App logo at top.
- **Main content area** — changes based on selected screen.
- **Split panes** where needed (transcript left / analysis right) with draggable divider.

### Key Components
- **Meeting card** — title, date, status badge (recording/done/failed). Click to open transcript.
- **Transcript viewer** — scrollable text with speaker labels and timestamps. Clickable highlights linking to analysis items.
- **Analysis panel** — collapsible sections for each analysis category. Each item has a "Create task" quick action.
- **Chat interface** — chat bubbles. Tasks generated from chat appear inline as approvable cards.
- **Task review** — kanban columns: Draft → Approved → Pushed to Linear. Drag or button to move. Bulk approve. Inline edit. **Scope-cut candidate:** if time is tight, replace kanban with a simple list + approve/reject buttons.
- **Settings modal** — Linear API key input, Linear team selection, Recall.ai API key. Opens from gear icon in sidebar.

## Work Split (8 hours)

### Person A — Electron Shell + UI
| Hour | Task |
|------|------|
| 1 | Scaffold Electron + React + Tailwind + shadcn/ui. Sidebar nav, routing. |
| 2-3 | Meeting list screen + Transcript viewer with split pane |
| 4-5 | Chat interface + Analysis panel |
| 6-7 | Task review board (kanban). Polish, transitions, dark theme. |
| 8 | Integration testing with Person B's backend, demo prep |

### Person B — Backend + Integrations
| Hour | Task |
|------|------|
| 1 | SQLite setup, IPC bridge scaffold, data model |
| 2-3 | Recall.ai integration (join meeting, poll status, fetch transcript) |
| 4-5 | Claude analysis pipeline (structured output) + chat with transcript |
| 6 | Linear API integration (push tasks) |
| 7 | Mom Test question generation, fallback "paste transcript" mode |
| 8 | Integration testing, demo prep |

### Critical Path
Person B's transcript analysis must work by hour 5 so Person A can wire up the UI to real data. Until then, Person A works with mock data.

### Demo Fallback Plan
If Recall.ai gives trouble, have a pre-recorded transcript ready. The analysis → chat → Linear flow is the core demo.

## Future Sub-projects (Post-hackathon)
- **Sub-project A:** Customer research agent (LinkedIn outreach, scheduling, calendar integration)
- Enterprise features (SSO, RBAC, audit logs)
- Multi-transcript pattern analysis ("across 10 interviews, what's the #1 pain point?")
- Figma/design integration
- Claude Code integration for implementation handoff
