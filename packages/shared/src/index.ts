// ─── Desktop Source (Electron desktopCapturer) ──────────────────────────────

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  appIconUrl?: string;
  display_id?: string;
}

// ─── Room State (Backend) ───────────────────────────────────────────────────

export interface MemberInfo {
  participantId: string;
  identity: string;
  role: 'host' | 'participant';
  canPublish: boolean;
  isHost: boolean;
  socketId?: string;
}

export interface RoomState {
  roomId: string;
  hostId: string;
  peers: string[];
  isStreaming: boolean;
  members?: MemberInfo[];
  activeStreamers?: string[];
}

// ─── LiveKit Token Request / Response ───────────────────────────────────────

export type ParticipantRole = 'publisher' | 'viewer';

export interface LiveKitTokenRequest {
  roomId?: string;
  identity?: string;
  role?: ParticipantRole;
}

export interface LiveKitTokenResponse {
  token: string;
  livekitUrl: string;
  roomName: string;
  participantId?: string;
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
    payload: { roomId?: string; identity?: string },
    callback: (res: {
      success: boolean;
      roomId: string;
      participantId?: string;
      sessionToken?: string;
      sessionRole?: 'host' | 'participant';
      members?: MemberInfo[];
      activeStreamers?: string[];
      isLocked?: boolean;
      error?: string;
      code?: string;
    }) => void
  ) => void;
  'join-room': (
    payload: { roomId: string; identity?: string; sessionToken?: string },
    callback: (res: {
      success: boolean;
      roomId: string;
      participantId?: string;
      sessionToken?: string;
      sessionRole?: 'host' | 'participant';
      isHost: boolean;
      peers: string[];
      members?: MemberInfo[];
      activeStreamers?: string[];
      isLocked?: boolean;
      error?: string;
      code?: string;
    }) => void
  ) => void;
  // Room actions (Session Token removed: authenticated via socket binding)
  'leave-room': (payload: { roomId: string }) => void;
  'start-stream': (
    payload: { roomId: string; identity?: string },
    callback?: (response: { success: boolean; error?: string }) => void
  ) => void;
  'stop-stream': (
    payload: { roomId: string },
    callback?: (response: { success: boolean; error?: string }) => void
  ) => void;

  // Host Administrative Actions
  'kick-participant': (
    payload: { roomId: string; targetParticipantId: string },
    callback?: (response: { success: boolean; error?: string; code?: string }) => void
  ) => void;
  'set-room-locked': (
    payload: { roomId: string; locked: boolean },
    callback?: (response: { success: boolean; error?: string; isLocked?: boolean }) => void
  ) => void;
  'transfer-host': (
    payload: { roomId: string; targetParticipantId: string },
    callback?: (response: { success: boolean; error?: string; newHostParticipantId?: string }) => void
  ) => void;

  // Server → Client
  'user-joined': (payload: { socketId: string; identity?: string; participantId?: string; isHost?: boolean }) => void;
  'user-left': (payload: { socketId: string; participantId?: string }) => void;
  'room-members-updated': (members: MemberInfo[]) => void;
  'stream-started': (payload: { streamerSocketId: string; participantId?: string; identity?: string }) => void;
  'stream-stopped': (payload: { streamerSocketId: string; participantId?: string; identity?: string; remainingStreamersCount?: number }) => void;

  // Host Administrative Server → Client
  'kicked-from-room': (payload: { roomId: string; reason?: string }) => void;
  'room-lock-status-changed': (payload: { roomId: string; isLocked: boolean }) => void;
  'role-updated': (payload: { roomId: string; role: 'host' | 'participant'; isHost: boolean; sessionToken?: string }) => void;
  'host-transferred': (payload: { roomId: string; previousHostParticipantId: string; newHostParticipantId: string }) => void;
}



// ─── Windows Audio Environment & Strategy ───────────────────────────────────

export enum AudioCaptureStrategy {
  PROCESS_LOOPBACK = 'PROCESS_LOOPBACK',
  PROCESS_LOOPBACK_PROBE = 'PROCESS_LOOPBACK_PROBE',
  VIRTUAL_AUDIO_REQUIRED = 'VIRTUAL_AUDIO_REQUIRED',
}

export interface WindowsAudioEnvironment {
  platform: string;
  release: string;
  build: number;
  windowsVersion: 'Windows 10' | 'Windows 11' | 'Unknown';
  officialProcessLoopbackSupported: boolean;
  processLoopbackProbeEligible: boolean;
  processLoopbackSupported: boolean;
  strategy: AudioCaptureStrategy;
}
