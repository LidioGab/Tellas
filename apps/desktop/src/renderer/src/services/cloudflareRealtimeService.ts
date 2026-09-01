export interface RemoteStreamInfo {
  participantId: string;
  displayName: string;
  stream: MediaStream;
}

export type RealtimeConnectionState = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface CloudflareRealtimeCallbacks {
  onRemoteTrackSubscribed: (info: RemoteStreamInfo) => void;
  onRemoteTrackUnsubscribed: (participantId: string) => void;
  onConnectionStateChanged: (state: RealtimeConnectionState) => void;
  onError: (error: Error) => void;
  onSubscriptionFailed?: (participantId: string, error: Error) => void;
}

interface SessionDescriptionPayload {
  sdp: string;
  type: 'offer' | 'answer';
}

interface ApiErrorPayload {
  error?: string;
  code?: string;
}
export class RealtimeApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'RealtimeApiError';
  }
}

export function isRoomNotFoundError(error: unknown): boolean {
  return (error instanceof RealtimeApiError && error.code === 'ROOM_NOT_FOUND')
    || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ROOM_NOT_FOUND');
}
const DEV = import.meta.env.DEV;
type CleanupReason = 'viewer-close' | 'switch-target' | 'stream-stopped' | 'user-left' | 'timeout' | 'reconnect' | 'cleanup' | 'other';

function getBackendUrl(): string {
  const envUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (envUrl?.trim()) return envUrl.trim();
  return 'https://tellas.fly.dev';
}

function toPayload(description: RTCSessionDescription | RTCSessionDescriptionInit): SessionDescriptionPayload {
  if (!description.sdp || (description.type !== 'offer' && description.type !== 'answer')) {
    throw new Error('Descrição WebRTC inválida.');
  }
  return { sdp: description.sdp, type: description.type };
}

async function waitForIceGathering(peerConnection: RTCPeerConnection): Promise<void> {
  if (peerConnection.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    let candidateGraceTimeout: number | null = null;
    const maximumWaitTimeout = window.setTimeout(done, 2_000);

    function done() {
      window.clearTimeout(maximumWaitTimeout);
      if (candidateGraceTimeout !== null) window.clearTimeout(candidateGraceTimeout);
      peerConnection.removeEventListener('icegatheringstatechange', check);
      peerConnection.removeEventListener('icecandidate', handleCandidate);
      resolve();
    }

    function check() {
      if (peerConnection.iceGatheringState === 'complete') done();
    }

    function handleCandidate(event: RTCPeerConnectionIceEvent) {
      const candidate = event.candidate?.candidate || '';
      if (!candidate) {
        if (peerConnection.iceGatheringState === 'complete') done();
        return;
      }
      if (/ typ (srflx|relay) /i.test(candidate)) {
        done();
        return;
      }
      if (candidateGraceTimeout === null) {
        candidateGraceTimeout = window.setTimeout(done, 500);
      }
    }

    peerConnection.addEventListener('icegatheringstatechange', check);
    peerConnection.addEventListener('icecandidate', handleCandidate);

    const existingSdp = peerConnection.localDescription?.sdp || '';
    if (/ typ (srflx|relay) /i.test(existingSdp)) done();
    else if (/a=candidate:/i.test(existingSdp)) candidateGraceTimeout = window.setTimeout(done, 500);
  });
}

export class CloudflareRealtimeService {
  private peerConnection: RTCPeerConnection | null = null;
  private callbacks: CloudflareRealtimeCallbacks | null = null;
  private sessionToken: string | null = null;
  private sessionId: string | null = null;
  private connectingPromise: Promise<void> | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private currentlySubscribedParticipantId: string | null = null;
  private subscriptionGeneration = 0;
  private subscriptionTimeout: ReturnType<typeof setTimeout> | null = null;
  private remoteMids: string[] = [];
  private localStream: MediaStream | null = null;
  private recovering = false;
  private intentionalClose = false;
  private participantId: string | null = null;
  private roomId: string | null = null;
  private reconnectAttempt = 0;
  private readonly backendUrl = getBackendUrl();

  setCallbacks(callbacks: CloudflareRealtimeCallbacks): void {
    this.callbacks = callbacks;
  }

  setSessionToken(token: string | null): void {
    this.sessionToken = token;
  }

  setDiagnosticContext(roomId: string | null, participantId: string | null): void {
    this.roomId = roomId;
    this.participantId = participantId;
    if (DEV) console.log('[CLOUDFLARE][ACTIVE_MEDIA_PROVIDER]', { provider: 'cloudflare' });
  }

