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
    path.join(process.cwd(), 'packages', 'native-audio', 'index.js')
  ].filter(Boolean) as string[];

  for (const candidate of candidatePaths) {
    try {
      NativeAudioModule = require(candidate);
      if (NativeAudioModule) break;
    } catch (_) { }
  }
}

import { AudioCaptureStrategy, WindowsAudioEnvironment } from '@stream-app/shared';
import { getWindowsAudioEnvironment } from './AudioCaptureStrategy';

export interface AudioCaptureStartResult {
  success: boolean;
  mode: string;
  discordDetected?: boolean;
  code?: string;
  strategy?: AudioCaptureStrategy;
  windowsVersion?: string;
  build?: number;
  error?: string;
}

export class DiscordAudioIsolationService extends EventEmitter {
  private isCapturing = false;
  private currentMode: 'NATIVE_PROCESS_LOOPBACK' | 'FALLBACK' | 'NONE' = 'NONE';
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
    } catch (_) { }

    if (NativeAudioModule && typeof NativeAudioModule.ProcessLoopbackCapture?.isSupported === 'function') {
      return NativeAudioModule.ProcessLoopbackCapture.isSupported();
    }

    return false;
  }

  /**
   * Query the centralized Windows audio environment and capture strategy.
   */
  public getAudioEnvironment(): WindowsAudioEnvironment {
    return getWindowsAudioEnvironment(this.isProcessLoopbackSupported());
  }

  /**
   * Start audio capture with centralized strategy decision.
   */
  public async start(deviceName?: string): Promise<AudioCaptureStartResult> {
    // Single producer guarantee: Stop any active capture first
    if (this.isCapturing) {
      await this.stop();
    }

    const env = this.getAudioEnvironment();
    console.log(
      `[AudioStrategy] OS: ${env.windowsVersion} build ${env.build} | Process Loopback: ${env.processLoopbackSupported} -> ${env.strategy}`
    );

    // ─── Case 1: Windows build requires Virtual Audio (e.g. Win 10 < 20348) ───
    if (env.strategy === AudioCaptureStrategy.VIRTUAL_AUDIO_REQUIRED) {
      console.warn(
        `[AudioCapture] System audio isolation requires Virtual Audio mode on ${env.windowsVersion} build ${env.build}`
      );
      this.currentMode = 'NONE';
      return {
        success: false,
        code: 'VIRTUAL_AUDIO_REQUIRED',
        strategy: AudioCaptureStrategy.VIRTUAL_AUDIO_REQUIRED,
        windowsVersion: env.windowsVersion,
        build: env.build,
        mode: 'NONE',
        discordDetected: false,
        error: 'Esta versão do Windows requer o modo de áudio compatível com Windows 10 para transmitir o som do sistema sem incluir o Discord. Esse modo ainda está sendo preparado.'
      };
    }

    // ─── Case 2: Windows build supports Process Loopback ─────────────────────
    const isAddonAvailable = NativeAudioModule && NativeAudioModule.isNativeAddonAvailable();

    if (!isAddonAvailable) {
      const loadError = NativeAudioModule ? NativeAudioModule.getLoadError() : null;
      console.error(
        `[AudioIsolation] Native addon unavailable: ${loadError ? loadError.message : 'Binary not found'}`
      );
      return {
        success: false,
        code: 'ADDON_UNAVAILABLE',
        strategy: AudioCaptureStrategy.PROCESS_LOOPBACK,
        windowsVersion: env.windowsVersion,
        build: env.build,
        mode: 'NONE',
        discordDetected: false,
        error: 'Addon nativo de captura de áudio indisponível no sistema.'
      };
    }

    // Detect Discord process tree
    let discordInfo: DiscordProcessInfo | null = null;
    try {
      discordInfo = await DiscordProcessDetector.detectDiscord();
      if (discordInfo) {
        console.log(`[AudioIsolation] Discord root process selected: PID ${discordInfo.rootPid}`);
      } else {
        console.log('[AudioIsolation] Discord process not detected (capturing system audio without exclusions).');
      }
    } catch (detectErr: any) {
      console.warn('[AudioIsolation] Discord detection error:', detectErr.message);
    }

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
        return {
          success: true,
          mode: this.currentMode,
          discordDetected: discordInfo !== null,
          strategy: AudioCaptureStrategy.PROCESS_LOOPBACK,
          windowsVersion: env.windowsVersion,
          build: env.build
        };
      } else {
        console.error('[AudioIsolation] Native WASAPI start returned false.');
        return {
          success: false,
          code: 'WASAPI_START_FAILED',
          mode: 'NONE',
          strategy: AudioCaptureStrategy.PROCESS_LOOPBACK,
          windowsVersion: env.windowsVersion,
          build: env.build,
          error: 'Falha ao iniciar a captura WASAPI Process Loopback.'
        };
      }
    } catch (nativeErr: any) {
      console.error('[AudioIsolation] Native WASAPI exception:', nativeErr.message);
      return {
        success: false,
        code: 'WASAPI_EXCEPTION',
        mode: 'NONE',
        strategy: AudioCaptureStrategy.PROCESS_LOOPBACK,
        windowsVersion: env.windowsVersion,
        build: env.build,
        error: nativeErr.message
      };
    }
  }

  /** Stop audio capture and release all resources */
  public async stop(): Promise<void> {
    if (this.nativeInstance) {
      try {
        this.nativeInstance.stop();
      } catch (_) { }
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
