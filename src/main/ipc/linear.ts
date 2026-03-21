import { ipcMain, shell, safeStorage } from 'electron';
import { LinearClient } from '@linear/sdk';
import { getDb } from '../db';
import crypto from 'crypto';
import http from 'http';

// ── Config ──────────────────────────────────────────────────────────
// Replace these with your Linear OAuth app credentials.
// In production, load from environment or a config file.
const CLIENT_ID = process.env.LINEAR_CLIENT_ID || 'YOUR_CLIENT_ID';
const CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'http://localhost:38901/oauth/callback';

// ── Token storage (encrypted via safeStorage) ───────────────────────

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function storeTokens(tokens: { access_token: string; refresh_token: string; expires_in: number }): void {
  const db = getDb();
  const data = {
    access_token_encrypted: safeStorage.encryptString(tokens.access_token).toString('base64'),
    refresh_token_encrypted: safeStorage.encryptString(tokens.refresh_token).toString('base64'),
    expires_at: Date.now() + tokens.expires_in * 1000,
  };
  db.prepare(
    'INSERT OR REPLACE INTO auth (provider, access_token_encrypted, refresh_token_encrypted, expires_at) VALUES (?, ?, ?, ?)'
  ).run('linear', data.access_token_encrypted, data.refresh_token_encrypted, data.expires_at);
}

function loadTokens(): StoredTokens | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM auth WHERE provider = ?').get('linear') as {
    access_token_encrypted: string;
    refresh_token_encrypted: string;
    expires_at: number;
  } | undefined;
  if (!row) return null;
  return {
    accessToken: safeStorage.decryptString(Buffer.from(row.access_token_encrypted, 'base64')),
    refreshToken: safeStorage.decryptString(Buffer.from(row.refresh_token_encrypted, 'base64')),
    expiresAt: row.expires_at,
  };
}

function clearTokens(): void {
  const db = getDb();
  db.prepare('DELETE FROM auth WHERE provider = ?').run('linear');
}

// ── Token refresh ───────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Not authenticated with Linear');

  // Refresh if expiring within 5 minutes
  if (Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
    const newTokens = await refreshAccessToken(tokens.refreshToken);
    storeTokens(newTokens);
    return newTokens.access_token;
  }
  return tokens.accessToken;
}

export async function getLinearClient(): Promise<LinearClient> {
  const accessToken = await getValidAccessToken();
  return new LinearClient({ accessToken });
}

// ── OAuth flow ──────────────────────────────────────────────────────

function exchangeCodeForTokens(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  return fetch('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  }).then(async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Token exchange failed: ${res.status} ${text}`);
    }
    return res.json();
  });
}

async function startOAuthFlow(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    const state = crypto.randomBytes(16).toString('hex');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const server = (http.createServer as any)(async (req: any, res: any) => {
      const url = new URL(req.url!, `http://localhost:38901`);
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (returnedState !== state) {
        res.writeHead(400);
        res.end('State mismatch.');
        server.close();
        resolve({ success: false, error: 'State mismatch' });
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('No authorization code received.');
        server.close();
        resolve({ success: false, error: 'No code received' });
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code);
        storeTokens(tokens);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body style="font-family:system-ui;text-align:center;padding:60px"><h2>Connected to Linear!</h2><p>You can close this tab.</p></body></html>');
        server.close();
        resolve({ success: true });
      } catch (err) {
        res.writeHead(500);
        res.end('Token exchange failed.');
        server.close();
        resolve({ success: false, error: (err as Error).message });
      }
    });

    server.listen(38901, '127.0.0.1');

    const authUrl = `https://linear.app/oauth/authorize?${new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'read,write',
      state,
      actor: 'user',
    })}`;

    // Open in the user's default browser — passkeys, saved sessions, etc. all work
    shell.openExternal(authUrl);
  });
}

// ── IPC handlers ────────────────────────────────────────────────────

