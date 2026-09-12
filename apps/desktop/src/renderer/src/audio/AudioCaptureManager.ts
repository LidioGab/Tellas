import { PCM_WORKLET_CODE } from './pcm-worklet-processor';

export class AudioCaptureManager {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private isStarted = false;
  private ipcCleanup: (() => void) | null = null;
  private firstRendererBufferLogged = false;
  private lastDiagnosticLogPath: string | null = null;

  public async start(sampleRate = 48000): Promise<{ success: boolean; error?: string; code?: string; diagnosticLogPath?: string }> {
    if (this.isStarted) this.stop();
    this.firstRendererBufferLogged = false;
    if (!window.electronAPI?.startAudioCapture) return { success: false, error: 'electronAPI indisponível' };
    window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_START_CALLED', { sampleRate, timestamp: new Date().toISOString() }, 'RENDERER');

    try {
      // The consumer must be ready before WASAPI starts producing frames.
      this.audioContext = new AudioContext({ sampleRate, latencyHint: 'interactive' });
      if (this.audioContext.state === 'suspended') await this.audioContext.resume().catch(() => undefined);
      const url = URL.createObjectURL(new Blob([PCM_WORKLET_CODE], { type: 'application/javascript' }));
      try { await this.audioContext.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-stream-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletNode.port.onmessage = (event) => {
        if (event.data?.type === 'diagnostic') {
          window.electronAPI?.sendAudioDiagnosticEvent?.(event.data.category, event.data.data, 'WORKLET');
        }
      };
      this.destinationNode = this.audioContext.createMediaStreamDestination();
      this.workletNode.connect(this.destinationNode);
      this.audioTrack = this.destinationNode.stream.getAudioTracks()[0] ?? null;
      if (!this.audioTrack) throw new Error('Falha ao criar AudioTrack do Web Audio');

      this.ipcCleanup = window.electronAPI.onAudioBuffer((frame) => {
        if (!frame?.samples || frame.sampleRate !== sampleRate || frame.channels !== 2 || !this.workletNode) return;
        if (!this.firstRendererBufferLogged) {
          this.firstRendererBufferLogged = true;
          window.electronAPI?.sendAudioDiagnosticEvent?.('FIRST_IPC_BUFFER', {
            sequence: frame.sequence,
            samples: frame.samples.length,
            frameCount: frame.frameCount,
          }, 'RENDERER');
        }
        this.workletNode.port.postMessage({ type: 'audio-frame', ...frame }, [frame.samples.buffer]);
      });

      const result = await window.electronAPI.startAudioCapture();
      if (result?.diagnosticLogPath) this.lastDiagnosticLogPath = result.diagnosticLogPath;
      window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_CAPTURE_RESULT', result, 'RENDERER');
      if (!result?.success) {
        const failure = { success: false, error: result?.error || 'Captura de áudio indisponível', code: result?.code, diagnosticLogPath: result?.diagnosticLogPath };
        this.stop();
        return failure;
      }

      this.isStarted = true;
      window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_GRAPH', {
        audioContextState: this.audioContext.state,
        sampleRate: this.audioContext.sampleRate,
        trackId: this.audioTrack.id,
      }, 'RENDERER');
      return { success: true, diagnosticLogPath: result.diagnosticLogPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.electronAPI.sendAudioDiagnosticEvent?.('AUDIO_GRAPH_ERROR', { error: message }, 'RENDERER');
      this.stop();
      return { success: false, error: message, diagnosticLogPath: this.lastDiagnosticLogPath || undefined };
    }
  }

  public stop(): void {
    this.ipcCleanup?.();
    this.ipcCleanup = null;
    void window.electronAPI?.stopAudioCapture?.().catch(() => undefined);
    this.workletNode?.port.postMessage({ type: 'reset' });
    this.workletNode?.disconnect();
    this.destinationNode?.disconnect();
    this.audioTrack?.stop();
    void this.audioContext?.close().catch(() => undefined);
    this.workletNode = null;
    this.destinationNode = null;
    this.audioTrack = null;
    this.audioContext = null;
    this.isStarted = false;
  }

  public getAudioTrack(): MediaStreamTrack | null { return this.audioTrack; }
  public get started(): boolean { return this.isStarted; }
  public getDiagnosticLogPath(): string | null { return this.lastDiagnosticLogPath; }
}

export const audioCaptureManager = new AudioCaptureManager();
