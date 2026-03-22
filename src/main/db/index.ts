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

  // Migrate: add error_message column if missing (added after initial schema)
  const cols = db.pragma('table_info(meeting_bots)') as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === 'error_message')) {
    db.exec('ALTER TABLE meeting_bots ADD COLUMN error_message TEXT');
  }

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

const CURRENT_VERSION = 3;

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
        INSERT INTO chat_messages_new(id, transcript_id, role, content, created_at) SELECT id, transcript_id, role, content, created_at FROM chat_messages;
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
        INSERT INTO tasks_new(id, transcript_id, title, description, status, linear_issue_id, source, created_at) SELECT id, transcript_id, title, description, status, linear_issue_id, source, created_at FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `);
      db.pragma('user_version = 1');
    })();
  }

  if (version < 2) {
    db.transaction(() => {
      // Upstream: chat sessions, transcript_json, meeting_bots transcript_id
      db.exec(`CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      const chatCols = db.pragma('table_info(chat_messages)') as Array<{ name: string }>;
      if (!chatCols.some(c => c.name === 'session_id')) {
        db.exec(`ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE`);
      }

      const transcriptCols = db.pragma('table_info(transcripts)') as Array<{ name: string }>;
      if (!transcriptCols.some(c => c.name === 'transcript_json')) {
        db.exec(`ALTER TABLE transcripts ADD COLUMN transcript_json TEXT`);
      }

      const botCols = db.pragma('table_info(meeting_bots)') as Array<{ name: string }>;
      if (!botCols.some(c => c.name === 'transcript_id')) {
        db.exec(`ALTER TABLE meeting_bots ADD COLUMN transcript_id TEXT`);
      }

      db.exec(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)`);

      // Seed mock contacts
      const contacts = [
        { id: 'c-001', name: 'Sarah Chen', email: 'sarah.chen@acmecorp.com', job_title: 'VP of Sales', project: 'Enterprise Onboarding' },
        { id: 'c-002', name: 'Marcus Rivera', email: 'marcus@riveratech.io', job_title: 'CTO', project: 'Platform API' },
        { id: 'c-003', name: 'Lena Kowalski', email: 'lena.k@dataflow.co', job_title: 'Product Manager', project: 'API Integration' },
        { id: 'c-004', name: 'Tom Nguyen', email: 'tom.nguyen@designlabs.com', job_title: 'Head of Design', project: 'Dashboard Redesign' },
        { id: 'c-005', name: 'Priya Sharma', email: 'priya@cloudnine.dev', job_title: 'Engineering Lead', project: 'Infrastructure' },
        { id: 'c-006', name: 'James O\'Brien', email: 'james.obrien@finserv.com', job_title: 'Customer Success Manager', project: 'Enterprise Onboarding' },
        { id: 'c-007', name: 'Ana Petrov', email: 'ana.petrov@startupxyz.com', job_title: 'CEO', project: 'Partnership' },
        { id: 'c-008', name: 'David Kim', email: 'dkim@megacorp.co', job_title: 'Director of Engineering', project: 'Platform API' },
      ];

      const stmt = db.prepare('INSERT OR IGNORE INTO contacts (id, name, email, job_title, project) VALUES (?, ?, ?, ?, ?)');
      for (const c of contacts) {
        stmt.run(c.id, c.name, c.email, c.job_title, c.project);
      }

      db.pragma('user_version = 2');
    })();
  }

  if (version < 3) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS repos (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL,
          github_url TEXT,
          default_branch TEXT NOT NULL DEFAULT 'main',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS builds (
          id TEXT PRIMARY KEY,
          repo_id TEXT NOT NULL REFERENCES repos(id),
          task_title TEXT NOT NULL,
          task_description TEXT,
          pm_notes TEXT,
          transcript_context TEXT,
          source TEXT NOT NULL DEFAULT 'linear',
          source_id TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          branch_name TEXT,
          pr_url TEXT,
          summary TEXT,
          files_changed INTEGER DEFAULT 0,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS build_events (
          id TEXT PRIMARY KEY,
          build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_builds_repo ON builds(repo_id);
        CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);
        CREATE INDEX IF NOT EXISTS idx_build_events_build ON build_events(build_id);
      `);
      db.pragma('user_version = 3');
    })();
  }
}
