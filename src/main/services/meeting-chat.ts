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

function buildSystemPrompt(meetingTitle: string, eventId: string): string {
  let prompt = `You are a meeting assistant for: "${meetingTitle}".

You help the user during or after their meeting. The current transcript is provided in context with each message.

You have a tool available: get_mom_test_framework. Use it ONLY when the user explicitly asks about the Mom Test, interview techniques, or customer conversation best practices. Do NOT use it proactively.

Guidelines:
- Be concise and helpful
- Reference specific parts of the conversation when relevant
- Help with summarization, action items, follow-up questions, and insights
- Format responses in short paragraphs, use bullet points for lists`;

  // Inject prep notes if available
  try {
    const db = getDb();
    const prepRow = db.prepare('SELECT notes_json FROM meeting_prep_notes WHERE google_event_id = ?').get(eventId) as { notes_json: string } | undefined;
    if (prepRow) {
      const notes = JSON.parse(prepRow.notes_json) as Array<{ text: string; type: string }>;
      if (notes.length > 0) {
        prompt += '\n\n<prep_notes>\nThe user prepared these before the meeting:\n';
        notes.forEach((n, i) => { prompt += `${i + 1}. [${n.type}] ${n.text}\n`; });
        prompt += 'Help them address these topics during the conversation.\n</prep_notes>';
      }
    }

    // Inject attendee profiles
    const attendees = db.prepare(
      'SELECT c.name, c.email, c.job_title, c.profile_summary FROM meeting_attendees ma JOIN contacts c ON ma.contact_id = c.id WHERE ma.google_event_id = ?'
    ).all(eventId) as Array<{ name: string; email: string; job_title: string | null; profile_summary: string | null }>;
    if (attendees.length > 0) {
      prompt += '\n\n<attendee_profiles>\n';
      attendees.forEach((a) => {
        prompt += `- ${a.name} (${a.email})`;
        if (a.job_title) prompt += ` — ${a.job_title}`;
        if (a.profile_summary) prompt += `\n  Profile: ${a.profile_summary}`;
        prompt += '\n';
      });
      prompt += '</attendee_profiles>';
    }
  } catch { /* ignore DB errors in prompt building */ }

  return prompt;
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

  // Load prep notes for this meeting
  let prepNotes: Array<{ id: string; text: string; type: string }> = [];
  try {
    const db = getDb();
    const prepRow = db.prepare('SELECT notes_json FROM meeting_prep_notes WHERE google_event_id = ?').get(eventId) as { notes_json: string } | undefined;
    if (prepRow) {
      prepNotes = JSON.parse(prepRow.notes_json);
    }
  } catch { /* ignore */ }

  floatingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getFloatingChatHTML(meetingTitle, meetingUrl, prepNotes))}`);

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
    const systemPrompt = buildSystemPrompt(win.title || 'Meeting', currentEventId);
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
          win.webContents.send('meeting-chat:event', { type: 'tool_call', tool: block.name });
          let result = '';
          if (block.name === 'get_mom_test_framework') {
            result = getMomTestContent();
          }
          win.webContents.send('meeting-chat:event', { type: 'tool_result', tool: block.name });
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

function getFloatingChatHTML(title: string, meetingUrl: string | null, prepNotes: Array<{ id: string; text: string; type: string }> = []): string {
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
  body { color: #F0EDE8; font-family: 'Instrument Sans', -apple-system, system-ui, sans-serif; font-size: 14px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; -webkit-font-smoothing: antialiased; }
  #window { flex: 1; display: flex; flex-direction: column; overflow: hidden; margin: 8px; border-radius: 14px; background: rgba(30, 30, 35, 0.78); backdrop-filter: blur(40px) saturate(1.4); -webkit-backdrop-filter: blur(40px) saturate(1.4); border: 1px solid rgba(255,255,255,0.08); box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04); }
  #titlebar { -webkit-app-region: drag; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  #titlebar .title { font-size: 12px; color: #E8A838; font-weight: 600; }
  #titlebar .actions { display: flex; gap: 6px; -webkit-app-region: no-drag; }
  #titlebar button { background: none; border: none; color: rgba(255,255,255,0.35); cursor: pointer; padding: 2px; border-radius: 4px; }
  #titlebar button:hover { color: #F0EDE8; }
  #tip-bar { padding: 8px 14px; background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 12px; line-height: 1.4; min-height: 36px; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  #tip-bar .label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.3); flex-shrink: 0; }
  #tip-bar .text { color: rgba(255,255,255,0.6); flex: 1; }
  #tip-bar .refresh { background: none; border: none; color: rgba(255,255,255,0.25); cursor: pointer; padding: 2px; flex-shrink: 0; transition: color 0.15s; border-radius: 4px; }
  #tip-bar .refresh:hover { color: #E8A838; }
  /* Prep notes panel */
  #notes-panel { border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0; }
  #notes-toggle { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; cursor: pointer; background: none; border: none; width: 100%; color: rgba(255,255,255,0.4); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; }
  #notes-toggle:hover { color: rgba(255,255,255,0.6); }
  #notes-toggle .chevron { transition: transform 0.2s; }
  #notes-toggle .chevron.open { transform: rotate(180deg); }
  #notes-list { padding: 0 14px 10px; display: none; }
  #notes-list.open { display: block; }
  .note-item { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 6px; }
  .note-badge { width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; border-radius: 3px; flex-shrink: 0; margin-top: 1px; }
  .note-badge.q { background: rgba(232,168,56,0.1); color: #E8A838; border: 1px solid rgba(232,168,56,0.3); }
  .note-badge.n { background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.4); border: 1px solid rgba(255,255,255,0.08); }
  .note-text { font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.4; }
  .note-text.done { text-decoration: line-through; opacity: 0.4; }
  #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  /* User bubble — golden, rounded right */
  .bubble-wrap { display: flex; }
  .bubble-wrap.user { justify-content: flex-end; }
  .bubble-wrap.assistant { justify-content: flex-start; }
  .bubble { padding: 10px 14px; font-size: 13px; line-height: 1.55; max-width: 88%; word-wrap: break-word; }
  .bubble.user { background: #E8A838; color: #07070A; border-radius: 18px 18px 4px 18px; }
  .bubble.assistant { background: #1C1C22; color: #F0EDE8; border-radius: 18px 18px 18px 4px; }
  .bubble.assistant p { margin: 2px 0; }
  .bubble.assistant ul, .bubble.assistant ol { margin: 4px 0; padding-left: 18px; } .bubble.assistant li { margin: 2px 0; }
  .bubble.assistant strong { font-weight: 600; }
  .bubble.assistant code { background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 5px; font-size: 12px; font-family: monospace; }
  .bubble.assistant pre { background: rgba(0,0,0,0.3); border-radius: 8px; padding: 10px 12px; margin: 6px 0; font-size: 12px; font-family: monospace; overflow-x: auto; white-space: pre; }
  .bubble.assistant pre code { background: none; padding: 0; }
  .bubble.assistant h2, .bubble.assistant h3 { font-size: 14px; font-weight: 600; margin: 8px 0 4px; }
  /* Thinking indicator */
  .status-wrap { display: flex; flex-direction: column; gap: 4px; align-self: flex-start; }
  .tool-done { display: flex; align-items: center; gap: 6px; padding: 4px 14px; font-size: 12px; color: rgba(255,255,255,0.4); }
  .tool-done-dot { width: 6px; height: 6px; border-radius: 50%; background: #5CC9A0; flex-shrink: 0; }
  .thinking-indicator { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 18px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }
  .thinking-dot { width: 6px; height: 6px; border-radius: 50%; background: #E8A838; }
  .thinking-dot.bounce-y { animation: thinkBounce 1.4s ease-in-out infinite; }
  .thinking-dot.bounce-x { animation: toolBounce 0.8s ease-in-out infinite; }
  .thinking-text { font-size: 12px; color: rgba(255,255,255,0.4); }
  .error { font-size: 12px; color: #E87B6B; padding: 8px 14px; align-self: flex-start; }
  @keyframes thinkBounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
    30% { transform: translateY(-4px); opacity: 1; }
  }
  @keyframes toolBounce {
    0%, 100% { transform: translateX(0); opacity: 0.4; }
    50% { transform: translateX(4px); opacity: 1; }
  }
  /* Input area — matches ChatInterface style */
  #input-wrap { margin: 0 10px 10px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); overflow: hidden; position: relative; }
  #input { width: 100%; background: transparent; border: none; color: #F0EDE8; padding: 12px 14px 36px; font-size: 13px; font-family: inherit; outline: none; resize: none; }
  #input::placeholder { color: rgba(255,255,255,0.3); }
  #input-buttons { position: absolute; bottom: 6px; right: 6px; display: flex; gap: 6px; }
  .send-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: none; cursor: pointer; transition: background 0.15s; }
  .send-btn.active { background: #E8A838; }
  .send-btn.inactive { background: rgba(255,255,255,0.08); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .cancel-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: none; cursor: pointer; background: rgba(232,107,107,0.15); }
  .cancel-btn:hover { background: rgba(232,107,107,0.3); }
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
  ${prepNotes.length > 0 ? `
  <div id="notes-panel">
    <button id="notes-toggle" onclick="toggleNotes()">
      <span>Prep Notes (${prepNotes.length})</span>
      <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div id="notes-list">
      ${prepNotes.map((n) => `
        <div class="note-item" data-id="${n.id}">
          <span class="note-badge ${n.type === 'question' ? 'q' : 'n'}">${n.type === 'question' ? 'Q' : 'N'}</span>
          <span class="note-text" onclick="this.classList.toggle('done')">${n.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}
  <div id="messages"></div>
  <div id="input-wrap">
    <textarea id="input" rows="1" placeholder="Ask about this meeting..."></textarea>
    <div id="input-buttons">
      <button id="send-btn" class="send-btn inactive" onclick="sendMessage()" disabled>
        <svg width="14" height="14" fill="none" stroke="#5E5B54" stroke-width="2" viewBox="0 0 24 24"><path d="M12 19V5m0 0l-5 5m5-5l5 5"/></svg>
      </button>
    </div>
  </div>
  </div>
  <script>
    var messages = document.getElementById('messages');
    var input = document.getElementById('input');
    var sendBtn = document.getElementById('send-btn');
    var tipText = document.getElementById('tip-text');
    var sending = false;

    function toggleNotes() {
      var list = document.getElementById('notes-list');
      var chevron = document.querySelector('#notes-toggle .chevron');
      if (list && chevron) {
        list.classList.toggle('open');
        chevron.classList.toggle('open');
      }
    }
    var toolLabels = {
      get_transcript: 'Read transcript', search_transcripts: 'Searched transcripts',
      get_meeting: 'Looked up meeting', list_meetings: 'Checked meetings',
      get_task: 'Looked up task', list_tasks: 'Searched tasks',
      create_task: 'Drafted task', update_task: 'Prepared update',
      get_contact: 'Looked up contact', list_contacts: 'Listed contacts',
      get_mom_test_framework: 'Loaded Mom Test',
    };
    var completedTools = [];

    // Update send button appearance
    input.addEventListener('input', function() {
      var hasText = input.value.trim().length > 0;
      sendBtn.className = 'send-btn ' + (hasText ? 'active' : 'inactive');
      sendBtn.disabled = !hasText || sending;
      sendBtn.querySelector('svg').setAttribute('stroke', hasText ? '#07070A' : '#5E5B54');
    });

    function md(text) {
      var html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      // Code blocks
      html = html.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(m, code) { return '<pre><code>' + code.replace(/^\\w*\\n/, '') + '</code></pre>'; });
      html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
      html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
      html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
      html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
      // Lists
      html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
      html = html.replace(/(<li>[\\s\\S]*?<\\/li>)/g, '<ul>$1</ul>');
      html = html.replace(/<\\/ul>\\s*<ul>/g, '');
      // Paragraphs
      html = html.split(/\\n\\n+/).map(function(p) {
        p = p.trim();
        if (!p || p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<pre')) return p;
        return '<p>' + p.replace(/\\n/g, '<br>') + '</p>';
      }).join('');
      return html;
    }

    function addBubble(role, text, isHtml) {
      var wrap = document.createElement('div');
      wrap.className = 'bubble-wrap ' + role;
      var bubble = document.createElement('div');
      bubble.className = 'bubble ' + role;
      if (isHtml) { bubble.innerHTML = text; } else { bubble.textContent = text; }
      wrap.appendChild(bubble);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
      return wrap;
    }

    function showStatus(label, isTool) {
      removeStatus();
      var wrap = document.createElement('div');
      wrap.className = 'status-wrap';
      wrap.id = 'status-wrap';
      // Show completed tools
      completedTools.forEach(function(t) {
        var d = document.createElement('div');
        d.className = 'tool-done';
        d.innerHTML = '<span class="tool-done-dot"></span>' + t;
        wrap.appendChild(d);
      });
      // Active indicator
      var div = document.createElement('div');
      div.className = 'thinking-indicator';
      div.innerHTML = '<span class="thinking-text">' + label + '</span><span class="thinking-dot ' + (isTool ? 'bounce-x' : 'bounce-y') + '"></span>';
      wrap.appendChild(div);
      messages.appendChild(wrap);
      messages.scrollTop = messages.scrollHeight;
    }

    function removeStatus() {
      var el = document.getElementById('status-wrap');
      if (el) el.remove();
    }

    function sendMessage() {
      var text = input.value.trim();
      if (!text || sending) return;
      sending = true;
      sendBtn.disabled = true;
      sendBtn.className = 'send-btn inactive';
      addBubble('user', text, false);
      input.value = '';
      window.api.invoke('meeting-chat:send', text);
    }

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    window.api.on('meeting-chat:event', function(event) {
      if (event.type === 'thinking') {
        completedTools = [];
        showStatus('Thinking...', false);
      } else if (event.type === 'tool_call') {
        var label = toolLabels[event.tool] || event.tool;
        showStatus(label + '...', true);
      } else if (event.type === 'tool_result') {
        var doneLabel = toolLabels[event.tool] || event.tool;
        completedTools.push(doneLabel);
        showStatus('Thinking...', false);
      } else if (event.type === 'message') {
        removeStatus();
        completedTools = [];
        addBubble('assistant', md(event.content), true);
        sending = false;
        sendBtn.disabled = false;
        input.dispatchEvent(new Event('input'));
      } else if (event.type === 'error') {
        removeStatus();
        completedTools = [];
        var div = document.createElement('div');
        div.className = 'error';
        div.textContent = 'Error: ' + event.message;
        messages.appendChild(div);
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
