import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { SCHEMA } from './schema';

let db: Database.Database;

export function initDb(): Database.Database {
  const dbPath = path.join(app.getPath('userData'), 'pm-tool.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

const CURRENT_VERSION = 1;

export function migrate() {
  const db = getDb();
  const version = db.pragma('user_version', { simple: true }) as number;

  if (version < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE chat_messages_new (
          id TEXT PRIMARY KEY,
          transcript_id TEXT REFERENCES transcripts(id),
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO chat_messages_new SELECT * FROM chat_messages;
        DROP TABLE chat_messages;
        ALTER TABLE chat_messages_new RENAME TO chat_messages;

        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY,
          transcript_id TEXT REFERENCES transcripts(id),
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          linear_issue_id TEXT,
          source TEXT NOT NULL DEFAULT 'auto',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO tasks_new SELECT * FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `);
      db.pragma(`user_version = ${CURRENT_VERSION}`);
    })();
  }
}
