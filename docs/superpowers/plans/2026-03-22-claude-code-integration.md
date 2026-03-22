# Claude Code Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable PMs to turn Linear issues into working prototype branches via Claude Code SDK, with a dedicated Build view for monitoring progress and answering clarification questions.

**Architecture:** Claude Code SDK (`@anthropic-ai/claude-code`) runs in Electron's main process, spawning isolated coding sessions per build. A build manager service queues and orchestrates builds (one per repo concurrently). The renderer gets a new Build view (list + detail split) with streaming progress events via IPC.

**Tech Stack:** Claude Code SDK, Electron IPC, better-sqlite3, React + Tailwind, existing Linear integration

**Spec:** `docs/superpowers/specs/2026-03-22-claude-code-integration-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `src/main/services/build-executor.ts` | Wraps Claude Code SDK — prompt construction, streaming, Q&A |
| `src/main/services/build-manager.ts` | Build queue, lifecycle, concurrency (one per repo) |
| `src/main/ipc/builds.ts` | IPC handlers for all `build:*` channels |
| `src/main/ipc/repos.ts` | IPC handlers for `repo:*` CRUD channels |
| `src/renderer/components/BuildView.tsx` | Top-level Build screen — composes list + detail |
| `src/renderer/components/BuildList.tsx` | Left panel — build list with status indicators |
| `src/renderer/components/BuildDetail.tsx` | Right panel — progress stream + completion card |
| `src/renderer/components/BuildForm.tsx` | New build form — Linear issue picker, repo selector, notes |
| `src/renderer/components/BuildChat.tsx` | Slide-up Q&A panel for clarification questions |

### Modified Files

| File | Change |
|------|--------|
| `src/main/db/schema.ts` | Add `repos`, `builds`, `build_events` tables |
| `src/main/db/index.ts` | Add migration v3 for new tables |
| `src/main/preload.ts` | Add `build:*` and `repo:*` to invoke channels, `build:event` to listen channels |
| `src/main/ipc/index.ts` | Register build and repo handlers |
| `src/renderer/App.tsx` | Add `'build'` to Screen type, render BuildView, import |
| `src/renderer/components/Sidebar.tsx` | Add `'build'` to Screen type, add Build nav item |
| `src/renderer/components/SettingsModal.tsx` | Add Repositories section |
| `package.json` | Add `@anthropic-ai/claude-code` dependency |

---

### Task 1: Install Claude Code SDK

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run:
```bash
npm install @anthropic-ai/claude-code
```

- [ ] **Step 2: Verify installation**

Run:
```bash
node -e "require('@anthropic-ai/claude-code')"
```
Expected: No error output

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @anthropic-ai/claude-code SDK dependency"
```

---

### Task 2: Database Schema — Add repos, builds, build_events Tables

**Files:**
- Modify: `src/main/db/schema.ts`
- Modify: `src/main/db/index.ts`

- [ ] **Step 1: Add tables to schema.ts**

Append these three tables before the closing backtick in `SCHEMA`:

```typescript
  CREATE TABLE IF NOT EXISTS repos (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    github_url TEXT,
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    repo_id TEXT NOT NULL REFERENCES repos(id),
    task_title TEXT NOT NULL,
    task_description TEXT,
    pm_notes TEXT,
    transcript_context TEXT,
    source TEXT NOT NULL DEFAULT 'linear',
    source_id TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    branch_name TEXT,
    pr_url TEXT,
    summary TEXT,
    files_changed INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS build_events (
    id TEXT PRIMARY KEY,
    build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
```

- [ ] **Step 2: Add migration v3 to index.ts**

After the `if (version < 2)` block in the `migrate()` function, add:

```typescript
  if (version < 3) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repos (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          github_url TEXT,
          default_branch TEXT NOT NULL DEFAULT 'main',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS builds (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repos(id),
          task_title TEXT NOT NULL,
          task_description TEXT,
          pm_notes TEXT,
          transcript_context TEXT,
          source TEXT NOT NULL DEFAULT 'linear',
          source_id TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          branch_name TEXT,
          pr_url TEXT,
          summary TEXT,
          files_changed INTEGER DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS build_events (
          id TEXT PRIMARY KEY,
          build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_builds_repo ON builds(repo_id);
        CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);
        CREATE INDEX IF NOT EXISTS idx_build_events_build ON build_events(build_id);
      `);
      db.pragma('user_version = 3');
    })();
  }
```

Also update `CURRENT_VERSION` to `3`.

- [ ] **Step 3: Verify the app starts without errors**

Run:
```bash
npm start
```
Expected: App launches, no schema errors in console.

- [ ] **Step 4: Commit**

```bash
git add src/main/db/schema.ts src/main/db/index.ts
git commit -m "feat(db): add repos, builds, build_events tables"
```

---

### Task 3: Repo Management — IPC Handlers

**Files:**
- Create: `src/main/ipc/repos.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Create repos.ts IPC handlers**

Create `src/main/ipc/repos.ts`:

```typescript
import { ipcMain } from 'electron';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

export function registerRepoHandlers() {
  ipcMain.handle('repo:list', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM repos ORDER BY name').all();
  });

  ipcMain.handle('repo:add', async (_e, data: {
    name: string;
    path: string;
    github_url?: string;
    default_branch?: string;
  }) => {
    const db = getDb();
    const id = uuid();
    db.prepare(
      'INSERT INTO repos (id, name, path, github_url, default_branch) VALUES (?, ?, ?, ?, ?)'
    ).run(id, data.name, data.path, data.github_url || null, data.default_branch || 'main');
    return { id, ...data };
  });

  ipcMain.handle('repo:remove', async (_e, id: string) => {
    const db = getDb();
    db.prepare('DELETE FROM repos WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('repo:validate', async (_e, repoPath: string) => {
    if (!existsSync(repoPath)) {
      return { valid: false, error: 'Path does not exist' };
    }
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, stdio: 'pipe' });
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, stdio: 'pipe' }).toString().trim();
      return { valid: true, currentBranch: branch };
    } catch {
      return { valid: false, error: 'Not a git repository' };
    }
  });
}
```

