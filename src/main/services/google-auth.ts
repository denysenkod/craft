import { OAuth2Client } from 'google-auth-library';
import { shell } from 'electron';
import http from 'http';
import crypto from 'crypto';
import url from 'url';
import { getDb } from '../db';
import { encrypt, decrypt } from './secure-storage';

// Bundled OAuth credentials, injected at build time from .env via DefinePlugin.
// Create a "Desktop app" OAuth 2.0 Client ID in Google Cloud Console and
// put the values in .env at the project root (see .env.example).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

const ENCRYPTED_KEYS = new Set(['google_access_token', 'google_refresh_token']);

function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row?.value) return undefined;
  return ENCRYPTED_KEYS.has(key) ? decrypt(row.value) : row.value;
}

function setSetting(key: string, value: string): void {
  const db = getDb();
  const stored = ENCRYPTED_KEYS.has(key) ? encrypt(value) : value;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, stored);
}

function deleteSetting(key: string): void {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

export async function startAuthFlow(): Promise<{ success: boolean; email?: string; error?: string }> {
  try {
    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    return await new Promise((resolve) => {
      // eslint-disable-next-line prefer-const, @typescript-eslint/no-explicit-any
      let server: any;

      const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
        const queryParams = new url.URL(req.url!, `http://127.0.0.1`).searchParams;
        const code = queryParams.get('code');

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Error: No authorization code received</h1></body></html>');
          server.close();
          resolve({ success: false, error: 'No authorization code received' });
          return;
        }

        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);

        client.getToken({ code, codeVerifier }).then(async ({ tokens }) => {
          if (tokens.refresh_token) {
            setSetting('google_refresh_token', tokens.refresh_token);
          }
          if (tokens.access_token) {
            setSetting('google_access_token', tokens.access_token);
          }
          if (tokens.expiry_date) {
            setSetting('google_token_expiry', String(tokens.expiry_date));
          }

          // Fetch user email
          client.setCredentials(tokens);
          const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          });
          const userInfo = await userInfoRes.json() as { email?: string };
          if (userInfo.email) {
            setSetting('google_user_email', userInfo.email);
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication successful!</h1><p>You can close this tab and return to the app.</p></body></html>');
          server.close();
          resolve({ success: true, email: userInfo.email });
        }).catch((err: unknown) => {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication failed</h1></body></html>');
          server.close();
          resolve({ success: false, error: (err as Error).message });
        });
      };

      server = (http.createServer as any)(handler); // eslint-disable-line @typescript-eslint/no-explicit-any

      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port;
        const redirectUri = `http://127.0.0.1:${port}`;
        const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);

        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          scope: SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256' as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          prompt: 'consent',
        });

        shell.openExternal(authUrl);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        server.close();
        resolve({ success: false, error: 'Authentication timed out' });
      }, 5 * 60 * 1000);
    });
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

export async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

  const accessToken = getSetting('google_access_token');
  const refreshToken = getSetting('google_refresh_token');
  const expiryStr = getSetting('google_token_expiry');

  if (!accessToken || !refreshToken) {
    throw new Error('Not authenticated. Please sign in with Google first.');
  }

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryStr ? Number(expiryStr) : undefined,
  });

  // Auto-refresh if expired
  const expiry = expiryStr ? Number(expiryStr) : 0;
  if (Date.now() >= expiry - 60_000) {
    const { credentials } = await client.refreshAccessToken();
    if (credentials.access_token) {
      setSetting('google_access_token', credentials.access_token);
    }
    if (credentials.expiry_date) {
      setSetting('google_token_expiry', String(credentials.expiry_date));
    }
    client.setCredentials(credentials);
  }

  return client;
}

export function isAuthenticated(): { authenticated: boolean; email?: string } {
  const accessToken = getSetting('google_access_token');
  const refreshToken = getSetting('google_refresh_token');
  const email = getSetting('google_user_email');
  return {
    authenticated: !!(accessToken && refreshToken),
    email,
  };
}

export function logout(): void {
  deleteSetting('google_access_token');
  deleteSetting('google_refresh_token');
  deleteSetting('google_token_expiry');
  deleteSetting('google_user_email');
}
