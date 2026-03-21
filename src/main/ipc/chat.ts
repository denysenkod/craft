import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db';
import { runAgent, cancelAgent } from '../agent/chat-agent';
import { CurrentContext } from '../agent/system-prompt';

export function registerChatHandlers() {
  ipcMain.handle('chat:send-message', async (event, data: { message: string; context: CurrentContext; transcriptContent?: string; analysisJson?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    // Fire-and-forget — streaming events handle the response.
    // We don't await so the invoke resolves immediately.
    runAgent(win, data.message, data.context, data.transcriptContent, data.analysisJson).catch(err => {
      console.error('Agent error:', err);
      if (!win.isDestroyed()) {
        win.webContents.send('chat:stream-event', { type: 'error', message: err.message || 'Unknown error' });
      }
    });
  });

  ipcMain.handle('chat:cancel', async () => {
    cancelAgent();
  });

  ipcMain.handle('chat:get-history', async () => {
    const db = getDb();
    return db.prepare('SELECT id, role, content, created_at FROM chat_messages ORDER BY created_at ASC').all();
  });

  ipcMain.handle('chat:clear-history', async () => {
    const db = getDb();
    db.prepare('DELETE FROM chat_messages').run();
  });

  ipcMain.handle('chat:approve-proposal', async (_event, data: { proposal_id: string; proposal: unknown }) => {
    const db = getDb();
    const proposal = data.proposal as {
      proposal_type: string;
      title?: string;
      description?: string;
      transcript_id?: string;
      task_id?: string;
      changes?: { title?: { new: string }; description?: { new: string } };
    };

    if (proposal.proposal_type === 'create') {
      const id = uuid();
      db.prepare(
        'INSERT INTO tasks (id, transcript_id, title, description, source) VALUES (?, ?, ?, ?, ?)'
      ).run(id, proposal.transcript_id || null, proposal.title, proposal.description, 'chat');
      updateProposalStatus(db, data.proposal_id, 'approved');
      return { id, title: proposal.title };
    }

    if (proposal.proposal_type === 'update' && proposal.task_id) {
      if (proposal.changes?.title) {
        db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(proposal.changes.title.new, proposal.task_id);
      }
      if (proposal.changes?.description) {
        db.prepare('UPDATE tasks SET description = ? WHERE id = ?').run(proposal.changes.description.new, proposal.task_id);
      }
      updateProposalStatus(db, data.proposal_id, 'approved');
      return { id: proposal.task_id };
    }
  });

  ipcMain.handle('chat:reject-proposal', async (_event, data: { proposal_id: string }) => {
    const db = getDb();
    updateProposalStatus(db, data.proposal_id, 'rejected');
  });
}

function updateProposalStatus(db: ReturnType<typeof getDb>, proposalId: string, status: 'approved' | 'rejected') {
  const rows = db.prepare(
    "SELECT id, content FROM chat_messages WHERE content LIKE '%' || ? || '%'"
  ).all(proposalId) as { id: string; content: string }[];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.content);
      if (parsed.proposals) {
        for (const p of parsed.proposals) {
          if (p.proposal_id === proposalId) {
            p.status = status;
          }
        }
        db.prepare('UPDATE chat_messages SET content = ? WHERE id = ?')
          .run(JSON.stringify(parsed), row.id);
      }
    } catch {
      // Not JSON content, skip
    }
  }
}
