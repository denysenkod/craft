import { ipcMain } from 'electron';
import { listEvents, createEvent, getEvent } from '../services/google-calendar';
import { scheduleBot, getBotStatus, mapBotStatus } from '../services/recall';
import { startLiveTranscript, stopLiveTranscript } from '../services/live-transcript';
import { getDb } from '../db';

export function registerCalendarHandlers() {
  ipcMain.handle('calendar:list-events', async (_e, params?: { timeMin?: string; timeMax?: string }) => {
    try {
      const events = await listEvents(params?.timeMin, params?.timeMax);
      const db = getDb();

      const enriched = [];
      for (const event of events) {
        const botRow = db.prepare('SELECT recall_bot_id, status, error_message FROM meeting_bots WHERE google_event_id = ?').get(event.id) as
          | { recall_bot_id: string; status: string; error_message: string | null }
          | undefined;

        // Skip hidden (removed) events
        if (botRow?.status === 'hidden') continue;

        let botStatus = botRow?.status || null;
        const botError = botRow?.error_message || null;

        // Sync status from Recall API for bots not in a terminal state
        if (botRow?.recall_bot_id && botStatus && botStatus !== 'done' && botStatus !== 'failed') {
          try {
            const bot = await getBotStatus(botRow.recall_bot_id);
            const newStatus = mapBotStatus(bot);
            if (newStatus !== botStatus) {
              botStatus = newStatus;
              db.prepare('UPDATE meeting_bots SET status = ? WHERE google_event_id = ?').run(newStatus, event.id);

              // Clean up tunnel when bot is done
              if (newStatus === 'done' || newStatus === 'failed') {
                stopLiveTranscript(event.id);
              }
            }
          } catch (err: unknown) {
            console.error(`Failed to sync bot status for ${event.id}:`, (err as Error).message);
          }
        }

        enriched.push({
          ...event,
          recallBotId: botRow?.recall_bot_id || null,
          botStatus,
          botError,
        });
      }

      // Most recent first
      enriched.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
      return enriched;
    } catch (err: unknown) {
      const msg = (err as Error).message || '';
      if (msg.includes('Not authenticated') || msg.includes('sign in')) {
        return [];
      }
      console.error('calendar:list-events error:', err);
      throw err;
    }
  });

  ipcMain.handle('calendar:create-event', async (_e, params: {
    title: string;
    description?: string;
    attendees: string[];
    startDateTime: string;
    endDateTime: string;
    timeZone?: string;
  }) => {
    try {
      const event = await createEvent(params);
      return { ...event, recallBotId: null, botStatus: null, botError: null };
    } catch (err: unknown) {
      console.error('calendar:create-event error:', err);
      throw err;
    }
  });

  ipcMain.handle('calendar:send-bot', async (_e, googleEventId: string) => {
    try {
      const event = await getEvent(googleEventId);
      if (!event.meetingUrl) {
        throw new Error('No meeting URL found for this event. The event needs a Google Meet or Zoom link.');
      }

      // Start live transcript tunnel + WS server
      const wsUrl = await startLiveTranscript(googleEventId);

      // Create bot with the websocket endpoint for live transcripts
      const bot = await scheduleBot(event.meetingUrl, undefined, wsUrl);

      const db = getDb();
      db.prepare(
        'INSERT INTO meeting_bots (google_event_id, recall_bot_id, status) VALUES (?, ?, ?) ON CONFLICT(google_event_id) DO UPDATE SET recall_bot_id = excluded.recall_bot_id, status = excluded.status, error_message = NULL'
      ).run(googleEventId, bot.id, 'scheduled');

      return { success: true, recallBotId: bot.id };
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Unknown error';
      console.error('calendar:send-bot error:', errorMsg);
      stopLiveTranscript(googleEventId);

      const db = getDb();
      db.prepare(
        'INSERT INTO meeting_bots (google_event_id, recall_bot_id, status, error_message) VALUES (?, NULL, ?, ?) ON CONFLICT(google_event_id) DO UPDATE SET status = excluded.status, error_message = excluded.error_message'
      ).run(googleEventId, 'failed', errorMsg);

      throw err;
    }
  });

  ipcMain.handle('calendar:retry-bot', async (_e, googleEventId: string) => {
    try {
      const event = await getEvent(googleEventId);
      if (!event.meetingUrl) {
        throw new Error('No meeting URL found for this event');
      }

      const wsUrl = await startLiveTranscript(googleEventId);
      const bot = await scheduleBot(event.meetingUrl, event.start, wsUrl);

      const db = getDb();
      db.prepare(
        'UPDATE meeting_bots SET recall_bot_id = ?, status = ?, error_message = NULL WHERE google_event_id = ?'
      ).run(bot.id, 'scheduled', googleEventId);

      return { success: true, recallBotId: bot.id };
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'Unknown error';
      console.error('calendar:retry-bot error:', errorMsg);
      stopLiveTranscript(googleEventId);

      const db = getDb();
      db.prepare(
        'UPDATE meeting_bots SET error_message = ? WHERE google_event_id = ?'
      ).run(errorMsg, googleEventId);

      throw err;
    }
  });

  ipcMain.handle('calendar:remove-meeting', async (_e, googleEventId: string) => {
    const db = getDb();
    const botRow = db.prepare('SELECT recall_bot_id, status FROM meeting_bots WHERE google_event_id = ?').get(googleEventId) as
      | { recall_bot_id: string; status: string }
      | undefined;

    // Cancel the Recall bot if it's still active
    if (botRow?.recall_bot_id && botRow.status !== 'done' && botRow.status !== 'failed') {
      try {
        const { deleteBot } = require('../services/recall');
        await deleteBot(botRow.recall_bot_id);
      } catch (err: unknown) {
        console.error('Failed to cancel bot:', (err as Error).message);
      }
    }

    // Stop live transcript if running
    stopLiveTranscript(googleEventId);

    // Mark as hidden instead of deleting, so it doesn't reappear from Calendar
    db.prepare(
      'INSERT INTO meeting_bots (google_event_id, status) VALUES (?, ?) ON CONFLICT(google_event_id) DO UPDATE SET status = excluded.status, recall_bot_id = NULL, error_message = NULL'
    ).run(googleEventId, 'hidden');

    return { success: true };
  });
}
