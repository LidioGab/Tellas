import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySessionToken, type SessionPayload } from '../auth/session';
import { getRoom } from '../socket/signaling';
import { checkRateLimit } from '../security/rateLimiter';
import {
  CloudflareRealtimeError,
  type CloudflareRealtimeApi,
  type CloudflareSessionDescription,
} from '../media/cloudflareRealtimeClient';
import { cloudflareSessionRegistry } from '../media/cloudflareSessionRegistry';

interface AuthenticatedMediaRequest {
  session: SessionPayload;
  room: NonNullable<ReturnType<typeof getRoom>>;
}

interface LocalTrackInput {
  mid: string;
  kind: 'video' | 'audio';
}
export const REALTIME_SDP_BODY_LIMIT = 128 * 1024;
export const REALTIME_SDP_MAX_LENGTH = 120 * 1024;
const DEV = process.env.NODE_ENV !== 'production';
const devLog = (event: string, fields: Record<string, unknown>): void => {
  if (DEV) console.log(`[CLOUDFLARE][${event}]`, fields);
};

const isSessionDescription = (value: unknown): value is CloudflareSessionDescription => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CloudflareSessionDescription>;
  return (candidate.type === 'offer' || candidate.type === 'answer')
    && typeof candidate.sdp === 'string'
    && candidate.sdp.length > 0
    && candidate.sdp.length <= REALTIME_SDP_MAX_LENGTH;
};

async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedMediaRequest | null> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    devLog('AUTHORIZATION_REJECTED', { reason: 'NOT_AUTHENTICATED', operation: request.url });
    reply.status(401).send({ error: 'Token de sessão ausente.', code: 'UNAUTHORIZED_MISSING_SESSION' });
    return null;
  }
  const session = await verifySessionToken(authHeader.slice(7).trim());
  if (!session) {
    devLog('AUTHORIZATION_REJECTED', { reason: 'INVALID_SESSION', operation: request.url });
    reply.status(401).send({ error: 'Token de sessão inválido ou expirado.', code: 'UNAUTHORIZED_INVALID_SESSION' });
    return null;
  }
  const room = getRoom(session.roomId);
  if (!room) {
    devLog('AUTHORIZATION_REJECTED', { reason: 'NOT_IN_ROOM', participantId: session.participantId, roomId: session.roomId });
    reply.status(404).send({ error: 'Sala não encontrada.', code: 'ROOM_NOT_FOUND' });
    return null;
  }
  const member = room.members.get(session.participantId);
  if (!member) {
    devLog('AUTHORIZATION_REJECTED', { reason: 'NOT_IN_ROOM', participantId: session.participantId, roomId: session.roomId });
    reply.status(403).send({ error: 'Participante não pertence à sala.', code: 'PARTICIPANT_NOT_IN_ROOM' });
    return null;
  }
  const rate = checkRateLimit(`participant:${session.participantId}:realtime`, 50, 60_000);
  if (!rate.allowed) {
    devLog('RATE_LIMIT_BLOCKED', { participantId: session.participantId, operation: request.url });
    reply.header('Retry-After', String(rate.retryAfterSec || 1));
    reply.status(429).send({ error: 'Muitas operações de mídia.', code: 'RATE_LIMITED' });
    return null;
  }
  return { session, room };
}

function sendCloudflareError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof CloudflareRealtimeError) {
    return reply.status(error.status).send({ error: error.message, code: error.code });
  }
  return reply.status(500).send({ error: 'Falha interna no transporte de mídia.', code: 'REALTIME_INTERNAL_ERROR' });
}

function ownedSession(participantId: string, roomId: string) {
  const mediaSession = cloudflareSessionRegistry.getSession(participantId);
  return mediaSession?.roomId === roomId ? mediaSession : undefined;
}

