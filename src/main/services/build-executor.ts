import { BrowserWindow } from 'electron';
import { query, type Query, type SDKAssistantMessage, type SDKResultMessage, type SDKResultSuccess, type SDKToolUseSummaryMessage } from '@anthropic-ai/claude-agent-sdk';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';

// ── Types ────────────────────────────────────────────────────────────

export interface BuildConfig {
  buildId: string;
  repoPath: string;
  defaultBranch: string;
  taskTitle: string;
  taskDescription: string;
  pmNotes?: string;
  transcriptContext?: string;
}

export type BuildStatus =
  | 'queued'
  | 'running'
  | 'awaiting_input'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface BuildEvent {
  id: string;
  build_id: string;
  type: string;
  content: string;
  created_at: string;
}

// ── Active sessions & answer resolvers ───────────────────────────────

const activeSessions = new Map<string, Query>();
const pendingAnswerResolvers = new Map<string, (answer: string) => void>();
const cancelledBuilds = new Set<string>();

// ── Helpers ──────────────────────────────────────────────────────────

function getMainWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows();
  return windows.length > 0 ? windows[0] : null;
}

/**
 * Persist a build event to SQLite and send it to the renderer.
 */
function emitEvent(buildId: string, type: string, content: string): void {
  const db = getDb();
  const id = uuid();
  db.prepare(
    'INSERT INTO build_events (id, build_id, type, content) VALUES (?, ?, ?, ?)'
  ).run(id, buildId, type, content);

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('build:event', { id, build_id: buildId, type, content });
  }
}

/**
 * Update the build record's status and optional extra columns.
 */
function updateBuildStatus(
  buildId: string,
  status: BuildStatus,
  extras?: Record<string, string | number | null>
): void {
  const db = getDb();
  let sql = "UPDATE builds SET status = ?, updated_at = datetime('now')";
  const params: (string | number | null)[] = [status];

  if (extras) {
    for (const [col, val] of Object.entries(extras)) {
      sql += `, ${col} = ?`;
      params.push(val);
    }
  }

  sql += ' WHERE id = ?';
  params.push(buildId);
  db.prepare(sql).run(...params);

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('build:status', { buildId, status, ...extras });
  }
}

// ── System prompt ────────────────────────────────────────────────────

function buildSystemPrompt(config: BuildConfig): string {
  const parts: string[] = [];

  parts.push(`You are an autonomous software engineer working on a task assigned by a PM.

<task>
Title: ${config.taskTitle}
Description: ${config.taskDescription}
</task>`);

  if (config.pmNotes) {
    parts.push(`<pm_notes>
${config.pmNotes}
</pm_notes>`);
  }

  if (config.transcriptContext) {
    parts.push(`<transcript_context>
The following is a conversation transcript that provides context for this task:
${config.transcriptContext}
</transcript_context>`);
  }

  parts.push(`<safety_rules>
CRITICAL — you MUST follow these rules at all times:

1. BRANCH NAMING: Always create and work on a branch prefixed with "pm/" (e.g., pm/add-login-page). Never commit directly to "${config.defaultBranch}".
2. DRAFT PR ONLY: When creating a pull request, always create it as a DRAFT PR. Use "gh pr create --draft".
3. NO DESTRUCTIVE OPS: Never run force pushes, hard resets, or any command that could destroy existing work. Never delete branches other than your own pm/ branch.
4. ASK FOR CLARIFICATION: If the task requirements are ambiguous or you need more information to proceed correctly, STOP and ask the PM a clarifying question. Do not guess or make assumptions about business logic.
5. STAY FOCUSED: Only modify files directly related to the task. Do not refactor unrelated code.
6. TEST YOUR WORK: If the project has tests, run them before creating a PR. Fix any failures you introduced.
7. COMMIT MESSAGES: Write clear, conventional commit messages describing what changed and why.
</safety_rules>`);

  return parts.join('\n\n');
}

// ── Main executor ────────────────────────────────────────────────────

/**
 * Execute a build using the Claude Agent SDK.
 * Iterates over SDK messages, emitting progress events, handling Q&A,
 * and producing a final summary.
 */
