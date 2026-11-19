import { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } from 'electron';
import path from 'path';
import fs from 'fs';
import { setupDatabaseIPC, getDb, saveDbImmediate } from './db';
import { setupPlayerIPC, playerInstance } from './player';
import { setupYTMusicIPC } from './ytmusic';
import { setupProvidersIPC } from './providers';
import { setupLibraryIPC } from './library';
import { setupLyricsIPC } from './lyrics';
import { setupCanvasIPC } from './canvas';
import { setupScrobbleIPC } from './scrobble';
import { setupSpotifyIPC, getValidSpotifyTokenOrNull } from './spotify';
import { setupYouTubeAuthIPC } from './youtubeAuth';
import { setupSoundCloudAuthIPC } from './soundcloudAuth';
import { setupTagEditorIPC } from './tagEditor';
import { desktopIntegration } from './desktop';
import { setupTogetherIPC, togetherManager } from './together';
import { setupPlaylistsIoIPC } from './playlists_io';

// Enable smooth Wayland/X11 GPU rendering on Linux (with user fallback setting)
const initialSettings = getDb().settings;
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations,VaapiVideoDecodeLinuxGL');
  if (!initialSettings.hardwareAcceleration) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-gpu');
  }
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
const isDev = process.env.NODE_ENV === 'development';

let cachedIconPath: string | null = null;
function resolveIconPath(): string {
  if (cachedIconPath) return cachedIconPath;
  const candidates = [
    path.join(__dirname, '../../assets/icon.png'),
    path.join(process.resourcesPath, 'assets/icon.png'),
    path.join(app.getAppPath(), 'assets/icon.png'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      cachedIconPath = candidate;
      return candidate;
    }
  }
  return '';
}

function createWindow(): void {
  const iconPath = resolveIconPath();

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: true,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#141218',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Required for streaming audio & video canvas URLs
    },
    icon: iconPath || undefined,
  });

  let shown = false;
  const showWindow = () => {
    if (!shown && mainWindow && !mainWindow.isDestroyed()) {
      shown = true;
      mainWindow.show();
    }
  };

  mainWindow.once('ready-to-show', showWindow);
  setTimeout(showWindow, 150);

  mainWindow.on('close', (e) => {
    if (!isQuitting && getDb().settings.closeToTray) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../renderer/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

process.on('uncaughtException', (err) => {
  console.error('ArchiveTune Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('ArchiveTune Unhandled Rejection:', reason);
});

app.whenReady().then(() => {
  createWindow();

  // Register all IPC subsystems
  setupDatabaseIPC();
  setupPlayerIPC(mainWindow ?? undefined);
  setupYTMusicIPC();
  setupProvidersIPC();
  setupLibraryIPC();
  setupLyricsIPC();
  setupCanvasIPC(getValidSpotifyTokenOrNull);
  setupScrobbleIPC();
  setupSpotifyIPC();
  setupYouTubeAuthIPC();
  setupSoundCloudAuthIPC();
  setupTagEditorIPC();
  setupTogetherIPC(mainWindow ?? undefined);
  setupPlaylistsIoIPC(mainWindow ?? undefined);

  if (mainWindow) {
    desktopIntegration.init(mainWindow);
    desktopIntegration.setupIPC();
  }

  // Window control handlers
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => {
    if (getDb().settings.closeToTray) {
      mainWindow?.hide();
    } else {
      isQuitting = true;
      mainWindow?.close();
    }
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Audio',
          extensions: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'wma'],
        },
      ],
    });
    return result.filePaths;
  });

  ipcMain.on('shell:openExternal', (_event, url: string) => {
    void shell.openExternal(url);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  saveDbImmediate();
  playerInstance.shutdown();
  togetherManager.leaveRoom();
  desktopIntegration.destroy();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  saveDbImmediate();
  playerInstance.shutdown();
  togetherManager.leaveRoom();
  desktopIntegration.destroy();
});

app.on('window-all-closed', () => {
  saveDbImmediate();
  playerInstance.shutdown();
  togetherManager.leaveRoom();
  desktopIntegration.destroy();
  if (process.platform !== 'darwin') app.quit();
});
