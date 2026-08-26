import { DesktopSource, WindowsAudioEnvironment } from '@stream-app/shared';

export interface AudioDevice {
  id: string;
  name: string;
  type: 'output' | 'input' | string;
}

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  chunkDurationMs: number;
}

export interface ElectronAPI {
  // Phase 1 — Screen Capture Sources
  getSources: () => Promise<DesktopSource[]>;

  // Phase 2 — System Audio Capture
  getAudioEnvironment: () => Promise<WindowsAudioEnvironment>;
  listAudioDevices: () => Promise<{ success: boolean; devices: AudioDevice[]; error?: string }>;
  startAudioCapture: (deviceName?: string) => Promise<{
    success: boolean;
    format?: AudioFormat;
    code?: string;
    strategy?: string;
    windowsVersion?: string;
    build?: number;
    error?: string;
  }>;
  stopAudioCapture: () => Promise<{ success: boolean; error?: string }>;
  onAudioBuffer: (callback: (buffer: Float32Array) => void) => () => void;
  onAudioCaptureError: (callback: (error: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
