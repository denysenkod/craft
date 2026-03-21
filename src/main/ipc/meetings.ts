import { ipcMain } from 'electron';
import { getBotTranscript, getBotStatus, mapBotStatus, TranscriptEntry } from '../services/recall';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';

export function registerMeetingHandlers() {
  ipcMain.handle('meeting:fetch-transcript', async (_e, googleEventId: string, meetingTitle?: string) => {
    const db = getDb();

    // 1. Check cache — if transcript already persisted, return from DB
    const botRow = db.prepare(
      'SELECT recall_bot_id, transcript_id FROM meeting_bots WHERE google_event_id = ?'
    ).get(googleEventId) as { recall_bot_id: string; transcript_id: string | null } | undefined;

    if (!botRow?.recall_bot_id) {
      throw new Error('No Recall bot found for this meeting');
    }

    if (botRow.transcript_id) {
      // Cache hit — load from DB
      const transcript = db.prepare(
        'SELECT t.id, t.meeting_id, t.transcript_json FROM transcripts t WHERE t.id = ?'
      ).get(botRow.transcript_id) as { id: string; meeting_id: string; transcript_json: string } | undefined;

      if (transcript) {
        return {
          status: 'done',
          transcript: JSON.parse(transcript.transcript_json),
          transcriptId: transcript.id,
          meetingId: transcript.meeting_id,
        };
      }
    }

    // 2. Fetch from Recall
    const botId = botRow.recall_bot_id;
    const bot = await getBotStatus(botId);
    const status = mapBotStatus(bot);

    if (status !== 'done') {
      return { status, transcript: [], message: 'Transcript not available yet. Bot is still ' + status };
    }

    const transcriptEntries: TranscriptEntry[] = await getBotTranscript(botId);

    // 3. Persist to DB in a transaction
    const meetingId = uuid();
    const transcriptId = uuid();

    // Flatten to raw_text for agent consumption
    const rawText = transcriptEntries.map((entry) => {
      const speaker = entry.participant?.name || 'Unknown';
      const text = entry.words.map((w) => w.text).join(' ');
      const time = entry.words[0]?.start_timestamp?.relative ?? 0;
      const m = Math.floor(time / 60);
      const s = Math.floor(time % 60);
      return `[${m}:${s.toString().padStart(2, '0')}] ${speaker}: ${text}`;
    }).join('\n');

    db.transaction(() => {
      // Create meeting row
      db.prepare(
        'INSERT INTO meetings (id, title, meeting_url, recall_bot_id, status, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
      ).run(meetingId, meetingTitle || 'Untitled Meeting', null, botId, 'done');

      // Insert transcript
      db.prepare(
        'INSERT INTO transcripts (id, meeting_id, raw_text, transcript_json, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
      ).run(transcriptId, meetingId, rawText, JSON.stringify(transcriptEntries));

      // Update meeting_bots with transcript_id for future cache lookups
      db.prepare(
        'UPDATE meeting_bots SET transcript_id = ? WHERE google_event_id = ?'
      ).run(transcriptId, googleEventId);
    })();

    return {
      status: 'done',
      transcript: transcriptEntries,
      transcriptId,
      meetingId,
    };
  });

  ipcMain.handle('transcript:get', async (_e, transcriptId: string) => {
    const db = getDb();
    const row = db.prepare(
      'SELECT id, meeting_id, raw_text, transcript_json, analysis_json, created_at FROM transcripts WHERE id = ?'
    ).get(transcriptId) as { id: string; meeting_id: string; raw_text: string; transcript_json: string | null; analysis_json: string | null; created_at: string } | undefined;

    if (!row) return null;

    return {
      ...row,
      transcript_json: row.transcript_json ? JSON.parse(row.transcript_json) : null,
    };
  });
}
