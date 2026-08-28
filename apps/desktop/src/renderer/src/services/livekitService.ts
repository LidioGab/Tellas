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
}

// ─── Backend URL ────────────────────────────────────────────────────────────

function getBackendUrl(): string {
  const envUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  if (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('file://')) {
    return window.location.origin;
  }
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
      autoSubscribe: true,
    });

    console.log('[LiveKit] Connected to room:', tokenResponse.roomName, '| state:', this.room.state);

    if (this.callbacks?.onConnectionStateChanged) {
      this.callbacks.onConnectionStateChanged(this.room.state);
    }

    // Check if any remote participants already have active subscribed tracks
    this.syncExistingTracks();
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

  public async disconnect(): Promise<void> {
    if (!this.room) return;

    try {
      await this.unpublishAllTracks();
      await this.room.disconnect(true);
    } catch (err) {
      console.warn('[LiveKit] Error during disconnect:', err);
    } finally {
      this.room = null;
      this.participantStreams.clear();
      console.log('[LiveKit] Disconnected');
    }
  }

  // ─── State Queries ──────────────────────────────────────────────────

  public get connected(): boolean {
    return this.room?.state === ConnectionState.Connected;
  }

  public get connectionState(): ConnectionState | null {
    return this.room?.state ?? null;
  }

  public get participantCount(): number {
    if (!this.room) return 0;
    return this.room.remoteParticipants.size + 1;
  }

  // ─── Room Event Listeners ───────────────────────────────────────────

  private setupRoomEventListeners(): void {
    if (!this.room) return;

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

        this.handleTrackAdded(track, participant);
      }
    );

    // Remote track unsubscribed
    this.room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        console.log('[LiveKit] Track unsubscribed from', participant.name || participant.identity);
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
      this.syncExistingTracks();
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

    for (const participant of this.room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        if (publication.isSubscribed && publication.track) {
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