- [ ] **Step 2: Register handlers in index.ts**

Add import at top of `src/main/ipc/index.ts`:
```typescript
import { registerRepoHandlers } from './repos';
```

Add call inside `registerAllHandlers()` before the console.log:
```typescript
  // Repo handlers
  registerRepoHandlers();
```

- [ ] **Step 3: Add repo channels to preload.ts**

Add to the `invokeChannels` array in `src/main/preload.ts`:
```typescript
  'repo:list', 'repo:add', 'repo:remove', 'repo:validate',
```

- [ ] **Step 4: Verify app starts**

Run:
```bash
npm start
```
Expected: "IPC handlers registered" in console, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/repos.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat: add repo management IPC handlers"
```

---

### Task 4: Build Executor — Claude Code SDK Wrapper

**Files:**
- Create: `src/main/services/build-executor.ts`

- [ ] **Step 1: Create build-executor.ts**

Create `src/main/services/build-executor.ts`:

```typescript
import { claude, type MessageEvent } from '@anthropic-ai/claude-code';
import { BrowserWindow } from 'electron';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';

export interface BuildConfig {
  buildId: string;
  repoPath: string;
  defaultBranch: string;
  taskTitle: string;
  taskDescription: string;
  pmNotes?: string;
  transcriptContext?: string;
}

interface AbortHandle {
  abort: () => void;
}

const activeAborts = new Map<string, AbortHandle>();

// Q&A: when Claude Code asks a question, we resolve this promise with the PM's answer
const pendingAnswers = new Map<string, { resolve: (answer: string) => void }>();

export function submitAnswer(buildId: string, answer: string) {
  const pending = pendingAnswers.get(buildId);
  if (pending) {
    pending.resolve(answer);
    pendingAnswers.delete(buildId);
  }
}

function waitForAnswer(buildId: string): Promise<string> {
  return new Promise<string>((resolve) => {
    pendingAnswers.set(buildId, { resolve });
  });
}

function buildSystemPrompt(config: BuildConfig): string {
  let prompt = `You are building a feature for a product. A product manager has given you this task based on customer feedback and product strategy.

## Task
${config.taskTitle}
${config.taskDescription || ''}
`;

  if (config.pmNotes) {
    prompt += `
## PM Notes
${config.pmNotes}
`;
  }

  if (config.transcriptContext) {
    prompt += `
## Customer Context (from interview transcripts)
${config.transcriptContext}
`;
  }

  prompt += `
## Rules
- First, check out a new branch from "${config.defaultBranch}" with prefix "pm/" (e.g., pm/add-dark-mode-toggle). Use a short descriptive name based on the task.
- Make clean, well-structured commits with descriptive messages.
- Write tests where appropriate.
- When done, push the branch and open a draft PR using "gh pr create --draft" with a clear title and description summarizing what was built and why.
- NEVER push to or merge into "${config.defaultBranch}".
- NEVER run destructive commands (rm -rf on project root, DROP TABLE, git push --force, git reset --hard on shared branches).
- If anything is unclear about the requirements, ask for clarification — do not guess.
`;

  return prompt;
}

function emitEvent(win: BrowserWindow, buildId: string, type: string, content: string) {
  if (win.isDestroyed()) return;
  const db = getDb();
  const id = uuid();
  db.prepare('INSERT INTO build_events (id, build_id, type, content) VALUES (?, ?, ?, ?)').run(id, buildId, type, content);
  win.webContents.send('build:event', { buildId, type, content, id, created_at: new Date().toISOString() });
}

