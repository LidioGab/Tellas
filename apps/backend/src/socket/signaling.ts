import { Server as SocketIOServer, Socket } from 'socket.io';
import * as crypto from 'crypto';
import { RoomState, MemberInfo, type StreamViewersByPublisher } from '@stream-app/shared';
import { createSessionToken, verifySessionToken } from '../auth/session';
import { checkRateLimit } from '../security/rateLimiter';
import { resolveClientIp } from '../security/ipResolver';
import { cloudflareSessionRegistry } from '../media/cloudflareSessionRegistry';
import { logInstanceEvent } from '../observability/instance';

// ─── Quotas & Resource Limits ───────────────────────────────────────────────

export const MAX_ACTIVE_ROOMS = process.env.MAX_ACTIVE_ROOMS
  ? parseInt(process.env.MAX_ACTIVE_ROOMS, 10)
  : 100;

export const MAX_PARTICIPANTS_PER_ROOM = process.env.MAX_PARTICIPANTS_PER_ROOM
  ? parseInt(process.env.MAX_PARTICIPANTS_PER_ROOM, 10)
  : 20;

export const MAX_PUBLISHERS_PER_ROOM = process.env.MAX_PUBLISHERS_PER_ROOM
  ? parseInt(process.env.MAX_PUBLISHERS_PER_ROOM, 10)
  : 4;

export const ROOM_RECONNECT_GRACE_MS = process.env.ROOM_RECONNECT_GRACE_MS
  ? parseInt(process.env.ROOM_RECONNECT_GRACE_MS, 10)
  : 30000; // 30 seconds reconnect grace period

export const STREAM_RESERVATION_TTL_MS = process.env.STREAM_RESERVATION_TTL_MS
  ? parseInt(process.env.STREAM_RESERVATION_TTL_MS, 10)
  : 30000;

// ─── State Model ────────────────────────────────────────────────────────────

export interface BackendMemberInfo {
  participantId: string;
  identity: string; // Sanitized display name
  role: 'host' | 'participant';
  canPublish: boolean;
  currentSocketId: string | null;
  joinedAt: number;
  disconnectTimer?: NodeJS.Timeout | null;
}

export interface ExtendedRoomState {
  roomId: string;
  hostParticipantId: string | null;
  members: Map<string, BackendMemberInfo>; // participantId -> BackendMemberInfo
  socketToParticipant: Map<string, string>; // socketId -> participantId
  activeStreamers: Set<string>; // Set of participantIds currently streaming
  reservedPublishers: Map<string, NodeJS.Timeout>; // participantId -> expiration timer
  isLocked: boolean;
  createdAt: number;
}

const rooms = new Map<string, ExtendedRoomState>();

export function getRoomCount(): number {
  return rooms.size;
}

function clearPublisherReservation(room: ExtendedRoomState, participantId: string): boolean {
  const timer = room.reservedPublishers.get(participantId);
  if (!timer) return false;
  clearTimeout(timer);
  room.reservedPublishers.delete(participantId);
  return true;
}

function reservePublisher(room: ExtendedRoomState, participantId: string): void {
  const timer = setTimeout(() => {
    if (!room.reservedPublishers.delete(participantId)) return;
    logInstanceEvent('STREAM_RESERVATION_EXPIRED', {
      operation: 'reserve-stream',
      roomId: room.roomId,
      participantId,
      roomCount: rooms.size,
    });
  }, STREAM_RESERVATION_TTL_MS);
  if (timer.unref) timer.unref();
  room.reservedPublishers.set(participantId, timer);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure 6-character room code.
 */
export function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    id += chars.charAt(randomIndex);
  }
  return id;
}

/**
 * Sanitizes user input display names.
 */
function sanitizeDisplayName(raw: any, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, 64);
}

/**
 * Extracts a trusted client IP from socket handshake using Fly-Client-IP priority.
 */
function getSocketClientIp(socket: Socket): string {
  return resolveClientIp(
    socket.handshake.headers as Record<string, string | string[] | undefined>,
    socket.handshake.address
  );
}

/**
 * Returns room state for public/API inspection.
 */
export function getRoom(roomId: string): ExtendedRoomState | undefined {
  if (!roomId) return undefined;
  return rooms.get(roomId.trim().toUpperCase());
}

/**
 * Returns read-only public room state.
 */
export function getPublicRoomState(roomId: string): (RoomState & { isLocked?: boolean }) | undefined {
  const room = getRoom(roomId);
  if (!room) return undefined;

  const peers = Array.from(room.socketToParticipant.keys());
  const members: MemberInfo[] = Array.from(room.members.values()).map((m) => ({
    participantId: m.participantId,
    identity: m.identity,
    role: m.role,
    canPublish: m.canPublish,
    isHost: m.role === 'host' && m.participantId === room.hostParticipantId,
    socketId: m.currentSocketId || undefined,
  }));

  return {
    roomId: room.roomId,
    hostId: room.hostParticipantId || '',
    peers,
    isStreaming: room.activeStreamers.size > 0,
    members,
    activeStreamers: Array.from(room.activeStreamers),
    isLocked: room.isLocked,
  };
}

