import { EventEmitter } from 'events';
import * as os from 'os';
import { DiscordProcessDetector, DiscordProcessInfo } from './DiscordProcessDetector';
import { audioCaptureService, AudioDevice } from './AudioCaptureService';

import * as path from 'path';

// Safely import native addon wrapper
let NativeAudioModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NativeAudioModule = require('@stream-app/native-audio');
} catch (err: any) {
  const candidatePaths = [
    process.resourcesPath ? path.join(process.resourcesPath, 'packages', 'native-audio', 'index.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'native_audio.node') : null,
    path.join(__dirname, '..', '..', '..', 'packages', 'native-audio', 'index.js'),
    path.join(process.cwd(), 'packages', 'native-audio', 'index.js'),
    'C:\\Users\\gabri\\OneDrive\\Documentos\\CompartilhamentoTela\\packages\\native-audio\\index.js'
  ].filter(Boolean) as string[];

  for (const candidate of candidatePaths) {
    try {
      NativeAudioModule = require(candidate);
      if (NativeAudioModule) break;
    } catch (_) {}
  }
}

export class DiscordAudioIsolationService extends EventEmitter {
  private isCapturing = false;
  private currentMode: 'NATIVE_PROCESS_LOOPBACK' | 'FALLBACK' = 'FALLBACK';
  private nativeInstance: any = null;
  private readonly sampleRate = 48000;
  private readonly channels = 2;

  constructor() {
    super();
  }

  /**
   * Check if Windows WASAPI Process Loopback is supported on this system
   * Requires Windows 10 build >= 20348 or Windows 11
   */
  public isProcessLoopbackSupported(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const release = os.release(); // e.g. "10.0.26200"
      const parts = release.split('.');
      if (parts.length >= 3) {
        const major = parseInt(parts[0], 10);
        const build = parseInt(parts[2], 10);
        if (major > 10 || (major === 10 && build >= 20348)) {
          return true;
        }
      }
    } catch (_) {}

    if (NativeAudioModule && typeof NativeAudioModule.ProcessLoopbackCapture?.isSupported === 'function') {
      return NativeAudioModule.ProcessLoopbackCapture.isSupported();
    }

    return false;
  }

  /**
   * Start audio capture with automatic Discord isolation
   */
  public async start(deviceName?: string): Promise<{ success: boolean; mode: string; discordDetected: boolean }> {
    // Single producer guarantee: Stop any active capture first
    if (this.isCapturing) {
      await this.stop();
    }

    const isLoopbackSupported = this.isProcessLoopbackSupported();
    const isAddonAvailable = NativeAudioModule && NativeAudioModule.isNativeAddonAvailable();

    // ─── Step 1: Addon availability logs ───────────────────────────────
    if (isAddonAvailable) {
      console.log('[AudioIsolation] Native addon loaded successfully');
    } else {
      const loadError = NativeAudioModule ? NativeAudioModule.getLoadError() : null;
      console.log(`[AudioIsolation] Native addon unavailable${loadError ? ` (Reason: ${loadError.message})` : ' (Binary native_audio.node not built yet)'}`);
    }

    // ─── Step 2: Process Loopback support log ──────────────────────────
    if (isLoopbackSupported) {
      console.log('[AudioIsolation] Process Loopback supported: true');
    } else {
      console.log('[AudioIsolation] Process Loopback supported: false');
    }

    // ─── Step 3: Detect Discord process ────────────────────────────────
    let discordInfo: DiscordProcessInfo | null = null;
    try {
      discordInfo = await DiscordProcessDetector.detectDiscord();
      if (discordInfo) {
        console.log(`[AudioIsolation] Discord process found: PID ${discordInfo.allPids.join(', ')} (${discordInfo.name})`);
        console.log(`[AudioIsolation] Discord root process selected: PID ${discordInfo.rootPid}`);
      } else {
        console.log('[AudioIsolation] Discord process not detected (Discord is not running).');
      }
    } catch (detectErr: any) {
      console.warn('[AudioIsolation] Process detection error:', detectErr.message);
    }

    // ─── Step 4: Attempt Native WASAPI Process Loopback ────────────────
    if (isLoopbackSupported && isAddonAvailable) {
      try {
        console.log('[AudioIsolation] Starting PROCESS_LOOPBACK_MODE_EXCLUDE_PROCESS_TREE');
        const nativeCapture = new NativeAudioModule.ProcessLoopbackCapture();
        const targetPid = discordInfo ? discordInfo.rootPid : 0;

        const started = nativeCapture.start(targetPid, (pcmBuffer: Float32Array) => {
          this.emit('data', pcmBuffer);
        });

        if (started) {
          this.nativeInstance = nativeCapture;
          this.isCapturing = true;
          this.currentMode = 'NATIVE_PROCESS_LOOPBACK';

          console.log('[AudioIsolation] Native WASAPI capture is ACTIVE');
          console.log('[AudioIsolation] Audio source currently in use: NATIVE_PROCESS_LOOPBACK');
          return { success: true, mode: this.currentMode, discordDetected: discordInfo !== null };
        } else {
          console.warn('[AudioIsolation] Native WASAPI start failed. Proceeding to fallback.');
        }
      } catch (nativeErr: any) {
        console.warn('[AudioIsolation] Native WASAPI exception:', nativeErr.message);
      }
    }

    // ─── Step 5: Fallback to FFmpeg/DirectShow ──────────────────────────
    console.log('[AudioIsolation] FFmpeg/DirectShow fallback is ACTIVE');
    console.log('[AudioIsolation] Audio source currently in use: FALLBACK');
    return this.startFallback(deviceName, discordInfo !== null);
  }

  /** Starts the ffmpeg/DirectShow fallback capture */
  private async startFallback(deviceName?: string, discordDetected = false): Promise<{ success: boolean; mode: string; discordDetected: boolean }> {
    try {
      audioCaptureService.removeAllListeners('data');
      audioCaptureService.removeAllListeners('error');

      audioCaptureService.on('data', (buffer: Float32Array) => {
        this.emit('data', buffer);
      });

      audioCaptureService.on('error', (err: Error) => {
        this.emit('error', err);
      });

      await audioCaptureService.start(deviceName);
      this.isCapturing = true;
      this.currentMode = 'FALLBACK';

      return { success: true, mode: this.currentMode, discordDetected };
    } catch (fallbackErr: any) {
      this.isCapturing = false;
      console.error('[AudioIsolation] All audio capture methods failed:', fallbackErr.message);
      throw fallbackErr;
    }
  }

  /** Stop audio capture and release all resources */
  public async stop(): Promise<void> {
    if (this.nativeInstance) {
      try {
        this.nativeInstance.stop();
      } catch (_) {}
      this.nativeInstance = null;
    }

    if (audioCaptureService.capturing) {
      audioCaptureService.removeAllListeners('data');
      audioCaptureService.removeAllListeners('error');
      audioCaptureService.stop();
    }

    this.isCapturing = false;
    console.log('[AudioIsolation] Audio capture stopped.');
  }

  public listDevices(): Promise<AudioDevice[]> {
    return audioCaptureService.listDevices();
  }

  public get capturing(): boolean {
    return this.isCapturing;
  }

  public get mode(): string {
    return this.currentMode;
  }

  public get audioFormat() {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      mode: this.currentMode
    };
  }
}

export const discordAudioIsolationService = new DiscordAudioIsolationService();
