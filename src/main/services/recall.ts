import { getDb } from '../db';

const RECALL_API_BASE = 'https://eu-central-1.recall.ai/api/v1';

function getApiKey(): string {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('recall_api_key') as { value: string } | undefined;
  if (!row?.value) {
    throw new Error('Recall.ai API key not configured. Set it in Settings.');
  }
  return row.value;
}

async function recallFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = getApiKey();
  const res = await fetch(`${RECALL_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Recall API error ${res.status}: ${body}`);
  }
  return res;
}

export interface RecallBot {
  id: string;
  status_changes: Array<{ code: string; created_at: string }>;
  meeting_url: { meeting_id: string; platform: string } | string;
  recordings?: Array<{
    id: string;
    status: { code: string };
    media_shortcuts?: {
      transcript?: {
        id: string;
        status: { code: string };
        data?: {
          download_url?: string;
        };
      };
    };
  }>;
}

export interface TranscriptEntry {
  participant: {
    id: number;
    name: string;
  };
  words: Array<{
    text: string;
    start_timestamp: { relative: number; absolute: string };
    end_timestamp: { relative: number; absolute: string };
  }>;
}

// Map Recall bot status_changes to our app status
export function mapBotStatus(bot: RecallBot): string {
  if (!bot.status_changes || bot.status_changes.length === 0) return 'scheduled';
  const latest = bot.status_changes[bot.status_changes.length - 1].code;

  switch (latest) {
    case 'ready':
    case 'joining_call':
    case 'in_waiting_room':
      return 'scheduled';
    case 'in_call_not_recording':
    case 'in_call_recording':
    case 'recording_permission_allowed':
      return 'recording';
    case 'call_ended':
    case 'recording_done':
    case 'done':
      return 'done';
    case 'fatal':
    case 'analysis_failed':
      return 'failed';
    default:
      return 'scheduled';
  }
}

export async function scheduleBot(meetingUrl: string, joinAt?: string, websocketUrl?: string): Promise<RecallBot> {
  const recordingConfig: Record<string, unknown> = {
    video_mixed_mp4: null,
    audio_mixed_mp3: {},
    transcript: {
      provider: {
        meeting_captions: {},
      },
    },
  };

  if (websocketUrl) {
    recordingConfig.realtime_endpoints = [{
      type: 'websocket',
      url: websocketUrl,
      events: ['transcript.data', 'transcript.partial_data'],
    }];
  }

  const body: Record<string, unknown> = {
    meeting_url: meetingUrl,
    bot_name: 'Craft Notetaker',
    recording_config: recordingConfig,
  };

  if (joinAt) {
    const joinTime = new Date(joinAt).getTime();
    const now = Date.now();
    if (joinTime - now > 10 * 60 * 1000) {
      body.join_at = joinAt;
    }
  }

  const res = await recallFetch('/bot', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json() as Promise<RecallBot>;
}

export async function getBotStatus(botId: string): Promise<RecallBot> {
  const res = await recallFetch(`/bot/${botId}`);
  return res.json() as Promise<RecallBot>;
}

export async function getBotTranscript(botId: string): Promise<TranscriptEntry[]> {
  const bot = await getBotStatus(botId);

  // Get transcript download URL from recordings
  const recording = bot.recordings?.[0];
  const downloadUrl = recording?.media_shortcuts?.transcript?.data?.download_url;

  if (downloadUrl) {
    const res = await fetch(downloadUrl);
    if (!res.ok) {
      throw new Error(`Failed to download transcript: ${res.status}`);
    }
    return res.json() as Promise<TranscriptEntry[]>;
  }

  // Transcript not available yet (bot still recording or processing)
  return [];
}

export async function deleteBot(botId: string): Promise<void> {
  await recallFetch(`/bot/${botId}`, { method: 'DELETE' });
}
