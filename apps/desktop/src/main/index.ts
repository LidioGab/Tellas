import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import { discordAudioIsolationService } from './DiscordAudioIsolationService';

// Enable Chromium Desktop System Audio & Screen Capturing Switches
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'StreamCraft - High Performance Screen Sharing',
    backgroundColor: '#090A0F',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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

// ─── Phase 2: Audio Capture with Discord Isolation IPC Handlers ─────────────

// Setup forwarder from Discord Audio Isolation Service to Renderer
discordAudioIsolationService.on('data', (buffer: Float32Array) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-buffer', buffer);
  }
});

discordAudioIsolationService.on('error', (err: Error) => {
  console.error('[Main] Audio isolation capture error:', err.message);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('audio-capture-error', err.message);
  }
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
    const result = await discordAudioIsolationService.start(deviceName);
    console.log('[Main] Audio capture active:', result);
    return {
      success: true,
      format: discordAudioIsolationService.audioFormat,
      isolation: result
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

// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    discordAudioIsolationService.stop().catch(() => {});
    app.quit();
  }
});
