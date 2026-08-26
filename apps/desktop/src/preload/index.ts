import { contextBridge, ipcRenderer } from 'electron';
import { DesktopSource, WindowsAudioEnvironment } from '@stream-app/shared';

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── Phase 1: Screen Capture Sources ──────────────────────────────────────
  getSources: (): Promise<DesktopSource[]> => {
    return ipcRenderer.invoke('get-sources');
  },

  // ─── Phase 2: System Audio Capture ────────────────────────────────────────

  /** Query detected Windows audio environment & active strategy */
  getAudioEnvironment: (): Promise<WindowsAudioEnvironment> => {
    return ipcRenderer.invoke('get-audio-environment');
  },

  /** List available DirectShow audio devices (for UI selector) */
  listAudioDevices: (): Promise<{ success: boolean; devices: Array<{ id: string; name: string; type: string }>; error?: string }> => {
    return ipcRenderer.invoke('list-audio-devices');
  },

  /** Start WASAPI system audio loopback capture */
  startAudioCapture: (deviceName?: string): Promise<{
    success: boolean;
    format?: { sampleRate: number; channels: number; chunkDurationMs?: number };
    code?: string;
    strategy?: string;
    windowsVersion?: string;
    build?: number;
    error?: string;
  }> => {
    return ipcRenderer.invoke('start-audio-capture', deviceName);
  },

  /** Stop system audio loopback capture */
  stopAudioCapture: (): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('stop-audio-capture');
  },

  /**
   * Register a callback to receive PCM audio buffer chunks from the main process.
   * The callback receives a Float32Array of stereo-interleaved samples at 48kHz.
   * Returns a cleanup function to remove the listener.
   */
  onAudioBuffer: (callback: (buffer: Float32Array) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, buffer: Float32Array) => {
      callback(buffer);
    };
    ipcRenderer.on('audio-buffer', handler);
    return () => ipcRenderer.removeListener('audio-buffer', handler);
  },

  /**
   * Register a callback for audio capture errors from the main process.
   * Returns a cleanup function.
   */
  onAudioCaptureError: (callback: (error: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, error: string) => {
      callback(error);
    };
    ipcRenderer.on('audio-capture-error', handler);
    return () => ipcRenderer.removeListener('audio-capture-error', handler);
  }
});
