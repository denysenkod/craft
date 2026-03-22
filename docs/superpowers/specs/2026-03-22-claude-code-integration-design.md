# Claude Code Integration — Design Spec

## Overview

Integrate Claude Code into the PM app so product managers can turn Linear issues into working prototype branches. The PM selects a ticket, enriches it with notes and transcript context, and Claude Code builds it on an isolated branch — opening a draft PR for engineer handoff.

## Integration Approach

Use the **Claude Code Agent SDK** (`@anthropic-ai/claude-code` npm package) to programmatically control Claude Code from Electron's main process. The SDK provides:

- Structured streaming events (thinking, tool use, progress, questions)
- Native Node.js integration — fits naturally in the Electron main process
- Interactive conversations for clarification questions
- Safety controls: allowed/disallowed tools, custom system prompts
- Full Claude Code capabilities: file editing, git operations, shell commands, PR creation

## Data Model

### `repos` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| name | TEXT | Display name (e.g., "Frontend App") |
| path | TEXT | Absolute local path to repo |
| github_url | TEXT | GitHub repo URL (for PR links) |
| default_branch | TEXT | Main branch name (main/master) |
| created_at | TEXT | ISO timestamp |

### `builds` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| repo_id | TEXT FK | Target repository |
| task_title | TEXT | Build task title |
| task_description | TEXT | Full task description |
| pm_notes | TEXT | PM's implementation hints, constraints |
| transcript_context | TEXT | Relevant transcript excerpts |
| source | TEXT | 'linear' (v1) |
| source_id | TEXT | Linear issue ID (nullable) |
| status | TEXT | queued, running, awaiting_input, done, failed |
| branch_name | TEXT | Git branch (e.g., pm/add-dark-mode-toggle) |
| pr_url | TEXT | GitHub draft PR URL |
| summary | TEXT | AI-generated summary of what was built |
| files_changed | INTEGER | Number of files modified |
| error_message | TEXT | Error details if failed |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### `build_events` table

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID |
| build_id | TEXT FK | Parent build |
| type | TEXT | progress, question, answer, error |
| content | TEXT | Human-readable event description |
| created_at | TEXT | ISO timestamp |

## Architecture

### Main Process — New Files

```
src/main/
  services/
    build-manager.ts      — Queue orchestration, build lifecycle
    build-executor.ts     — Claude Code SDK wrapper, event streaming
  ipc/
    builds.ts             — IPC handlers for Build view
    repos.ts              — IPC handlers for repo CRUD
```

### build-manager.ts

Responsibilities:
- Maintains the build queue
- Enforces concurrency: one running build per repo, parallel across different repos
- Manages build lifecycle transitions: queued → running → awaiting_input → done/failed
- Persists builds and events to SQLite
- Delegates execution to `build-executor.ts`

### build-executor.ts

Responsibilities:
- Wraps the Claude Code SDK `claude()` function
- Constructs the prompt from task title, description, PM notes, and transcript context
- Sets `cwd` to the target repo path
- Configures safety constraints (allowed/disallowed tools)
- Streams SDK events, distills them into curated `build_events` entries
- Forwards events to renderer via `webContents.send('build:event', ...)`
- Handles clarification questions: pauses execution, emits question event, resumes when PM answers
- On completion: extracts PR URL, files changed count, generates summary

### System Prompt for Builds

The SDK session receives a system prompt that includes:

```
You are building a feature for a product. A product manager has given you this task
based on customer feedback and product strategy.

## Task
{task_title}: {task_description}

## PM Notes
{pm_notes}

## Customer Context
{transcript_context}

## Rules
- Create a new branch with prefix "pm/" from the default branch
- Make clean, well-structured commits
- Write tests where appropriate
- When done, push the branch and open a draft PR with a clear description
- NEVER push to or merge into the default branch
- NEVER run destructive commands (rm -rf, drop tables, force push)
- If anything is unclear, ask for clarification — do not guess
```

### Safety Constraints

Enforced via SDK configuration:

- **Branch prefix**: System prompt mandates `pm/` prefix branches
- **No production push**: System prompt forbids pushing to default branch
- **Disallowed tools**: Block destructive shell commands via SDK `disallowedTools`
- **Scoped CWD**: `cwd` locks Claude Code to the target repo directory
- **Draft PRs only**: System prompt specifies draft PRs, never auto-merge
- **Clarification required**: System prompt instructs agent to ask rather than assume

## IPC Channels

### Build channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `build:create` | invoke | Create a new build (task info, repo_id, pm_notes, transcript_context) |
| `build:list` | invoke | List all builds (with status, repo name) |
| `build:get` | invoke | Get build detail + events |
| `build:cancel` | invoke | Cancel a running build |
| `build:answer` | invoke | Send PM's answer to a clarification question |
| `build:retry` | invoke | Retry a failed build |
| `build:event` | listen | Streaming build events (progress, question, done, error) |

