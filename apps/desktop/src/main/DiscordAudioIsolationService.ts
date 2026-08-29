import { EventEmitter } from 'events';
import * as os from 'os';
import { DiscordProcessDetector } from './DiscordProcessDetector';
import { audioCaptureService, AudioDevice } from './AudioCaptureService';
import { resolverLog } from './discordResolverDiagnosticLogger';

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

import { win10AudioLogger } from './Win10AudioDiagnosticLogger';

export interface AudioCaptureStartResult {
  success: boolean;
  mode: string;
  discordDetected?: boolean;
  code?: string;
  strategy?: AudioCaptureStrategy;
  windowsVersion?: string;
  build?: number;
  error?: string;
  diagnosticLogPath?: string;
}

export class DiscordAudioIsolationService extends EventEmitter {
  private isCapturing = false;
  private currentMode: 'NATIVE_PROCESS_LOOPBACK' | 'FALLBACK' | 'NONE' = 'NONE';
  private nativeInstance: any = null;
  private readonly sampleRate = 48000;
  private readonly channels = 2;
  private firstNativeBufferLogged = false;

  constructor() {
    super();
  }

  /**
   * Check if Windows WASAPI Process Loopback is officially supported on this system (Windows 10 Build >= 20348 or Windows 11).
   */
  public isOfficiallySupported(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const release = os.release(); // e.g. "10.0.19045" or "10.0.22631"
      const parts = release.split('.');
      if (parts.length >= 3) {
        const major = parseInt(parts[0], 10);
        const build = parseInt(parts[2], 10);
        if (major > 10 || (major === 10 && build >= 20348)) {
          return true;
        }
      }
    } catch (_) { }

    if (NativeAudioModule && typeof NativeAudioModule.ProcessLoopbackCapture?.isOfficiallySupported === 'function') {
      return NativeAudioModule.ProcessLoopbackCapture.isOfficiallySupported();
    }

