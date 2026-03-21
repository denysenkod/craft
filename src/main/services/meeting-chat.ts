import { BrowserWindow, ipcMain } from 'electron';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { getBotTranscript, TranscriptEntry } from './recall';
import { getLiveTranscript } from './live-transcript';
import { getDb } from '../db';

declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let floatingWindow: BrowserWindow | null = null;
let currentEventId: string | null = null;
let abortController: AbortController | null = null;
let tipInterval: ReturnType<typeof setInterval> | null = null;
let tipAbortController: AbortController | null = null;
let currentMeetingTitle: string | null = null;

// Conversation history for the floating chat (in-memory, per session)
let conversationHistory: Anthropic.MessageParam[] = [];

// Cache the Mom Test content
let momTestContent: string | null = null;
function getMomTestContent(): string {
  if (momTestContent) return momTestContent;
  try {
    // Try multiple paths (dev vs packaged)
    const paths = [
      path.resolve(__dirname, '../../MOM_TEST_SKILL.md'),
      path.resolve(__dirname, '../../../MOM_TEST_SKILL.md'),
      path.resolve(process.cwd(), 'MOM_TEST_SKILL.md'),
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) {
        momTestContent = fs.readFileSync(p, 'utf-8');
        return momTestContent;
      }
    }
  } catch { /* ignore */ }
  return '(Mom Test framework file not found)';
}

function getTranscriptText(transcript: TranscriptEntry[]): string {
  return transcript.map((entry) => {
    const speaker = entry.participant?.name || 'Unknown';
    const text = entry.words.map((w) => w.text).join(' ');
    return `${speaker}: ${text}`;
  }).join('\n');
}

async function fetchCurrentTranscript(eventId: string): Promise<string> {
  const live = getLiveTranscript(eventId);
  if (live) return live;

  const db = getDb();
  const row = db.prepare('SELECT recall_bot_id FROM meeting_bots WHERE google_event_id = ?').get(eventId) as
    | { recall_bot_id: string } | undefined;

  if (!row?.recall_bot_id) return '(No transcript available yet — bot may still be joining)';

  try {
    const transcript = await getBotTranscript(row.recall_bot_id);
    return transcript.length > 0 ? getTranscriptText(transcript) : '(No transcript content available yet)';
  } catch {
    return '(No transcript available yet)';
  }
}

function buildSystemPrompt(meetingTitle: string): string {
  return `You are a meeting assistant for: "${meetingTitle}".

You help the user during or after their meeting. The current transcript is provided in context with each message.

You have a tool available: get_mom_test_framework. Use it ONLY when the user explicitly asks about the Mom Test, interview techniques, or customer conversation best practices. Do NOT use it proactively.

Guidelines:
- Be concise and helpful
- Reference specific parts of the conversation when relevant
- Help with summarization, action items, follow-up questions, and insights
- Format responses in short paragraphs, use bullet points for lists`;
}

const CHAT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_mom_test_framework',
    description: 'Retrieves the Mom Test framework for customer interview best practices. Use when the user asks about interview techniques, question formulation, or the Mom Test methodology.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];

// ── Tip Generator ────────────────────────────────────────────────────

async function generateTip(eventId: string, meetingTitle: string): Promise<void> {
  if (!floatingWindow || floatingWindow.isDestroyed()) return;

  const transcript = await fetchCurrentTranscript(eventId);
  if (!transcript || transcript.startsWith('(')) return; // No transcript yet

  tipAbortController = new AbortController();

  try {
    const client = new Anthropic();
    const response = await client.messages.create(
      {
        model: process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 150,
        system: `You are a real-time meeting coach. Based on the conversation transcript and the Mom Test framework below, generate a single short tip (1-2 sentences max) for the user. The tip should be a suggested question to ask, an observation about the conversation, or a Mom Test principle to apply right now. Be specific to what's being discussed. If not enough context, give a generic icebreaker or conversation starter. Output ONLY the tip text, nothing else.

${getMomTestContent()}`,
        messages: [{
          role: 'user',
          content: `Meeting: "${meetingTitle}"\n\nCurrent transcript:\n${transcript}`,
        }],
      },
      { signal: tipAbortController.signal }
    );

    let tip = '';
    for (const block of response.content) {
      if (block.type === 'text') tip += block.text;
    }

    if (tip && floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.webContents.send('meeting-chat:event', { type: 'tip', content: tip.trim() });
    }
  } catch {
    // Silently ignore tip generation errors
  } finally {
    tipAbortController = null;
  }
}

// ── Window Management ────────────────────────────────────────────────

