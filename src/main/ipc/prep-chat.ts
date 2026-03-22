import { ipcMain, BrowserWindow } from 'electron';
import { getDb } from '../db';
import { runPrepAgent, cancelPrepAgent } from '../agent/prep-agent';

export function registerPrepChatHandlers() {
  ipcMain.handle('prep-chat:send', async (event, data: { message: string; googleEventId: string; meetingTitle: string; meetingDate: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    runPrepAgent(win, data.message, data.googleEventId, data.meetingTitle, data.meetingDate).catch((err) => {
      console.error('Prep agent error:', err);
      if (!win.isDestroyed()) {
        win.webContents.send('prep-chat:stream-event', { type: 'error', message: err.message || 'Unknown error' });
      }
    });
  });

  ipcMain.handle('prep-chat:cancel', async () => {
    cancelPrepAgent();
  });

  ipcMain.handle('prep-chat:get-history', async (_e, googleEventId: string) => {
    const db = getDb();
    return db.prepare(
      'SELECT id, role, content, created_at FROM prep_chat_messages WHERE google_event_id = ? ORDER BY created_at ASC'
    ).all(googleEventId);
  });

  ipcMain.handle('prep-chat:clear-history', async (_e, googleEventId: string) => {
    const db = getDb();
    db.prepare('DELETE FROM prep_chat_messages WHERE google_event_id = ?').run(googleEventId);
  });
}