export async function executeBuild(config: BuildConfig): Promise<void> {
  const { buildId } = config;

  updateBuildStatus(buildId, 'running');
  emitEvent(buildId, 'status', 'Build started');

  const systemPromptText = buildSystemPrompt(config);
  const initialPrompt = `Implement the following task in the repo at ${config.repoPath}.

1. First, explore the codebase to understand the project structure and conventions.
2. Create a new branch with the pm/ prefix (e.g., pm/${slugify(config.taskTitle)}).
3. Implement the changes described in the task.
4. Commit your work with a clear commit message.
5. Create a DRAFT pull request using "gh pr create --draft".

Begin.`;

  let currentSessionId: string | undefined;
  let lastAssistantText = '';

  try {
    // Start the initial query
    let session = query({
      prompt: initialPrompt,
      options: {
        cwd: config.repoPath,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: systemPromptText,
        },
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        disallowedTools: ['Agent'],
        maxTurns: 100,
        persistSession: false,
        model: 'claude-sonnet-4-6',
      },
    });

    activeSessions.set(buildId, session);

    // Process the session in a loop that supports Q&A resume cycles
    let continueLoop = true;
    while (continueLoop) {
      continueLoop = false;
      let resultMessage: SDKResultMessage | null = null;

      for await (const message of session) {
        // Handle tool_use_summary: emit as progress
        if (message.type === 'tool_use_summary') {
          const summary = (message as SDKToolUseSummaryMessage).summary;
          emitEvent(buildId, 'progress', summary);
        }

        // Handle assistant messages: track text, detect questions
        if (message.type === 'assistant') {
          const assistantMsg = message as SDKAssistantMessage;
          // Extract text for tracking
          const textBlocks: string[] = [];
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text' && block.text) {
              textBlocks.push(block.text);
            }
          }
          if (textBlocks.length > 0) {
            lastAssistantText = textBlocks.join('\n');
          }
          // Store session ID for potential resume
          currentSessionId = assistantMsg.session_id;
        }

        // Handle result
        if (message.type === 'result') {
          resultMessage = message as SDKResultMessage;
        }
      }

      // Session iteration ended — process the result
      if (!resultMessage) {
        // No result means the session was closed/cancelled
        break;
      }

      if (resultMessage.subtype === 'success') {
        const successResult = resultMessage as SDKResultSuccess;

        // Check if the final response was a question
        const finalText = successResult.result || lastAssistantText;
        const isQuestion = finalText.trim().endsWith('?');

        if (isQuestion && currentSessionId) {
          // Claude is asking a clarification question
          emitEvent(buildId, 'question', finalText.trim());
          updateBuildStatus(buildId, 'awaiting_input');

          // Wait for the PM's answer
          const answer = await new Promise<string>((resolve) => {
            pendingAnswerResolvers.set(buildId, resolve);
          });
          pendingAnswerResolvers.delete(buildId);

          // Check if the build was cancelled while waiting
          if (cancelledBuilds.has(buildId)) {
            cancelledBuilds.delete(buildId);
            break;
          }

          emitEvent(buildId, 'answer', answer);
          updateBuildStatus(buildId, 'running');

          // Resume with a new query using the session resume option
          session = query({
            prompt: answer,
            options: {
              cwd: config.repoPath,
              systemPrompt: {
                type: 'preset',
                preset: 'claude_code',
                append: systemPromptText,
              },
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              disallowedTools: ['Agent'],
              maxTurns: 100,
              persistSession: false,
              resume: currentSessionId,
              model: 'claude-sonnet-4-6',
            },
          });

          activeSessions.set(buildId, session);
          continueLoop = true;
        } else {
          // Build completed successfully
          const resultText = successResult.result || lastAssistantText;
          const prUrl = extractPrUrl(resultText);
          const filesChanged = extractFilesChanged(resultText);
          const summary = resultText.length > 2000
            ? resultText.substring(0, 2000) + '...'
            : resultText;

          updateBuildStatus(buildId, 'done', {
            pr_url: prUrl,
            files_changed: filesChanged,
            summary,
          });
          emitEvent(buildId, 'done', summary);
        }
      } else {
        // Error result
        const errorMsg = 'errors' in resultMessage
          ? (resultMessage as any).errors?.join('; ') || `Build ended with ${resultMessage.subtype}`
          : `Build ended with ${resultMessage.subtype}`;

        updateBuildStatus(buildId, 'failed', { error_message: errorMsg });
        emitEvent(buildId, 'error', errorMsg);
      }
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Don't mark as failed if it was a deliberate cancellation
    if (!errorMessage.includes('abort') && activeSessions.has(buildId)) {
      updateBuildStatus(buildId, 'failed', { error_message: errorMessage });
      emitEvent(buildId, 'error', errorMessage);
    }
  } finally {
    activeSessions.delete(buildId);
    pendingAnswerResolvers.delete(buildId);
    cancelledBuilds.delete(buildId);
  }
}

// ── Public API for Q&A and cancellation ──────────────────────────────

/**
 * Submit an answer to a pending clarification question.
 * Resolves the Promise that executeBuild() is awaiting.
 */
export function submitAnswer(buildId: string, answer: string): boolean {
  const resolver = pendingAnswerResolvers.get(buildId);
  if (!resolver) return false;
  resolver(answer);
  return true;
}

/**
 * Cancel a running build. Closes the SDK session and cleans up.
 */
export function cancelBuild(buildId: string): boolean {
  const session = activeSessions.get(buildId);
  if (!session) return false;

  // If waiting for an answer, resolve it to unblock (executeBuild will check cancelledBuilds)
  cancelledBuilds.add(buildId);
  const resolver = pendingAnswerResolvers.get(buildId);
  if (resolver) {
    resolver(''); // unblock the awaiting promise
    pendingAnswerResolvers.delete(buildId);
  }

  try {
    session.close();
  } catch {
    // session may already be closed
  }

  activeSessions.delete(buildId);
  updateBuildStatus(buildId, 'cancelled');
  emitEvent(buildId, 'cancelled', 'Build was cancelled by the user');
  return true;
}

/**
 * Check if a build is currently active (running or awaiting input).
 */
export function isBuildActive(buildId: string): boolean {
  return activeSessions.has(buildId);
}

// ── Utility functions ────────────────────────────────────────────────

/**
 * Extract a GitHub PR URL from text.
 */
function extractPrUrl(text: string): string | null {
  const match = text.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/);
  return match ? match[0] : null;
}

/**
 * Try to extract a file count from the result text.
 * Looks for patterns like "changed 5 files" or "5 files changed".
 */
function extractFilesChanged(text: string): number {
  const patterns = [
    /(\d+)\s+files?\s+changed/i,
    /changed\s+(\d+)\s+files?/i,
    /modif(?:ied|y)\s+(\d+)\s+files?/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseInt(match[1], 10);
  }
  return 0;
}

/**
 * Convert a task title to a branch-friendly slug.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);
}