### Repo channels

| Channel | Direction | Description |
|---------|-----------|-------------|
| `repo:list` | invoke | List configured repos |
| `repo:add` | invoke | Add a repo (name, path, github_url, default_branch) |
| `repo:remove` | invoke | Remove a repo |
| `repo:validate` | invoke | Check if a path is a valid git repo |

## Renderer — UI Design

### Build View Layout

List + Detail split, matching the app's existing patterns:

```
┌──────────────────────────────────────────────────┐
│  Sidebar  │  Build List (left)  │  Build Detail   │
│           │                     │  (right)         │
│  ...      │  [+ New Build]      │                  │
│  Meetings │                     │  Title + Status  │
│  Trans... │  ● Dark mode toggle │  Branch name     │
│  Tasks    │    my-saas · Running│                  │
│  ■ Build  │                     │  [Build Brief]   │
│           │  ● Refactor profile │  (collapsible)   │
│           │    frontend · Queued│                  │
│           │                     │  Progress Stream │
│           │  ● Export to CSV    │  0:12 Checked out│
│           │    api · Done       │  0:28 Analyzing  │
│           │                     │  1:05 Created... │
│           │  ● Fix payments     │  1:42 Added CSS  │
│           │    backend · Failed │  2:15 Writing... │
│           │                     │                  │
│           │                     │ ┌──────────────┐ │
│           │                     │ │ Chat panel   │ │
│           │                     │ │ (slide-up    │ │
│           │                     │ │  for Q&A)    │ │
│           │                     │ └──────────────┘ │
└──────────────────────────────────────────────────┘
```

### Screen Type

The `Screen` union type in `App.tsx` and `Sidebar.tsx` must be extended with `'build'` to support navigation to the Build view.

### Components

**BuildView.tsx** — Top-level view. Renders BuildList + BuildDetail side by side. Manages selected build state.

**BuildList.tsx** — Left panel. Lists all builds with:
- Status indicator (colored dot: green=running, amber=queued, blue=done, red=failed)
- Task title
- Repo name + status label
- "New Build" button at top

**BuildDetail.tsx** — Right panel. Shows:
- Header: task title, repo name, branch name, status badge, cancel button
- Build Brief: collapsible section showing task description, PM notes, transcript context
- Progress Stream: timestamped list of curated events, auto-scrolling
- Completion Card (when done): PR link, files changed, AI summary, "View on GitHub" button
- Error display (when failed): error message + "Retry" button

**BuildForm.tsx** — New build configuration (replaces detail panel or modal):
- Linear issue selector (dropdown, fetched via existing Linear integration)
- Repo selector (dropdown from configured repos)
- PM notes textarea
- Transcript attachment (search/pick from existing transcripts)
- "Start Build" button

**BuildChat.tsx** — Slide-up chat panel within BuildDetail:
- Appears when build status is `awaiting_input`
- Shows the question from Claude Code
- Text input for PM's answer
- Send button, resumes the build
- Remains visible showing Q&A history for the build's duration

### Build States in the UI

| Status | List indicator | Detail panel |
|--------|---------------|--------------|
| queued | Amber dot | "Waiting — 1 build ahead" or similar |
| running | Green dot (pulsing) | Progress stream, active events |
| awaiting_input | Amber dot (pulsing) | Progress stream + chat panel with question |
| done | Blue dot | Summary card with PR link |
| failed | Red dot | Error message + Retry button |

### Entry Point — Linear Issues

The PM clicks "New Build" in the Build view. The form shows a Linear issue selector that:
- Fetches issues from connected Linear teams (existing integration)
- Pre-fills task title and description from the selected issue
- PM selects target repo from configured repos
- PM optionally adds implementation notes and transcript context
- Hitting "Start Build" creates the build and enters the queue

### Completion Summary Card

When a build finishes successfully, the detail panel shows:
- Status: "Done" badge
- PR link (clickable, opens GitHub)
- Branch name
- Files changed count
- AI-generated 2-3 sentence summary of what was built
- "View on GitHub" button

## Settings Integration

Add a "Repositories" section to the existing Settings modal:
- List of configured repos with name, path, GitHub URL
- "Add Repository" form: name, local path (with folder picker), GitHub URL, default branch
- Validate button to confirm the path is a valid git repo
- Remove button per repo

## Future Extensions (not in v1)

- Chat agent proposal → Build queue entry point
- Manual/free-form build creation
- Build history and analytics
- Re-run builds with modified parameters
- Multiple concurrent builds per repo (using git worktrees)
