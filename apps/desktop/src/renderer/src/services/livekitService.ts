import {
  Room,
  RoomEvent,
  Track,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  LocalTrackPublication,
  VideoPresets,
  ConnectionState,
  DisconnectReason,
  type VideoCodec,
} from 'livekit-client';
import type {
  LiveKitTokenResponse,
  LiveKitTokenRequest,
  VideoQualityPreset,
} from '@stream-app/shared';
import { VIDEO_QUALITY_PRESETS } from '@stream-app/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RemoteStreamInfo {
  participantId: string;
  displayName: string;
  stream: MediaStream;
}

export interface LiveKitCallbacks {
  onRemoteTrackSubscribed: (info: RemoteStreamInfo) => void;
  onRemoteTrackUnsubscribed: (participantId: string) => void;
  onConnectionStateChanged: (state: ConnectionState) => void;
  onError: (error: Error) => void;
  onSubscriptionFailed?: (participantId: string, error: Error) => void;
  onParticipantDisconnected?: (participantId: string) => void;
}

// ─── Backend URL ────────────────────────────────────────────────────────────

function getBackendUrl(): string {
  const envUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  return 'https://tellas.fly.dev';
}




// ─── LiveKitService ─────────────────────────────────────────────────────────

export class LiveKitService {
  private room: Room | null = null;
  private callbacks: LiveKitCallbacks | null = null;
  private currentQualityPreset: string = '1080p30';
  private backendUrl: string;
  private participantStreams: Map<string, MediaStream> = new Map();
  private sessionToken: string | null = null;
  private connectingPromise: Promise<void> | null = null;
  private reconciliationTimers: ReturnType<typeof setTimeout>[] = [];
  private currentlySubscribedParticipantId: string | null = null;
  private subscriptionGeneration = 0;
  private publicationGenerations = new Map<string, number>();
  private subscriptionTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.backendUrl = getBackendUrl();
  }

  // ─── Configuration ──────────────────────────────────────────────────

  public setSessionToken(token: string | null): void {
    this.sessionToken = token;
  }

  public getSessionToken(): string | null {
    return this.sessionToken;
  }

  public setCallbacks(callbacks: LiveKitCallbacks): void {
    this.callbacks = callbacks;
  }

  public setQualityPreset(presetKey: string): void {
    if (VIDEO_QUALITY_PRESETS[presetKey]) {
      this.currentQualityPreset = presetKey;
    }
  }

  public getQualityPreset(): VideoQualityPreset {
    return VIDEO_QUALITY_PRESETS[this.currentQualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];
  }

  // ─── Token Request ──────────────────────────────────────────────────

  public async requestToken(request: LiveKitTokenRequest, tokenOverride?: string): Promise<LiveKitTokenResponse> {
    const token = tokenOverride || this.sessionToken;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    console.log('[LiveKit] Requesting protected token from:', `${this.backendUrl}/api/livekit/token`);
    const response = await fetch(`${this.backendUrl}/api/livekit/token`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Erro ao solicitar token (HTTP ${response.status})`);
    }

    const data = await response.json();
    console.log('[LiveKit] Token received successfully for room:', data.roomName);
    return data;
  }

  // ─── Connect to Room ────────────────────────────────────────────────

  public async connect(tokenResponse: LiveKitTokenResponse): Promise<void> {
    // If already connected to the same room, avoid reconnecting
    if (this.connected && this.room?.name === tokenResponse.roomName) {
      console.log('[LiveKit] Already connected to room:', tokenResponse.roomName);
      return;
    }

    // If a connection is already in flight, return the existing promise
    if (this.connectingPromise) {
      console.log('[LiveKit] Connection already in progress for room:', tokenResponse.roomName);
      return this.connectingPromise;
    }

    this.connectingPromise = (async () => {
      try {
        // Clean up any existing connection
        await this.disconnect();

        this.room = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: VideoPresets.h1080.resolution,
          },
        });

        this.setupRoomEventListeners();

        console.log('[LiveKit] Connecting to:', tokenResponse.livekitUrl, 'with room:', tokenResponse.roomName);
        await this.room.connect(tokenResponse.livekitUrl, tokenResponse.token, {
          autoSubscribe: false,
        });

        console.log('[LiveKit] Connected to room:', tokenResponse.roomName, '| state:', this.room.state);

        if (this.callbacks?.onConnectionStateChanged) {
          this.callbacks.onConnectionStateChanged(this.room.state);
        }

        // Reconcile only media explicitly requested by the current watch target.
        this.syncExistingTracks();

        // Bounded reconciliation retries to catch tracks whose WebRTC subscription resolves after connect()
        this.clearReconciliationTimers();
        const timer1 = setTimeout(() => {
          if (this.connected) this.syncExistingTracks();
        }, 300);
        const timer2 = setTimeout(() => {
          if (this.connected) this.syncExistingTracks();
        }, 1000);
        this.reconciliationTimers.push(timer1, timer2);
      } finally {
        this.connectingPromise = null;
      }
    })();

    return this.connectingPromise;
  }

  // ─── Publish Stream ─────────────────────────────────────────────────

  public async publishStream(stream: MediaStream): Promise<void> {
    if (!this.room) {
      throw new Error('Não conectado à sala LiveKit. Conecte antes de publicar.');
    }

    const preset = this.getQualityPreset();
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    // Publish video tracks
    for (const videoTrack of videoTracks) {
      console.log('[LiveKit] Publishing video track:', videoTrack.label);
      await this.room.localParticipant.publishTrack(videoTrack, {
        name: 'screen',
        source: Track.Source.ScreenShare,
        videoEncoding: {
          maxBitrate: preset.maxBitrate * 1000,
          maxFramerate: preset.frameRate,
        },
        screenShareEncoding: {
          maxBitrate: preset.maxBitrate * 1000,
          maxFramerate: preset.frameRate,
        },
        simulcast: false,
        videoCodec: 'vp8' as VideoCodec,
      });
    }

    // Publish audio tracks
    for (const audioTrack of audioTracks) {
      console.log('[LiveKit] Publishing audio track:', audioTrack.label);
      await this.room.localParticipant.publishTrack(audioTrack, {
        name: 'screen-audio',
        source: Track.Source.ScreenShareAudio,
      });
    }

    console.log('[LiveKit] Published', videoTracks.length, 'video +', audioTracks.length, 'audio tracks');
  }

  // ─── Unpublish All Tracks ───────────────────────────────────────────

  public async unpublishAllTracks(): Promise<void> {
    if (!this.room) return;

    const publications = Array.from(this.room.localParticipant.trackPublications.values());
    for (const pub of publications) {
      if (pub instanceof LocalTrackPublication && pub.track) {
        const track = pub.track;
        try {
          await this.room.localParticipant.unpublishTrack(track.mediaStreamTrack);
          track.stop();
        } catch (err) {
          console.warn('[LiveKit] Error unpublishing track:', err);
        }
      }
    }

    console.log('[LiveKit] Unpublished all local tracks');
  }

  // ─── Disconnect ─────────────────────────────────────────────────────

  private clearReconciliationTimers(): void {
    this.reconciliationTimers.forEach((timer) => clearTimeout(timer));
    this.reconciliationTimers = [];
  }

  private clearSubscriptionTimeout(): void {
    if (this.subscriptionTimeout) clearTimeout(this.subscriptionTimeout);
    this.subscriptionTimeout = null;
  }

  public async disconnect(): Promise<void> {
    this.clearReconciliationTimers();
    this.clearSubscriptionTimeout();
    this.subscriptionGeneration++;
    await this.unsubscribeAll();
    if (!this.room) return;

    try {
      await this.unpublishAllTracks();
      await this.room.disconnect(true);
    } catch (err) {
      console.warn('[LiveKit] Error during disconnect:', err);
    } finally {
      this.room = null;
      this.participantStreams.clear();
      this.currentlySubscribedParticipantId = null;
      this.publicationGenerations.clear();
      console.log('[LiveKit] Disconnected');
    }
  }

  // ─── State Queries ──────────────────────────────────────────────────

  public get connected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  public get isConnecting(): boolean {
    return this.connectingPromise !== null;
  }

  public get connectionState(): ConnectionState | null {
    return this.room?.state ?? null;
  }

  public get participantCount(): number {
    if (!this.room) return 0;
    return this.room.remoteParticipants.size + 1;
  }

  private isAllowedSource(source: Track.Source): boolean {
    return source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio;
  }

  private findParticipant(participantId: string): RemoteParticipant | undefined {
    return this.room
      ? Array.from(this.room.remoteParticipants.values()).find((participant) => participant.identity === participantId)
      : undefined;
  }

  private requestPublication(publication: RemoteTrackPublication, participantId: string, generation: number): void {
    if (!this.isAllowedSource(publication.source)) return;
    if (participantId !== this.currentlySubscribedParticipantId || generation !== this.subscriptionGeneration) return;
    this.publicationGenerations.set(publication.trackSid, generation);
    console.log('[LIVEKIT][SUBSCRIBE_PUBLICATION]', { participantId, source: publication.source, publicationSid: publication.trackSid });
    publication.setSubscribed(true);
  }

  public async subscribeToParticipant(participantId: string): Promise<void> {
    const previous = this.currentlySubscribedParticipantId;
    if (previous && previous !== participantId) await this.unsubscribeFromParticipant(previous, false);

    const generation = ++this.subscriptionGeneration;
    this.clearSubscriptionTimeout();
    this.currentlySubscribedParticipantId = participantId;
    this.participantStreams.delete(participantId);
    this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    console.log('[LIVEKIT][SUBSCRIBE_REQUEST]', { participantId, generation });

    const participant = this.findParticipant(participantId);
    if (participant) {
      for (const publication of participant.trackPublications.values()) {
        this.requestPublication(publication, participantId, generation);
      }
    }

    this.subscriptionTimeout = setTimeout(() => {
      if (generation !== this.subscriptionGeneration || participantId !== this.currentlySubscribedParticipantId) return;
      const error = new Error('Não foi possível conectar à transmissão.');
      this.subscriptionGeneration++;
      void this.unsubscribeFromParticipant(participantId).finally(() => {
        this.callbacks?.onSubscriptionFailed?.(participantId, error);
      });
    }, 10_000);
  }

  public async unsubscribeFromParticipant(participantId: string, invalidate = true): Promise<void> {
    if (invalidate) this.subscriptionGeneration++;
    this.clearSubscriptionTimeout();
    console.log('[LIVEKIT][UNSUBSCRIBE_REQUEST]', { participantId });
    const participant = this.findParticipant(participantId);
    if (participant) {
      for (const publication of participant.trackPublications.values()) {
        if (this.isAllowedSource(publication.source)) {
          this.publicationGenerations.delete(publication.trackSid);
          publication.setSubscribed(false);
        }
      }
    }
    this.participantStreams.delete(participantId);
    this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    if (this.currentlySubscribedParticipantId === participantId) this.currentlySubscribedParticipantId = null;
  }

  public async unsubscribeAll(): Promise<void> {
    this.subscriptionGeneration++;
    this.clearSubscriptionTimeout();
    if (this.room) {
      for (const participant of this.room.remoteParticipants.values()) {
        for (const publication of participant.trackPublications.values()) {
          if (this.isAllowedSource(publication.source)) publication.setSubscribed(false);
        }
      }
    }
    for (const participantId of this.participantStreams.keys()) this.callbacks?.onRemoteTrackUnsubscribed(participantId);
    this.participantStreams.clear();
    this.publicationGenerations.clear();
    this.currentlySubscribedParticipantId = null;
  }

  // ─── Room Event Listeners ───────────────────────────────────────────

  private setupRoomEventListeners(): void {
    if (!this.room) return;

    // Remote track published — SFU announced a new publication
    this.room.on(
      RoomEvent.TrackPublished,
      (publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log(
          '[LiveKit] Track published:',
          publication.kind,
          'from',
          participant.name || participant.identity,
          '| trackSid:',
          publication.trackSid
        );
        if (participant.identity === this.currentlySubscribedParticipantId && this.isAllowedSource(publication.source)) {
          this.requestPublication(publication, participant.identity, this.subscriptionGeneration);
        }
      }
    );

    // Remote track subscribed — viewer receives a track from SFU
    this.room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log(
          '[LiveKit] Track subscribed:',
          track.kind,
          'from',
          participant.name || participant.identity,
          '| trackSid:',
          publication.trackSid
        );

        const requestedGeneration = this.publicationGenerations.get(publication.trackSid);
        if (
          !this.isAllowedSource(publication.source) ||
          participant.identity !== this.currentlySubscribedParticipantId ||
          requestedGeneration !== this.subscriptionGeneration
        ) {
          publication.setSubscribed(false);
          return;
        }
        console.log('[LIVEKIT][TRACK_SUBSCRIBED]', { participantId: participant.identity, kind: track.kind, source: publication.source });
        this.handleTrackAdded(track, participant);
        if (track.kind === Track.Kind.Video) this.clearSubscriptionTimeout();
      }
    );

    // Remote track unsubscribed
    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log('[LIVEKIT][TRACK_UNSUBSCRIBED]', { participantId: participant.identity, kind: track.kind });
        this.handleTrackRemoved(track, participant);
      }
    );

    // Connection state changes
    this.room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      console.log('[LiveKit] Connection state changed:', state);
      if (this.callbacks?.onConnectionStateChanged) {
        this.callbacks.onConnectionStateChanged(state);
      }
    });

    this.room.on(RoomEvent.Reconnecting, () => {
      console.log('[LiveKit] Reconnecting...');
    });

    this.room.on(RoomEvent.Reconnected, () => {
      console.log('[LiveKit] Reconnected!');
      console.log('[LIVEKIT][RECONNECT_RESUBSCRIBE]', { participantId: this.currentlySubscribedParticipantId });
      this.syncExistingTracks();
    });

    this.room.on(RoomEvent.TrackSubscriptionFailed, (trackSid: string, participant: RemoteParticipant, cause?: unknown) => {
      if (participant.identity !== this.currentlySubscribedParticipantId) return;
      const publication = participant.trackPublications.get(trackSid);
      if (publication && !this.isAllowedSource(publication.source)) return;
      const error = cause instanceof Error ? cause : new Error('Não foi possível conectar à transmissão.');
      console.warn('[LIVEKIT][SUBSCRIPTION_FAILED]', { participantId: participant.identity, trackSid });
      this.subscriptionGeneration++;
      void this.unsubscribeFromParticipant(participant.identity).finally(() => {
        this.callbacks?.onSubscriptionFailed?.(participant.identity, error);
      });
    });

    this.room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      console.log('[LiveKit] Disconnected. Reason:', reason);
      if (this.callbacks?.onConnectionStateChanged) {
        this.callbacks.onConnectionStateChanged(ConnectionState.Disconnected);
      }
    });

    this.room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      console.log('[LiveKit] Participant disconnected:', participant.identity);
      this.participantStreams.delete(participant.identity);
      if (this.callbacks?.onRemoteTrackUnsubscribed) {
        this.callbacks.onRemoteTrackUnsubscribed(participant.identity);
      }
      if (participant.identity === this.currentlySubscribedParticipantId) {
        this.subscriptionGeneration++;
        this.clearSubscriptionTimeout();
        this.currentlySubscribedParticipantId = null;
      }
      this.callbacks?.onParticipantDisconnected?.(participant.identity);
    });
  }

  private handleTrackAdded(track: RemoteTrack, participant: RemoteParticipant) {
    if (!track.mediaStreamTrack) return;

    // Use Tellas participantId (stored in participant.identity) for stream mapping
    const participantId = participant.identity;
    let mediaStream = this.participantStreams.get(participantId);
    if (!mediaStream) {
      mediaStream = new MediaStream();
      this.participantStreams.set(participantId, mediaStream);
    }

    const existingTrack = mediaStream.getTracks().find((t) => t.id === track.mediaStreamTrack!.id);
    if (existingTrack) {
      // Idempotent: track already added
      return;
    }

    // Replace any existing track of same kind (e.g. new video track replacing old)
    const sameKindTracks = track.kind === Track.Kind.Video
      ? mediaStream.getVideoTracks()
      : mediaStream.getAudioTracks();
    sameKindTracks.forEach((t) => mediaStream!.removeTrack(t));

    mediaStream.addTrack(track.mediaStreamTrack);

    if (this.callbacks?.onRemoteTrackSubscribed) {
      this.callbacks.onRemoteTrackSubscribed({
        participantId,
        displayName: participant.name || '',
        stream: new MediaStream(mediaStream.getTracks()),
      });
    }
  }

  private handleTrackRemoved(track: RemoteTrack, participant: RemoteParticipant) {
    const participantId = participant.identity;
    const mediaStream = this.participantStreams.get(participantId);
    if (mediaStream && track.mediaStreamTrack) {
      mediaStream.removeTrack(track.mediaStreamTrack);
    }

    if (!mediaStream || mediaStream.getTracks().length === 0) {
      this.participantStreams.delete(participantId);
      if (this.callbacks?.onRemoteTrackUnsubscribed) {
        this.callbacks.onRemoteTrackUnsubscribed(participantId);
      }
    } else {
      if (this.callbacks?.onRemoteTrackSubscribed) {
        this.callbacks.onRemoteTrackSubscribed({
          participantId,
          displayName: participant.name || '',
          stream: new MediaStream(mediaStream.getTracks()),
        });
      }
    }
  }

  private syncExistingTracks() {
    if (!this.room) return;

    const target = this.currentlySubscribedParticipantId;
    if (!target) return;
    const generation = this.subscriptionGeneration;
    for (const participant of this.room.remoteParticipants.values()) {
      if (participant.identity !== target) continue;
      for (const publication of participant.trackPublications.values()) {
        if (!this.isAllowedSource(publication.source)) continue;
        this.requestPublication(publication, target, generation);
        if (publication.isSubscribed && publication.track && this.publicationGenerations.get(publication.trackSid) === generation) {
          this.handleTrackAdded(publication.track, participant);
        }
      }
    }
  }

  public getParticipants(): Array<{ id: string; identity: string; name?: string; isLocal: boolean }> {
    if (!this.room) return [];
    const list: Array<{ id: string; identity: string; name?: string; isLocal: boolean }> = [];
    if (this.room.localParticipant) {
      list.push({
        id: this.room.localParticipant.sid || 'local',
        identity: this.room.localParticipant.identity,
        name: this.room.localParticipant.name,
        isLocal: true
      });
    }
    for (const p of this.room.remoteParticipants.values()) {
      list.push({
        id: p.sid,
        identity: p.identity,
        name: p.name,
        isLocal: false
      });
    }
    return list;
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const livekitService = new LiveKitService();