function updateBuildStatus(buildId: string, status: string, extra?: Record<string, unknown>) {
  const db = getDb();
  const sets = ['status = ?', "updated_at = datetime('now')"];
  const params: unknown[] = [status];

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      sets.push(`${key} = ?`);
      params.push(value);
    }
  }
  params.push(buildId);
  db.prepare(`UPDATE builds SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export async function executeBuild(win: BrowserWindow, config: BuildConfig): Promise<void> {
  const abortController = new AbortController();
  activeAborts.set(config.buildId, { abort: () => abortController.abort() });

  try {
    updateBuildStatus(config.buildId, 'running');
    emitEvent(win, config.buildId, 'progress', 'Starting build...');

    const systemPrompt = buildSystemPrompt(config);
    let conversationPrompt = `${config.taskTitle}\n\n${config.taskDescription || ''}`;
    let continueConversation = true;

    // Conversation loop: runs once normally, then re-enters if Claude asked a question
    while (continueConversation) {
      continueConversation = false;
      let lastAssistantText = '';

      const result = await claude({
        prompt: conversationPrompt,
        systemPrompt,
        options: {
          cwd: config.repoPath,
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
        },
        abortController,
        onEvent: (event: MessageEvent) => {
          if (win.isDestroyed()) return;

          // Distill SDK events into curated progress
          if (event.type === 'assistant' && event.message) {
            const msg = event.message;
            if (msg.type === 'tool_use') {
              const toolName = (msg as { name?: string }).name || 'tool';
              const toolInput = (msg as { input?: Record<string, unknown> }).input || {};

              if (toolName === 'Write' || toolName === 'Edit') {
                const filePath = (toolInput.file_path as string) || '';
                const shortPath = filePath.split('/').slice(-2).join('/');
                emitEvent(win, config.buildId, 'progress', `Editing ${shortPath}`);
              } else if (toolName === 'Bash') {
                const cmd = (toolInput.command as string) || '';
                if (cmd.startsWith('git checkout') || cmd.startsWith('git switch')) {
                  const branch = cmd.split(' ').pop() || '';
                  emitEvent(win, config.buildId, 'progress', `Checked out branch ${branch}`);
                  updateBuildStatus(config.buildId, 'running', { branch_name: branch });
                } else if (cmd.startsWith('gh pr create')) {
                  emitEvent(win, config.buildId, 'progress', 'Creating draft pull request...');
                } else if (cmd.startsWith('git push')) {
                  emitEvent(win, config.buildId, 'progress', 'Pushing branch to remote...');
                } else if (cmd.includes('npm test') || cmd.includes('jest') || cmd.includes('pytest')) {
                  emitEvent(win, config.buildId, 'progress', 'Running tests...');
                }
              } else if (toolName === 'Glob' || toolName === 'Grep' || toolName === 'Read') {
                emitEvent(win, config.buildId, 'progress', 'Analyzing codebase...');
              }
            } else if (msg.type === 'text') {
              // Capture assistant text — may contain a question
              lastAssistantText += (msg as { text?: string }).text || '';
            }
          }
        },
      });

      // Check if the result looks like a question (no PR created, text ends with ?)
      const resultText = typeof result === 'string' ? result : JSON.stringify(result);
      const hasPrUrl = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/.test(resultText);
      const endsWithQuestion = lastAssistantText.trim().endsWith('?');

      if (!hasPrUrl && endsWithQuestion && !abortController.signal.aborted) {
        // Claude is asking for clarification — pause and wait for PM answer
        updateBuildStatus(config.buildId, 'awaiting_input');
        emitEvent(win, config.buildId, 'question', lastAssistantText.trim());

        const answer = await waitForAnswer(config.buildId);

        // Resume with the PM's answer
        emitEvent(win, config.buildId, 'progress', `PM answered: ${answer}`);
        updateBuildStatus(config.buildId, 'running');
        conversationPrompt = answer;
        continueConversation = true;
      } else {
        // Build is done — extract results
        let prUrl: string | null = null;
        const prMatch = resultText.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
        if (prMatch) prUrl = prMatch[0];

        let filesChanged = 0;
        try {
          const { execSync } = require('child_process');
          const diff = execSync(`git diff --name-only ${config.defaultBranch}...HEAD`, {
            cwd: config.repoPath,
            stdio: 'pipe',
          }).toString().trim();
          filesChanged = diff ? diff.split('\n').length : 0;
        } catch {
          // Branch may not exist on remote yet
        }

        const summary = resultText.slice(0, 500);

        updateBuildStatus(config.buildId, 'done', {
          pr_url: prUrl,
          summary,
          files_changed: filesChanged,
        });
        emitEvent(win, config.buildId, 'progress', prUrl ? 'Done — draft PR created' : 'Build complete');
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (abortController.signal.aborted) {
      updateBuildStatus(config.buildId, 'failed', { error_message: 'Build cancelled by user' });
      emitEvent(win, config.buildId, 'error', 'Build cancelled');
    } else {
      updateBuildStatus(config.buildId, 'failed', { error_message: message });
      emitEvent(win, config.buildId, 'error', `Build failed: ${message}`);
    }
  } finally {
    activeAborts.delete(config.buildId);
    pendingAnswers.delete(config.buildId);
  }
}

export function cancelBuild(buildId: string) {
  const handle = activeAborts.get(buildId);
  if (handle) handle.abort();
}
```

**Note:** The Claude Code SDK's exact event types and `claude()` function signature may differ from what's shown above. During implementation, check the SDK's TypeScript types (`node_modules/@anthropic-ai/claude-code/dist/index.d.ts`) and adjust accordingly. Key patterns to preserve: (1) distill tool_use events into human-readable progress, (2) detect branch checkout / PR creation / test runs from Bash commands, (3) extract PR URL from result, (4) the Q&A loop — if the SDK supports native interactive mode, use that instead of the re-invocation approach shown here.

- [ ] **Step 2: Commit**

```bash
git add src/main/services/build-executor.ts
git commit -m "feat: add build executor service wrapping Claude Code SDK"
```

---

### Task 5: Build Manager — Queue & Lifecycle

**Files:**
- Create: `src/main/services/build-manager.ts`

- [ ] **Step 1: Create build-manager.ts**

Create `src/main/services/build-manager.ts`:

```typescript
import { BrowserWindow } from 'electron';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';
import { executeBuild, cancelBuild, type BuildConfig } from './build-executor';

interface BuildRow {
  id: string;
  repo_id: string;
  task_title: string;
  task_description: string;
  pm_notes: string | null;
  transcript_context: string | null;
  source: string;
  source_id: string | null;
  status: string;
  branch_name: string | null;
  pr_url: string | null;
  summary: string | null;
  files_changed: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RepoRow {
  id: string;
  name: string;
  path: string;
  github_url: string | null;
  default_branch: string;
}

// Track which repos have a running build
const runningRepos = new Set<string>();

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.find(w => !w.isDestroyed()) || null;
}

export function createBuild(data: {
  repoId: string;
  taskTitle: string;
  taskDescription?: string;
  pmNotes?: string;
  transcriptContext?: string;
  source?: string;
  sourceId?: string;
}): BuildRow {
  const db = getDb();
  const id = uuid();
  db.prepare(`
    INSERT INTO builds (id, repo_id, task_title, task_description, pm_notes, transcript_context, source, source_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')
  `).run(
    id, data.repoId, data.taskTitle, data.taskDescription || null,
    data.pmNotes || null, data.transcriptContext || null,
    data.source || 'linear', data.sourceId || null
  );

  // Try to process queue immediately
  processQueue();

  return db.prepare('SELECT * FROM builds WHERE id = ?').get(id) as BuildRow;
}

export function listBuilds(): (BuildRow & { repo_name: string })[] {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, r.name as repo_name
    FROM builds b
    JOIN repos r ON b.repo_id = r.id
    ORDER BY b.created_at DESC
  `).all() as (BuildRow & { repo_name: string })[];
}