function memberList(room: ExtendedRoomState): MemberInfo[] {
  return Array.from(room.members.values()).map((member) => ({
    participantId: member.participantId,
    identity: member.identity,
    role: member.role,
    canPublish: member.canPublish,
    isHost: member.role === 'host' && member.participantId === room.hostParticipantId,
    socketId: member.currentSocketId || undefined,
  }));
}

function streamViewers(room: ExtendedRoomState): StreamViewersByPublisher {
  return Object.fromEntries(Array.from(room.activeStreamers).map((streamerParticipantId) => [
    streamerParticipantId,
    cloudflareSessionRegistry.getViewerParticipantIds(streamerParticipantId)
      .map((participantId) => room.members.get(participantId))
      .filter((member): member is BackendMemberInfo => Boolean(member))
      .map((member) => ({ participantId: member.participantId, identity: member.identity })),
  ]));
}

async function promoteNextHost(io: SocketIOServer, room: ExtendedRoomState, previousHostParticipantId: string): Promise<string | null> {
  const candidates = Array.from(room.members.values());
  const nextHost = candidates.find((member) => member.currentSocketId) || candidates[0];
  if (!nextHost) {
    room.hostParticipantId = null;
    return null;
  }

  for (const member of candidates) member.role = member.participantId === nextHost.participantId ? 'host' : 'participant';
  room.hostParticipantId = nextHost.participantId;

  if (nextHost.currentSocketId) {
    const sessionToken = await createSessionToken({
      roomId: room.roomId,
      participantId: nextHost.participantId,
      sessionRole: 'host',
      canPublish: nextHost.canPublish,
    });
    io.to(nextHost.currentSocketId).emit('role-updated', {
      roomId: room.roomId,
      role: 'host',
      isHost: true,
      sessionToken,
    });
  }

  io.to(room.roomId).emit('host-transferred', {
    roomId: room.roomId,
    previousHostParticipantId,
    newHostParticipantId: nextHost.participantId,
  });
  console.log(`[Room] Host automatically transferred in ${room.roomId}: ${previousHostParticipantId} -> ${nextHost.participantId}`);
  return nextHost.participantId;
}



/**
 * Resets the entire in-memory room store (used for testing).
 * Clears all active timers to prevent memory leaks.
 */
export function resetRoomStore(): void {
  for (const room of rooms.values()) {
    for (const timer of room.reservedPublishers.values()) clearTimeout(timer);
    room.reservedPublishers.clear();
    for (const member of room.members.values()) {
      if (member.disconnectTimer) {
        clearTimeout(member.disconnectTimer);
        member.disconnectTimer = null;
      }
    }
  }
  rooms.clear();
  cloudflareSessionRegistry.reset();
}

// ─── Socket.IO Signaling & Room Management ──────────────────────────────────

