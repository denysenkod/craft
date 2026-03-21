import { ipcMain, BrowserWindow } from 'electron';
import { getDb } from '../db';
import { runAgent, cancelAgent } from '../agent/chat-agent';
import { CurrentContext } from '../agent/system-prompt';
import { getTaskProvider } from '../services/task-provider-manager';

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
      changes?: { title?: { new: string }; description?: { new: string }; status?: { new: string } };
    };

    try {
      const provider = getTaskProvider();

      if (proposal.proposal_type === 'create') {
        const created = await provider.create({
          title: proposal.title!,
          description: proposal.description!,
        });
        updateProposalStatus(db, data.proposal_id, 'approved');
        return { id: created.id, identifier: created.identifier, url: created.url, title: proposal.title };
      }

      if (proposal.proposal_type === 'update' && proposal.task_id) {
        await provider.update({
          taskId: proposal.task_id,
          title: proposal.changes?.title?.new,
          description: proposal.changes?.description?.new,
          status: proposal.changes?.status?.new,
        });
        updateProposalStatus(db, data.proposal_id, 'approved');
        return { id: proposal.task_id };
      }
    } catch (err) {
      throw new Error(`Failed to save to ${getTaskProvider().name}: ${err instanceof Error ? err.message : 'unknown error'}`);
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
