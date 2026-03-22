import { ipcMain } from 'electron';
import { getDb } from '../db';
import { v4 as uuid } from 'uuid';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

export function registerRepoHandlers() {
  ipcMain.handle('repo:list', async () => {
    const db = getDb();
    return db.prepare('SELECT * FROM repos ORDER BY name').all();
  });

  ipcMain.handle('repo:add', async (_e, data: {
    name: string;
    path: string;
    github_url?: string;
    default_branch?: string;
  }) => {
    const db = getDb();
    const id = uuid();
    db.prepare(
      'INSERT INTO repos (id, name, path, github_url, default_branch) VALUES (?, ?, ?, ?, ?)'
    ).run(id, data.name, data.path, data.github_url || null, data.default_branch || 'main');
    return { id, ...data };
  });

  ipcMain.handle('repo:remove', async (_e, id: string) => {
    const db = getDb();
    db.prepare('DELETE FROM repos WHERE id = ?').run(id);
    return { success: true };
  });

  ipcMain.handle('repo:validate', async (_e, repoPath: string) => {
    if (!existsSync(repoPath)) {
      return { valid: false, error: 'Path does not exist' };
    }
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, stdio: 'pipe' });
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: repoPath, stdio: 'pipe' }).toString().trim();
      return { valid: true, currentBranch: branch };
    } catch {
      return { valid: false, error: 'Not a git repository' };
    }
  });
}