export function setupSignaling(io: SocketIOServer) {
  cloudflareSessionRegistry.setSubscriptionChangeListener((roomId, streamerParticipantId) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const viewers = streamViewers(room)[streamerParticipantId] || [];
    io.to(roomId).emit('stream-viewers-updated', { streamerParticipantId, viewers });
  });

  io.on('connection', (socket: Socket) => {
    const clientIp = getSocketClientIp(socket);
    console.log(`[Socket] Connected: ${socket.id} (IP: ${clientIp})`);

    // ─── 1. Create Room ──────────────────────────────────────────────
    socket.on('create-room', async (payload: { roomId?: string; identity?: string }, callback) => {
      // Rate limit check: 5 create-room per minute per IP
      const rateCheck = checkRateLimit(`ip:${clientIp}:create-room`, 5, 60 * 1000);
      if (!rateCheck.allowed) {
        if (typeof callback === 'function') {
          callback({
            success: false,
            roomId: '',
            error: `Muitas salas criadas recentemente. Tente novamente em ${rateCheck.retryAfterSec}s.`,
            code: 'RATE_LIMITED',
          });
        }
        return;
      }

      // Quota check: max active rooms
      if (rooms.size >= MAX_ACTIVE_ROOMS) {
        if (typeof callback === 'function') {
          callback({
            success: false,
            roomId: '',
            error: 'Capacidade máxima do servidor atingida. Tente novamente mais tarde.',
            code: 'MAX_ROOMS_REACHED',
          });
        }
        return;
      }

      const roomId = generateRoomId();
      const participantId = crypto.randomUUID();
      const identity = sanitizeDisplayName(payload?.identity, 'Host');

      // Create session JWT
      const sessionToken = await createSessionToken({
        roomId,
        participantId,
        sessionRole: 'host',
        canPublish: true,
      });

      const hostMember: BackendMemberInfo = {
        participantId,
        identity,
        role: 'host',
        canPublish: true,
        currentSocketId: socket.id,
        joinedAt: Date.now(),
        disconnectTimer: null,
      };

      const members = new Map<string, BackendMemberInfo>();
      members.set(participantId, hostMember);

      const socketToParticipant = new Map<string, string>();
      socketToParticipant.set(socket.id, participantId);

      const newRoom: ExtendedRoomState = {
        roomId,
        hostParticipantId: participantId,
        members,
        socketToParticipant,
        activeStreamers: new Set<string>(),
        reservedPublishers: new Map<string, NodeJS.Timeout>(),
        isLocked: false,
        createdAt: Date.now(),
      };

      rooms.set(roomId, newRoom);
      socket.join(roomId);

      console.log(`[Room] Created ${roomId} by host ${participantId} (${identity})`);
      logInstanceEvent('ROOM_CREATED', { operation: 'create-room', roomId, participantId, roomCount: rooms.size });

      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          participantId,
          sessionToken,
          sessionRole: 'host',
          isLocked: false,
          streamViewers: {},
          members: [
            {
              participantId,
              identity,
              role: 'host',
              canPublish: true,
              isHost: true,
              socketId: socket.id,
            },
          ],
        });
      }
    });

    // ─── 2. Join Room / Reconnect ────────────────────────────────────
    socket.on(
      'join-room',
      async (
        payload: { roomId: string; identity?: string; sessionToken?: string },
        callback
      ) => {
        // Rate limit check: 20 join-room per minute per IP
        const rateCheck = checkRateLimit(`ip:${clientIp}:join-room`, 20, 60 * 1000);
        if (!rateCheck.allowed) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              roomId: '',
              isHost: false,
              peers: [],
              error: `Muitas tentativas de entrada. Tente novamente em ${rateCheck.retryAfterSec}s.`,
              code: 'RATE_LIMITED',
            });
          }
          return;
        }

        if (!payload || !payload.roomId || typeof payload.roomId !== 'string') {
          if (typeof callback === 'function') {
            callback({
              success: false,
              roomId: '',
              isHost: false,
              peers: [],
              error: 'ID da sala é obrigatório',
              code: 'INVALID_INPUT',
            });
          }
          return;
        }

        const cleanRoomId = payload.roomId.trim().toUpperCase();

        // Valid room code format check (e.g. 6 alphanumeric chars)
        if (!/^[A-Z0-9]{4,20}$/.test(cleanRoomId)) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              roomId: cleanRoomId,
              isHost: false,
              peers: [],
              error: 'Formato de código de sala inválido',
              code: 'INVALID_ROOM_FORMAT',
            });
          }
          return;
        }

        const room = rooms.get(cleanRoomId);
        // CRITICAL SECURITY RULE: Join CANNOT create non-existent room!
        if (!room) {
          logInstanceEvent('ROOM_LOOKUP_FAILED', {
            operation: 'join-room',
            roomId: cleanRoomId,
            participantId: null,
            roomCount: rooms.size,
          });
          if (typeof callback === 'function') {
            callback({
              success: false,
              roomId: cleanRoomId,
              isHost: false,
              peers: [],
              error: 'Sala não encontrada',
              code: 'ROOM_NOT_FOUND',
            });
          }
          return;
        }

        // Case A: Reconnecting with existing valid session token (Grace Period Recovery)
        if (payload.sessionToken) {
          const verified = await verifySessionToken(payload.sessionToken);
          if (verified && verified.roomId === cleanRoomId && room.members.has(verified.participantId)) {
            const existingMember = room.members.get(verified.participantId)!;

            // Cancel any pending disconnect grace timer
            if (existingMember.disconnectTimer) {
              clearTimeout(existingMember.disconnectTimer);
              existingMember.disconnectTimer = null;
              console.log(`[Room] Cancelled disconnect grace timer for participant ${existingMember.participantId}`);
            }

            // Update socket bindings
            if (existingMember.currentSocketId) {
              room.socketToParticipant.delete(existingMember.currentSocketId);
            }
            existingMember.currentSocketId = socket.id;
            room.socketToParticipant.set(socket.id, existingMember.participantId);

            socket.join(cleanRoomId);
            console.log(
              `[Room] Reconnected participant ${existingMember.participantId} (${existingMember.identity}) in room ${cleanRoomId}`
            );
            logInstanceEvent('PARTICIPANT_RECONNECTED', {
              operation: 'join-room',
              roomId: cleanRoomId,
              participantId: existingMember.participantId,
              roomCount: rooms.size,
            });

            const isHostActual = existingMember.role === 'host' && existingMember.participantId === room.hostParticipantId;
            const refreshedSessionToken = await createSessionToken({
              roomId: cleanRoomId,
              participantId: existingMember.participantId,
              sessionRole: existingMember.role,
              canPublish: existingMember.canPublish,
            });

            const memberList: MemberInfo[] = Array.from(room.members.values()).map((m) => ({
              participantId: m.participantId,
              identity: m.identity,
              role: m.role,
              canPublish: m.canPublish,
              isHost: m.role === 'host' && m.participantId === room.hostParticipantId,
              socketId: m.currentSocketId || undefined,
            }));

            // Notify other members of reconnection
            socket.to(cleanRoomId).emit('user-joined', {
              socketId: socket.id,
              participantId: existingMember.participantId,
              identity: existingMember.identity,
              isHost: isHostActual,
            });
            socket.to(cleanRoomId).emit('room-members-updated', memberList);

            const otherPeers = Array.from(room.socketToParticipant.keys()).filter((s) => s !== socket.id);

            if (typeof callback === 'function') {
              callback({
                success: true,
                roomId: cleanRoomId,
                participantId: existingMember.participantId,
                sessionToken: refreshedSessionToken,
                sessionRole: existingMember.role,
                isHost: isHostActual,
                isLocked: room.isLocked,
                peers: otherPeers,
                members: memberList,
                activeStreamers: Array.from(room.activeStreamers),
                streamViewers: streamViewers(room),
              });
            }
            return;
          }
        }

        // Case B: New participant joining
        // Lock check: if room is locked, new participants cannot join
        if (room.isLocked) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              roomId: cleanRoomId,
              isHost: false,
              peers: [],
              error: 'A sala está trancada pelo host.',
              code: 'ROOM_LOCKED',
            });
          }
          return;
        }

        // Quota check: max participants per room
        if (room.members.size >= MAX_PARTICIPANTS_PER_ROOM) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              roomId: cleanRoomId,
              isHost: false,
              peers: [],
              error: 'A sala atingiu o limite máximo de participantes',
              code: 'ROOM_FULL',
            });
          }
          return;
        }

        const participantId = crypto.randomUUID();
        const identity = sanitizeDisplayName(payload?.identity, `User-${participantId.substring(0, 4)}`);

        // Create session token
        const sessionToken = await createSessionToken({
          roomId: cleanRoomId,
          participantId,
          sessionRole: 'participant',
          canPublish: true, // Tellas allows all authenticated room members to share screen
        });

        const newMember: BackendMemberInfo = {
          participantId,
          identity,
          role: 'participant',
          canPublish: true,
          currentSocketId: socket.id,
          joinedAt: Date.now(),
          disconnectTimer: null,
        };

        room.members.set(participantId, newMember);
        room.socketToParticipant.set(socket.id, participantId);
        socket.join(cleanRoomId);

        console.log(`[Room] Participant ${participantId} (${identity}) joined room ${cleanRoomId}`);
        logInstanceEvent('PARTICIPANT_JOINED', {
          operation: 'join-room',
          roomId: cleanRoomId,
          participantId,
          roomCount: rooms.size,
        });

        const memberList: MemberInfo[] = Array.from(room.members.values()).map((m) => ({
          participantId: m.participantId,
          identity: m.identity,
          role: m.role,
          canPublish: m.canPublish,
          isHost: m.role === 'host' && m.participantId === room.hostParticipantId,
          socketId: m.currentSocketId || undefined,
        }));

        // Notify existing room members
        socket.to(cleanRoomId).emit('user-joined', {
          socketId: socket.id,
          participantId,
          identity,
          isHost: false,
        });
        socket.to(cleanRoomId).emit('room-members-updated', memberList);

        const otherPeers = Array.from(room.socketToParticipant.keys()).filter((s) => s !== socket.id);

        if (typeof callback === 'function') {
          callback({
            success: true,
            roomId: cleanRoomId,
            participantId,
            sessionToken,
            sessionRole: 'participant',
            isHost: false,
            isLocked: room.isLocked,
            peers: otherPeers,
            members: memberList,
            activeStreamers: Array.from(room.activeStreamers),
            streamViewers: streamViewers(room),
          });
        }


      }
    );

    // ─── 3. Publisher Reservation / Confirmation ─────────────────────
    socket.on('reserve-stream', (payload: { roomId?: string }, callback) => {
      const cleanRoomId = payload?.roomId?.trim().toUpperCase();
      const room = cleanRoomId ? rooms.get(cleanRoomId) : undefined;
      if (!room) {
        logInstanceEvent('ROOM_LOOKUP_FAILED', {
          operation: 'reserve-stream',
          roomId: cleanRoomId || null,
          participantId: null,
          roomCount: rooms.size,
        });
        if (typeof callback === 'function') callback({ success: false, code: 'ROOM_NOT_FOUND', error: 'Sala não encontrada' });
        return;
      }

      const participantId = room.socketToParticipant.get(socket.id);
      const member = participantId ? room.members.get(participantId) : undefined;
      if (!participantId || !member || member.currentSocketId !== socket.id) {
        if (typeof callback === 'function') callback({ success: false, code: 'STREAM_UNAUTHORIZED', error: 'Socket não associado à sala.' });
        return;
      }
      if (!member.canPublish) {
        if (typeof callback === 'function') callback({ success: false, code: 'PUBLISH_FORBIDDEN', error: 'Permissão de transmissão negada.' });
        return;
      }
      if (room.activeStreamers.has(participantId) || room.reservedPublishers.has(participantId) || cloudflareSessionRegistry.getStream(participantId)) {
        if (typeof callback === 'function') callback({ success: false, code: 'STREAM_ALREADY_EXISTS', error: 'Já existe uma reserva ou publicação para este participante.' });
        return;
      }

      const rateCheck = checkRateLimit(`participant:${participantId}:stream`, 10, 60 * 1000);
      if (!rateCheck.allowed) {
        if (typeof callback === 'function') callback({ success: false, code: 'RATE_LIMITED', error: 'Muitas ações de stream recentes.' });
        return;
      }
      if (room.activeStreamers.size + room.reservedPublishers.size >= MAX_PUBLISHERS_PER_ROOM) {
        if (typeof callback === 'function') callback({
          success: false,
          code: 'PUBLISHER_LIMIT_REACHED',
          error: `Limite de ${MAX_PUBLISHERS_PER_ROOM} transmissões simultâneas atingido.`,
        });
        return;
      }

      reservePublisher(room, participantId);
      logInstanceEvent('STREAM_RESERVED', {
        operation: 'reserve-stream',
        roomId: cleanRoomId,
        participantId,
        roomCount: rooms.size,
      });
      if (typeof callback === 'function') callback({ success: true, expiresInMs: STREAM_RESERVATION_TTL_MS });
    });

    socket.on('confirm-stream', (payload: { roomId?: string }, callback) => {
      const cleanRoomId = payload?.roomId?.trim().toUpperCase();
      const room = cleanRoomId ? rooms.get(cleanRoomId) : undefined;
      if (!room) {
        logInstanceEvent('ROOM_LOOKUP_FAILED', {
          operation: 'confirm-stream',
          roomId: cleanRoomId || null,
          participantId: null,
          roomCount: rooms.size,
        });
        if (typeof callback === 'function') callback({ success: false, code: 'ROOM_NOT_FOUND', error: 'Sala não encontrada' });
        return;
      }

      const participantId = room.socketToParticipant.get(socket.id);
      const member = participantId ? room.members.get(participantId) : undefined;
      if (!participantId || !member || member.currentSocketId !== socket.id) {
        if (typeof callback === 'function') callback({ success: false, code: 'STREAM_UNAUTHORIZED', error: 'Socket não associado à sala.' });
        return;
      }
      if (!room.reservedPublishers.has(participantId)) {
        if (typeof callback === 'function') callback({ success: false, code: 'STREAM_RESERVATION_REQUIRED', error: 'Reserva de transmissão ausente ou expirada.' });
        return;
      }

      const registeredStream = cloudflareSessionRegistry.getStream(participantId);
      if (!registeredStream || registeredStream.roomId !== cleanRoomId) {
        if (typeof callback === 'function') callback({ success: false, code: 'CLOUDFLARE_STREAM_REQUIRED', error: 'A mídia ainda não foi publicada na Cloudflare.' });
        return;
      }

      clearPublisherReservation(room, participantId);
      room.activeStreamers.add(participantId);
      if (process.env.NODE_ENV !== 'production') console.log('[CLOUDFLARE][STREAM_ANNOUNCED]', {
        participantId,
        roomId: cleanRoomId,
        hasVideoTrack: Boolean(registeredStream.videoTrackId),
        hasAudioTrack: Boolean(registeredStream.audioTrackId),
      });
      socket.to(cleanRoomId).emit('stream-started', {
        streamerSocketId: socket.id,
        participantId,
        identity: member.identity,
      });
      if (typeof callback === 'function') callback({ success: true });
    });

    socket.on('release-stream-reservation', (payload: { roomId?: string }, callback) => {
      const cleanRoomId = payload?.roomId?.trim().toUpperCase();
      const room = cleanRoomId ? rooms.get(cleanRoomId) : undefined;
      if (!room) {
        if (typeof callback === 'function') callback({ success: true, released: false });
        return;
      }
      const participantId = room.socketToParticipant.get(socket.id);
      const member = participantId ? room.members.get(participantId) : undefined;
      if (!participantId || !member || member.currentSocketId !== socket.id) {
        if (typeof callback === 'function') callback({ success: false, code: 'STREAM_UNAUTHORIZED', error: 'Socket não associado à sala.' });
        return;
      }
      const released = clearPublisherReservation(room, participantId);
      if (typeof callback === 'function') callback({ success: true, released });
    });

    // ─── 4. Stop Stream (Multi-Streaming Authorized) ─────────────────
    socket.on(
      'stop-stream',
      async (payload: { roomId: string }, callback) => {
        if (!payload || !payload.roomId) {
          if (typeof callback === 'function') callback({ success: false, error: 'roomId obrigatório' });
          return;
        }

        const cleanRoomId = payload.roomId.trim().toUpperCase();
        const room = rooms.get(cleanRoomId);
        if (!room) {
          if (typeof callback === 'function') callback({ success: false, error: 'Sala não encontrada' });
          return;
        }

        // Security: Post-auth actions rely strictly on active server-side socket binding
        const participantId = room.socketToParticipant.get(socket.id);
        if (!participantId) {
          console.warn(`[Security] Unauthorized stop-stream attempt from unmapped socket ${socket.id}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Não autorizado: socket não associado' });
          return;
        }

        const member = room.members.get(participantId);
        if (!member || member.currentSocketId !== socket.id) {
          console.warn(`[Security] Stale socket ${socket.id} attempted stop-stream for participant ${participantId}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Socket desatualizado ou não autorizado' });
          return;
        }

        if (cloudflareSessionRegistry.getStream(participantId)) {
          if (typeof callback === 'function') {
            callback({ success: false, error: 'Encerre a publicação Cloudflare antes de anunciar stop-stream.' });
          }
          return;
        }

        // Stop ONLY the caller's own stream (preserves other streamers!)
        room.activeStreamers.delete(participantId);
        if (process.env.NODE_ENV !== 'production') console.log('[CLOUDFLARE][STREAM_STOPPED_ANNOUNCED]', { participantId, roomId: cleanRoomId });
        console.log(
          `[Stream] Participant ${participantId} (${member.identity}) stopped streaming in ${cleanRoomId} (remaining streamers: ${room.activeStreamers.size})`
        );

        socket.to(cleanRoomId).emit('stream-stopped', {
          streamerSocketId: socket.id,
          participantId,
          identity: member.identity,
          remainingStreamersCount: room.activeStreamers.size,
        });

        if (typeof callback === 'function') callback({ success: true });
      }
    );

    // ─── 5. Host Administrative: Lock / Unlock Room ──────────────────
    socket.on(
      'set-room-locked',
      async (payload: { roomId: string; locked: boolean }, callback) => {
        if (!payload || !payload.roomId || typeof payload.locked !== 'boolean') {
          if (typeof callback === 'function') callback({ success: false, error: 'Payload inválido' });
          return;
        }
        const cleanRoomId = payload.roomId.trim().toUpperCase();
        const room = rooms.get(cleanRoomId);
        if (!room) {
          if (typeof callback === 'function') callback({ success: false, error: 'Sala não encontrada' });
          return;
        }
        const participantId = room.socketToParticipant.get(socket.id);
        if (!participantId || participantId !== room.hostParticipantId) {
          console.warn(`[Security] Unauthorized set-room-locked attempt from socket ${socket.id} on room ${cleanRoomId}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Apenas o host pode trancar ou destrancar a sala' });
          return;
        }

        room.isLocked = payload.locked;
        console.log(`[Room] Host ${participantId} set room ${cleanRoomId} isLocked=${room.isLocked}`);

        socket.to(cleanRoomId).emit('room-lock-status-changed', {
          roomId: cleanRoomId,
          isLocked: room.isLocked,
        });

        if (typeof callback === 'function') {
          callback({ success: true, isLocked: room.isLocked });
        }
      }
    );

    // ─── 6. Host Administrative: Kick Participant ────────────────────
    socket.on(
      'kick-participant',
      async (payload: { roomId: string; targetParticipantId?: string; targetSocketId?: string }, callback) => {
        if (!payload || !payload.roomId || (!payload.targetParticipantId && !payload.targetSocketId)) {
          if (typeof callback === 'function') callback({ success: false, error: 'Payload inválido' });
          return;
        }
        const cleanRoomId = payload.roomId.trim().toUpperCase();
        const room = rooms.get(cleanRoomId);
        if (!room) {
          if (typeof callback === 'function') callback({ success: false, error: 'Sala não encontrada' });
          return;
        }
        const senderParticipantId = room.socketToParticipant.get(socket.id);
        if (!senderParticipantId || senderParticipantId !== room.hostParticipantId) {
          console.warn(`[Security] Unauthorized kick-participant attempt from socket ${socket.id} on room ${cleanRoomId}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Apenas o host pode expulsar participantes' });
          return;
        }

        let targetParticipantId = (payload.targetParticipantId || '').trim();
        let targetMember = room.members.get(targetParticipantId);
        if (!targetMember && payload.targetSocketId) {
          const resolvedPId = room.socketToParticipant.get(payload.targetSocketId);
          if (resolvedPId) {
            targetParticipantId = resolvedPId;
            targetMember = room.members.get(targetParticipantId);
          }
        }

        if (targetParticipantId === room.hostParticipantId) {
          if (typeof callback === 'function') callback({ success: false, error: 'O host não pode expulsar a si mesmo' });
          return;
        }

        if (!targetMember) {
          if (typeof callback === 'function') callback({ success: false, error: 'Participante não encontrado na sala' });
          return;
        }

        clearPublisherReservation(room, targetParticipantId);

        // 1. If target is streaming, remove from activeStreamers and emit stream-stopped
        if (room.activeStreamers.has(targetParticipantId)) {
          room.activeStreamers.delete(targetParticipantId);
          cloudflareSessionRegistry.removeStream(targetParticipantId, 'explicit-cleanup');
          socket.to(cleanRoomId).emit('stream-stopped', {
            streamerSocketId: targetMember.currentSocketId || '',
            participantId: targetParticipantId,
            identity: targetMember.identity,
            remainingStreamersCount: room.activeStreamers.size,
          });
        }
        cloudflareSessionRegistry.removeParticipant(targetParticipantId, 'explicit-cleanup');

        // 2. Target socket cleanup & notification
        const targetSocketId = targetMember.currentSocketId;
        if (targetSocketId) {
          room.socketToParticipant.delete(targetSocketId);
          io.to(targetSocketId).emit('kicked-from-room', {
            roomId: cleanRoomId,
            reason: 'Você foi expulso da sala pelo host.',
          });
          const targetSocket = io?.sockets?.sockets?.get ? io.sockets.sockets.get(targetSocketId) : null;
          if (targetSocket) {
            targetSocket.leave(cleanRoomId);
          }
        }


        // 3. Clear disconnect timer if any
        if (targetMember.disconnectTimer) {
          clearTimeout(targetMember.disconnectTimer);
          targetMember.disconnectTimer = null;
        }

        // 4. Remove membership completely
        room.members.delete(targetParticipantId);

        console.log(`[Room] Host ${senderParticipantId} kicked participant ${targetParticipantId} (${targetMember.identity}) from ${cleanRoomId}`);

        // 5. Notify remaining room members
        socket.to(cleanRoomId).emit('user-left', {
          socketId: targetSocketId || '',
          participantId: targetParticipantId,
        });

        const remainingMembers: MemberInfo[] = Array.from(room.members.values()).map((m) => ({
          participantId: m.participantId,
          identity: m.identity,
          role: m.role,
          canPublish: m.canPublish,
          isHost: m.role === 'host' && m.participantId === room.hostParticipantId,
          socketId: m.currentSocketId || undefined,
        }));
        socket.to(cleanRoomId).emit('room-members-updated', remainingMembers);
        socket.emit('room-members-updated', remainingMembers);

        if (typeof callback === 'function') {
          callback({ success: true, members: remainingMembers });
        }
      }
    );


    // ─── 7. Host Administrative: Transfer Host ───────────────────────
    socket.on(
      'transfer-host',
      async (payload: { roomId: string; targetParticipantId?: string; targetSocketId?: string }, callback) => {
        if (!payload || !payload.roomId || (!payload.targetParticipantId && !payload.targetSocketId)) {
          if (typeof callback === 'function') callback({ success: false, error: 'Payload inválido' });
          return;
        }
        const cleanRoomId = payload.roomId.trim().toUpperCase();
        const room = rooms.get(cleanRoomId);
        if (!room) {
          if (typeof callback === 'function') callback({ success: false, error: 'Sala não encontrada' });
          return;
        }
        const senderParticipantId = room.socketToParticipant.get(socket.id);
        if (!senderParticipantId || senderParticipantId !== room.hostParticipantId) {
          console.warn(`[Security] Unauthorized transfer-host attempt from socket ${socket.id} on room ${cleanRoomId}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Apenas o host atual pode transferir a sala' });
          return;
        }

        let targetParticipantId = (payload.targetParticipantId || '').trim();
        let targetMember = room.members.get(targetParticipantId);
        if (!targetMember && payload.targetSocketId) {
          const resolvedPId = room.socketToParticipant.get(payload.targetSocketId);
          if (resolvedPId) {
            targetParticipantId = resolvedPId;
            targetMember = room.members.get(targetParticipantId);
          }
        }

        if (targetParticipantId === senderParticipantId) {
          if (typeof callback === 'function') callback({ success: false, error: 'Você já é o host da sala' });
          return;
        }

        if (!targetMember) {
          if (typeof callback === 'function') callback({ success: false, error: 'Participante alvo não encontrado na sala' });
          return;
        }


        const oldHostMember = room.members.get(senderParticipantId);
        if (oldHostMember) {
          oldHostMember.role = 'participant';
        }
        targetMember.role = 'host';
        room.hostParticipantId = targetParticipantId;

        console.log(`[Room] Host transferred in ${cleanRoomId}: ${senderParticipantId} -> ${targetParticipantId}`);

        // Issue fresh session tokens for both
        const oldHostToken = await createSessionToken({
          roomId: cleanRoomId,
          participantId: senderParticipantId,
          sessionRole: 'participant',
          canPublish: true,
        });

        const newHostToken = await createSessionToken({
          roomId: cleanRoomId,
          participantId: targetParticipantId,
          sessionRole: 'host',
          canPublish: true,
        });

        // Notify old host socket
        socket.emit('role-updated', {
          roomId: cleanRoomId,
          role: 'participant',
          isHost: false,
          sessionToken: oldHostToken,
        });

        // Notify new host socket
        if (targetMember.currentSocketId) {
          io.to(targetMember.currentSocketId).emit('role-updated', {
            roomId: cleanRoomId,
            role: 'host',
            isHost: true,
            sessionToken: newHostToken,
          });
        }


        // Broadcast host-transferred and updated memberList to all
        socket.to(cleanRoomId).emit('host-transferred', {
          roomId: cleanRoomId,
          previousHostParticipantId: senderParticipantId,
          newHostParticipantId: targetParticipantId,
        });

        const updatedMemberList: MemberInfo[] = Array.from(room.members.values()).map((m) => ({
          participantId: m.participantId,
          identity: m.identity,
          role: m.role,
          canPublish: m.canPublish,
          isHost: m.role === 'host' && m.participantId === room.hostParticipantId,
          socketId: m.currentSocketId || undefined,
        }));
        socket.to(cleanRoomId).emit('room-members-updated', updatedMemberList);
        socket.emit('room-members-updated', updatedMemberList);

        if (typeof callback === 'function') {
          callback({ success: true, newHostParticipantId: targetParticipantId, members: updatedMemberList });
        }
      }
    );


    // ─── 8. Explicit Leave Room (Immediate Cleanup) ──────────────────

    socket.on('leave-room', ({ roomId }: { roomId: string }) => {
      if (roomId) {
        void handleExplicitLeave(io, socket, roomId.trim().toUpperCase());
      }
    });

    // ─── 9. Involuntary Transport Disconnect (Grace Period) ──────────

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Disconnected: ${socket.id} (reason: ${reason})`);
      rooms.forEach((_room, roomId) => {
        handleInvoluntaryDisconnect(io, socket, roomId);
      });
    });
  });
}

