import { ipcMain } from 'electron';
import { startAuthFlow, isAuthenticated, logout } from '../services/google-auth';

export function registerGoogleAuthHandlers() {
  ipcMain.handle('google:auth', async () => {
    return startAuthFlow();
  });

  ipcMain.handle('google:auth-status', async () => {
    return isAuthenticated();
  });

  ipcMain.handle('google:logout', async () => {
    logout();
    return { success: true };
  });
}
