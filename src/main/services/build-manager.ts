import { BrowserWindow } from 'electron';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';
import { executeBuild, cancelBuild, type BuildConfig } from './build-executor';

// ── Row interfaces ────────────────────────────────────────────────────

export interface BuildRow {
  id: string;
  repo_id: string;
  task_title: string;
  task_description: string | null;
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

export interface RepoRow {
  id: string;
  name: string;
  path: string;
  github_url: string | null;
  default_branch: string;
  created_at: string;
}

// ── Concurrency tracker ───────────────────────────────────────────────

// Track which repos have a running build
const runningRepos = new Set<string>();

// ── Window helper ─────────────────────────────────────────────────────

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.find(w => !w.isDestroyed()) || null;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Insert a new build with status 'queued', kick off the queue, and return the new row.
 */
export function createBuild(data: {
  repo_id: string;
  task_title: string;
  task_description?: string;
  pm_notes?: string;
  transcript_context?: string;
  source?: string;
  source_id?: string;
}): BuildRow {
  const db = getDb();
  const id = uuid();

  db.prepare(`
    INSERT INTO builds (id, repo_id, task_title, task_description, pm_notes, transcript_context, source, source_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')
  `).run(
    id,
    data.repo_id,
    data.task_title,
    data.task_description ?? null,
    data.pm_notes ?? null,
    data.transcript_context ?? null,
    data.source ?? 'linear',
    data.source_id ?? null,
  );

  processQueue();

  return db.prepare('SELECT * FROM builds WHERE id = ?').get(id) as BuildRow;
}

/**
 * List all builds joined with their repo name, newest first.
 */
export function listBuilds(): (BuildRow & { repo_name: string })[] {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, r.name AS repo_name
    FROM builds b
    JOIN repos r ON b.repo_id = r.id
    ORDER BY b.created_at DESC
  `).all() as (BuildRow & { repo_name: string })[];
}

/**
 * Get a single build with repo name and path.
 */
export function getBuild(id: string): (BuildRow & { repo_name: string; repo_path: string }) | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT b.*, r.name AS repo_name, r.path AS repo_path
    FROM builds b
    JOIN repos r ON b.repo_id = r.id
    WHERE b.id = ?
  `).get(id) as (BuildRow & { repo_name: string; repo_path: string }) | undefined;
}

/**
 * Get all events for a build in chronological order.
 */
export function getBuildEvents(buildId: string) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM build_events
    WHERE build_id = ?
    ORDER BY created_at ASC
  `).all(buildId);
}

/**
 * Cancel a running (or awaiting-input) build. Updates status, cleans up the running set,
 * and re-checks the queue in case another build for the same repo can now start.
 */
export function cancelBuildById(buildId: string): boolean {
  const build = getBuild(buildId);
  if (!build) return false;

  const cancelled = cancelBuild(buildId);

  // Whether or not the executor had an active session, remove the repo from the set
  // (the build may have been queued but not yet started)
  runningRepos.delete(build.repo_id);

  processQueue();

  return cancelled;
}

/**
 * Create a new build using the same parameters as an existing one, and return it.
 */
export function retryBuild(buildId: string): BuildRow {
  const original = getBuild(buildId);
  if (!original) throw new Error(`Build ${buildId} not found`);

  return createBuild({
    repo_id: original.repo_id,
    task_title: original.task_title,
    task_description: original.task_description ?? undefined,
    pm_notes: original.pm_notes ?? undefined,
    transcript_context: original.transcript_context ?? undefined,
    source: original.source,
    source_id: original.source_id ?? undefined,
  });
}

// ── Queue scheduler ───────────────────────────────────────────────────

/**
 * Inspect all queued builds and start any whose repo does not already have a running build.
 * One build per repo runs at a time; builds for different repos run in parallel.
 */
function processQueue(): void {
  const db = getDb();

  const queued = db.prepare(`
    SELECT b.*, r.name AS repo_name, r.path AS repo_path
    FROM builds b
    JOIN repos r ON b.repo_id = r.id
    WHERE b.status = 'queued'
    ORDER BY b.created_at ASC
  `).all() as (BuildRow & { repo_name: string; repo_path: string })[];

  for (const build of queued) {
    // Skip if this repo already has a running build
    if (runningRepos.has(build.repo_id)) continue;

    const win = getMainWindow();

    // Fetch the full repo row for default_branch
    const repo = db.prepare('SELECT * FROM repos WHERE id = ?').get(build.repo_id) as RepoRow | undefined;
    if (!repo) continue;

    runningRepos.add(build.repo_id);

    const config: BuildConfig = {
      buildId: build.id,
      repoPath: repo.path,
      defaultBranch: repo.default_branch,
      taskTitle: build.task_title,
      taskDescription: build.task_description ?? '',
      pmNotes: build.pm_notes ?? undefined,
      transcriptContext: build.transcript_context ?? undefined,
    };

    executeBuild(config)
      .finally(() => {
        runningRepos.delete(build.repo_id);
        processQueue();
      });
  }
}
