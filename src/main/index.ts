import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { app, BrowserWindow } from 'electron';

// These must be set before app.whenReady()
app.commandLine.appendSwitch('disable-features', 'UsePortalFileChooser');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

import { registerAllHandlers } from './ipc';
import { initDb, migrate } from './db';
import { stopAllLiveTranscripts } from './services/live-transcript';


declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#07070A',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
}

app.whenReady().then(() => {
  initDb();
  migrate();
  registerAllHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  stopAllLiveTranscripts();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