export function registerLinearHandlers() {
  // Start OAuth login flow
  ipcMain.handle('linear:auth', async () => {
    return startOAuthFlow();
  });

  // Check if user is connected
  ipcMain.handle('linear:status', async () => {
    const tokens = loadTokens();
    if (!tokens) return { connected: false };
    try {
      const client = await getLinearClient();
      const viewer = await client.viewer;
      return { connected: true, name: viewer.name, email: viewer.email };
    } catch {
      return { connected: false };
    }
  });

  // Disconnect / revoke
  ipcMain.handle('linear:disconnect', async () => {
    const tokens = loadTokens();
    if (tokens) {
      try {
        await fetch('https://api.linear.app/oauth/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.accessToken }),
        });
      } catch {
        // Best effort — clear locally regardless
      }
    }
    clearTokens();
    return { success: true };
  });

  // Fetch teams for the settings dropdown
  ipcMain.handle('linear:get-teams', async () => {
    const client = await getLinearClient();
    const teams = await client.teams();
    return teams.nodes.map((t: any) => ({ id: t.id, name: t.name, key: t.key }));
  });

  // Fetch workflow states for a team, ordered by type category
  ipcMain.handle('linear:get-states', async (_e, { teamId }: { teamId?: string } = {}) => {
    const client = await getLinearClient();

    let team: any;
    if (teamId) {
      team = await client.team(teamId);
    } else {
      const teams = await client.teams();
      if (teams.nodes.length === 0) return [];
      team = teams.nodes[0];
    }

    const states = await team.states();
    const TYPE_ORDER = ['triage', 'backlog', 'unstarted', 'started', 'completed', 'canceled'];

    return states.nodes
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,       // "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled"
        color: s.color,
        position: s.position,
      }))
      .sort((a: any, b: any) => {
        const typeA = TYPE_ORDER.indexOf(a.type);
        const typeB = TYPE_ORDER.indexOf(b.type);
        if (typeA !== typeB) return typeA - typeB;
        return a.position - b.position;
      });
  });

  // Fetch all team issues from Linear for the kanban board
  ipcMain.handle('linear:get-issues', async (_e, { teamId }: { teamId?: string } = {}) => {
    const client = await getLinearClient();

    let team: any;
    if (teamId) {
      team = await client.team(teamId);
    } else {
      const teams = await client.teams();
      if (teams.nodes.length === 0) return [];
      team = teams.nodes[0];
    }

    const issues = await team.issues({ first: 100, orderBy: 'updatedAt' });

    const results = [];
    for (const issue of issues.nodes) {
      const state = await issue.state;
      const assignee = await issue.assignee;

      // Resolve relations
      let blockedBy: { id: string; identifier: string; title: string }[] = [];
      let blocking: { id: string; identifier: string; title: string }[] = [];
      try {
        const inverseRels = await issue.inverseRelations();
        for (const rel of inverseRels.nodes) {
          if (rel.type === 'blocks') {
            const blocker = await rel.issue;
            blockedBy.push({ id: blocker.id, identifier: blocker.identifier, title: blocker.title });
          }
        }
        const rels = await issue.relations();
        for (const rel of rels.nodes) {
          if (rel.type === 'blocks') {
            const blocked = await rel.relatedIssue;
            blocking.push({ id: blocked.id, identifier: blocked.identifier, title: blocked.title });
          }
        }
      } catch {
        // Relations may not be available — continue without them
      }

      results.push({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        statusId: state?.id || '',
        status: state?.name || 'Unknown',
        statusType: state?.type || 'backlog',
        statusColor: state?.color || '#5E5B54',
        priority: issue.priority,
        priorityLabel: issue.priorityLabel,
        assigneeName: assignee?.name || null,
        assigneeInitials: assignee?.name ? assignee.name.split(' ').map((n: string) => n[0]).join('').toUpperCase() : null,
        blockedBy,
        blocking,
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
      });
    }
    return results;
  });

  // Push a task as a Linear issue
  ipcMain.handle('task:push-to-linear', async (_e, { title, description, teamId }: { title: string; description: string; teamId: string }) => {
    const client = await getLinearClient();
    const result = await client.createIssue({ title, description, teamId });
    const issue = await result.issue;
    return { id: issue!.id, identifier: issue!.identifier, url: issue!.url };
  });
}
