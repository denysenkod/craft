import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';

export function registerPrepNotesHandlers() {
  ipcMain.handle('prep:get-notes', async (_e, googleEventId: string) => {
    const db = getDb();
    const row = db.prepare('SELECT notes_json FROM meeting_prep_notes WHERE google_event_id = ?').get(googleEventId) as
      | { notes_json: string } | undefined;
    return { notes_json: row?.notes_json || '[]' };
  });

  ipcMain.handle('prep:save-notes', async (_e, data: { googleEventId: string; notesJson: string }) => {
    const db = getDb();
    db.prepare(
      "INSERT INTO meeting_prep_notes (id, google_event_id, notes_json) VALUES (?, ?, ?) ON CONFLICT(google_event_id) DO UPDATE SET notes_json = excluded.notes_json, updated_at = datetime('now')"
    ).run(uuid(), data.googleEventId, data.notesJson);
    return { success: true };
  });

  ipcMain.handle('prep:get-attendees', async (_e, googleEventId: string) => {
    const db = getDb();
    return db.prepare(
      'SELECT c.* FROM meeting_attendees ma JOIN contacts c ON ma.contact_id = c.id WHERE ma.google_event_id = ?'
    ).all(googleEventId);
  });

  ipcMain.handle('prep:set-attendees', async (_e, data: { googleEventId: string; contactIds: string[] }) => {
    const db = getDb();
    db.transaction(() => {
      db.prepare('DELETE FROM meeting_attendees WHERE google_event_id = ?').run(data.googleEventId);
      const stmt = db.prepare('INSERT OR IGNORE INTO meeting_attendees (id, google_event_id, contact_id) VALUES (?, ?, ?)');
      for (const contactId of data.contactIds) {
        stmt.run(uuid(), data.googleEventId, contactId);
      }
    })();
    return { success: true };
  });
}
