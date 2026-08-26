// ─── Desktop Source (Electron desktopCapturer) ──────────────────────────────

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  appIconUrl?: string;
  display_id?: string;
}

// ─── Room State (Backend) ───────────────────────────────────────────────────

export interface RoomState {
  roomId: string;
  hostId: string;
  peers: string[];
  isStreaming: boolean;
}

// ─── LiveKit Token Request / Response ───────────────────────────────────────

export type ParticipantRole = 'publisher' | 'viewer';

export interface LiveKitTokenRequest {
  roomId: string;
  identity: string;
  role: ParticipantRole;
}

export interface LiveKitTokenResponse {
  token: string;
  livekitUrl: string;
  roomName: string;
}

// ─── Video Quality Presets ──────────────────────────────────────────────────

export interface VideoQualityPreset {
  label: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number; // kbps
}

export const VIDEO_QUALITY_PRESETS: Record<string, VideoQualityPreset> = {
  '720p30': { label: '720p 30fps', width: 1280, height: 720, frameRate: 30, maxBitrate: 2500 },
  '720p60': { label: '720p 60fps', width: 1280, height: 720, frameRate: 60, maxBitrate: 4000 },
  '1080p30': { label: '1080p 30fps', width: 1920, height: 1080, frameRate: 30, maxBitrate: 4500 },
  '1080p60': { label: '1080p 60fps', width: 1920, height: 1080, frameRate: 60, maxBitrate: 6000 },
};

// ─── Socket.IO Events (Room Management Only — no WebRTC signaling) ──────────

export interface SignalingEvents {
  // Client → Server
  'create-room': (
    payload: { roomId?: string },
    callback: (res: { success: boolean; roomId: string; error?: string }) => void
  ) => void;
  'join-room': (
    payload: { roomId: string; identity: string },
    callback: (res: {
      success: boolean;
      roomId: string;
      isHost: boolean;
      peers: string[];
      error?: string;
    }) => void
  ) => void;
  'leave-room': (payload: { roomId: string }) => void;
  'start-stream': (payload: { roomId: string }) => void;
  'stop-stream': (payload: { roomId: string }) => void;

  // Server → Client
  'user-joined': (payload: { socketId: string }) => void;
  'user-left': (payload: { socketId: string }) => void;
  'stream-started': (payload: { streamerSocketId: string }) => void;
  'stream-stopped': (payload: { streamerSocketId: string }) => void;
}
