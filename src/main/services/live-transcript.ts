import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { app } from 'electron';

// Use ws from the project's node_modules (available via webpack bundling)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

function getCloudflaredUrl(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    // cloudflared provides a universal macOS binary
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz';
  } else if (platform === 'win32') {
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
  } else {
    // Linux
    if (arch === 'arm64') {
      return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64';
    }
    return 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
  }
}

interface LiveSession {
  wss: InstanceType<typeof WebSocket.Server>;
  tunnelProcess: ReturnType<typeof spawn>;
  publicUrl: string;
}

// Active sessions keyed by google_event_id
const sessions = new Map<string, LiveSession>();

// Accumulated live transcript lines keyed by google_event_id
const liveTranscriptLines = new Map<string, Array<{ speaker: string; text: string }>>();

export function getLiveTranscript(eventId: string): string {
  const lines = liveTranscriptLines.get(eventId);
  if (!lines || lines.length === 0) return '';
  return lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
}

function getCloudflaredPath(): string {
  return path.join(app.getPath('userData'), 'cloudflared');
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      // Follow redirects (GitHub uses multiple)
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, dest).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(dest);
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (err) => { fs.unlinkSync(dest); reject(err); });
    });
    request.on('error', (err) => { try { fs.unlinkSync(dest); } catch { /* ignore */ } reject(err); });
  });
}

async function ensureCloudflared(): Promise<string> {
  const cfPath = getCloudflaredPath();
  // Check it exists AND is non-empty
  if (fs.existsSync(cfPath) && fs.statSync(cfPath).size > 0) {
    return cfPath;
  }

  const url = getCloudflaredUrl();
  console.log('[tunnel] Downloading cloudflared...');

  if (url.endsWith('.tgz')) {
    // macOS: download .tgz, extract, then move the binary
    const tgzPath = cfPath + '.tgz';
    await downloadFile(url, tgzPath);
    const { execSync } = require('child_process');
    const extractDir = path.dirname(cfPath);
    execSync(`tar -xzf "${tgzPath}" -C "${extractDir}"`, { stdio: 'ignore' });
    fs.unlinkSync(tgzPath);
    // The archive contains a 'cloudflared' binary in the extract dir
    fs.chmodSync(cfPath, 0o755);
  } else {
    await downloadFile(url, cfPath);
    fs.chmodSync(cfPath, 0o755);
  }

  console.log('[tunnel] cloudflared downloaded');
  return cfPath;
}

function startTunnel(port: number, cfPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cf = spawn(cfPath, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Tunnel startup timed out'));
      }
    }, 30000);

    const handleOutput = (data: Buffer) => {
      const line = data.toString();
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    cf.stdout.on('data', handleOutput);
    cf.stderr.on('data', handleOutput);
    cf.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); }
    });

    // Store the process so we can kill it later
    (cf as any).__port = port;
    (startTunnel as any).__lastProcess = cf;
  });
}

export async function startLiveTranscript(eventId: string): Promise<string> {
  if (sessions.has(eventId)) {
    return sessions.get(eventId)!.publicUrl;
  }

  const cfPath = await ensureCloudflared();

  // Start local WS server on random port
  const wss = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => wss.on('listening', resolve));
  const port = (wss.address() as { port: number }).port;

  wss.on('connection', (ws: any) => {
    console.log(`[live-transcript] Recall connected for ${eventId}`);
    ws.on('message', (raw: Buffer) => {
      try {
        const event = JSON.parse(raw.toString());
        const type = event.event;
        const d = event.data?.data;
        if (!d) return;
        const speaker = d.participant?.name || 'Unknown';
        const text = (d.words || []).map((w: any) => w.text).join(' ');
        if (type === 'transcript.partial_data') {
          console.log(`[transcript] (partial) ${speaker}: ${text}`);
        } else if (type === 'transcript.data') {
          console.log(`[transcript] ${speaker}: ${text}`);
          // Store final lines for the chat agent
          if (!liveTranscriptLines.has(eventId)) {
            liveTranscriptLines.set(eventId, []);
          }
          liveTranscriptLines.get(eventId)!.push({ speaker, text });
        }
      } catch {
        // ignore parse errors
      }
    });
    ws.on('close', () => {
      console.log(`[live-transcript] Recall disconnected for ${eventId}`);
    });
  });

  console.log(`[live-transcript] WS server on port ${port}, starting tunnel...`);

  // Start tunnel
  const publicHttpsUrl = await startTunnel(port, cfPath);
  const publicWssUrl = publicHttpsUrl.replace('https://', 'wss://');

  const tunnelProcess = (startTunnel as any).__lastProcess;

  sessions.set(eventId, { wss, tunnelProcess, publicUrl: publicWssUrl });
  console.log(`[live-transcript] Tunnel ready: ${publicWssUrl}`);

  return publicWssUrl;
}

export function stopLiveTranscript(eventId: string): void {
  const session = sessions.get(eventId);
  if (!session) return;

  try { session.tunnelProcess.kill(); } catch { /* ignore */ }
  try { session.wss.close(); } catch { /* ignore */ }
  sessions.delete(eventId);
  liveTranscriptLines.delete(eventId);
  console.log(`[live-transcript] Stopped session for ${eventId}`);
}

export function stopAllLiveTranscripts(): void {
  for (const [eventId] of sessions) {
    stopLiveTranscript(eventId);
  }
}