    return false;
  }

  /**
   * Check if system is eligible for Process Loopback capability probing (Windows 10 2004+ Build >= 19041).
   */
  public isProbeEligible(): boolean {
    if (process.platform !== 'win32') {
      return false;
    }

    try {
      const release = os.release();
      const parts = release.split('.');
      if (parts.length >= 3) {
        const major = parseInt(parts[0], 10);
        const build = parseInt(parts[2], 10);
        if (major > 10 || (major === 10 && build >= 19041)) {
          return true;
        }
      }
    } catch (_) { }

    if (NativeAudioModule && typeof NativeAudioModule.ProcessLoopbackCapture?.isProbeEligible === 'function') {
      return NativeAudioModule.ProcessLoopbackCapture.isProbeEligible();
    }

    return false;
  }

  /**
   * General check: true if officially supported or probe eligible.
   */
  public isProcessLoopbackSupported(): boolean {
    return this.isOfficiallySupported() || this.isProbeEligible();
  }

  /**
   * Query the centralized Windows audio environment and capture strategy.
   */
  public getAudioEnvironment(): WindowsAudioEnvironment {
    return getWindowsAudioEnvironment(
      this.isOfficiallySupported(),
      this.isProbeEligible()
    );
  }

  /**
   * Start audio capture with centralized strategy decision and accurate Discord tree isolation.
   */
  public async start(deviceName?: string): Promise<AudioCaptureStartResult> {
    // Single producer guarantee: Stop any active capture first
    if (this.isCapturing) {
      await this.stop('restart_new_capture');
    }

    this.firstNativeBufferLogged = false;
    win10AudioLogger.startSession('audio');
    const diagnosticLogPath = win10AudioLogger.getCurrentLogFilePath() || undefined;

    const env = this.getAudioEnvironment();

    win10AudioLogger.logImmediate('MAIN', 'OS', {
      platform: process.platform,
      release: os.release(),
      build: env.build,
      displayVersion: env.windowsVersion
    });

    win10AudioLogger.logImmediate('MAIN', 'STRATEGY', {
      build: env.build,
      officialThreshold: 20348,
      officialSupported: env.officialProcessLoopbackSupported,
      probeEligible: env.processLoopbackProbeEligible,
      selectedStrategy: env.strategy
    });

    const isAddonAvailable = NativeAudioModule && NativeAudioModule.isNativeAddonAvailable();
    win10AudioLogger.logImmediate('MAIN', 'MODULE', {
      wrapperLoaded: Boolean(NativeAudioModule),
      addonAvailable: Boolean(isAddonAvailable),
      resolvedPath: NativeAudioModule?.getResolvedPath?.() || 'N/A',
      loadError: NativeAudioModule?.getLoadError?.()?.message || 'none',
      isOfficiallySupportedResult: NativeAudioModule?.ProcessLoopbackCapture?.isOfficiallySupported?.() ?? false,
      isProbeEligibleResult: NativeAudioModule?.ProcessLoopbackCapture?.isProbeEligible?.() ?? false,
      canAttemptResult: NativeAudioModule?.ProcessLoopbackCapture?.canAttemptProcessLoopback?.() ?? false
    });

    // ─── Case 1: Windows build requires Virtual Audio / Unsupported Loopback (e.g. Win 10 < 19041) ───
    if (env.strategy === AudioCaptureStrategy.VIRTUAL_AUDIO_REQUIRED) {
      console.warn(`[DiscordAudioIsolation] Process loopback audio isolation is unsupported on ${env.windowsVersion} build ${env.build}`);
      this.currentMode = 'NONE';

      win10AudioLogger.writeSummary({
        OS_BUILD: env.build,
        STRATEGY: env.strategy,
        DISCORD_DETECTED: false,
        DISCORD_ROOT_PID: 0,
        NATIVE_ADDON_LOADED: isAddonAvailable,
        FINAL_AUDIO_RESULT: 'VIDEO_ONLY',
        FAILURE_STAGE: 'UNSUPPORTED_OS_BUILD'
      });

      return {
        success: false,
        code: 'PROCESS_LOOPBACK_UNSUPPORTED',
        strategy: AudioCaptureStrategy.VIRTUAL_AUDIO_REQUIRED,
        windowsVersion: env.windowsVersion,
        build: env.build,
        mode: 'NONE',
        discordDetected: false,
        error: 'O isolamento de áudio por aplicativo não é compatível com esta versão do Windows (requer Windows 10 build 19041+ ou Windows 11). Para impedir que conversas do Discord sejam transmitidas, o compartilhamento será iniciado somente com vídeo.',
        diagnosticLogPath
      };
    }

    // ─── Case 2: Windows build supports Process Loopback or Probe ─────────────
    if (!isAddonAvailable) {
      console.error('[DiscordAudioIsolation] Native audio addon unavailable on this system.');
      win10AudioLogger.writeSummary({
        OS_BUILD: env.build,
        STRATEGY: env.strategy,
        DISCORD_DETECTED: false,
        DISCORD_ROOT_PID: 0,
        NATIVE_ADDON_LOADED: false,
        FINAL_AUDIO_RESULT: 'VIDEO_ONLY',
        FAILURE_STAGE: 'ADDON_UNAVAILABLE'
      });

      return {
        success: false,
        code: 'ADDON_UNAVAILABLE',
        strategy: env.strategy,
        windowsVersion: env.windowsVersion,
        build: env.build,
        mode: 'NONE',
        discordDetected: false,
        error: 'Addon nativo de captura de áudio indisponível no sistema.',
        diagnosticLogPath
      };
    }

    // Detect Discord process tree
    const detectionResult = await DiscordProcessDetector.detectDiscord();

    resolverLog(`--- DISCORD AUDIO ISOLATION SERVICE ---`);
    if (detectionResult.success) {
      resolverLog(`DetectorResult:\n  status=UNIQUE_ROOT\n  pid=${detectionResult.rootPid}\n  evidence=${detectionResult.evidence}`);
    } else if (detectionResult.reason === 'AMBIGUOUS_AUDIO_ROOTS' || detectionResult.reason === 'AMBIGUOUS_ROOTS') {
      resolverLog(`DetectorResult:\n  status=${detectionResult.reason}\n  roots=[${detectionResult.roots.join(', ')}]`);
    } else {
      resolverLog(`DetectorResult:\n  status=${detectionResult.reason}`);
    }

    const detectionReason = detectionResult.success ? 'OK' : detectionResult.reason;
    const detectionRoots = !detectionResult.success && 'roots' in detectionResult
      ? detectionResult.roots.join(', ')
      : 'N/A';
    const resolverTier = detectionResult.success ? detectionResult.evidence : 'NONE';

    win10AudioLogger.logImmediate('MAIN', 'DISCORD', {
      detected: detectionResult.success,
      reason: detectionReason,
      roots: detectionRoots,
      selectedRootPid: detectionResult.success ? detectionResult.rootPid : 0,
      resolverTier,
      ambiguous: !detectionResult.success && (detectionResult.reason === 'AMBIGUOUS_AUDIO_ROOTS' || detectionResult.reason === 'AMBIGUOUS_ROOTS')
    });

    // Fail closed if multiple ambiguous roots are detected
    if (!detectionResult.success && (detectionResult.reason === 'AMBIGUOUS_AUDIO_ROOTS' || detectionResult.reason === 'AMBIGUOUS_ROOTS')) {
      resolverLog(`IsolationDecision:\n  FAIL_CLOSED\n  reason=DISCORD_PROCESS_TREE_AMBIGUOUS\n`);
      console.warn('[DiscordAudioIsolation] Ambiguous Discord process trees detected. Failing closed to prevent leakage.');

      win10AudioLogger.writeSummary({
        OS_BUILD: env.build,
        STRATEGY: env.strategy,
        DISCORD_DETECTED: true,
        DISCORD_ROOT_PID: 0,
        NATIVE_ADDON_LOADED: true,
        FINAL_AUDIO_RESULT: 'VIDEO_ONLY',
        FAILURE_STAGE: 'DISCORD_PROCESS_TREE_AMBIGUOUS'
      });

      return {
        success: false,
        code: 'DISCORD_PROCESS_TREE_AMBIGUOUS',
        strategy: env.strategy,
        windowsVersion: env.windowsVersion,
        build: env.build,
        mode: 'NONE',
        discordDetected: true,
        error: 'Não foi possível isolar com segurança o áudio do Discord. A transmissão continuará sem áudio do sistema.',
        diagnosticLogPath
      };
    }

    const targetPid = detectionResult.success ? detectionResult.rootPid : 0;
    const discordDetected = detectionResult.success;

    resolverLog(`IsolationDecision:\n  START_PROCESS_LOOPBACK\n  targetPid=${targetPid}\n`);

    try {
      console.log(`[DiscordAudioIsolation] Starting Process Loopback capture with target Discord PID: ${targetPid}`);

      const nativeCapture = new NativeAudioModule.ProcessLoopbackCapture();

      if (typeof nativeCapture.setDiagnosticCallback === 'function') {
        nativeCapture.setDiagnosticCallback((category: string, message: string) => {
          win10AudioLogger.log('NATIVE', category, message);
        });
      }

      const started = nativeCapture.start(targetPid, (pcmBuffer: Float32Array) => {
        if (!this.firstNativeBufferLogged) {
          this.firstNativeBufferLogged = true;
          win10AudioLogger.logImmediate('MAIN', 'IPC', {
            firstNativeBufferReceived: true,
            samples: pcmBuffer.length,
            bytes: pcmBuffer.byteLength
          });
        }
        this.emit('data', pcmBuffer);
      });

      if (started) {
        this.nativeInstance = nativeCapture;
        this.isCapturing = true;
        this.currentMode = 'NATIVE_PROCESS_LOOPBACK';

        win10AudioLogger.logImmediate('MAIN', 'START', {
          started: true,
          mode: this.currentMode,
          targetPid
        });

        return {
          success: true,
          mode: this.currentMode,
          discordDetected,
          strategy: env.strategy,
          windowsVersion: env.windowsVersion,
          build: env.build,
          diagnosticLogPath
        };
      } else {
        console.error('[DiscordAudioIsolation] Native WASAPI process loopback start returned false.');

        win10AudioLogger.writeSummary({
          OS_BUILD: env.build,
          STRATEGY: env.strategy,
          DISCORD_DETECTED: discordDetected,
          DISCORD_ROOT_PID: targetPid,
          NATIVE_ADDON_LOADED: true,
          FINAL_AUDIO_RESULT: 'VIDEO_ONLY',
          FAILURE_STAGE: 'WASAPI_START_FAILED'
        });

        return {
          success: false,
          code: 'WASAPI_START_FAILED',
          mode: 'NONE',
          strategy: env.strategy,
          windowsVersion: env.windowsVersion,
          build: env.build,
          error: 'Falha ao iniciar a captura WASAPI Process Loopback.',
          diagnosticLogPath
        };
      }
    } catch (nativeErr: any) {
      console.error('[DiscordAudioIsolation] Exception starting native audio capture:', nativeErr.message);

      win10AudioLogger.writeSummary({
        OS_BUILD: env.build,
        STRATEGY: env.strategy,
        DISCORD_DETECTED: discordDetected,
        DISCORD_ROOT_PID: targetPid,
        NATIVE_ADDON_LOADED: true,
        FINAL_AUDIO_RESULT: 'VIDEO_ONLY',
        FAILURE_STAGE: 'WASAPI_EXCEPTION'
      });

      return {
        success: false,
        code: 'WASAPI_EXCEPTION',
        mode: 'NONE',
        strategy: env.strategy,
        windowsVersion: env.windowsVersion,
        build: env.build,
        error: nativeErr.message,
        diagnosticLogPath
      };
    }
  }

  /** Stop audio capture and release all resources */
  public async stop(reason = 'user_request'): Promise<void> {
    win10AudioLogger.logImmediate('MAIN', 'STOP', { reason });

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

    if (this.isCapturing) {
      console.log(`[DiscordAudioIsolation] Capture stopped (reason: ${reason})`);
    }

    this.isCapturing = false;
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