export function getBuild(id: string): (BuildRow & { repo_name: string; repo_path: string }) | null {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, r.name as repo_name, r.path as repo_path
    FROM builds b
    JOIN repos r ON b.repo_id = r.id
    WHERE b.id = ?
  `).get(id) as (BuildRow & { repo_name: string; repo_path: string }) | null;
}

export function getBuildEvents(buildId: string) {
  const db = getDb();
  return db.prepare('SELECT * FROM build_events WHERE build_id = ? ORDER BY created_at ASC').all(buildId);
}

export function cancelBuildById(buildId: string) {
  cancelBuild(buildId);
  const db = getDb();
  const build = db.prepare('SELECT repo_id FROM builds WHERE id = ?').get(buildId) as { repo_id: string } | undefined;
  if (build) {
    runningRepos.delete(build.repo_id);
    processQueue();
  }
}

export function retryBuild(buildId: string): BuildRow | null {
  const db = getDb();
  const original = db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId) as BuildRow | null;
  if (!original) return null;

  return createBuild({
    repoId: original.repo_id,
    taskTitle: original.task_title,
    taskDescription: original.task_description || undefined,
    pmNotes: original.pm_notes || undefined,
    transcriptContext: original.transcript_context || undefined,
    source: original.source,
    sourceId: original.source_id || undefined,
  });
}

function processQueue() {
  const db = getDb();
  const queued = db.prepare(`
    SELECT b.*, r.path as repo_path, r.default_branch
    FROM builds b
    JOIN repos r ON b.repo_id = r.id
    WHERE b.status = 'queued'
    ORDER BY b.created_at ASC
  `).all() as (BuildRow & { repo_path: string; default_branch: string })[];

  for (const build of queued) {
    if (runningRepos.has(build.repo_id)) continue;

    const win = getMainWindow();
    if (!win) break;

    runningRepos.add(build.repo_id);

    const config: BuildConfig = {
      buildId: build.id,
      repoPath: build.repo_path,
      defaultBranch: build.default_branch,
      taskTitle: build.task_title,
      taskDescription: build.task_description || '',
      pmNotes: build.pm_notes || undefined,
      transcriptContext: build.transcript_context || undefined,
    };

    executeBuild(win, config).finally(() => {
      runningRepos.delete(build.repo_id);
      processQueue(); // Check for next in queue
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/services/build-manager.ts
git commit -m "feat: add build manager with queue and lifecycle orchestration"
```

---

### Task 6: Build IPC Handlers

**Files:**
- Create: `src/main/ipc/builds.ts`
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Create builds.ts IPC handlers**

Create `src/main/ipc/builds.ts`:

```typescript
import { ipcMain } from 'electron';
import {
  createBuild,
  listBuilds,
  getBuild,
  getBuildEvents,
  cancelBuildById,
  retryBuild,
} from '../services/build-manager';
import { submitAnswer } from '../services/build-executor';

export function registerBuildHandlers() {
  ipcMain.handle('build:create', async (_e, data: {
    repoId: string;
    taskTitle: string;
    taskDescription?: string;
    pmNotes?: string;
    transcriptContext?: string;
    source?: string;
    sourceId?: string;
  }) => {
    return createBuild(data);
  });

  ipcMain.handle('build:list', async () => {
    return listBuilds();
  });

  ipcMain.handle('build:get', async (_e, id: string) => {
    const build = getBuild(id);
    if (!build) return null;
    const events = getBuildEvents(id);
    return { ...build, events };
  });

  ipcMain.handle('build:cancel', async (_e, id: string) => {
    cancelBuildById(id);
    return { success: true };
  });

  ipcMain.handle('build:retry', async (_e, id: string) => {
    return retryBuild(id);
  });

  ipcMain.handle('build:answer', async (_e, buildId: string, answer: string) => {
    submitAnswer(buildId, answer);
    return { success: true };
  });
}
```

- [ ] **Step 2: Register build handlers in index.ts**

Add import at top of `src/main/ipc/index.ts`:
```typescript
import { registerBuildHandlers } from './builds';
```

Add call inside `registerAllHandlers()` before the console.log:
```typescript
  // Build handlers
  registerBuildHandlers();
```

- [ ] **Step 3: Add build channels to preload.ts**

Add to the `invokeChannels` array:
```typescript
  'build:create', 'build:list', 'build:get', 'build:cancel', 'build:retry', 'build:answer',
```

Add to the `listenChannels` array:
```typescript
  'build:event',
```

- [ ] **Step 4: Verify app starts**

Run:
```bash
npm start
```
Expected: No errors. "IPC handlers registered" in console.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/builds.ts src/main/ipc/index.ts src/main/preload.ts
git commit -m "feat: add build IPC handlers and preload channels"
```

---

### Task 7: Settings UI — Repositories Section

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`

- [ ] **Step 1: Add repo state and effects**

Inside the `SettingsModal` component, after the existing state declarations (around line 37), add:

```typescript
  const [repos, setRepos] = useState<{ id: string; name: string; path: string; github_url: string | null; default_branch: string }[]>([]);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [repoGithubUrl, setRepoGithubUrl] = useState('');
  const [repoDefaultBranch, setRepoDefaultBranch] = useState('main');
  const [repoValidation, setRepoValidation] = useState<{ valid: boolean; error?: string } | null>(null);
  const [addingRepo, setAddingRepo] = useState(false);
```

Inside the existing `useEffect` (the one that runs on `open`), add after the Linear status fetch:

```typescript
    window.api.invoke('repo:list').then((r) => setRepos(r as typeof repos));
```

- [ ] **Step 2: Add repo handler functions**

After the existing handler functions (after `handleLinearDisconnect`), add:

```typescript
  const handleValidateRepo = async () => {
    if (!repoPath) return;
    const result = await window.api.invoke('repo:validate', repoPath) as { valid: boolean; error?: string };
    setRepoValidation(result);
  };

  const handleAddRepo = async () => {
    if (!repoName || !repoPath) return;
    setAddingRepo(true);
    await window.api.invoke('repo:add', {
      name: repoName,
      path: repoPath,
      github_url: repoGithubUrl || undefined,
      default_branch: repoDefaultBranch,
    });
    const updated = await window.api.invoke('repo:list') as typeof repos;
    setRepos(updated);
    setShowAddRepo(false);
    setRepoName('');
    setRepoPath('');
    setRepoGithubUrl('');
    setRepoDefaultBranch('main');
    setRepoValidation(null);
    setAddingRepo(false);
  };

  const handleRemoveRepo = async (id: string) => {
    await window.api.invoke('repo:remove', id);
    setRepos(repos.filter(r => r.id !== id));
  };
```

- [ ] **Step 3: Add Repositories UI section**

In the JSX, after the Linear Teams section (after the closing `</div>` around line 216, before the footer `<div className="px-7 py-4 border-t...`), add:

```tsx
          {/* Repositories */}
          <div className="px-7 pb-6">
            <div className="pt-5 border-t border-border-base">
              <label className={labelClass}>Repositories</label>

              {repos.length > 0 && (
                <div className="space-y-2 mb-3">
                  {repos.map((repo) => (
                    <div key={repo.id} className="border border-border-base rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-text-primary font-medium">{repo.name}</div>
                          <div className="text-xs text-text-muted mt-0.5 font-mono">{repo.path}</div>
                          {repo.github_url && (
                            <div className="text-xs text-text-muted mt-0.5">{repo.github_url}</div>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveRepo(repo.id)}
                          className="text-xs text-text-muted underline underline-offset-2 hover:text-red-400 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showAddRepo ? (
                <div className="border border-border-base rounded-lg p-3 space-y-3">
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Name</label>
                    <input
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      placeholder="e.g., Frontend App"
                      className="w-full text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Local Path</label>
                    <div className="flex gap-2">
                      <input
                        value={repoPath}
                        onChange={(e) => { setRepoPath(e.target.value); setRepoValidation(null); }}
                        placeholder="/Users/you/projects/my-app"
                        className="flex-1 text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none font-mono"
                      />
                      <button
                        onClick={handleValidateRepo}
                        className="text-xs px-3 py-2 border border-border-base bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all"
                      >
                        Validate
                      </button>
                    </div>
                    {repoValidation && (
                      <div className={`text-xs mt-1 ${repoValidation.valid ? 'text-green-400' : 'text-red-400'}`}>
                        {repoValidation.valid ? 'Valid git repository' : repoValidation.error}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">GitHub URL (optional)</label>
                    <input
                      value={repoGithubUrl}
                      onChange={(e) => setRepoGithubUrl(e.target.value)}
                      placeholder="https://github.com/org/repo"
                      className="w-full text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-muted mb-1">Default Branch</label>
                    <input
                      value={repoDefaultBranch}
                      onChange={(e) => setRepoDefaultBranch(e.target.value)}
                      placeholder="main"
                      className="w-full text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowAddRepo(false)}
                      className="text-xs px-3 py-2 text-text-muted hover:text-text-secondary transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddRepo}
                      disabled={!repoName || !repoPath || addingRepo}
                      className="text-xs px-4 py-2 bg-honey text-surface-0 rounded-lg font-medium hover:bg-honey-dim disabled:opacity-40 transition-all"
                    >
                      {addingRepo ? 'Adding...' : 'Add Repository'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddRepo(true)}
                  className="w-full text-sm font-medium px-4 py-2.5 border border-dashed border-border-base text-text-muted rounded-lg hover:border-honey hover:text-honey transition-all"
                >
                  + Add Repository
                </button>
              )}
            </div>
          </div>
```

- [ ] **Step 4: Verify in-app**

Run `npm start`. Open Settings. Verify:
- Repositories section appears below Linear
- "Add Repository" button opens the form
- Validate checks if path is a git repo
- Adding a repo shows it in the list
- Remove button works

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx
git commit -m "feat: add repository management to Settings modal"
```

---

### Task 8: Sidebar & App Routing — Add Build Screen

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/App.tsx`

- [ ] **Step 1: Update Screen type in Sidebar.tsx**

In `src/renderer/components/Sidebar.tsx`, change line 3:

```typescript
type Screen = 'meetings' | 'transcript' | 'tasks' | 'build';
```

Add a new entry to the `navItems` array (after the tasks entry, before the closing `]`):

```typescript
  {
    id: 'build',
    label: 'Build',
    icon: (
      <svg fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
        <path d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085" />
      </svg>
    ),
  },
```

- [ ] **Step 2: Update Screen type and routing in App.tsx**

In `src/renderer/App.tsx`, update the Screen type (line 11):

```typescript
type Screen = 'meetings' | 'transcript' | 'tasks' | 'build';
```

Add the import for BuildView at the top:

```typescript
import BuildView from './components/BuildView';
```

In the main content area, after the tasks screen render (after line 91 `{screen === 'tasks' && <TaskReview refreshKey={taskVersion} />}`), add:

```tsx
        {screen === 'build' && <BuildView />}
```

- [ ] **Step 3: Verify navigation**

Run `npm start`. Verify:
- Build icon appears in the sidebar (wrench icon)
- Clicking it navigates to the Build view (will show nothing yet until we create BuildView — that's expected, it will error)

Note: This step will cause a runtime error until BuildView.tsx exists. That's fine — we'll create it in the next tasks. Just verify the sidebar icon appears.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/Sidebar.tsx src/renderer/App.tsx
git commit -m "feat: add Build screen to sidebar navigation and app routing"
```

---

### Task 9: BuildList Component

**Files:**
- Create: `src/renderer/components/BuildList.tsx`

- [ ] **Step 1: Create BuildList.tsx**

Create `src/renderer/components/BuildList.tsx`:

```tsx
import React from 'react';

interface Build {
  id: string;
  task_title: string;
  status: string;
  repo_name: string;
  branch_name: string | null;
  pr_url: string | null;
  created_at: string;
}

interface BuildListProps {
  builds: Build[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewBuild: () => void;
}

const STATUS_DOT: Record<string, { color: string; pulse?: boolean }> = {
  queued: { color: '#E8A838' },
  running: { color: '#4ade80', pulse: true },
  awaiting_input: { color: '#E8A838', pulse: true },
  done: { color: '#60a5fa' },
  failed: { color: '#f87171' },
};

const STATUS_LABEL: Record<string, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting_input: 'Needs Input',
  done: 'Done',
  failed: 'Failed',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function BuildList({ builds, selectedId, onSelect, onNewBuild }: BuildListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="p-3">
        <button
          onClick={onNewBuild}
          className="w-full text-sm font-medium px-4 py-2.5 bg-honey/10 text-honey rounded-lg hover:bg-honey/20 transition-all"
        >
          + New Build
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {builds.length === 0 && (
          <div className="text-sm text-text-muted text-center mt-8 px-4">
            No builds yet. Create one to get started.
          </div>
        )}
        {builds.map((build) => {
          const dot = STATUS_DOT[build.status] || STATUS_DOT.queued;
          const isSelected = build.id === selectedId;
          return (
            <button
              key={build.id}
              onClick={() => onSelect(build.id)}
              className={`w-full text-left p-3 rounded-lg mb-1 transition-all ${
                isSelected
                  ? 'bg-honey/10 border border-honey/20'
                  : 'hover:bg-surface-3 border border-transparent'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                  style={{
                    background: dot.color,
                    animation: dot.pulse ? 'pulse 2s infinite' : 'none',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">{build.task_title}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {build.repo_name} · {STATUS_LABEL[build.status] || build.status}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">{timeAgo(build.created_at)}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/BuildList.tsx
git commit -m "feat: add BuildList component"
```

---

### Task 10: BuildForm Component

**Files:**
- Create: `src/renderer/components/BuildForm.tsx`

- [ ] **Step 1: Create BuildForm.tsx**

Create `src/renderer/components/BuildForm.tsx`:

```tsx
import React, { useEffect, useState } from 'react';

interface Repo {
  id: string;
  name: string;
  path: string;
}

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
}

interface BuildFormProps {
  onSubmit: (data: {
    repoId: string;
    taskTitle: string;
    taskDescription?: string;
    pmNotes?: string;
    transcriptContext?: string;
    source: string;
    sourceId?: string;
  }) => void;
  onCancel: () => void;
}

export default function BuildForm({ onSubmit, onCancel }: BuildFormProps) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);

  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [pmNotes, setPmNotes] = useState('');
  const [transcriptContext, setTranscriptContext] = useState('');

  useEffect(() => {
    window.api.invoke('repo:list').then((r) => {
      const repoList = r as Repo[];
      setRepos(repoList);
      if (repoList.length === 1) setSelectedRepoId(repoList[0].id);
    });

    setLoadingIssues(true);
    window.api.invoke('linear:get-issues').then((i) => {
      setIssues(i as LinearIssue[]);
      setLoadingIssues(false);
    }).catch(() => setLoadingIssues(false));
  }, []);

  const handleIssueSelect = (issueId: string) => {
    setSelectedIssueId(issueId);
    const issue = issues.find(i => i.id === issueId);
    if (issue) {
      setTaskTitle(issue.title);
      setTaskDescription(issue.description || '');
    }
  };

  const handleSubmit = () => {
    if (!selectedRepoId || !taskTitle) return;
    onSubmit({
      repoId: selectedRepoId,
      taskTitle,
      taskDescription: taskDescription || undefined,
      pmNotes: pmNotes || undefined,
      transcriptContext: transcriptContext || undefined,
      source: selectedIssueId ? 'linear' : 'manual',
      sourceId: selectedIssueId || undefined,
    });
  };

  const labelClass = 'block text-xs font-medium text-text-muted mb-1.5';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-lg">
        <h2 className="text-xl font-semibold text-text-primary mb-1">New Build</h2>
        <p className="text-sm text-text-muted mb-6">Configure a build from a Linear issue.</p>

        {/* Linear Issue */}
        <div className="mb-5">
          <label className={labelClass}>Linear Issue</label>
          {loadingIssues ? (
            <div className="text-sm text-text-muted py-2">Loading issues...</div>
          ) : issues.length === 0 ? (
            <div className="text-sm text-text-muted py-2">No Linear issues found. Connect Linear in Settings.</div>
          ) : (
            <select
              value={selectedIssueId}
              onChange={(e) => handleIssueSelect(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none appearance-none"
            >
              <option value="">Select an issue...</option>
              {issues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  {issue.identifier}: {issue.title}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Target Repo */}
        <div className="mb-5">
          <label className={labelClass}>Target Repository</label>
          {repos.length === 0 ? (
            <div className="text-sm text-text-muted py-2">No repos configured. Add one in Settings.</div>
          ) : (
            <select
              value={selectedRepoId}
              onChange={(e) => setSelectedRepoId(e.target.value)}
              className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none appearance-none"
            >
              <option value="">Select a repository...</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>{repo.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Task Title */}
        <div className="mb-5">
          <label className={labelClass}>Task Title</label>
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="What should be built?"
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none"
          />
        </div>

        {/* Task Description */}
        <div className="mb-5">
          <label className={labelClass}>Description</label>
          <textarea
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            placeholder="Detailed requirements..."
            rows={4}
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
          />
        </div>

        {/* PM Notes */}
        <div className="mb-5">
          <label className={labelClass}>PM Notes (optional)</label>
          <textarea
            value={pmNotes}
            onChange={(e) => setPmNotes(e.target.value)}
            placeholder="Implementation hints, constraints, or preferences..."
            rows={3}
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
          />
        </div>

        {/* Transcript Context */}
        <div className="mb-6">
          <label className={labelClass}>Transcript Context (optional)</label>
          <textarea
            value={transcriptContext}
            onChange={(e) => setTranscriptContext(e.target.value)}
            placeholder="Paste relevant customer quotes or transcript excerpts..."
            rows={3}
            className="w-full text-sm px-3.5 py-2.5 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="text-sm font-medium px-4 py-2.5 border border-border-strong bg-surface-3 text-text-secondary rounded-lg hover:border-honey hover:text-honey transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedRepoId || !taskTitle}
            className="text-sm font-semibold px-6 py-2.5 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Start Build
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/BuildForm.tsx
git commit -m "feat: add BuildForm component with Linear issue picker"
```

---

### Task 11: BuildDetail Component

**Files:**
- Create: `src/renderer/components/BuildDetail.tsx`

- [ ] **Step 1: Create BuildDetail.tsx**

Create `src/renderer/components/BuildDetail.tsx`:

```tsx
import React, { useState } from 'react';
import BuildChat from './BuildChat';

interface BuildEvent {
  id: string;
  type: string;
  content: string;
  created_at: string;
}

interface BuildData {
  id: string;
  task_title: string;
  task_description: string | null;
  pm_notes: string | null;
  transcript_context: string | null;
  status: string;
  repo_name: string;
  branch_name: string | null;
  pr_url: string | null;
  summary: string | null;
  files_changed: number;
  error_message: string | null;
  created_at: string;
  events: BuildEvent[];
}

interface BuildDetailProps {
  build: BuildData;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  queued: { label: 'Queued', bg: 'rgba(232,168,56,0.15)', text: '#E8A838' },
  running: { label: 'Running', bg: 'rgba(74,222,128,0.15)', text: '#4ade80' },
  awaiting_input: { label: 'Needs Input', bg: 'rgba(232,168,56,0.15)', text: '#E8A838' },
  done: { label: 'Done', bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  failed: { label: 'Failed', bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
};

function formatTime(dateStr: string, baseDateStr: string): string {
  const diff = new Date(dateStr).getTime() - new Date(baseDateStr).getTime();
  const totalSecs = Math.max(0, Math.floor(diff / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function BuildDetail({ build, onCancel, onRetry }: BuildDetailProps) {
  const [briefOpen, setBriefOpen] = useState(false);
  const statusCfg = STATUS_CONFIG[build.status] || STATUS_CONFIG.queued;
  const isActive = build.status === 'running' || build.status === 'awaiting_input';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border-base shrink-0">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text-primary truncate">{build.task_title}</h3>
            <div className="text-xs text-text-muted mt-1">
              {build.repo_name}
              {build.branch_name && (
                <span className="text-blue-400 ml-1.5">{build.branch_name}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span
              className="text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: statusCfg.bg, color: statusCfg.text }}
            >
              {statusCfg.label}
            </span>
            {isActive && (
              <button
                onClick={() => onCancel(build.id)}
                className="text-xs px-2.5 py-1 rounded-full border border-red-400/30 text-red-400 hover:bg-red-400/10 transition-all"
              >
                Cancel
              </button>
            )}
            {build.status === 'failed' && (
              <button
                onClick={() => onRetry(build.id)}
                className="text-xs px-2.5 py-1 rounded-full border border-honey/30 text-honey hover:bg-honey/10 transition-all"
              >
                Retry
              </button>
            )}
          </div>
        </div>

        {/* Collapsible build brief */}
        <button
          onClick={() => setBriefOpen(!briefOpen)}
          className="mt-2 w-full text-left px-3 py-2 rounded-lg transition-all"
          style={{ background: 'rgba(232,168,56,0.06)', border: '1px solid rgba(232,168,56,0.12)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-honey font-medium">Build Brief</span>
            <span className="text-xs text-text-muted">{briefOpen ? 'Collapse' : 'Expand'}</span>
          </div>
        </button>
        {briefOpen && (
          <div className="mt-2 px-3 py-2 text-xs text-text-secondary space-y-2">
            {build.task_description && <div><span className="text-text-muted">Description:</span> {build.task_description}</div>}
            {build.pm_notes && <div><span className="text-text-muted">PM Notes:</span> {build.pm_notes}</div>}
            {build.transcript_context && <div><span className="text-text-muted">Transcript:</span> {build.transcript_context.slice(0, 300)}...</div>}
          </div>
        )}
      </div>

      {/* Completion card */}
      {build.status === 'done' && (
        <div className="p-4 border-b border-border-base shrink-0">
          <div className="rounded-lg p-4" style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.15)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-primary">Build Complete</span>
              <span className="text-xs text-text-muted">{build.files_changed} files changed</span>
            </div>
            {build.summary && (
              <p className="text-xs text-text-secondary mb-3">{build.summary.slice(0, 300)}</p>
            )}
            {build.pr_url && (
              <button
                onClick={() => window.api.invoke('shell:open-external', build.pr_url)}
                className="text-sm font-medium px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all"
              >
                View Draft PR on GitHub
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error display */}
      {build.status === 'failed' && build.error_message && (
        <div className="p-4 border-b border-border-base shrink-0">
          <div className="rounded-lg p-3" style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)' }}>
            <span className="text-xs text-red-400">{build.error_message}</span>
          </div>
        </div>
      )}

      {/* Progress stream */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="text-xs text-text-muted uppercase tracking-wider mb-3">Progress</div>
        {build.events.length === 0 && (
          <div className="text-sm text-text-muted">Waiting to start...</div>
        )}
        <div className="space-y-1">
          {build.events.map((event, i) => {
            const isLast = i === build.events.length - 1;
            const isError = event.type === 'error';
            return (
              <div
                key={event.id}
                className="flex items-start gap-3 px-2.5 py-2 rounded-lg"
                style={{
                  background: isLast && isActive ? 'rgba(232,168,56,0.06)' : isError ? 'rgba(248,113,113,0.06)' : 'transparent',
                  border: isLast && isActive ? '1px solid rgba(232,168,56,0.12)' : '1px solid transparent',
                }}
              >
                <span className="text-xs text-text-muted whitespace-nowrap min-w-[36px] mt-0.5">
                  {formatTime(event.created_at, build.created_at)}
                </span>
                <div
                  className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                  style={{
                    background: isError ? '#f87171' : isLast && isActive ? '#E8A838' : '#4ade80',
                    animation: isLast && isActive ? 'pulse 2s infinite' : 'none',
                  }}
                />
                <span className={`text-xs ${isError ? 'text-red-400' : 'text-text-primary'}`}>
                  {event.content}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat panel for Q&A */}
      {build.status === 'awaiting_input' && (
        <BuildChat buildId={build.id} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/BuildDetail.tsx
git commit -m "feat: add BuildDetail component with progress stream and completion card"
```

---

### Task 12: BuildChat Component

**Files:**
- Create: `src/renderer/components/BuildChat.tsx`

- [ ] **Step 1: Create BuildChat.tsx**

Create `src/renderer/components/BuildChat.tsx`:

```tsx
import React, { useState } from 'react';

interface BuildChatProps {
  buildId: string;
}

export default function BuildChat({ buildId }: BuildChatProps) {
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!answer.trim() || sending) return;
    setSending(true);
    try {
      await window.api.invoke('build:answer', buildId, answer.trim());
      setAnswer('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border-base p-3 shrink-0" style={{ background: 'rgba(232,168,56,0.04)' }}>
      <div className="text-xs text-honey font-medium mb-2">Claude Code needs your input</div>
      <div className="flex gap-2">
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer..."
          rows={2}
          className="flex-1 text-sm px-3 py-2 bg-surface-3 border border-border-base text-text-primary rounded-lg outline-none resize-none"
        />
        <button
          onClick={handleSend}
          disabled={!answer.trim() || sending}
          className="self-end text-sm font-medium px-4 py-2 bg-honey text-surface-0 rounded-lg hover:bg-honey-dim disabled:opacity-40 transition-all"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
```

**Note:** The `build:answer` IPC channel and `submitAnswer` function are already registered in Task 6 (builds.ts) and Task 4 (build-executor.ts). The Q&A flow works as follows: when Claude Code's response ends with a question and no PR was created, the executor transitions to `awaiting_input`, emits a `question` event, and awaits a Promise. When the PM sends an answer via `build:answer`, the Promise resolves and the executor re-invokes the SDK with the PM's answer as the next prompt, continuing the conversation loop.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/BuildChat.tsx
git commit -m "feat: add BuildChat slide-up Q&A component"
```

---

### Task 13: BuildView — Top-Level Composition

**Files:**
- Create: `src/renderer/components/BuildView.tsx`

- [ ] **Step 1: Create BuildView.tsx**

Create `src/renderer/components/BuildView.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import BuildList from './BuildList';
import BuildDetail from './BuildDetail';
import BuildForm from './BuildForm';

interface Build {
  id: string;
  task_title: string;
  task_description: string | null;
  pm_notes: string | null;
  transcript_context: string | null;
  status: string;
  repo_name: string;
  branch_name: string | null;
  pr_url: string | null;
  summary: string | null;
  files_changed: number;
  error_message: string | null;
  created_at: string;
  events: { id: string; type: string; content: string; created_at: string }[];
}

type View = 'list' | 'form';

export default function BuildView() {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBuild, setSelectedBuild] = useState<Build | null>(null);
  const [view, setView] = useState<View>('list');

  // Load all builds
  const loadBuilds = useCallback(async () => {
    const result = await window.api.invoke('build:list') as Build[];
    setBuilds(result);
  }, []);

  // Load selected build detail
  const loadBuildDetail = useCallback(async (id: string) => {
    const result = await window.api.invoke('build:get', id) as Build | null;
    setSelectedBuild(result);
  }, []);

  // Initial load
  useEffect(() => {
    loadBuilds();
  }, [loadBuilds]);

  // Load detail when selection changes
  useEffect(() => {
    if (selectedId) {
      loadBuildDetail(selectedId);
    } else {
      setSelectedBuild(null);
    }
  }, [selectedId, loadBuildDetail]);

  // Listen for streaming build events
  useEffect(() => {
    const sub = window.api.on('build:event', (event: unknown) => {
      const evt = event as { buildId: string; type: string; content: string; id: string; created_at: string };

      // Update selected build's events in real-time
      setSelectedBuild((prev) => {
        if (!prev || prev.id !== evt.buildId) return prev;
        return { ...prev, events: [...prev.events, evt] };
      });

      // Refresh build list to update statuses
      loadBuilds();
    });
    return () => { window.api.off('build:event', sub); };
  }, [loadBuilds]);

  const handleNewBuild = () => {
    setView('form');
    setSelectedId(null);
  };

  const handleFormSubmit = async (data: {
    repoId: string;
    taskTitle: string;
    taskDescription?: string;
    pmNotes?: string;
    transcriptContext?: string;
    source: string;
    sourceId?: string;
  }) => {
    const build = await window.api.invoke('build:create', data) as Build;
    setView('list');
    await loadBuilds();
    setSelectedId(build.id);
  };

  const handleCancel = async (id: string) => {
    await window.api.invoke('build:cancel', id);
    await loadBuilds();
    if (selectedId === id) loadBuildDetail(id);
  };

  const handleRetry = async (id: string) => {
    const newBuild = await window.api.invoke('build:retry', id) as Build;
    await loadBuilds();
    setSelectedId(newBuild.id);
  };

  if (view === 'form') {
    return <BuildForm onSubmit={handleFormSubmit} onCancel={() => setView('list')} />;
  }

  return (
    <div className="flex h-full">
      {/* Left: Build list */}
      <div className="w-72 border-r border-border-base shrink-0 overflow-hidden">
        <BuildList
          builds={builds}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNewBuild={handleNewBuild}
        />
      </div>

      {/* Right: Build detail */}
      <div className="flex-1 overflow-hidden">
        {selectedBuild ? (
          <BuildDetail
            build={selectedBuild}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-text-muted text-sm">Select a build or create a new one</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the full flow**

Run `npm start`. Verify:
1. Build icon in sidebar navigates to Build view
2. "New Build" button opens the form
3. Form shows Linear issues (if connected) and repos (if configured)
4. Creating a build adds it to the list
5. Selecting a build shows the detail panel
6. Events stream in real-time when a build is running

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/BuildView.tsx
git commit -m "feat: add BuildView composing list, detail, and form"
```

---

### Task 14: Add Pulse Animation CSS

**Files:**
- Modify: `src/renderer/globals.css`

- [ ] **Step 1: Add keyframe animation**

Add this to the end of `src/renderer/globals.css`:

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

Check if a `pulse` animation already exists in the file first — Tailwind may provide one. If so, skip this step.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/globals.css
git commit -m "style: add pulse keyframe animation for build status indicators"
```

---

### Task 15: Integration Smoke Test

- [ ] **Step 1: Verify complete flow end-to-end**

Run `npm start` and walk through:

1. Open Settings → add a repository (point to any local git repo)
2. Validate it — should show "Valid git repository"
3. Save it
4. Navigate to Build view via sidebar
5. Click "New Build"
6. Select a Linear issue (or just type a title/description manually)
7. Select the repo
8. Add PM notes
9. Click "Start Build"
10. Watch the progress stream for events
11. If Claude Code asks a question, answer in the chat panel
12. When done, verify the PR link appears in the completion card

- [ ] **Step 2: Fix any issues found**

Address any TypeScript errors, runtime errors, or UI issues.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Claude Code integration — Build view with SDK execution"
```
