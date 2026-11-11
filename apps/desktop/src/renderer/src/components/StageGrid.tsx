import React, { useRef, useEffect, useState } from 'react';
import {
  Users,
  Radio,
  Eye,
  Maximize2,
  Minimize2,
  Video,
  VideoOff,
  Loader2,
  Monitor,
  MonitorUp,
  Settings,
  ChevronDown,
  Play
} from 'lucide-react';
import type { DesktopSource, StreamViewerInfo } from '@stream-app/shared';

export interface ParticipantItem {
  participantId?: string;
  socketId?: string;
  identity: string;
  isHost?: boolean;
  isSelf?: boolean;
}

export interface StreamItem {
  participantId: string;
  displayName: string;
  stream: MediaStream;
  isLocal?: boolean;
  viewersCount?: number;
}

interface StageGridProps {
  members: ParticipantItem[];
  currentUser: {
    name: string;
    isHost?: boolean;
    participantId: string;
  };
  cameraStream: MediaStream | null;
  isCameraActive: boolean;
  isCameraLoading: boolean;
  cameraLoadingParticipants: Set<string>;
  localStream: MediaStream | null;
  isStreaming: boolean;
  remoteStreams: Map<string, { stream: MediaStream; participantId: string; displayName: string }>;
  remoteCameraStreams: Map<string, MediaStream>;
  activeStreamers: Map<string, { participantId: string; displayName: string }>;
  streamViewers: Map<string, StreamViewerInfo[]>;
  viewMode: 'grid' | 'focus';
  focusedStreamId: string | null;
  qualityPreset: string;
  onWatchStream: (participantId: string) => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onChangeQuality: (preset: string) => void;
  onLeaveRoom: () => void;
  onToggleViewMode: (mode: 'grid' | 'focus') => void;
  onSelectFocus: (id: string) => void;
}

// Visual themes for participant tiles matching the reference design
const TILE_GRAYSCALE = [
  '#1C1C1C',
  '#242424',
  '#2C2C2C',
  '#343434',
  '#3C3C3C',
  '#444444',
];

function getThemeForParticipant(name: string, index: number) {
  const color = TILE_GRAYSCALE[Math.abs(index) % TILE_GRAYSCALE.length];
  return { bg: color, type: 'initial', accentColor: '#FAFAFA' };
}

