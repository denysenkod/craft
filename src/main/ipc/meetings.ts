import { ipcMain } from 'electron';
import { getBotTranscript, getBotStatus, mapBotStatus, TranscriptEntry } from '../services/recall';
import { getDb } from '../db';

export function registerMeetingHandlers() {
  // Fetch and print transcript for a completed meeting
  ipcMain.handle('meeting:fetch-transcript', async (_e, googleEventId: string) => {
    const db = getDb();
    const row = db.prepare('SELECT recall_bot_id FROM meeting_bots WHERE google_event_id = ?').get(googleEventId) as
      | { recall_bot_id: string }
      | undefined;

    if (!row?.recall_bot_id) {
      throw new Error('No Recall bot found for this meeting');
    }

    const botId = row.recall_bot_id;

    // Check bot status first
    const bot = await getBotStatus(botId);
    const status = mapBotStatus(bot);

    if (status !== 'done') {
      return { status, transcript: [], message: 'Transcript not available yet. Bot is still ' + status };
    }

    const transcript: TranscriptEntry[] = await getBotTranscript(botId);

    // Print to terminal
    console.log(`\n=== Transcript for ${googleEventId} ===`);
    for (const entry of transcript) {
      const speaker = entry.participant?.name || 'Unknown';
      const text = entry.words.map((w) => w.text).join(' ');
      console.log(`${speaker}: ${text}`);
    }
    console.log(`=== End of transcript ===\n`);

    return { status: 'done', transcript };
  });
}
