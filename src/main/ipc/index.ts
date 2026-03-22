import { ipcMain, shell } from 'electron';
import { getDb } from '../db';
import { registerGoogleAuthHandlers } from './google-auth';
import { registerCalendarHandlers } from './calendar';
import { registerMeetingHandlers } from './meetings';
import { registerLinearHandlers } from './linear';
import { registerChatHandlers } from './chat';
import { registerContactHandlers } from './contacts';
import { registerPrepNotesHandlers } from './prep-notes';
import { registerPrepChatHandlers } from './prep-chat';
import { registerRepoHandlers } from './repos';
import { registerBuildHandlers } from './builds';
import { openMeetingChat, registerMeetingChatHandlers } from '../services/meeting-chat';

export function registerAllHandlers() {
  // Real settings handlers
  ipcMain.handle('settings:get', async (_e, key?: string) => {
    const db = getDb();
    if (key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value ?? null;
    }
    const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  });

  ipcMain.handle('settings:set', async (_e, key: string, value: string) => {
    const db = getDb();
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
    return { success: true };
  });

  ipcMain.handle('shell:open-external', async (_e, url: string) => {
    await shell.openExternal(url);
  });

  // Google Auth handlers
  registerGoogleAuthHandlers();

  // Calendar handlers
  registerCalendarHandlers();

  // Meeting / transcript handlers
  registerMeetingHandlers();

  // Linear handlers
  registerLinearHandlers();

  // Chat handlers
  registerChatHandlers();

  // Contacts + Prep notes + Prep chat handlers
  registerContactHandlers();
  registerPrepNotesHandlers();
  registerPrepChatHandlers();

  // Meeting chat floating window
  ipcMain.handle('meeting-chat:open', async (_e, data: { eventId: string; title: string; meetingUrl: string | null }) => {
    openMeetingChat(data.eventId, data.title, data.meetingUrl);
  });
  registerMeetingChatHandlers();

  // Repo handlers
  registerRepoHandlers();

  // Build handlers
  registerBuildHandlers();

  console.log('IPC handlers registered');
}
