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
  public async start(sampleRate = 48000): Promise<void> {
    if (this.isStarted) {
      this.stop();
    }

    // Check electronAPI is available (running inside Electron)
    if (!window.electronAPI?.startAudioCapture) {
      console.warn('[AudioCaptureManager] electronAPI not available — running in browser mode without native audio');
      return;
    }

    // 1. Create AudioContext at the stream's sample rate
    this.audioContext = new AudioContext({ sampleRate, latencyHint: 'interactive' });

    // 2. Load the AudioWorklet from an inline Blob URL (avoids separate .js file bundling)
    const blob = new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(blob);
    await this.audioContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    // 3. Create worklet node + destination
    this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-stream-processor', {
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.workletNode.connect(this.destinationNode);

    // 4. Extract the audio track from the destination stream
    this.audioTrack = this.destinationNode.stream.getAudioTracks()[0] ?? null;

    if (!this.audioTrack) {
      console.error('[AudioCaptureManager] Failed to create audio track from destination node');
      this.stop();
      return;
    }

    // 5. Start WASAPI/ffmpeg capture in Electron main process
    await window.electronAPI.startAudioCapture();

    // 6. Register IPC listener for audio buffer chunks
    const handler = (buffer: Float32Array) => {
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'pcm', samples: buffer }, [buffer.buffer]);
      }
    };

    this.ipcCleanup = window.electronAPI.onAudioBuffer(handler);
    this.isStarted = true;

    console.log('[AudioCaptureManager] Started — audio track id:', this.audioTrack.id);
  }

  /** Stop capture and release all resources */
  public stop(): void {
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    if (window.electronAPI?.stopAudioCapture) {
      window.electronAPI.stopAudioCapture().catch(() => {});
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
      this.audioContext.close().catch(() => {});
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