/**
 * Handles an explicit leave-room action from the client (immediate cleanup).
 */
async function handleExplicitLeave(io: SocketIOServer, socket: Socket, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Security: leave-room operates only on current active socket binding
  const participantId = room.socketToParticipant.get(socket.id);
  if (!participantId) return;

  const member = room.members.get(participantId);
  if (!member || member.currentSocketId !== socket.id) return;

  if (member.disconnectTimer) {
    clearTimeout(member.disconnectTimer);
    member.disconnectTimer = null;
  }

  // Clean up streaming and membership immediately
  const wasStreaming = room.activeStreamers.has(participantId);
  clearPublisherReservation(room, participantId);
  if (process.env.NODE_ENV !== 'production') console.log('[CLOUDFLARE][PARTICIPANT_LEFT]', { participantId, roomId, wasStreaming, hadCloudflareSession: Boolean(cloudflareSessionRegistry.getSession(participantId)) });
  room.activeStreamers.delete(participantId);
  cloudflareSessionRegistry.removeParticipant(participantId, 'leave');
  if (process.env.NODE_ENV !== 'production') console.log('[CLOUDFLARE][PARTICIPANT_CLEANUP_COMPLETE]', { participantId, roomId });
  logInstanceEvent('PARTICIPANT_FINAL_CLEANUP', {
    operation: 'leave-room',
    roomId,
    participantId,
    roomCount: rooms.size,
  });
  room.socketToParticipant.delete(socket.id);
  room.members.delete(participantId);

  if (room.members.size === 0) {
    rooms.delete(roomId);
    logInstanceEvent('ROOM_DELETED', { operation: 'leave-room', roomId, participantId, roomCount: rooms.size });
    console.log(`[Room] Explicit leave: cleaned up empty room ${roomId}`);
  } else if (room.hostParticipantId === participantId) {
    await promoteNextHost(io, room, participantId);
  }

  socket.to(roomId).emit('user-left', { socketId: socket.id, participantId });
  socket.to(roomId).emit('room-members-updated', memberList(room));
  socket.leave(roomId);
}



