import { ipcMain } from 'electron';
import { registerLinearHandlers } from './linear';
import { registerChatHandlers } from './chat';

export function registerAllHandlers() {
  ipcMain.handle('settings:get', async () => ({}));
  ipcMain.handle('settings:set', async (_e, _data) => {});

  registerLinearHandlers();
  registerChatHandlers();

  console.log('IPC handlers registered');
}
