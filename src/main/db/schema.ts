export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    meeting_url TEXT,
    recall_bot_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id),
    raw_text TEXT NOT NULL,
    analysis_json TEXT,
    transcript_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    transcript_id TEXT REFERENCES transcripts(id),
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    linear_issue_id TEXT,
    source TEXT NOT NULL DEFAULT 'auto',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    transcript_id TEXT REFERENCES transcripts(id),
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth (
    provider TEXT PRIMARY KEY,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS meeting_bots (
    google_event_id TEXT PRIMARY KEY,
    recall_bot_id TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    error_message TEXT,
    transcript_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    job_title TEXT,
    project TEXT,
    profile_summary TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS meeting_attendees (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL,
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(google_event_id, contact_id)
  );

  CREATE TABLE IF NOT EXISTS meeting_prep_notes (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL UNIQUE,
    notes_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prep_chat_messages (
    id TEXT PRIMARY KEY,
    google_event_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;
