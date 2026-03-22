import { ipcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';

export function registerContactHandlers() {
  ipcMain.handle('contacts:list', async (_e, params?: { search?: string }) => {
    const db = getDb();
    if (params?.search) {
      const q = `%${params.search.toLowerCase()}%`;
      return db.prepare(
        'SELECT * FROM contacts WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ? ORDER BY name ASC'
      ).all(q, q);
    }
    return db.prepare('SELECT * FROM contacts ORDER BY name ASC').all();
  });

  ipcMain.handle('contacts:get', async (_e, id: string) => {
    const db = getDb();
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) || null;
  });

  ipcMain.handle('contacts:create', async (_e, data: { name: string; email: string; job_title?: string; project?: string }) => {
    const db = getDb();
    const id = uuid();
    db.prepare(
      'INSERT INTO contacts (id, name, email, job_title, project) VALUES (?, ?, ?, ?, ?)'
    ).run(id, data.name, data.email.toLowerCase(), data.job_title || null, data.project || null);
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  });

  ipcMain.handle('contacts:update', async (_e, data: { id: string; name?: string; email?: string; job_title?: string; project?: string; profile_summary?: string }) => {
    const db = getDb();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name); }
    if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email.toLowerCase()); }
    if (data.job_title !== undefined) { fields.push('job_title = ?'); values.push(data.job_title); }
    if (data.project !== undefined) { fields.push('project = ?'); values.push(data.project); }
    if (data.profile_summary !== undefined) { fields.push('profile_summary = ?'); values.push(data.profile_summary); }
    fields.push("updated_at = datetime('now')");
    values.push(data.id);
    db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return db.prepare('SELECT * FROM contacts WHERE id = ?').get(data.id);
  });

  ipcMain.handle('contacts:get-by-email', async (_e, email: string) => {
    const db = getDb();
    return db.prepare('SELECT * FROM contacts WHERE email = ?').get(email.toLowerCase()) || null;
  });
}
