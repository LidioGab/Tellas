import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import fs from 'fs';
import electronUpdater from 'electron-updater';
import { discordAudioIsolationService } from './DiscordAudioIsolationService';
import { AppUpdaterService } from './AppUpdaterService';
import { secureAuthStorage } from './SecureAuthStorage';


// Enable Chromium Desktop System Audio & Screen Capturing Switches
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

let mainWindow: BrowserWindow | null = null;
const { autoUpdater } = electronUpdater;
const appUpdaterService = new AppUpdaterService({
  updater: autoUpdater,
  isPackaged: app.isPackaged,
  currentVersion: app.getVersion(),
  onStatusChanged: (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:status', status);
    }
  },
});

function getAppIconPath(): string | undefined {
  const possiblePaths = [
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(process.resourcesPath, 'build/icon.ico'),
    path.join(process.resourcesPath, 'build/icon.png'),
    path.join(__dirname, '../renderer/favicon.ico'),
    path.join(__dirname, '../renderer/logo.png'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

function createWindow() {
  const iconPath = getAppIconPath();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Tellas — Compartilhamento de Tela',
    backgroundColor: '#090A0F',
    autoHideMenuBar: true,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.setMenuBarVisibility(false);



  // Load Vite Dev Server URL or Production Index HTML
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Security: Desktop Capturer IPC Handler
ipcMain.handle('get-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 400, height: 225 }
    });

    return sources.map((source) => ({
      id: source.id,
      name: source.name || 'Tela / Janela Sem Nome',
      thumbnail: source.thumbnail.toDataURL(),
      display_id: source.display_id
    }));
  } catch (error) {
    console.error('Error fetching desktop sources:', error);
    return [];
  }
});

ipcMain.handle('app:get-info', () => ({
  runtime: 'desktop' as const,
  version: app.getVersion(),
}));

ipcMain.handle('updater:get-status', () => appUpdaterService.getStatus());
ipcMain.handle('updater:check', () => appUpdaterService.checkForUpdates());
ipcMain.handle('updater:download', () => appUpdaterService.downloadUpdate());
ipcMain.handle('updater:install', () => appUpdaterService.installUpdate());

const allowedAuthBackends = new Set(['https://tellas.fly.dev', 'http://localhost:3001']);
function requireAllowedAuthBackend(value: unknown): string {
  const backendUrl = String(value || '').replace(/\/$/, '');
  if (!allowedAuthBackends.has(backendUrl)) throw new Error('Backend de autenticação não autorizado.');
  return backendUrl;
}

ipcMain.handle('auth:store-refresh-token', (_event, refreshToken: unknown) => {
  if (typeof refreshToken !== 'string' || refreshToken.length < 32) throw new Error('Refresh token inválido.');
  secureAuthStorage.saveRefreshToken(refreshToken);
  return true;
});

ipcMain.handle('auth:refresh', async (_event, requestedBackendUrl: unknown) => {
  const backendUrl = requireAllowedAuthBackend(requestedBackendUrl);
  const refreshToken = secureAuthStorage.getRefreshToken();
  if (!refreshToken) return null;
  const response = await fetch(`${backendUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    if (response.status === 401) secureAuthStorage.clear();
    return null;
  }
  const data = await response.json() as { tokens?: { accessToken: string; refreshToken: string; expiresIn: number } };
  if (!data.tokens?.refreshToken) return null;
  secureAuthStorage.saveRefreshToken(data.tokens.refreshToken);
  return { accessToken: data.tokens.accessToken, expiresIn: data.tokens.expiresIn };
});

ipcMain.handle('auth:logout', async (_event, requestedBackendUrl: unknown) => {
  const backendUrl = requireAllowedAuthBackend(requestedBackendUrl);
  const refreshToken = secureAuthStorage.getRefreshToken();
  secureAuthStorage.clear();
  if (refreshToken) {
    await fetch(`${backendUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  return true;
});

import { win10AudioLogger } from './Win10AudioDiagnosticLogger';

// ─── Phase 2: Audio Capture with Discord Isolation IPC Handlers ─────────────

let firstIpcSentLogged = false;

// Setup forwarder from Discord Audio Isolation Service to Renderer
discordAudioIsolationService.on('data', (frame) => {
  if (!firstIpcSentLogged) {
    firstIpcSentLogged = true;
    win10AudioLogger.logImmediate('MAIN', 'IPC', {
      audioBufferIpcSent: true,
      sequence: frame.sequence,
      samples: frame.samples.length
    });
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-buffer', frame);
  }
});

discordAudioIsolationService.on('error', (err: Error) => {
  console.error('[Main] Audio isolation capture error:', err.message);
  win10AudioLogger.logImmediate('MAIN', 'CAPTURE_ERROR', { error: err.message });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-capture-error', err.message);
  }
});

/** Get centralized Windows audio environment & strategy */
ipcMain.handle('get-audio-environment', async () => {
  return discordAudioIsolationService.getAudioEnvironment();
});

/** List available audio devices (for UI selector) */
ipcMain.handle('list-audio-devices', async () => {
  try {
    const devices = await discordAudioIsolationService.listDevices();
    return { success: true, devices };
  } catch (err: any) {
    console.error('[Main] list-audio-devices error:', err);
    return { success: false, devices: [], error: err.message };
  }
});

/** Start audio capture with Discord isolation and automatic fallback */
ipcMain.handle('start-audio-capture', async (_event, deviceName?: string) => {
  try {
    firstIpcSentLogged = false;
    const result = await discordAudioIsolationService.start(deviceName);
    if (!result.success) {
      return {
        success: false,
        code: result.code,
        strategy: result.strategy,
        windowsVersion: result.windowsVersion,
        build: result.build,
        error: result.error,
        diagnosticLogPath: result.diagnosticLogPath
      };
    }
    console.log('[Main] Audio capture active:', result);
    return {
      success: true,
      format: discordAudioIsolationService.audioFormat,
      isolation: result,
      diagnosticLogPath: result.diagnosticLogPath
    };
  } catch (err: any) {
    console.error('[Main] start-audio-capture error:', err);
    return { success: false, error: err.message };
  }
});

/** Stop audio capture and release resources */
ipcMain.handle('stop-audio-capture', async () => {
  try {
    await discordAudioIsolationService.stop();
    return { success: true };
  } catch (err: any) {
    console.error('[Main] stop-audio-capture error:', err);
    return { success: false, error: err.message };
  }
});

/** Renderer Audio Diagnostic Event Receiver */
ipcMain.on('audio-diagnostic-event', (_event, payload: { layer?: any; category: string; data: any }) => {
  win10AudioLogger.log(payload.layer || 'RENDERER', payload.category, payload.data);
});

/** Get current audio diagnostic log path */
ipcMain.handle('get-audio-diagnostic-path', async () => {
  return {
    path: win10AudioLogger.getCurrentLogFilePath(),
    dir: win10AudioLogger.getLogDirectory()
  };
});

/** Open audio diagnostic folder in file explorer */
ipcMain.handle('open-audio-diagnostic-folder', async () => {
  return {
    success: win10AudioLogger.openLogFolder()
  };
});

// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const env = discordAudioIsolationService.getAudioEnvironment();
  console.log(`[AudioStrategy] OS: ${env.windowsVersion} build ${env.build} | Process Loopback supported: ${env.processLoopbackSupported} -> ${env.strategy}`);

  createWindow();
  appUpdaterService.initialize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    discordAudioIsolationService.stop().catch(() => { });
    app.quit();
  }
});