export function openMeetingChat(eventId: string, meetingTitle: string, meetingUrl: string | null) {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    if (currentEventId === eventId) {
      floatingWindow.focus();
      return;
    }
    floatingWindow.close();
  }

  currentEventId = eventId;
  currentMeetingTitle = meetingTitle;
  conversationHistory = [];

  floatingWindow = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: 320,
    minHeight: 400,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    hasShadow: true,
    roundedCorners: true,
    type: 'toolbar',
    skipTaskbar: true,
    // macOS-specific frosted glass
    ...(process.platform === 'darwin' ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
    backgroundColor: '#00000000',
    title: meetingTitle,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  floatingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getFloatingChatHTML(meetingTitle, meetingUrl))}`);

  // Start tip generation every 25 seconds
  tipInterval = setInterval(() => {
    if (currentEventId) generateTip(currentEventId, meetingTitle);
  }, 25000);

  floatingWindow.on('closed', () => {
    floatingWindow = null;
    currentEventId = null;
    conversationHistory = [];
    if (abortController) { abortController.abort(); abortController = null; }
    if (tipAbortController) { tipAbortController.abort(); tipAbortController = null; }
    if (tipInterval) { clearInterval(tipInterval); tipInterval = null; }
  });
}

export function closeMeetingChat() {
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.close();
  }
}

// ── IPC Handlers ─────────────────────────────────────────────────────

export function registerMeetingChatHandlers() {
  ipcMain.handle('meeting-chat:send', async (event, message: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !currentEventId) return;

    abortController = new AbortController();
    const signal = abortController.signal;

    const client = new Anthropic();
    const systemPrompt = buildSystemPrompt(win.title || 'Meeting');
    const transcript = await fetchCurrentTranscript(currentEventId);
    const contextBlock = `<current_transcript>\n${transcript}\n</current_transcript>\n\n`;

    conversationHistory.push({ role: 'user', content: contextBlock + message });
    win.webContents.send('meeting-chat:event', { type: 'thinking' });

    try {
      let messages = [...conversationHistory];
      let fullText = '';
      let iterations = 0;

      // Agentic loop for tool calls
      while (iterations < 5) {
        iterations++;
        const response = await client.messages.create(
          {
            model: process.env.ANTHROPIC_CHAT_MODEL || 'claude-sonnet-4-20250514',
            max_tokens: 2048,
            system: systemPrompt,
            tools: CHAT_TOOLS,
            messages,
          },
          { signal }
        );

        const toolBlocks: Anthropic.ContentBlock[] = [];
        for (const block of response.content) {
          if (block.type === 'text') fullText += block.text;
          else if (block.type === 'tool_use') toolBlocks.push(block);
        }

        if (toolBlocks.length === 0 || response.stop_reason === 'end_turn') break;

        // Execute tools
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolBlocks) {
          if (block.type !== 'tool_use') continue;
          let result = '';
          if (block.name === 'get_mom_test_framework') {
            result = getMomTestContent();
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }

        messages = [
          ...messages,
          { role: 'assistant' as const, content: response.content },
          { role: 'user' as const, content: toolResults },
        ];
        fullText = ''; // Reset, final text comes from next iteration
      }

      // Store clean user message in history
      conversationHistory[conversationHistory.length - 1] = { role: 'user', content: message };
      conversationHistory.push({ role: 'assistant', content: fullText });

      win.webContents.send('meeting-chat:event', { type: 'message', content: fullText });
    } catch (err: unknown) {
      if (!signal.aborted) {
        win.webContents.send('meeting-chat:event', { type: 'error', message: (err as Error).message });
      }
    } finally {
      abortController = null;
    }
  });

  ipcMain.handle('meeting-chat:cancel', async () => {
    if (abortController) abortController.abort();
  });

  ipcMain.handle('meeting-chat:refresh-tip', async () => {
    if (!currentEventId || !currentMeetingTitle) return;
    // Reset the timer
    if (tipInterval) clearInterval(tipInterval);
    tipInterval = setInterval(() => {
      if (currentEventId && currentMeetingTitle) generateTip(currentEventId, currentMeetingTitle);
    }, 25000);
    // Generate immediately
    generateTip(currentEventId, currentMeetingTitle);
  });
}

// ── HTML Template ────────────────────────────────────────────────────

function getFloatingChatHTML(title: string, meetingUrl: string | null): string {
  const escapedTitle = title.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const joinButton = meetingUrl
    ? `<button id="join-btn" onclick="window.api.invoke('shell:open-external', '${meetingUrl.replace(/'/g, "\\'")}')" style="background:none;border:1px solid #3A3A44;color:#9C9890;font-family:monospace;font-size:10px;padding:4px 8px;cursor:pointer;text-transform:uppercase;letter-spacing:0.05em;">Join</button>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: transparent; }
  body { color: #F0EDE8; font-family: -apple-system, system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  #window { flex: 1; display: flex; flex-direction: column; overflow: hidden; margin: 8px; border-radius: 14px; background: rgba(30, 30, 35, 0.78); backdrop-filter: blur(40px) saturate(1.4); -webkit-backdrop-filter: blur(40px) saturate(1.4); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04); }
  #titlebar { -webkit-app-region: drag; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  #titlebar .title { font-family: monospace; font-size: 11px; color: #E8A838; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  #titlebar .actions { display: flex; gap: 6px; -webkit-app-region: no-drag; }
  #titlebar button { background: none; border: none; color: rgba(255,255,255,0.35); cursor: pointer; padding: 2px; }
  #titlebar button:hover { color: #F0EDE8; }
  #tip-bar { padding: 8px 14px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px; line-height: 1.4; min-height: 36px; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  #tip-bar .label { font-family: monospace; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.3); flex-shrink: 0; }
  #tip-bar .text { color: rgba(255,255,255,0.6); flex: 1; }
  #tip-bar .refresh { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; padding: 2px; flex-shrink: 0; transition: color 0.15s; }
  #tip-bar .refresh:hover { color: #E8A838; }
  #messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .msg { padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; max-width: 90%; word-wrap: break-word; }
  .msg.user { background: rgba(232,168,56,0.18); align-self: flex-end; color: #F0EDE8; }
  .msg.assistant { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.06); align-self: flex-start; color: rgba(255,255,255,0.75); }
  .msg.assistant p { margin: 0 0 8px 0; } .msg.assistant p:last-child { margin-bottom: 0; }
  .msg.assistant ul, .msg.assistant ol { margin: 4px 0 8px 18px; padding: 0; } .msg.assistant li { margin: 2px 0; }
  .msg.assistant strong { color: #F0EDE8; }
  .msg.assistant code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .msg.assistant pre { background: rgba(255,255,255,0.04); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
  .msg.assistant pre code { padding: 0; background: none; }
  .msg.thinking { color: rgba(255,255,255,0.35); font-style: italic; font-size: 12px; }
  .msg.error { color: #E87B6B; font-size: 12px; }
  #input-area { padding: 10px 14px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 8px; flex-shrink: 0; }
  #input { flex: 1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; color: #F0EDE8; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; resize: none; }
  #input:focus { border-color: rgba(232,168,56,0.35); }
  #send-btn { background: rgba(232,168,56,0.85); border: none; border-radius: 8px; color: #07070A; padding: 8px 14px; font-family: monospace; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; cursor: pointer; }
  #send-btn:hover { background: rgba(232,168,56,1); }
  #send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
</head>
<body>
  <div id="window">
  <div id="titlebar">
    <span class="title">${escapedTitle}</span>
    <div class="actions">
      ${joinButton}
      <button onclick="window.close()" title="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
  </div>
  <div id="tip-bar">
    <span class="label">Tip</span>
    <span class="text" id="tip-text">Start with an open-ended question about their current workflow.</span>
    <button class="refresh" onclick="window.api.invoke('meeting-chat:refresh-tip')" title="New tip">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg>
    </button>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask about this meeting..."></textarea>
    <button id="send-btn" onclick="sendMessage()">Send</button>
  </div>
  </div>
  <script>
    const messages = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const tipText = document.getElementById('tip-text');
    let sending = false;

    function md(text) {
      let html = text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
      html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>');
      html = html.replace(/<\\/ul>\\s*<ul>/g, '');
      html = html.split(/\\n\\n+/).map(function(p) {
        p = p.trim();
        if (!p || p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<pre')) return p;
        return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
      }).join('');
      return html;
    }

    function addMessage(role, text, isHtml) {
      var div = document.createElement('div');
      div.className = 'msg ' + role;
      if (isHtml) { div.innerHTML = text; } else { div.textContent = text; }
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
      return div;
    }

    function sendMessage() {
      var text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      sendBtn.disabled = true;
      addMessage('user', text, false);
      input.value = '';
      window.api.invoke('meeting-chat:send', text);
    }

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    window.api.on('meeting-chat:event', function(event) {
      if (event.type === 'thinking') {
        addMessage('thinking', 'Thinking...', false);
      } else if (event.type === 'message') {
        var thinking = messages.querySelector('.thinking');
        if (thinking) thinking.remove();
        addMessage('assistant', md(event.content), true);
        sending = false;
        sendBtn.disabled = false;
      } else if (event.type === 'error') {
        var thinking2 = messages.querySelector('.thinking');
        if (thinking2) thinking2.remove();
        addMessage('error', 'Error: ' + event.message, false);
        sending = false;
        sendBtn.disabled = false;
      } else if (event.type === 'tip') {
        tipText.textContent = event.content;
      }
    });

    input.focus();
  </script>
</body>
</html>`;
}