// Custom SVG Avatars matching reference style
const AvatarGraphic: React.FC<{ themeType: string; name: string }> = ({ themeType, name }) => {
  if (themeType === 'discord') {
    return (
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#E58E26] flex items-center justify-center shadow-lg border-2 border-white/20">
        <svg className="w-9 h-9 sm:w-11 sm:h-11 text-white fill-current" viewBox="0 0 127.14 96.36">
          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1,105.25,105.25,0,0,0,32.19-16.14c2.64-27.38-4.51-51.11-19.66-72.27ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
        </svg>
      </div>
    );
  }

  if (themeType === 'moon') {
    return (
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#E5E9F8] flex items-center justify-center shadow-lg border-2 border-white/20 overflow-hidden">
        <svg className="w-12 h-12 text-[#98A3C7]" viewBox="0 0 64 64" fill="none">
          <circle cx="32" cy="32" r="30" fill="#E8ECF8" />
          <path d="M42 14C30.9543 14 22 22.9543 22 34C22 45.0457 30.9543 54 42 54C47.2889 54 52.0913 51.9568 55.6797 48.618C44.4069 49.3094 34.6906 39.5931 35.382 28.3203C32.0432 31.9087 30 36.7111 30 42" fill="#BBC6E8" opacity="0.6" />
          <circle cx="25" cy="24" r="4" fill="#C5CFEE" />
          <circle cx="38" cy="40" r="3" fill="#C5CFEE" />
          <circle cx="28" cy="38" r="2.5" fill="#C5CFEE" />
        </svg>
      </div>
    );
  }

  if (themeType === 'anime' || themeType === 'avatar') {
    return (
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#1E2024] flex items-center justify-center shadow-lg border-2 border-white/30 overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" fill="#F8D7DA" />
          <path d="M25 88C25 72 36 60 50 60C64 60 75 72 75 88" fill="#4A4E69" />
          <circle cx="50" cy="42" r="20" fill="#FCEADE" />
          <path d="M30 34C30 20 40 16 50 16C60 16 70 20 70 34C70 42 66 48 50 48C34 48 30 42 30 34Z" fill="#22223B" />
          <circle cx="43" cy="42" r="3" fill="#22223B" />
          <circle cx="57" cy="42" r="3" fill="#22223B" />
          <path d="M47 50C48 52 52 52 53 50" stroke="#E07A5F" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }

  if (themeType === 'sculpture') {
    return (
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#EDE0D4] flex items-center justify-center shadow-lg border-2 border-white/20 overflow-hidden">
        <svg className="w-full h-full" viewBox="0 0 100 100" fill="none">
          <circle cx="50" cy="50" r="48" fill="#D6CCC2" />
          <path d="M35 85C35 65 42 55 50 55C58 55 65 65 65 85" fill="#A98467" />
          <path d="M40 35C40 25 45 20 50 20C55 20 60 25 60 35C60 45 55 50 50 50C45 50 40 45 40 35Z" fill="#E6CCB2" />
          <path d="M42 28C42 22 46 18 50 18C54 18 58 22 58 28" stroke="#B08968" strokeWidth="3" />
        </svg>
      </div>
    );
  }

  // Fallback initial
  const initial = (name || 'U').charAt(0).toUpperCase();
  return (
    <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-black/25 flex items-center justify-center shadow-lg border-2 border-white/25 text-white font-bold text-2xl uppercase">
      {initial}
    </div>
  );
};

const CameraVideo: React.FC<{ stream: MediaStream; muted: boolean; mirrored: boolean }> = ({ stream, muted, mirrored }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted={muted}
      playsInline
      className={`absolute inset-0 h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
    />
  );
};

// Video player tile for screen shares
const VideoTile: React.FC<{
  stream: MediaStream | null;
  title: string;
  isLive?: boolean;
  isCamera?: boolean;
  isSelf?: boolean;
  viewersCount?: number;
  onWatch?: () => void;
  showWatchButton?: boolean;
  fill?: boolean;
  onExpand?: () => void;
}> = ({
  stream,
  title,
  isLive = true,
  isCamera = false,
  isSelf = false,
  viewersCount = 0,
  onWatch,
  showWatchButton = false,
  fill = false,
  onExpand,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className={`relative w-full rounded-2xl overflow-hidden bg-[#171717] border border-[#262626]/40 shadow-xl group flex flex-col justify-between ${fill ? 'h-full min-h-[300px]' : 'aspect-video'}`}>
      {/* Video element */}
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-[#18191D]">
          <Monitor className="w-12 h-12 text-[#6D6F78]" />
        </div>
      )}

      {/* Top overlay shadow */}
      <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

      {/* Bottom overlay with stream details & live badge */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent flex flex-col gap-1.5 z-10">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs sm:text-sm font-semibold text-white drop-shadow truncate">
            {title}
          </span>
          {isLive && (
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#EF4444] text-white text-[10px] font-bold tracking-wider uppercase shadow">
              AO VIVO
            </span>
          )}
        </div>

        {/* Action row (viewers + Watch button) */}
        {!isCamera && (
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5 text-[11px] text-[#DBDEE1]/80">
              <Users className="w-3.5 h-3.5" />
              <span>{viewersCount > 0 ? `${viewersCount} espectadores` : '0 espectadores'}</span>
            </div>

            {showWatchButton && onWatch && (
              <div className="flex items-center gap-1.5">
                {onExpand && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onExpand();
                    }}
                    title="Ampliar no palco"
                    className="p-1.5 rounded-md bg-black/45 hover:bg-black/65 text-white transition"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onWatch();
                  }}
                  className="flex items-center gap-1 px-3 py-1 rounded-md bg-[#FFFFFF] hover:bg-[#4752C4] text-white text-xs font-semibold shadow-sm transition active:scale-95"
                >
                  <Play className="w-3 h-3 fill-white" />
                  Assistir
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const StageGrid: React.FC<StageGridProps> = ({
  members,
  currentUser,
  cameraStream,
  isCameraActive,
  isCameraLoading,
  cameraLoadingParticipants,
  localStream,
  isStreaming,
  remoteStreams,
  remoteCameraStreams,
  activeStreamers,
  streamViewers,
  viewMode,
  focusedStreamId,
  qualityPreset,
  onWatchStream,
  onToggleCamera,
  onToggleScreenShare,
  onChangeQuality,
  onLeaveRoom,
  onToggleViewMode,
  onSelectFocus,
}) => {
  const [qualityMenuOpen, setQualityMenuOpen] = React.useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hideControls = () => setControlsVisible(false);
    const revealControls = () => {
      setControlsVisible(true);
      if (controlsIdleTimerRef.current) clearTimeout(controlsIdleTimerRef.current);
      controlsIdleTimerRef.current = setTimeout(hideControls, 4_000);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (event.clientY >= window.innerHeight - 140) revealControls();
    };
    const handleKeyDown = () => revealControls();

    controlsIdleTimerRef.current = setTimeout(hideControls, 4_000);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('keydown', handleKeyDown);
      if (controlsIdleTimerRef.current) clearTimeout(controlsIdleTimerRef.current);
    };
  }, []);

  // Combine streamers
  const allStreamersList: Array<{
    id: string;
    displayName: string;
    stream: MediaStream | null;
    isLocal: boolean;
    viewersCount: number;
  }> = [];

  // Local streamer
  if (isStreaming && localStream) {
    allStreamersList.push({
      id: currentUser.participantId || 'local-streamer',
      displayName: currentUser.name,
      stream: localStream,
      isLocal: true,
      viewersCount: streamViewers.get(currentUser.participantId)?.length || 0,
    });
  }

  // Remote streamers
  remoteStreams.forEach((item, pid) => {
    allStreamersList.push({
      id: pid,
      displayName: item.displayName || activeStreamers.get(pid)?.displayName || 'Transmitindo',
      stream: item.stream,
      isLocal: false,
      viewersCount: streamViewers.get(pid)?.length || 0,
    });
  });

  activeStreamers.forEach((item, pid) => {
    if (pid === currentUser.participantId || allStreamersList.some((streamer) => streamer.id === pid)) return;
    allStreamersList.push({
      id: pid,
      displayName: item.displayName || 'Transmitindo',
      stream: null,
      isLocal: false,
      viewersCount: streamViewers.get(pid)?.length || 0,
    });
  });

  // When in focus mode and a specific stream is chosen
  const focusedStream = focusedStreamId
    ? allStreamersList.find((s) => s.id === focusedStreamId) || allStreamersList[0]
    : allStreamersList[0];

  return (
    <div className="flex-1 flex flex-col h-full bg-[#0A0A0A] relative overflow-hidden select-none">
      {/* ── Main Stage Area: Grid or Focus Mode ──────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 pb-24">
        {viewMode === 'focus' && focusedStream ? (
          /* Focus Mode: Prominent large stream with row of peers */
          <div className="relative h-full flex flex-col gap-4">
            <button
              onClick={() => onToggleViewMode('grid')}
              title="Recolher transmissão"
              className="absolute right-3 top-3 z-20 p-2 rounded-lg bg-black/55 hover:bg-black/75 text-white transition"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <div className="flex-1 min-h-[300px]">
              <VideoTile
                stream={focusedStream.stream}
                title={`${focusedStream.displayName} - Transmissão de Tela`}
                isLive
                isSelf={focusedStream.isLocal}
                viewersCount={focusedStream.viewersCount}
                onWatch={() => onWatchStream(focusedStream.id)}
                showWatchButton={!focusedStream.isLocal}
                fill
              />
            </div>
          </div>
        ) : (
          /* Grid Mode: Modern Responsive Grid matching the reference image */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-3.5 sm:gap-4 auto-rows-fr">
            {allStreamersList.length === 0 && members.length === 0 && (
              <div className="col-span-full min-h-[280px] flex flex-col items-center justify-center gap-3 text-center">
                <Users className="w-10 h-10 text-[#6D6F78]" />
                <p className="text-sm font-medium text-[#DBDEE1]">Aguardando participantes</p>
                <p className="text-xs text-[#949BA4]">As transmissões aparecerão aqui quando alguém entrar na sala.</p>
              </div>
            )}

            {/* 1. Screen Shares (Transmissão de Tela) */}
            {allStreamersList.map((streamer) => (
              <VideoTile
                key={streamer.id}
                stream={streamer.stream}
                title={`${streamer.displayName} - Transmissão de Tela`}
                isLive
                isSelf={streamer.isLocal}
                viewersCount={streamer.viewersCount}
                onWatch={() => onWatchStream(streamer.id)}
                showWatchButton={!streamer.isLocal}
                onExpand={!streamer.isLocal ? () => {
                  onSelectFocus(streamer.id);
                  onToggleViewMode('focus');
                } : undefined}
              />
            ))}

            {/* Participant Cards (Avatar Tiles) */}
            {members.map((member, idx) => {
              const theme = getThemeForParticipant(member.identity, idx);
              const isSelf = member.isSelf
                || member.participantId === currentUser.participantId
                || member.identity === currentUser.name;
              const remoteCameraStream = member.participantId ? remoteCameraStreams.get(member.participantId) : null;
              const activeCameraStream = isSelf && isCameraActive && cameraStream ? cameraStream : remoteCameraStream;
              const participantCameraLoading = isSelf
                ? isCameraLoading
                : Boolean(member.participantId && cameraLoadingParticipants.has(member.participantId));

              return (
                <div
                  key={member.participantId || member.socketId || `${member.identity}-${idx}`}
                  style={{ backgroundColor: theme.bg }}
                  className="relative aspect-video w-full rounded-2xl overflow-hidden shadow-lg flex flex-col items-center justify-center p-4 border border-black/10 transition-transform duration-150 hover:scale-[1.01]"
                >
                  {!participantCameraLoading && activeCameraStream ? (
                    <CameraVideo
                      stream={activeCameraStream}
                      muted={isSelf}
                      mirrored={isSelf}
                    />
                  ) : !participantCameraLoading ? (
                    <div className="relative z-10 transform scale-105 sm:scale-110">
                      <AvatarGraphic themeType={theme.type} name={member.identity} />
                    </div>
                  ) : null}

                  {participantCameraLoading && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
                      <Loader2 className="w-7 h-7 animate-spin" />
                      <span className="text-xs font-medium">Iniciando câmera...</span>
                    </div>
                  )}

                  {/* Name badge at bottom left */}
                  <div className="absolute inset-x-0 bottom-0 z-20 p-3 bg-gradient-to-t from-black/75 to-transparent">
                    <span className="px-2.5 py-1 rounded-md bg-black/45 backdrop-blur-sm text-white text-xs font-medium tracking-wide shadow-sm">
                      {member.identity}
                      {isSelf && <span className="opacity-80 ml-1">(você)</span>}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Floating Bottom Control Bar ───────────────────────────────── */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none z-30 max-w-[calc(100vw-2rem)]">
        <div
          className={`pointer-events-auto flex w-fit max-w-full items-center gap-2 sm:gap-3 bg-[#111111]/95 backdrop-blur-md border border-[#262626] shadow-2xl rounded-2xl px-3 sm:px-4 py-2 transition-transform duration-500 ease-in-out ${controlsVisible ? '' : 'pointer-events-none'}`}
          style={{ transform: controlsVisible ? 'translateY(0)' : 'translateY(calc(100% + 1rem))' }}
        >
            {/* Camera Button */}
            <button
              onClick={onToggleCamera}
              disabled={isCameraLoading}
              title={isCameraLoading ? 'Iniciando câmera...' : isCameraActive ? 'Desligar câmera' : 'Ligar câmera'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${
                isCameraActive
                  ? 'bg-[#1F1F1F] text-white hover:bg-[#2A2A2A]'
                  : 'text-[#DBDEE1] hover:bg-[#1F1F1F] hover:text-white'
              }`}
            >
              {isCameraLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : isCameraActive ? <VideoOff className="w-4 h-4 text-[#EF4444]" /> : <Video className="w-4 h-4" />}
              <span className="hidden sm:inline">{isCameraLoading ? 'Iniciando...' : isCameraActive ? 'Desligar Câmera' : 'Ligar Câmera'}</span>
            </button>

            {/* Screen Share Button */}
            <button
              onClick={onToggleScreenShare}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition ${
                isStreaming
                  ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#ED4245]/30'
                  : 'text-[#DBDEE1] hover:bg-[#1F1F1F] hover:text-white'
              }`}
            >
              <MonitorUp className="w-4 h-4" />
              <span className="hidden sm:inline">{isStreaming ? 'Parar Transmissão' : 'Compartilhar Tela'}</span>
            </button>

            {/* Quality Picker Button */}
            <div className="relative">
              <button
                onClick={() => setQualityMenuOpen(!qualityMenuOpen)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#DBDEE1] hover:bg-[#1F1F1F] hover:text-white transition"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">Mudar Qualidade</span>
              </button>

              {qualityMenuOpen && (
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-40 bg-[#171717] border border-[#262626] rounded-xl shadow-2xl p-1.5 space-y-1">
                  {['720p30', '720p60', '1080p30', '1080p60'].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => {
                        onChangeQuality(preset);
                        setQualityMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        qualityPreset === preset ? 'bg-[#FFFFFF] text-white' : 'text-[#DBDEE1] hover:bg-[#1F1F1F]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Leave Room Button */}
            <button
              onClick={onLeaveRoom}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white text-xs font-semibold shadow-md transition active:scale-95"
            >
              <span>Sair da Sala</span>
            </button>
        </div>
      </div>
    </div>
  );
};
