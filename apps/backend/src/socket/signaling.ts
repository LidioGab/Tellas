import { Server as SocketIOServer, Socket } from 'socket.io';
import * as crypto from 'crypto';
import { RoomState, MemberInfo } from '@stream-app/shared';
import { createSessionToken, verifySessionToken } from '../auth/session';
import { checkRateLimit } from '../security/rateLimiter';
import { resolveClientIp } from '../security/ipResolver';

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
  createdAt: number;
}

const rooms = new Map<string, ExtendedRoomState>();

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
export function getPublicRoomState(roomId: string): RoomState | undefined {
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
  };
}


/**
 * Resets the entire in-memory room store (used for testing).
 * Clears all active timers to prevent memory leaks.
 */
export function resetRoomStore(): void {
  for (const room of rooms.values()) {
    for (const member of room.members.values()) {
      if (member.disconnectTimer) {
        clearTimeout(member.disconnectTimer);
        member.disconnectTimer = null;
      }
    }
  }
  rooms.clear();
}

// ─── Socket.IO Signaling & Room Management ──────────────────────────────────

export function setupSignaling(io: SocketIOServer) {
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
        createdAt: Date.now(),
      };

      rooms.set(roomId, newRoom);
      socket.join(roomId);

      console.log(`[Room] Created ${roomId} by host ${participantId} (${identity})`);

      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          participantId,
          sessionToken,
          sessionRole: 'host',
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
              isHost: existingMember.role === 'host' && existingMember.participantId === room.hostParticipantId,
            });
            socket.to(cleanRoomId).emit('room-members-updated', memberList);

            const otherPeers = Array.from(room.socketToParticipant.keys()).filter((s) => s !== socket.id);

            if (typeof callback === 'function') {
              callback({
                success: true,
                roomId: cleanRoomId,
                participantId: existingMember.participantId,
                sessionToken: payload.sessionToken,
                sessionRole: existingMember.role,
                isHost: existingMember.role === 'host' && existingMember.participantId === room.hostParticipantId,
                peers: otherPeers,
                members: memberList,
              });
            }
            return;
          }
        }

        // Case B: New participant joining
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
            peers: otherPeers,
            members: memberList,
          });
        }

      }
    );

    // ─── 3. Start Stream (Multi-Streaming Authorized) ────────────────
    socket.on(
      'start-stream',
      async (payload: { roomId: string; identity?: string }, callback) => {
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
          console.warn(`[Security] Unauthorized start-stream attempt from unmapped socket ${socket.id} on room ${cleanRoomId}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Não autorizado: socket não associado' });
          return;
        }

        const member = room.members.get(participantId);
        if (!member || member.currentSocketId !== socket.id) {
          console.warn(`[Security] Stale socket ${socket.id} attempted start-stream for participant ${participantId}`);
          if (typeof callback === 'function') callback({ success: false, error: 'Socket desatualizado ou não autorizado' });
          return;
        }

        if (!member.canPublish) {
          if (typeof callback === 'function') callback({ success: false, error: 'Permissão de transmissão negada' });
          return;
        }

        // Rate limit: 10 stream actions per minute per participant
        const rateCheck = checkRateLimit(`participant:${participantId}:stream`, 10, 60 * 1000);
        if (!rateCheck.allowed) {
          if (typeof callback === 'function') callback({ success: false, error: 'Muitas ações de stream recentes' });
          return;
        }

        // Quota check: max simultaneous publishers
        if (room.activeStreamers.size >= MAX_PUBLISHERS_PER_ROOM && !room.activeStreamers.has(participantId)) {
          if (typeof callback === 'function') {
            callback({
              success: false,
              error: `Limite de ${MAX_PUBLISHERS_PER_ROOM} transmissões simultâneas atingido`,
            });
          }
          return;
        }

        // Add this participant to active streamers
        room.activeStreamers.add(participantId);
        console.log(
          `[Stream] Participant ${participantId} (${member.identity}) started streaming in ${cleanRoomId} (active streamers: ${room.activeStreamers.size})`
        );

        // Broadcast to other room members with server-verified streamer identity
        socket.to(cleanRoomId).emit('stream-started', {
          streamerSocketId: socket.id,
          participantId,
          identity: member.identity,
        });

        if (typeof callback === 'function') callback({ success: true });
      }
    );

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

        // Stop ONLY the caller's own stream (preserves other streamers!)
        room.activeStreamers.delete(participantId);
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

    // ─── 5. Explicit Leave Room (Immediate Cleanup) ──────────────────
    socket.on('leave-room', ({ roomId }: { roomId: string }) => {
      if (roomId) {
        handleExplicitLeave(socket, roomId.trim().toUpperCase());
      }
    });

    // ─── 6. Involuntary Transport Disconnect (Grace Period) ──────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      rooms.forEach((_room, roomId) => {
        handleInvoluntaryDisconnect(socket, roomId);
      });
    });
  });
}

/**
 * Handles an explicit leave-room action from the client (immediate cleanup).
 */
function handleExplicitLeave(socket: Socket, roomId: string) {
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
  room.activeStreamers.delete(participantId);
  room.socketToParticipant.delete(socket.id);
  room.members.delete(participantId);

  socket.to(roomId).emit('user-left', {
    socketId: socket.id,
    participantId,
  });

  const remainingMembers: MemberInfo[] = Array.from(room.members.values()).map((m) => ({
    participantId: m.participantId,
    identity: m.identity,
    role: m.role,
    canPublish: m.canPublish,
    isHost: m.role === 'host' && m.participantId === room.hostParticipantId,
    socketId: m.currentSocketId || undefined,
  }));
  socket.to(roomId).emit('room-members-updated', remainingMembers);

  socket.leave(roomId);


  if (room.members.size === 0) {
    rooms.delete(roomId);
    console.log(`[Room] Explicit leave: cleaned up empty room ${roomId}`);
  } else if (room.hostParticipantId === participantId) {
    // Security: Host authority is a security principal and is NEVER automatically transferred.
    room.hostParticipantId = null;
    console.log(`[Room] Host ${participantId} left ${roomId}. Host authority unassigned (no automatic promotion).`);
  }
}


/**
 * Handles an involuntary disconnect with a grace period timer to allow reconnects.
 */
function handleInvoluntaryDisconnect(socket: Socket, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;

  const participantId = room.socketToParticipant.get(socket.id);
  if (!participantId) return;

  const member = room.members.get(participantId);
  if (!member) return;

  // 1. Immediately remove from activeStreamers (NO ghost streams!)
  room.activeStreamers.delete(participantId);
  // 2. Remove socket mapping
  room.socketToParticipant.delete(socket.id);
  member.currentSocketId = null;

  socket.to(roomId).emit('user-left', {
    socketId: socket.id,
    participantId,
  });

  socket.leave(roomId);

  // 3. Clear existing timer if any
  if (member.disconnectTimer) {
    clearTimeout(member.disconnectTimer);
  }

  console.log(
    `[Room] Participant ${participantId} disconnected. Starting ${ROOM_RECONNECT_GRACE_MS}ms reconnect grace period.`
  );

  // 4. Start grace timer before removing membership
  member.disconnectTimer = setTimeout(() => {
    // Grace period expired without reconnect
    const currentRoom = rooms.get(roomId);
    if (!currentRoom) return;

    const currentMember = currentRoom.members.get(participantId);
    if (currentMember && currentMember.currentSocketId === null) {
      currentRoom.members.delete(participantId);
      console.log(`[Room] Reconnect grace period expired for participant ${participantId} in ${roomId}`);

      if (currentRoom.members.size === 0) {
        rooms.delete(roomId);
        console.log(`[Room] Cleaned up empty room ${roomId} after grace expiration`);
      } else if (currentRoom.hostParticipantId === participantId) {
        // Security: Host authority is a security principal and is NEVER automatically transferred.
        currentRoom.hostParticipantId = null;
        console.log(`[Room] Host grace period expired in ${roomId}. Host authority unassigned (no automatic promotion).`);
      }
    }
  }, ROOM_RECONNECT_GRACE_MS);

  if (member.disconnectTimer.unref) {
    member.disconnectTimer.unref();
  }
}

