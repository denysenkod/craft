import { getDb } from '../db';
import { v4 as uuid } from 'uuid';

export interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update';
  status: 'pending' | 'approved' | 'rejected';
  title?: string;
  description?: string;
  transcript_id?: string;
  task_id?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string } };
  reason?: string;
}

export function executeTool(name: string, input: Record<string, unknown>): unknown {
  const db = getDb();

  switch (name) {
    case 'get_transcript': {
      const row = db.prepare(`
        SELECT t.id, t.meeting_id, t.raw_text, t.analysis_json, t.created_at,
               m.title as meeting_title
        FROM transcripts t
        JOIN meetings m ON m.id = t.meeting_id
        WHERE t.id = ?
      `).get(input.transcript_id as string) as Record<string, unknown> | undefined;
      if (!row) return { error: 'Transcript not found' };
      return {
        ...row,
        analysis: row.analysis_json ? JSON.parse(row.analysis_json as string) : null,
      };
    }

    case 'search_transcripts': {
      const limit = (input.limit as number) || 10;
      const query = `%${input.query as string}%`;
      const rows = db.prepare(`
        SELECT t.id as transcript_id, t.meeting_id, m.title as meeting_title, t.created_at,
               substr(t.raw_text, max(1, instr(lower(t.raw_text), lower(?)) - 100), 300) as snippet
        FROM transcripts t
        JOIN meetings m ON m.id = t.meeting_id
        WHERE t.raw_text LIKE ?
        LIMIT ?
      `).all(input.query as string, query, limit);
      return rows;
    }

    case 'get_meeting': {
      const row = db.prepare(`
        SELECT m.id, m.title, m.meeting_url, m.status, m.created_at,
               EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = m.id) as has_transcript
        FROM meetings m WHERE m.id = ?
      `).get(input.meeting_id as string);
      if (!row) return { error: 'Meeting not found' };
      return row;
    }

    case 'list_meetings': {
      const limit = (input.limit as number) || 20;
      const status = input.status as string | undefined;
      if (status) {
        return db.prepare(`
          SELECT m.id, m.title, m.status, m.created_at,
                 EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = m.id) as has_transcript
          FROM meetings m WHERE m.status = ? ORDER BY m.created_at DESC LIMIT ?
        `).all(status, limit);
      }
      return db.prepare(`
        SELECT m.id, m.title, m.status, m.created_at,
               EXISTS(SELECT 1 FROM transcripts WHERE meeting_id = m.id) as has_transcript
        FROM meetings m ORDER BY m.created_at DESC LIMIT ?
      `).all(limit);
    }

    case 'get_task': {
      const row = db.prepare(`
        SELECT t.id, t.transcript_id, t.title, t.description, t.status,
               t.source, t.linear_issue_id, t.created_at,
               m.title as meeting_title
        FROM tasks t
        LEFT JOIN transcripts tr ON tr.id = t.transcript_id
        LEFT JOIN meetings m ON m.id = tr.meeting_id
        WHERE t.id = ?
      `).get(input.task_id as string);
      if (!row) return { error: 'Task not found' };
      return row;
    }

    case 'list_tasks': {
      const limit = (input.limit as number) || 50;
      const status = input.status as string | undefined;
      const transcriptId = input.transcript_id as string | undefined;

      let sql = `
        SELECT t.id, t.title, t.description, t.status, t.source,
               t.transcript_id, t.created_at, m.title as meeting_title
        FROM tasks t
        LEFT JOIN transcripts tr ON tr.id = t.transcript_id
        LEFT JOIN meetings m ON m.id = tr.meeting_id
      `;
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (status) { conditions.push('t.status = ?'); params.push(status); }
      if (transcriptId) { conditions.push('t.transcript_id = ?'); params.push(transcriptId); }

      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY t.created_at DESC LIMIT ?';
      params.push(limit);

      return db.prepare(sql).all(...params);
    }

    case 'create_task': {
      const proposal: Proposal = {
        proposal_id: uuid(),
        proposal_type: 'create',
        status: 'pending',
        title: input.title as string,
        description: input.description as string,
        transcript_id: input.transcript_id as string | undefined,
      };
      return proposal;
    }

    case 'update_task': {
      const existing = db.prepare('SELECT id, title, description FROM tasks WHERE id = ?')
        .get(input.task_id as string) as { id: string; title: string; description: string } | undefined;
      if (!existing) return { error: 'Task not found' };

      const changes: Proposal['changes'] = {};
      if (input.title) changes.title = { old: existing.title, new: input.title as string };
      if (input.description) changes.description = { old: existing.description, new: input.description as string };

      const proposal: Proposal = {
        proposal_id: uuid(),
        proposal_type: 'update',
        status: 'pending',
        task_id: input.task_id as string,
        changes,
        reason: input.reason as string,
      };
      return proposal;
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
