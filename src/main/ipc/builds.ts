import { ipcMain } from 'electron';
import {
  createBuild,
  listBuilds,
  getBuild,
  getBuildEvents,
  cancelBuildById,
  retryBuild,
} from '../services/build-manager';
import { submitAnswer } from '../services/build-executor';

export function registerBuildHandlers() {
  ipcMain.handle('build:create', async (_e, data: {
    repoId: string;
    taskTitle: string;
    taskDescription?: string;
    pmNotes?: string;
    transcriptContext?: string;
    source?: string;
    sourceId?: string;
  }) => {
    return createBuild({
      repo_id: data.repoId,
      task_title: data.taskTitle,
      task_description: data.taskDescription,
      pm_notes: data.pmNotes,
      transcript_context: data.transcriptContext,
      source: data.source,
      source_id: data.sourceId,
    });
  });

  ipcMain.handle('build:list', async () => {
    return listBuilds();
  });

  ipcMain.handle('build:get', async (_e, id: string) => {
    const build = getBuild(id);
    if (!build) return null;
    const events = getBuildEvents(id);
    return { ...build, events };
  });

  ipcMain.handle('build:cancel', async (_e, id: string) => {
    cancelBuildById(id);
    return { success: true };
  });

  ipcMain.handle('build:retry', async (_e, id: string) => {
    return retryBuild(id);
  });

  ipcMain.handle('build:answer', async (_e, buildId: string, answer: string) => {
    submitAnswer(buildId, answer);
    return { success: true };
  });
}
