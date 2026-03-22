import { getDb } from '../db';
import { v4 as uuid } from 'uuid';
import { getTaskProvider } from '../services/task-provider-manager';

export interface Proposal {
  proposal_id: string;
  proposal_type: 'create' | 'update' | 'delete';
  status: 'pending' | 'approved' | 'rejected';
  title?: string;
  description?: string;
  transcript_id?: string;
  task_id?: string;
  changes?: { title?: { old: string; new: string }; description?: { old: string; new: string }; status?: { old: string; new: string } };
  reason?: string;
}

export async function executeTool(name: string, input: Record<string, unknown>): Promise<unknown> {
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
      try {
        const provider = getTaskProvider();
        const task = await provider.get(input.task_id as string);
        if (!task) return { error: 'Task not found' };
        return task;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to fetch task' };
      }
    }

    case 'list_tasks': {
      try {
        const provider = getTaskProvider();
        const tasks = await provider.list({
          status: input.status as string | undefined,
          limit: (input.limit as number) || 50,
        });
        return tasks;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to list tasks' };
      }
    }

    case 'create_task': {
      if (input.auto_execute) {
        try {
          const provider = getTaskProvider();
          const created = await provider.create({
            title: input.title as string,
            description: input.description as string,
          });
          return { auto_executed: true, id: created.id, identifier: created.identifier, title: input.title };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'Failed to create task' };
        }
      }
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
      try {
        const provider = getTaskProvider();
        const existing = await provider.get(input.task_id as string);
        if (!existing) return { error: 'Task not found' };

        if (input.auto_execute) {
          await provider.update({
            taskId: input.task_id as string,
            title: input.title as string | undefined,
            description: input.description as string | undefined,
            status: input.status as string | undefined,
          });
          return { auto_executed: true, id: input.task_id, identifier: existing.identifier, title: existing.title, reason: input.reason };
        }

        const changes: Proposal['changes'] = {};
        if (input.title) changes.title = { old: existing.title, new: input.title as string };
        if (input.description) changes.description = { old: existing.description, new: input.description as string };
        if (input.status) changes.status = { old: existing.status, new: input.status as string };

        const proposal: Proposal = {
          proposal_id: uuid(),
          proposal_type: 'update',
          status: 'pending',
          task_id: input.task_id as string,
          changes,
          reason: input.reason as string,
        };
        return proposal;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to fetch task for update' };
      }
    }

    case 'delete_task': {
      try {
        const provider = getTaskProvider();
        const existing = await provider.get(input.task_id as string);
        if (!existing) return { error: 'Task not found' };

        const proposal: Proposal = {
          proposal_id: uuid(),
          proposal_type: 'delete',
          status: 'pending',
          task_id: input.task_id as string,
          title: existing.title,
          reason: input.reason as string,
        };
        return proposal;
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to fetch task for deletion' };
      }
    }

    case 'get_contact': {
      const db = getDb();
      const query = `%${(input.query as string).toLowerCase()}%`;
      const rows = db.prepare(
        'SELECT * FROM contacts WHERE LOWER(name) LIKE ? OR LOWER(email) LIKE ? LIMIT 5'
      ).all(query, query);
      return rows.length > 0 ? rows : { error: 'No contacts found matching that query' };
    }

    case 'list_contacts': {
      const db = getDb();
      const limit = (input.limit as number) || 20;
      return db.prepare('SELECT * FROM contacts ORDER BY updated_at DESC LIMIT ?').all(limit);
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
