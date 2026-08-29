import { PCM_WORKLET_CODE } from './pcm-worklet-processor';

/**
 * AudioCaptureManager
 *
 * Bridges the IPC audio-buffer stream from Electron's main process
 * into a Web Audio API AudioWorklet, producing a live MediaStreamTrack
 * that can be passed to WebRTC as the audio track.
 *
 * Architecture:
 *   [Electron Main] → IPC 'audio-buffer' → [onAudioBuffer IPC listener]
 *        → [AudioWorkletNode port] → [PcmStreamProcessor (AudioWorklet thread)]
 *        → [AudioContext] → [MediaStreamAudioDestinationNode]
 *        → [MediaStreamTrack] → [LiveKit publishTrack()]
 */
export class AudioCaptureManager {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private isStarted = false;
  private ipcCleanup: (() => void) | null = null;
  private firstRendererBufferLogged = false;
  private lastDiagnosticLogPath: string | null = null;

  /** Start the audio capture pipeline */
  public async start(sampleRate = 48000): Promise<{ success: boolean; error?: string; code?: string; diagnosticLogPath?: string }> {
    if (this.isStarted) {
      this.stop();
    }

    this.firstRendererBufferLogged = false;

    // Check electronAPI is available (running inside Electron)
    if (!window.electronAPI?.startAudioCapture) {
      console.warn('[AudioCaptureManager] electronAPI not available — running in browser mode without native audio');
      return { success: false, error: 'electronAPI indisponível' };
    }

    window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_START_CALLED', {
      sampleRate,
      timestamp: new Date().toISOString()
    }, 'RENDERER');

    // 1. Request main process to start audio capture based on OS capability
    const captureResult = await window.electronAPI.startAudioCapture();
    console.log('[AudioCaptureManager] startAudioCapture result:', captureResult);

    if (captureResult?.diagnosticLogPath) {
      this.lastDiagnosticLogPath = captureResult.diagnosticLogPath;
    }

    window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_CAPTURE_RESULT', {
      success: captureResult?.success,
      code: captureResult?.code,
      strategy: captureResult?.strategy,
      windowsVersion: captureResult?.windowsVersion,
      build: captureResult?.build,
      error: captureResult?.error
    }, 'RENDERER');

    if (!captureResult || !captureResult.success) {
      const errMsg = captureResult?.error || 'Captura de áudio indisponível neste sistema';
      console.warn('[AudioCaptureManager] Audio capture not started:', errMsg);
      this.stop();
      return {
        success: false,
        error: errMsg,
        code: captureResult?.code,
        diagnosticLogPath: captureResult?.diagnosticLogPath
      };
    }

    try {
      // 2. Create AudioContext at the stream's sample rate
      this.audioContext = new AudioContext({ sampleRate, latencyHint: 'interactive' });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume().catch(() => {});
      }

      // 3. Load the AudioWorklet from an inline Blob URL
      const blob = new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await this.audioContext.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      // 4. Create worklet node + destination
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-stream-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });

      // Handle diagnostic messages from worklet
      this.workletNode.port.onmessage = (e) => {
        if (e.data?.type === 'diagnostic') {
          window.electronAPI?.sendAudioDiagnosticEvent?.(e.data.category, e.data.data, 'WORKLET');
        }
      };

      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.workletNode.connect(this.destinationNode);

      window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_GRAPH', {
        audioContextState: this.audioContext.state,
        sampleRate: this.audioContext.sampleRate,
        workletCreated: true,
        destinationCreated: true
      }, 'RENDERER');

      // 5. Extract the audio track from the destination stream
      this.audioTrack = this.destinationNode.stream.getAudioTracks()[0] ?? null;

      if (!this.audioTrack) {
        console.error('[AudioCaptureManager] Failed to create audio track from destination node');
        window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_TRACK_ERROR', { error: 'Failed to create audio track' }, 'RENDERER');
        this.stop();
        return { success: false, error: 'Falha ao criar AudioTrack do Web Audio', diagnosticLogPath: captureResult?.diagnosticLogPath };
      }

      window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_TRACK', {
        trackId: this.audioTrack.id,
        kind: this.audioTrack.kind,
        readyState: this.audioTrack.readyState,
        enabled: this.audioTrack.enabled,
        muted: this.audioTrack.muted
      }, 'RENDERER');

      // 6. Register IPC listener for audio buffer chunks
      const handler = (buffer: Float32Array) => {
        if (!this.firstRendererBufferLogged) {
          this.firstRendererBufferLogged = true;
          let peak = 0;
          let sumSq = 0;
          for (let i = 0; i < buffer.length; i++) {
            const abs = Math.abs(buffer[i]);
            if (abs > peak) peak = abs;
            sumSq += buffer[i] * buffer[i];
          }
          const rms = Math.sqrt(sumSq / buffer.length);

          window.electronAPI?.sendAudioDiagnosticEvent?.('FIRST_IPC_BUFFER', {
            samples: buffer.length,
            peak: peak.toFixed(4),
            rms: rms.toFixed(4),
            nonZero: peak > 0.00001
          }, 'RENDERER');
        }

        if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'pcm', samples: buffer }, [buffer.buffer]);
        }
      };

      this.ipcCleanup = window.electronAPI.onAudioBuffer(handler);
      this.isStarted = true;

      console.log('[AudioCaptureManager] Started successfully — audio track id:', this.audioTrack.id);
      return { success: true, diagnosticLogPath: captureResult?.diagnosticLogPath };
    } catch (err: any) {
      console.error('[AudioCaptureManager] Audio graph initialization error:', err);
      window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_GRAPH_ERROR', { error: err.message }, 'RENDERER');
      this.stop();
      return { success: false, error: err.message, diagnosticLogPath: captureResult?.diagnosticLogPath };
    }
  }

  /** Stop capture and release all resources */
  public stop(): void {
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    if (window.electronAPI?.stopAudioCapture) {
      window.electronAPI.stopAudioCapture().catch(() => { });
    }

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.destinationNode) {
      this.destinationNode.disconnect();
      this.destinationNode = null;
    }

    if (this.audioTrack) {
      this.audioTrack.stop();
      this.audioTrack = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => { });
      this.audioContext = null;
    }

    this.isStarted = false;
    console.log('[AudioCaptureManager] Stopped');
  }

  /** Returns the live audio MediaStreamTrack, or null if not started */
  public getAudioTrack(): MediaStreamTrack | null {
    return this.audioTrack;
  }

  public get started(): boolean {
    return this.isStarted;
  }

  public getDiagnosticLogPath(): string | null {
    return this.lastDiagnosticLogPath;
  }
}

export const audioCaptureManager = new AudioCaptureManager();