/**
 * Handles an involuntary disconnect with a grace period timer to allow reconnects.
 */
function handleInvoluntaryDisconnect(io: SocketIOServer, socket: Socket, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participantId = room.socketToParticipant.get(socket.id);
  if (!participantId) return;

  const member = room.members.get(participantId);
  if (!member) return;

  // Keep membership and media registry during the reconnect grace period.
  // A transient transport close must not destroy a valid publication.
  const wasStreaming = room.activeStreamers.has(participantId);

  // Reservations are not publications and must never survive a transport loss.
  clearPublisherReservation(room, participantId);

  // 1. Remove only the ephemeral socket binding.
  room.socketToParticipant.delete(socket.id);
  member.currentSocketId = null;

  socket.leave(roomId);

  // 2. Clear existing timer if any
  if (member.disconnectTimer) {
    clearTimeout(member.disconnectTimer);
  }

  console.log(
    `[Room] Participant ${participantId} disconnected. Starting ${ROOM_RECONNECT_GRACE_MS}ms reconnect grace period.`
  );

  // 3. Start grace timer before removing membership and media state
  member.disconnectTimer = setTimeout(async () => {
    // Grace period expired without reconnect
    const currentRoom = rooms.get(roomId);
    if (!currentRoom) return;

    const currentMember = currentRoom.members.get(participantId);
    if (currentMember && currentMember.currentSocketId === null) {
      if (process.env.NODE_ENV !== 'production') console.log('[CLOUDFLARE][PARTICIPANT_LEFT]', {
        participantId,
        roomId,
        wasStreaming,
        hadCloudflareSession: Boolean(cloudflareSessionRegistry.getSession(participantId)),
      });
      currentRoom.activeStreamers.delete(participantId);
      currentRoom.members.delete(participantId);
      cloudflareSessionRegistry.removeParticipant(participantId, 'disconnect');
      if (process.env.NODE_ENV !== 'production') console.log('[CLOUDFLARE][PARTICIPANT_CLEANUP_COMPLETE]', { participantId, roomId });
      logInstanceEvent('PARTICIPANT_FINAL_CLEANUP', {
        operation: 'disconnect-grace-expired',
        roomId,
        participantId,
        roomCount: rooms.size,
      });
      console.log(`[Room] Reconnect grace period expired for participant ${participantId} in ${roomId}`);

      if (currentRoom.members.size === 0) {
        rooms.delete(roomId);
        logInstanceEvent('ROOM_DELETED', {
          operation: 'disconnect-grace-expired',
          roomId,
          participantId,
          roomCount: rooms.size,
        });
        console.log(`[Room] Cleaned up empty room ${roomId} after grace expiration`);
      } else if (currentRoom.hostParticipantId === participantId) {
        await promoteNextHost(io, currentRoom, participantId);
      }
      socket.to(roomId).emit('user-left', { socketId: socket.id, participantId });
      socket.to(roomId).emit('room-members-updated', memberList(currentRoom));
    }
  }, ROOM_RECONNECT_GRACE_MS);

  if (member.disconnectTimer.unref) {
    member.disconnectTimer.unref();
  }
}
