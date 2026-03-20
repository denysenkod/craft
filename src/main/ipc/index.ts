import { ipcMain } from 'electron';

export function registerAllHandlers() {
  // Stub handlers — each module will register its own
  ipcMain.handle('settings:get', async () => ({}));
  ipcMain.handle('settings:set', async (_e, _data) => {});
  console.log('IPC handlers registered');
}
