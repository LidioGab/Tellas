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

  /** Start the audio capture pipeline */
  public async start(sampleRate = 48000): Promise<{ success: boolean; error?: string; code?: string }> {
    if (this.isStarted) {
      this.stop();
    }

    // Check electronAPI is available (running inside Electron)
    if (!window.electronAPI?.startAudioCapture) {
      console.warn('[AudioCaptureManager] electronAPI not available — running in browser mode without native audio');
      return { success: false, error: 'electronAPI indisponível' };
    }

    // 1. Request main process to start audio capture based on OS capability
    const captureResult = await window.electronAPI.startAudioCapture();
    console.log('[AudioCaptureManager] startAudioCapture result:', captureResult);

    if (!captureResult || !captureResult.success) {
      const errMsg = captureResult?.error || 'Captura de áudio indisponível neste sistema';
      console.warn('[AudioCaptureManager] Audio capture not started:', errMsg);
      this.stop();
      return {
        success: false,
        error: errMsg,
        code: captureResult?.code
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

      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.workletNode.connect(this.destinationNode);

      // 5. Extract the audio track from the destination stream
      this.audioTrack = this.destinationNode.stream.getAudioTracks()[0] ?? null;

      if (!this.audioTrack) {
        console.error('[AudioCaptureManager] Failed to create audio track from destination node');
        this.stop();
        return { success: false, error: 'Falha ao criar AudioTrack do Web Audio' };
      }

      // 6. Register IPC listener for audio buffer chunks
      const handler = (buffer: Float32Array) => {
        if (this.workletNode) {
          this.workletNode.port.postMessage({ type: 'pcm', samples: buffer }, [buffer.buffer]);
        }
      };

      this.ipcCleanup = window.electronAPI.onAudioBuffer(handler);
      this.isStarted = true;

      console.log('[AudioCaptureManager] Started successfully — audio track id:', this.audioTrack.id);
      return { success: true };
    } catch (err: any) {
      console.error('[AudioCaptureManager] Audio graph initialization error:', err);
      this.stop();
      return { success: false, error: err.message };
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
}

export const audioCaptureManager = new AudioCaptureManager();