  private async api<T>(path: string, body: unknown = {}): Promise<T> {
    if (!this.sessionToken) throw new Error('Sessão Tellas ausente.');
    const serializedBody = JSON.stringify(body);
    const response = await fetch(`${this.backendUrl}/api/realtime/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sessionToken}`,
      },
      body: serializedBody,
    });
    const payload = await response.json().catch(() => ({})) as T & ApiErrorPayload;
    if (!response.ok) throw new RealtimeApiError(payload.error || `Falha no transporte Cloudflare (HTTP ${response.status}).`, response.status, payload.code);
    return payload;
  }

  async connect(): Promise<void> {
    if (this.connected || this.connectingPromise) return this.connectingPromise || Promise.resolve();
    if (this.peerConnection || this.sessionId) await this.discardMediaSession('invalid-session');
    const startedAt = performance.now();
    if (DEV) console.log('[CLOUDFLARE][SESSION_CREATE_REQUEST]', {
      participantId: this.participantId,
      roomId: this.roomId,
      hasExistingSession: Boolean(this.sessionId),
      peerConnectionState: this.peerConnection?.connectionState || 'none',
    });
    this.connectingPromise = (async () => {
      this.intentionalClose = false;
      const result = await this.api<{ sessionId: string; sessionDescription?: SessionDescriptionPayload }>('session');
      this.sessionId = result.sessionId;
      this.createPeerConnection();
      if (result.sessionDescription) await this.peerConnection!.setRemoteDescription(result.sessionDescription);
      if (DEV) console.log('[CLOUDFLARE][SESSION_CREATED]', { participantId: this.participantId, roomId: this.roomId, sessionId: this.sessionId, elapsedMs: Math.round(performance.now() - startedAt) });
    })().finally(() => {
      this.connectingPromise = null;
    });
    return this.connectingPromise;
  }

  private createPeerConnection(): void {
    const peerConnection = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
    if (DEV) console.log('[CLOUDFLARE][PC_CREATED]', { sessionId: this.sessionId, participantId: this.participantId, roomId: this.roomId, iceServerCount: 1 });
    let previousConnection = peerConnection.connectionState;
    peerConnection.onconnectionstatechange = () => {
      if (DEV && previousConnection !== peerConnection.connectionState) console.log('[CLOUDFLARE][PC_CONNECTION_STATE]', { previous: previousConnection, current: peerConnection.connectionState, sessionId: this.sessionId });
      previousConnection = peerConnection.connectionState;
      this.callbacks?.onConnectionStateChanged(peerConnection.connectionState);
      if (!this.intentionalClose && (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected')) {
        if (DEV) console.log('[CLOUDFLARE][RECONNECT_TRIGGERED]', { participantId: this.participantId, roomId: this.roomId, previousSessionId: this.sessionId, reason: peerConnection.connectionState, wasPublishing: Boolean(this.localStream), watchingParticipantId: this.currentlySubscribedParticipantId });
        void this.recover().catch((error) => this.callbacks?.onError(error instanceof Error ? error : new Error(String(error))));
      }
    };
    peerConnection.ontrack = (event) => {
      const target = this.currentlySubscribedParticipantId;
      if (!target || (event.track.kind !== 'video' && event.track.kind !== 'audio')) {
        event.track.stop();
        return;
      }
      const previousStream = this.remoteStreams.get(target);
      const stream = new MediaStream(previousStream?.getTracks() || []);
      if (!stream.getTracks().some((track) => track.id === event.track.id)) stream.addTrack(event.track);
      this.remoteStreams.set(target, stream);
      event.track.onended = () => this.removeRemoteTrack(target, event.track.id);
      if (DEV) console.log('[CLOUDFLARE][REMOTE_TRACK_RECEIVED]', { targetParticipantId: target, kind: event.track.kind, mid: event.transceiver.mid, readyState: event.track.readyState, generation: this.subscriptionGeneration });
      this.callbacks?.onRemoteTrackSubscribed({ participantId: target, displayName: '', stream });
    };
    this.peerConnection = peerConnection;
  }

  async publishStream(stream: MediaStream): Promise<void> {
    await this.connect();
    if (!this.peerConnection) throw new Error('PeerConnection Cloudflare indisponível.');
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();
    if (videoTracks.length !== 1 || audioTracks.length > 1) throw new Error('A publicação requer uma tela e no máximo um áudio de sistema.');
    if (DEV) {
      console.log('[CLOUDFLARE][PUBLISH_REQUEST]', { participantId: this.participantId, roomId: this.roomId, hasVideoTrack: videoTracks.length > 0, hasAudioTrack: audioTracks.length > 0 });
    }
    const senders = [...videoTracks, ...audioTracks].map((track) => this.peerConnection!.addTrack(track, stream));
    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      await waitForIceGathering(this.peerConnection);
      const localDescription = this.peerConnection.localDescription;
      if (!localDescription) throw new Error('Oferta WebRTC local ausente.');
      const tracks = [...videoTracks, ...audioTracks].map((track) => {
        const transceiver = this.peerConnection!.getTransceivers().find((item) => item.sender.track?.id === track.id);
        if (!transceiver?.mid) throw new Error(`MID ausente para track ${track.kind}.`);
        return { mid: transceiver.mid, kind: track.kind as 'video' | 'audio' };
      });
      const result = await this.api<{ sessionDescription: SessionDescriptionPayload }>('publish', {
        sessionDescription: toPayload(localDescription),
        tracks,
      });
      await this.peerConnection.setRemoteDescription(result.sessionDescription);
      this.localStream = stream;
    } catch (error) {
      for (const sender of senders) this.peerConnection?.removeTrack(sender);
      this.localStream = null;
      if (error instanceof RealtimeApiError && error.status === 410) await this.discardMediaSession('cloudflare-session-disconnected');
      else if (this.peerConnection?.signalingState === 'have-local-offer') await this.peerConnection.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
      throw error;
    }
  }

  async replacePublishedVideoTrack(newTrack: MediaStreamTrack): Promise<MediaStreamTrack> {
    if (!this.peerConnection || !this.localStream) {
      throw new Error('Publicação Cloudflare ativa não encontrada.');
    }
    if (newTrack.kind !== 'video') {
      throw new Error('A nova fonte precisa fornecer uma track de vídeo.');
    }

    const currentTrack = this.localStream.getVideoTracks()[0];
    if (!currentTrack) throw new Error('Track de vídeo atual não encontrada.');
    const sender = this.peerConnection.getSenders().find((item) => item.track?.id === currentTrack.id)
      || this.peerConnection.getSenders().find((item) => item.track?.kind === 'video');
    if (!sender) throw new Error('Sender de vídeo ativo não encontrado.');

    await sender.replaceTrack(newTrack);
    this.localStream.removeTrack(currentTrack);
    this.localStream.addTrack(newTrack);
    return currentTrack;
  }

  async subscribeToParticipant(participantId: string): Promise<void> {
    const previous = this.currentlySubscribedParticipantId;
    if (previous && previous !== participantId) {
      if (DEV) console.log('[CLOUDFLARE][SWITCH_TARGET]', { previousParticipantId: previous, nextParticipantId: participantId, generation: this.subscriptionGeneration + 1 });
      await this.unsubscribeFromParticipant(previous, false, 'switch-target');
      if (DEV) console.log('[CLOUDFLARE][SWITCH_OLD_TARGET_CLOSED]', { previousParticipantId: previous });
    }
    await this.connect();
    if (!this.peerConnection) throw new Error('PeerConnection Cloudflare indisponível.');
    const generation = ++this.subscriptionGeneration;
    this.currentlySubscribedParticipantId = participantId;
    this.remoteStreams.delete(participantId);
    this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    if (DEV) console.log('[CLOUDFLARE][SUBSCRIBE_REQUEST]', { callerParticipantId: this.participantId, targetParticipantId: participantId, roomId: this.roomId, sessionId: this.sessionId, generation });
    try {
      const result = await this.api<{ sessionDescription: SessionDescriptionPayload; remoteMids: string[] }>('subscribe', { targetParticipantId: participantId });
      if (generation !== this.subscriptionGeneration || participantId !== this.currentlySubscribedParticipantId) {
        if (DEV) console.log('[CLOUDFLARE][STALE_OPERATION_IGNORED]', { operation: 'subscribe', participantId, operationGeneration: generation, currentGeneration: this.subscriptionGeneration });
        await this.api('unsubscribe').catch(() => undefined);
        return;
      }
      this.remoteMids = result.remoteMids || [];
      await this.peerConnection.setRemoteDescription(result.sessionDescription);
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      await waitForIceGathering(this.peerConnection);
      if (!this.peerConnection.localDescription) throw new Error('Resposta WebRTC local ausente.');
      await this.api('renegotiate', { sessionDescription: toPayload(this.peerConnection.localDescription) });
      this.clearSubscriptionTimeout();
      this.subscriptionTimeout = setTimeout(() => {
        void this.getInboundMediaStats().then((stats) => {
          if (generation !== this.subscriptionGeneration || stats.videoFramesDecoded > 0) return;
          const error = new Error('O vídeo da transmissão não começou a chegar. Tente assistir novamente.');
          void this.unsubscribeFromParticipant(participantId, true, 'timeout')
            .finally(() => this.callbacks?.onSubscriptionFailed?.(participantId, error));
        }).catch((error) => this.callbacks?.onError(error instanceof Error ? error : new Error(String(error))));
      }, 5_000);
    } catch (error) {
      if (generation === this.subscriptionGeneration) {
        await this.api('unsubscribe').catch(() => undefined);
        this.currentlySubscribedParticipantId = null;
        this.callbacks?.onSubscriptionFailed?.(participantId, error instanceof Error ? error : new Error(String(error)));
      }
      if (error instanceof RealtimeApiError && error.status === 410) await this.discardMediaSession('cloudflare-session-disconnected');
      throw error;
    }
  }

  async unsubscribeFromParticipant(participantId: string, invalidate = true, reason: CleanupReason = 'viewer-close'): Promise<void> {
    if (invalidate) this.subscriptionGeneration++;
    if (DEV) console.log('[CLOUDFLARE][UNSUBSCRIBE_REQUEST]', { participantId, sessionId: this.sessionId, generation: this.subscriptionGeneration, reason });
    this.clearSubscriptionTimeout();
    if (participantId === this.currentlySubscribedParticipantId) {
      await this.api('unsubscribe').catch((error) => { if (DEV) console.warn('[CLOUDFLARE][UNSUBSCRIBE_FAILED]', error); });
    }
    const stream = this.remoteStreams.get(participantId);
    const removedVideoTracks = stream?.getVideoTracks().length || 0;
    const removedAudioTracks = stream?.getAudioTracks().length || 0;
    stream?.getTracks().forEach((track) => track.stop());
    this.remoteStreams.delete(participantId);
    this.remoteMids = [];
    if (this.currentlySubscribedParticipantId === participantId) this.currentlySubscribedParticipantId = null;
    this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    if (DEV) console.log('[CLOUDFLARE][REMOTE_MEDIA_CLEARED]', { participantId, removedVideoTracks, removedAudioTracks, reason });
  }

  async unsubscribeAll(): Promise<void> {
    const target = this.currentlySubscribedParticipantId;
    if (target) await this.unsubscribeFromParticipant(target);
    else {
      for (const stream of this.remoteStreams.values()) stream.getTracks().forEach((track) => track.stop());
      this.remoteStreams.clear();
    }
  }

  async unpublishAllTracks(): Promise<void> {
    if (!this.localStream) return;
    if (DEV) console.log('[CLOUDFLARE][STOP_PUBLISH_REQUEST]', { participantId: this.participantId, sessionId: this.sessionId, watchingParticipantId: this.currentlySubscribedParticipantId });
    await this.api('unpublish');
    if (this.peerConnection) {
      for (const sender of this.peerConnection.getSenders()) {
        if (sender.track && this.localStream.getTracks().some((track) => track.id === sender.track?.id)) {
          this.peerConnection.removeTrack(sender);
        }
      }
    }
    this.localStream = null;
    if (DEV) console.log('[CLOUDFLARE][STOP_PUBLISH_COMPLETE]', { participantId: this.participantId, stillWatchingParticipantId: this.currentlySubscribedParticipantId });
  }

  async disconnect(): Promise<void> {
    this.intentionalClose = true;
    this.subscriptionGeneration++;
    this.clearSubscriptionTimeout();
    await this.api('disconnect').catch(() => undefined);
    this.remoteStreams.forEach((stream) => stream.getTracks().forEach((track) => track.stop()));
    this.remoteStreams.clear();
    this.peerConnection?.close();
    this.peerConnection = null;
    this.sessionId = null;
    this.currentlySubscribedParticipantId = null;
    this.remoteMids = [];
    this.localStream = null;
    this.callbacks?.onConnectionStateChanged('closed');
  }

  private async recover(): Promise<void> {
    if (this.recovering || this.intentionalClose) return;
    this.recovering = true;
    const localStream = this.localStream;
    const target = this.currentlySubscribedParticipantId;
    const oldSessionId = this.sessionId;
    const attempt = ++this.reconnectAttempt;
    if (DEV) console.log('[CLOUDFLARE][RECONNECT_ATTEMPT]', { attempt, delayMs: 0, generation: this.subscriptionGeneration });
    try {
      this.intentionalClose = true;
      await this.api('disconnect').catch(() => undefined);
      this.peerConnection?.close();
      this.peerConnection = null;
      this.sessionId = null;
      this.currentlySubscribedParticipantId = null;
      this.remoteStreams.clear();
      this.intentionalClose = false;
      await this.connect();
      if (DEV) console.log('[CLOUDFLARE][RECONNECT_SESSION_CREATED]', { oldSessionId, newSessionId: this.sessionId });
      if (localStream) { if (DEV) console.log('[CLOUDFLARE][RECONNECT_REPUBLISH]', { video: localStream.getVideoTracks().length > 0, audio: localStream.getAudioTracks().length > 0 }); await this.publishStream(localStream); }
      if (target) { if (DEV) console.log('[CLOUDFLARE][RECONNECT_RESUBSCRIBE]', { targetParticipantId: target }); await this.subscribeToParticipant(target); }
      else if (DEV) console.log('[CLOUDFLARE][RECONNECT_IDLE]', { remoteTracksRequested: 0 });
      if (DEV) console.log('[CLOUDFLARE][RECONNECT_COMPLETE]', { isPublishing: Boolean(this.localStream), watchingParticipantId: this.currentlySubscribedParticipantId });
    } finally {
      this.recovering = false;
    }
  }

  private async discardMediaSession(reason: string): Promise<void> {
    if (DEV) console.log('[CLOUDFLARE][SESSION_INVALIDATED]', { participantId: this.participantId, roomId: this.roomId, sessionId: this.sessionId, reason, connectionState: this.peerConnection?.connectionState, signalingState: this.peerConnection?.signalingState });
    await this.api('disconnect').catch(() => undefined);
    this.peerConnection?.close();
    this.peerConnection = null;
    this.sessionId = null;
    this.localStream = null;
    this.currentlySubscribedParticipantId = null;
    this.remoteStreams.forEach((remoteStream, participantId) => {
      remoteStream.getTracks().forEach((track) => track.stop());
      this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    });
    this.remoteStreams.clear();
    this.remoteMids = [];
  }

  private removeRemoteTrack(participantId: string, trackId: string): void {
    const stream = this.remoteStreams.get(participantId);
    const track = stream?.getTracks().find((item) => item.id === trackId);
    if (stream && track) stream.removeTrack(track);
    if (!stream || stream.getTracks().length === 0) {
      this.remoteStreams.delete(participantId);
      this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    }
  }

  private clearSubscriptionTimeout(): void {
    if (this.subscriptionTimeout) clearTimeout(this.subscriptionTimeout);
    this.subscriptionTimeout = null;
  }

  async getInboundMediaStats(): Promise<{ participantId: string | null; videoBytesReceived: number; videoFramesDecoded: number; audioBytesReceived: number; videoTracks: number; audioTracks: number }> {
    let videoBytesReceived = 0;
    let videoFramesDecoded = 0;
    let audioBytesReceived = 0;
    let videoTracks = 0;
    let audioTracks = 0;
    if (this.peerConnection) {
      const report = await this.peerConnection.getStats();
      report.forEach((stat) => {
        if (stat.type !== 'inbound-rtp' || stat.isRemote || typeof stat.bytesReceived !== 'number') return;
        if (stat.kind === 'video' || stat.mediaType === 'video') {
          videoTracks++;
          videoBytesReceived += stat.bytesReceived;
          videoFramesDecoded += typeof stat.framesDecoded === 'number' ? stat.framesDecoded : 0;
        } else if (stat.kind === 'audio' || stat.mediaType === 'audio') {
          audioTracks++;
          audioBytesReceived += stat.bytesReceived;
        }
      });
    }
    return { participantId: this.currentlySubscribedParticipantId, videoBytesReceived, videoFramesDecoded, audioBytesReceived, videoTracks, audioTracks };
  }

  get connected(): boolean {
    return Boolean(this.peerConnection && this.sessionId && this.peerConnection.connectionState !== 'closed' && this.peerConnection.connectionState !== 'failed');
  }

  get isConnecting(): boolean {
    return this.connectingPromise !== null;
  }
}

export const cloudflareRealtimeService = new CloudflareRealtimeService();
