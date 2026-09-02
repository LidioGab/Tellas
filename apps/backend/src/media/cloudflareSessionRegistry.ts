export interface ParticipantMediaSession {
  participantId: string;
  roomId: string;
  cloudflareSessionId: string;
  createdAt: number;
}

export interface ActiveCloudflareStream {
  participantId: string;
  roomId: string;
  cloudflareSessionId: string;
  videoTrackId: string;
  videoMid: string;
  audioTrackId: string | null;
  audioMid: string | null;
}

export interface ActiveSubscription {
  viewerParticipantId: string;
  targetParticipantId: string;
  remoteMids: string[];
}

const DEV = process.env.NODE_ENV !== 'production';

class CloudflareSessionRegistry {
  private readonly sessions = new Map<string, ParticipantMediaSession>();
  private readonly streams = new Map<string, ActiveCloudflareStream>();
  private readonly subscriptions = new Map<string, ActiveSubscription>();
  private readonly pendingSubscriptions = new Set<string>();

  getStats(): { sessions: number; streams: number; subscriptions: number } {
    return {
      sessions: this.sessions.size,
      streams: this.streams.size,
      subscriptions: this.subscriptions.size,
    };
  }

  setSession(session: ParticipantMediaSession): void {
    this.sessions.set(session.participantId, session);
    if (DEV) console.log('[CLOUDFLARE][SESSION_REGISTRY_SET]', {
      participantId: session.participantId,
      roomId: session.roomId,
      sessionId: session.cloudflareSessionId,
    });
  }

  getSession(participantId: string): ParticipantMediaSession | undefined {
    return this.sessions.get(participantId);
  }

  setStream(stream: ActiveCloudflareStream): void {
    this.streams.set(stream.participantId, stream);
    if (DEV) {
      console.log('[CLOUDFLARE][ACTIVE_STREAM_SET]', {
        participantId: stream.participantId,
        roomId: stream.roomId,
        publisherSessionId: stream.cloudflareSessionId,
        videoTrackId: stream.videoTrackId,
        audioTrackId: stream.audioTrackId,
      });
    }
  }

  getStream(participantId: string): ActiveCloudflareStream | undefined {
    return this.streams.get(participantId);
  }

  removeStream(participantId: string, reason = 'explicit-cleanup'): void {
    const stream = this.streams.get(participantId);
    this.streams.delete(participantId);
    if (DEV && stream) {
      console.log('[CLOUDFLARE][ACTIVE_STREAM_DELETE]', { participantId, roomId: stream.roomId, reason });
    }
  }

  setSubscription(subscription: ActiveSubscription): void {
    this.pendingSubscriptions.delete(subscription.viewerParticipantId);
    this.subscriptions.set(subscription.viewerParticipantId, subscription);
  }

  beginSubscription(viewerParticipantId: string): boolean {
    if (this.subscriptions.has(viewerParticipantId) || this.pendingSubscriptions.has(viewerParticipantId)) return false;
    this.pendingSubscriptions.add(viewerParticipantId);
    return true;
  }

  endPendingSubscription(viewerParticipantId: string): void {
    this.pendingSubscriptions.delete(viewerParticipantId);
  }

  getSubscription(viewerParticipantId: string): ActiveSubscription | undefined {
    return this.subscriptions.get(viewerParticipantId);
  }

  removeSubscription(viewerParticipantId: string): void {
    this.pendingSubscriptions.delete(viewerParticipantId);
    this.subscriptions.delete(viewerParticipantId);
  }

  removeParticipant(participantId: string, reason = 'disconnect'): void {
    const session = this.sessions.get(participantId);
    if (DEV && session) console.log('[CLOUDFLARE][SESSION_REGISTRY_DELETE]', {
      participantId,
      roomId: session.roomId,
      sessionId: session.cloudflareSessionId,
      reason,
    });
    this.sessions.delete(participantId);
    this.streams.delete(participantId);
    this.subscriptions.delete(participantId);
    this.pendingSubscriptions.delete(participantId);
    for (const [viewerId, subscription] of this.subscriptions) {
      if (subscription.targetParticipantId === participantId) this.subscriptions.delete(viewerId);
    }
  }

  reset(): void {
    this.sessions.clear();
    this.streams.clear();
    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
  }
}

export const cloudflareSessionRegistry = new CloudflareSessionRegistry();
