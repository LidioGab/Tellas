import { Server as SocketIOServer, Socket } from 'socket.io';
import { RoomState } from '@stream-app/shared';

export interface ParticipantInfo {
  socketId: string;
  identity: string;
  isHost?: boolean;
}

interface ExtendedRoomState extends RoomState {
  members: Map<string, { identity: string }>;
}

const rooms = new Map<string, ExtendedRoomState>();

function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Returns the room if it exists, or undefined.
 */
export function getRoom(roomId: string): RoomState | undefined {
  return rooms.get(roomId);
}

/**
 * Gets existing room or registers a new room.
 */
export function getOrCreateRoom(roomId: string, hostId?: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      hostId: hostId || 'host',
      peers: hostId ? [hostId] : [],
      isStreaming: false,
      members: new Map()
    };
    if (hostId) {
      room.members.set(hostId, { identity: 'Host' });
    }
    rooms.set(roomId, room);
  }
  return room;
}

/**
 * Socket.IO signaling — Room Management Only.
 * WebRTC signaling (offer/answer/ICE) is handled entirely by LiveKit.
 */
export function setupSignaling(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ─── Create Room ─────────────────────────────────────────────────
    socket.on('create-room', (payload: { roomId?: string; identity?: string }, callback) => {
      const roomId = (payload.roomId && payload.roomId.trim()) || generateRoomId();
      const identity = (payload.identity && payload.identity.trim()) || 'Host';

      if (typeof roomId !== 'string' || roomId.length < 1 || roomId.length > 20) {
        if (typeof callback === 'function') {
          callback({ success: false, roomId: '', error: 'ID da sala inválido' });
        }
        return;
      }

      const members = new Map<string, { identity: string }>();
      members.set(socket.id, { identity });

      const newRoom: ExtendedRoomState = {
        roomId,
        hostId: socket.id,
        peers: [socket.id],
        isStreaming: false,
        members
      };

      rooms.set(roomId, newRoom);
      socket.join(roomId);
      console.log(`[Room] Created ${roomId} by host ${socket.id} (${identity})`);

      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          members: Array.from(members.entries()).map(([sid, info]) => ({
            socketId: sid,
            identity: info.identity,
            isHost: true
          }))
        });
      }
    });

    // ─── Join Room ───────────────────────────────────────────────────
    socket.on('join-room', (payload: { roomId: string; identity?: string }, callback) => {
      const roomId = payload.roomId ? payload.roomId.trim().toUpperCase() : '';
      const identity = (payload.identity && payload.identity.trim()) || `User-${socket.id.substring(0, 4)}`;

      if (!roomId) {
        if (typeof callback === 'function') {
          callback({ success: false, roomId: '', isHost: false, peers: [], error: 'ID da sala é obrigatório' });
        }
        return;
      }

      // Auto-register room if not present in memory
      let room = rooms.get(roomId);
      if (!room) {
        const members = new Map<string, { identity: string }>();
        members.set(socket.id, { identity });
        room = {
          roomId,
          hostId: socket.id,
          peers: [socket.id],
          isStreaming: false,
          members
        };
        rooms.set(roomId, room);
      } else {
        if (!room.peers.includes(socket.id)) {
          room.peers.push(socket.id);
        }
        room.members.set(socket.id, { identity });
      }

      socket.join(roomId);
      console.log(`[Room] User ${socket.id} (${identity}) joined room ${roomId}`);

      // Notify existing peers with name
      socket.to(roomId).emit('user-joined', {
        socketId: socket.id,
        identity
      });

      const memberList = Array.from(room.members.entries()).map(([sid, info]) => ({
        socketId: sid,
        identity: info.identity,
        isHost: room!.hostId === sid
      }));

      const otherPeers = room.peers.filter(id => id !== socket.id);
      if (typeof callback === 'function') {
        callback({
          success: true,
          roomId,
          isHost: room.hostId === socket.id,
          peers: otherPeers,
          members: memberList
        });
      }
    });

    // ─── Leave Room ──────────────────────────────────────────────────
    socket.on('leave-room', ({ roomId }: { roomId: string }) => {
      removeFromRoom(socket, roomId);
    });

    // ─── Stream Status ───────────────────────────────────────────────
    socket.on('start-stream', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.isStreaming = true;
        socket.to(roomId).emit('stream-started', { streamerSocketId: socket.id });
      }
    });

    socket.on('stop-stream', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.isStreaming = false;
        socket.to(roomId).emit('stream-stopped', { streamerSocketId: socket.id });
      }
    });

    // ─── Disconnect ──────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      rooms.forEach((_room, roomId) => {
        removeFromRoom(socket, roomId);
      });
    });
  });
}

function removeFromRoom(socket: Socket, roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (!room.peers.includes(socket.id)) return;

  room.peers = room.peers.filter(id => id !== socket.id);
  room.members.delete(socket.id);
  socket.to(roomId).emit('user-left', { socketId: socket.id });
  socket.leave(roomId);

  if (room.peers.length === 0) {
    rooms.delete(roomId);
    console.log(`[Room] Cleaned up empty room ${roomId}`);
  } else if (room.hostId === socket.id) {
    room.hostId = room.peers[0];
    console.log(`[Room] Host reassigned in ${roomId} to ${room.hostId}`);
  }
}