export function registerRealtimeRoutes(app: FastifyInstance, client: CloudflareRealtimeApi): void {
  app.post('/api/realtime/session', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const previous = ownedSession(auth.session.participantId, auth.session.roomId);
    const registryRoomId = cloudflareSessionRegistry.getSession(auth.session.participantId)?.roomId || null;
    const roomAffinityMatches = !registryRoomId || registryRoomId === auth.session.roomId;
    devLog('ROOM_AFFINITY', {
      participantId: auth.session.participantId,
      tellasRoomId: auth.session.roomId,
      registryRoomId,
      appCurrentRoomId: auth.room.roomId,
      matches: roomAffinityMatches,
    });
    if (!roomAffinityMatches) devLog('ROOM_AFFINITY_MISMATCH', { participantId: auth.session.participantId, tellasRoomId: auth.session.roomId, registryRoomId });
    if (previous) return reply.send({ sessionId: previous.cloudflareSessionId });

    const startedAt = performance.now();
    try {
      devLog('SESSION_CREATE_REQUEST', {
        roomId: auth.session.roomId,
        participantId: auth.session.participantId,
        hasSessionDescription: false,
        hasExistingSession: false,
        peerConnectionState: 'not-created-backend',
      });
      const result = await client.createSession(`${auth.session.roomId}:${auth.session.participantId}`);
      cloudflareSessionRegistry.setSession({
        participantId: auth.session.participantId,
        roomId: auth.session.roomId,
        cloudflareSessionId: result.sessionId,
        createdAt: Date.now(),
      });
      devLog('SESSION_CREATED', {
        sessionId: result.sessionId,
        roomId: auth.session.roomId,
        participantId: auth.session.participantId,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      return reply.status(201).send({ sessionId: result.sessionId });
    } catch (error) {
      devLog('SESSION_CREATE_FAILED', {
        participantId: auth.session.participantId,
        roomId: auth.session.roomId,
        status: error instanceof CloudflareRealtimeError ? error.status : 500,
        errorCode: error instanceof CloudflareRealtimeError ? error.code : 'REALTIME_INTERNAL_ERROR',
        operation: error instanceof CloudflareRealtimeError ? error.operation : 'SESSION_CREATE_FAILED',
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      request.log.error({ err: error }, 'Cloudflare session creation failed');
      return sendCloudflareError(reply, error);
    }
  });

  app.post<{ Body: { sessionDescription?: unknown; tracks?: LocalTrackInput[] } }>('/api/realtime/publish', {
    bodyLimit: REALTIME_SDP_BODY_LIMIT,
  }, async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const mediaSession = ownedSession(auth.session.participantId, auth.session.roomId);
    if (!mediaSession) return reply.status(409).send({ error: 'Sessão de mídia ausente.', code: 'MEDIA_SESSION_REQUIRED' });
    if (!auth.session.canPublish) return reply.status(403).send({ error: 'Publicação não autorizada.', code: 'PUBLISH_FORBIDDEN' });
    if (!isSessionDescription(request.body?.sessionDescription)) {
      return reply.status(400).send({ error: 'SDP inválido.', code: 'INVALID_SESSION_DESCRIPTION' });
    }
    const tracks = Array.isArray(request.body?.tracks) ? request.body.tracks : [];
    const video = tracks.filter((track) => track?.kind === 'video' && typeof track.mid === 'string');
    const audio = tracks.filter((track) => track?.kind === 'audio' && typeof track.mid === 'string');
    if (video.length !== 1 || audio.length > 1 || tracks.length !== video.length + audio.length) {
      return reply.status(400).send({ error: 'Apenas uma tela e um áudio de sistema são permitidos.', code: 'INVALID_LOCAL_TRACKS' });
    }

    const trackNames = new Map<string, string>();
    for (const track of tracks) trackNames.set(track.mid, crypto.randomUUID());
    try {
      const result = await client.addTracks(mediaSession.cloudflareSessionId, {
        sessionDescription: request.body.sessionDescription,
        tracks: tracks.map((track) => ({ location: 'local', mid: track.mid, trackName: trackNames.get(track.mid), kind: track.kind })),
      });
      if (!result.sessionDescription) throw new CloudflareRealtimeError('Resposta SDP ausente.', 502, 'CLOUDFLARE_SDP_MISSING');
      const failed = result.tracks?.find((track) => track.errorCode);
      if (failed) throw new CloudflareRealtimeError(failed.errorDescription || 'Falha ao publicar track.', 502, failed.errorCode || 'TRACK_PUBLISH_FAILED');

      cloudflareSessionRegistry.setStream({
        participantId: auth.session.participantId,
        roomId: auth.session.roomId,
        cloudflareSessionId: mediaSession.cloudflareSessionId,
        videoTrackId: trackNames.get(video[0].mid)!,
        videoMid: video[0].mid,
        audioTrackId: audio[0] ? trackNames.get(audio[0].mid)! : null,
        audioMid: audio[0]?.mid || null,
      });
      for (const track of tracks) devLog('TRACK_PUBLISHED', {
        participantId: auth.session.participantId,
        roomId: auth.session.roomId,
        sessionId: mediaSession.cloudflareSessionId,
        kind: track.kind,
        trackId: trackNames.get(track.mid),
        mid: track.mid,
        location: 'local',
      });
      return reply.send({ sessionDescription: result.sessionDescription });
    } catch (error) {
      request.log.error({ err: error }, 'Cloudflare publish failed');
      return sendCloudflareError(reply, error);
    }
  });

  app.post<{ Body: { targetParticipantId?: string } }>('/api/realtime/subscribe', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const targetParticipantId = request.body?.targetParticipantId;
    if (!targetParticipantId || targetParticipantId === auth.session.participantId) {
      devLog('AUTHORIZATION_REJECTED', { reason: 'SELF_SUBSCRIBE', participantId: auth.session.participantId, targetParticipantId });
      return reply.status(403).send({ error: 'Self-subscribe não permitido.', code: 'SELF_SUBSCRIBE_FORBIDDEN' });
    }
    const viewerSession = ownedSession(auth.session.participantId, auth.session.roomId);
    if (!viewerSession) return reply.status(409).send({ error: 'Sessão de mídia ausente.', code: 'MEDIA_SESSION_REQUIRED' });
    const targetMember = auth.room.members.get(targetParticipantId);
    const targetStream = cloudflareSessionRegistry.getStream(targetParticipantId);
    const targetStreaming = Boolean(targetStream && auth.room.activeStreamers.has(targetParticipantId));
    const sameRoom = Boolean(targetStream?.roomId === auth.session.roomId);
    devLog('SUBSCRIBE_AUTHORIZATION', {
      callerParticipantId: auth.session.participantId,
      targetParticipantId,
      callerRoomId: auth.session.roomId,
      targetRoomId: targetStream?.roomId || null,
      sameRoom,
      targetStreaming,
      authorized: Boolean(targetMember && targetStreaming && sameRoom),
    });
    if (!targetMember || !targetStream || targetStream.roomId !== auth.session.roomId || !auth.room.activeStreamers.has(targetParticipantId)) {
      devLog('AUTHORIZATION_REJECTED', { reason: targetStream && !sameRoom ? 'CROSS_ROOM' : 'TARGET_NOT_STREAMING', participantId: auth.session.participantId, targetParticipantId });
      return reply.status(403).send({ error: 'Transmissão alvo indisponível nesta sala.', code: 'TARGET_STREAM_FORBIDDEN' });
    }
    if (cloudflareSessionRegistry.getSubscription(auth.session.participantId)) {
      return reply.status(409).send({ error: 'Encerre a subscription atual antes de trocar.', code: 'SUBSCRIPTION_ALREADY_ACTIVE' });
    }

    const remoteTracks = [
      { location: 'remote' as const, sessionId: targetStream.cloudflareSessionId, trackName: targetStream.videoTrackId, kind: 'video' as const },
      ...(targetStream.audioTrackId ? [{ location: 'remote' as const, sessionId: targetStream.cloudflareSessionId, trackName: targetStream.audioTrackId, kind: 'audio' as const }] : []),
    ];
    try {
      devLog('SUBSCRIBE_TRACK_RESOLUTION', {
        targetParticipantId,
        publisherSessionId: targetStream.cloudflareSessionId,
        videoTrackId: targetStream.videoTrackId,
        audioTrackId: targetStream.audioTrackId,
        hasVideo: true,
        hasAudio: Boolean(targetStream.audioTrackId),
      });
      for (const track of remoteTracks) devLog('REMOTE_TRACK_REQUESTED', {
        viewerParticipantId: auth.session.participantId,
        targetParticipantId,
        kind: track.kind,
        trackId: track.trackName,
      });
      const result = await client.addTracks(viewerSession.cloudflareSessionId, { tracks: remoteTracks });
      if (!result.sessionDescription) throw new CloudflareRealtimeError('Oferta SDP ausente.', 502, 'CLOUDFLARE_SDP_MISSING');
      const failed = result.tracks?.find((track) => track.errorCode);
      if (failed) throw new CloudflareRealtimeError(failed.errorDescription || 'Falha ao receber track.', 502, failed.errorCode || 'TRACK_SUBSCRIBE_FAILED');
      const remoteMids = (result.tracks || []).map((track) => track.mid).filter((mid): mid is string => Boolean(mid));
      cloudflareSessionRegistry.setSubscription({ viewerParticipantId: auth.session.participantId, targetParticipantId, remoteMids });
      return reply.send({ sessionDescription: result.sessionDescription, remoteMids });
    } catch (error) {
      request.log.error({ err: error }, 'Cloudflare subscribe failed');
      return sendCloudflareError(reply, error);
    }
  });

  app.post<{ Body: { sessionDescription?: unknown } }>('/api/realtime/renegotiate', {
    bodyLimit: REALTIME_SDP_BODY_LIMIT,
  }, async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const mediaSession = ownedSession(auth.session.participantId, auth.session.roomId);
    if (!mediaSession) return reply.status(409).send({ error: 'Sessão de mídia ausente.', code: 'MEDIA_SESSION_REQUIRED' });
    if (!isSessionDescription(request.body?.sessionDescription) || request.body.sessionDescription.type !== 'answer') {
      return reply.status(400).send({ error: 'Resposta SDP inválida.', code: 'INVALID_SESSION_DESCRIPTION' });
    }
    try {
      await client.renegotiate(mediaSession.cloudflareSessionId, request.body.sessionDescription);
      return reply.send({ success: true });
    } catch (error) {
      return sendCloudflareError(reply, error);
    }
  });

  app.post('/api/realtime/unsubscribe', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const mediaSession = ownedSession(auth.session.participantId, auth.session.roomId);
    const subscription = cloudflareSessionRegistry.getSubscription(auth.session.participantId);
    if (!mediaSession || !subscription) return reply.send({ success: true });
    try {
      const targetStream = cloudflareSessionRegistry.getStream(subscription.targetParticipantId);
      const startedAt = performance.now();
      subscription.remoteMids.forEach((mid, index) => devLog('REMOTE_TRACK_CLOSE_REQUEST', {
        targetParticipantId: subscription.targetParticipantId,
        trackId: index === 0 ? targetStream?.videoTrackId : targetStream?.audioTrackId,
        mid,
        kind: index === 0 ? 'video' : 'audio',
      }));
      await client.closeTracks(mediaSession.cloudflareSessionId, subscription.remoteMids);
      subscription.remoteMids.forEach((mid, index) => devLog('REMOTE_TRACK_CLOSED', {
        targetParticipantId: subscription.targetParticipantId,
        kind: index === 0 ? 'video' : 'audio',
        trackId: index === 0 ? targetStream?.videoTrackId : targetStream?.audioTrackId,
        mid,
        elapsedMs: Math.round(performance.now() - startedAt),
      }));
      cloudflareSessionRegistry.removeSubscription(auth.session.participantId);
      return reply.send({ success: true });
    } catch (error) {
      return sendCloudflareError(reply, error);
    }
  });

  app.post('/api/realtime/unpublish', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const mediaSession = ownedSession(auth.session.participantId, auth.session.roomId);
    const stream = cloudflareSessionRegistry.getStream(auth.session.participantId);
    if (!mediaSession || !stream) return reply.send({ success: true });
    try {
      devLog('LOCAL_TRACK_CLOSE_REQUEST', { kind: 'video', trackId: stream.videoTrackId, mid: stream.videoMid });
      if (stream.audioMid) devLog('LOCAL_TRACK_CLOSE_REQUEST', { kind: 'audio', trackId: stream.audioTrackId, mid: stream.audioMid });
      await client.closeTracks(mediaSession.cloudflareSessionId, [stream.videoMid, ...(stream.audioMid ? [stream.audioMid] : [])]);
      devLog('LOCAL_TRACK_CLOSED', { kind: 'video', trackId: stream.videoTrackId, mid: stream.videoMid });
      if (stream.audioMid) devLog('LOCAL_TRACK_CLOSED', { kind: 'audio', trackId: stream.audioTrackId, mid: stream.audioMid });
      cloudflareSessionRegistry.removeStream(auth.session.participantId, 'explicit-cleanup');
      return reply.send({ success: true });
    } catch (error) {
      return sendCloudflareError(reply, error);
    }
  });

  app.post('/api/realtime/disconnect', async (request, reply) => {
    const auth = await authenticate(request, reply);
    if (!auth) return;
    const mediaSession = ownedSession(auth.session.participantId, auth.session.roomId);
    if (mediaSession) {
      const stream = cloudflareSessionRegistry.getStream(auth.session.participantId);
      const subscription = cloudflareSessionRegistry.getSubscription(auth.session.participantId);
      const mids = [...(stream ? [stream.videoMid, ...(stream.audioMid ? [stream.audioMid] : [])] : []), ...(subscription?.remoteMids || [])];
      try {
        await client.closeTracks(mediaSession.cloudflareSessionId, mids);
      } catch (error) {
        request.log.warn({ err: error }, 'Cloudflare disconnect cleanup failed');
      }
    }
    cloudflareSessionRegistry.removeParticipant(auth.session.participantId, 'explicit-cleanup');
    return reply.send({ success: true });
  });
}
