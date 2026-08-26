import React, { useEffect, useState, useCallback, useRef } from 'react';
import { socket } from './services/socket';
import { livekitService, type RemoteStreamInfo } from './services/livekitService';
import { audioCaptureManager } from './audio/AudioCaptureManager';
import type { DesktopSource } from '@stream-app/shared';
import { VIDEO_QUALITY_PRESETS } from '@stream-app/shared';
import { ConnectionState } from 'livekit-client';
import { SourcePickerModal } from './components/SourcePickerModal';
import { StreamPublisher } from './components/StreamPublisher';
import { StreamViewer } from './components/StreamViewer';
import {
  Monitor,
  Users,
  Copy,
  Check,
  Tv,
  Radio,
  PlusCircle,
  LogIn,
  LogOut,
  Sparkles,
  ScreenShare,
  User,
  Settings,
  Headphones,
  Crown,
  Volume2,
  ChevronDown,
  X
} from 'lucide-react';

interface Member {
  socketId: string;
  identity: string;
  isHost?: boolean;
}

function generateRandomName(): string {
  const adjectives = ['Player', 'Cyber', 'Shadow', 'Neo', 'Gamer', 'Apex', 'Hyper', 'Sonic'];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${num}`;
}

interface RemoteStreamItem {
  stream: MediaStream;
  identity: string;
}

export const App: React.FC = () => {
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('stream_username') || generateRandomName();
  });
  const [roomId, setRoomId] = useState<string>('');
  const [inputRoomId, setInputRoomId] = useState<string>('');
  const [isInRoom, setIsInRoom] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [isMembersMenuOpen, setIsMembersMenuOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Stream state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStreamItem>>(new Map());
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);

  // Quality preset
  const [qualityPreset, setQualityPreset] = useState<string>('1080p30');

  const membersMenuRef = useRef<HTMLDivElement>(null);

  // Handle nickname persistence
  const handleNameChange = (name: string) => {
    setUserName(name);
    localStorage.setItem('stream_username', name);
  };

  const getEffectiveIdentity = useCallback(() => {
    const trimmed = userName.trim();
    return trimmed.length > 0 ? trimmed : `User-${Math.random().toString(36).substring(2, 6)}`;
  }, [userName]);

  // Close members menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (membersMenuRef.current && !membersMenuRef.current.contains(event.target as Node)) {
        setIsMembersMenuOpen(false);
      }
    };
    if (isMembersMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMembersMenuOpen]);

  // ─── LiveKit Callbacks ──────────────────────────────────────────────

  useEffect(() => {
    livekitService.setCallbacks({
      onRemoteTrackSubscribed: (info: RemoteStreamInfo) => {
        console.log('[App] Remote track subscribed from:', info.identity);
        setRemoteStreams((prev) => new Map(prev).set(info.participantId, { stream: info.stream, identity: info.identity }));
      },
      onRemoteTrackUnsubscribed: (participantId: string) => {
        console.log('[App] Remote track removed:', participantId);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
      },
      onConnectionStateChanged: (state: ConnectionState) => {
        console.log('[App] Connection state changed:', state);
        setConnectionState(state);
      },
      onError: (error: Error) => {
        console.error('[App] LiveKit error:', error);
      },
    });
  }, []);

  // ─── Socket.IO Room Events ──────────────────────────────────────────

  useEffect(() => {
    socket.on('user-joined', ({ socketId, identity }: { socketId: string; identity?: string }) => {
      console.log('[App] Peer joined:', socketId, identity);
      setMembers((prev) => {
        const filtered = prev.filter((m) => m.socketId !== socketId);
        return [...filtered, { socketId, identity: identity || 'Convidado', isHost: false }];
      });
    });

    socket.on('user-left', ({ socketId }: { socketId: string }) => {
      console.log('[App] Peer left:', socketId);
      setMembers((prev) => prev.filter((m) => m.socketId !== socketId));
    });

    socket.on('stream-started', () => {
      console.log('[App] Stream started in room');
      if (roomId && !isHost && !livekitService.connected) {
        connectAsViewer(roomId, getEffectiveIdentity());
      }
    });

    socket.on('stream-stopped', () => {
      console.log('[App] Stream stopped in room');
      setRemoteStreams(new Map());
    });

    return () => {
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('stream-started');
      socket.off('stream-stopped');
    };
  }, [roomId, isHost, getEffectiveIdentity]);

  // ─── Connect As Viewer Helper ───────────────────────────────────────

  const connectAsViewer = async (room: string, identity: string) => {
    try {
      console.log('[App] Requesting viewer token for room:', room, 'as identity:', identity);
      const tokenResponse = await livekitService.requestToken({
        roomId: room,
        identity,
        role: 'viewer',
      });
      await livekitService.connect(tokenResponse);
      console.log('[App] Successfully connected to LiveKit as viewer');
    } catch (err: any) {
      console.error('[App] Failed to connect as viewer:', err);
      alert(`Falha ao conectar na transmissão: ${err.message}`);
    }
  };

  // ─── Room Actions ───────────────────────────────────────────────────

  const handleCreateRoom = useCallback(() => {
    const identity = getEffectiveIdentity();
    socket.emit('create-room', { identity }, (res: any) => {
      if (res.success) {
        setRoomId(res.roomId);
        setIsInRoom(true);
        setIsHost(true);
        setMembers(res.members || [{ socketId: socket.id, identity, isHost: true }]);
      } else {
        alert(res.error || 'Erro ao criar sala');
      }
    });
  }, [getEffectiveIdentity]);

  const handleJoinRoom = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRoomId.trim()) return;

    const cleanRoomId = inputRoomId.trim().toUpperCase();
    const identity = getEffectiveIdentity();

    socket.emit('join-room', { roomId: cleanRoomId, identity }, (res: any) => {
      if (res.success) {
        setRoomId(res.roomId);
        setIsInRoom(true);
        setIsHost(res.isHost);
        setMembers(res.members || [{ socketId: socket.id, identity, isHost: res.isHost }]);

        // Connect to LiveKit to receive remote tracks from the SFU
        connectAsViewer(res.roomId, identity);
      } else {
        alert(res.error || 'Erro ao entrar na sala');
      }
    });
  }, [inputRoomId, getEffectiveIdentity]);

  const handleLeaveRoom = useCallback(async () => {
    if (roomId) {
      socket.emit('leave-room', { roomId });
    }
    await handleStopStream();
    await livekitService.disconnect();
    setIsInRoom(false);
    setRoomId('');
    setMembers([]);
    setRemoteStreams(new Map());
    setConnectionState(null);
    setIsMembersMenuOpen(false);
  }, [roomId]);

  const copyRoomCode = useCallback(() => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  // ─── Streaming Actions ───────────────────────────────────────

  const startStreamingViaLiveKit = async (videoStream: MediaStream) => {
    let finalStream = videoStream;
    const identity = getEffectiveIdentity();

    // Try to add WASAPI system audio (Phase 2 — Electron only)
    if (window.electronAPI?.startAudioCapture) {
      try {
        await audioCaptureManager.start(48000);
        const audioTrack = audioCaptureManager.getAudioTrack();
        if (audioTrack) {
          console.log('[App] WASAPI audio track obtained:', audioTrack.id);
          const videoTracks = videoStream.getVideoTracks();
          finalStream = new MediaStream([...videoTracks, audioTrack]);
        }
      } catch (audioErr) {
        console.warn('[App] WASAPI audio capture failed, using original stream:', audioErr);
      }
    }

    try {
      // 1. Request publisher token from backend
      console.log('[App] Requesting publisher token for room:', roomId, 'identity:', identity);
      const tokenResponse = await livekitService.requestToken({
        roomId,
        identity,
        role: 'publisher',
      });

      // 2. Connect to LiveKit room
      if (!livekitService.connected) {
        await livekitService.connect(tokenResponse);
      }

      // 3. Set quality preset
      livekitService.setQualityPreset(qualityPreset);

      // 4. Publish stream through LiveKit SFU
      await livekitService.publishStream(finalStream);

      // 5. Update local UI state
      setLocalStream(finalStream);
      setIsStreaming(true);

      socket.emit('start-stream', { roomId });
      console.log('[App] Stream published successfully via LiveKit SFU');
    } catch (err: any) {
      console.error('[App] Failed to publish stream:', err);
      alert(`Erro ao iniciar transmissão no LiveKit: ${err.message}`);
      setIsStreaming(false);
      setLocalStream(null);
      if (finalStream) {
        finalStream.getTracks().forEach((t) => t.stop());
      }
    }
  };

  // Electron desktop source capture
  const handleStartCapture = async (source: DesktopSource) => {
    setSelectedSource(source);

    const isScreenSource = source.id.startsWith('screen:');
    const preset = VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];

    try {
      let stream: MediaStream;

      if (isScreenSource) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-ignore
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
              minWidth: preset.width,
              maxWidth: preset.width,
              minHeight: preset.height,
              maxHeight: preset.height,
              maxFrameRate: preset.frameRate
            }
          }
        });
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            // @ts-ignore
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: source.id,
              minWidth: preset.width,
              maxWidth: preset.width,
              minHeight: preset.height,
              maxHeight: preset.height,
              maxFrameRate: preset.frameRate
            }
          }
        });
      }

      setIsModalOpen(false);
      await startStreamingViaLiveKit(stream);

      stream.getVideoTracks()[0].onended = () => {
        handleStopStream();
      };
    } catch (err: any) {
      console.error('[App] Failed to capture screen source:', err);
      alert(`Erro ao capturar fonte de vídeo: ${err.message}`);
    }
  };

  // Native Windows DisplayMedia capture
  const handleStartNativeCapture = async () => {
    const preset = VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: preset.width },
          height: { ideal: preset.height },
          frameRate: { ideal: preset.frameRate }
        },
        audio: false
      });

      setSelectedSource({
        id: 'native:screen',
        name: 'Tela Selecionada',
        thumbnail: ''
      });

      setIsModalOpen(false);
      await startStreamingViaLiveKit(stream);

      stream.getVideoTracks()[0].onended = () => {
        handleStopStream();
      };
    } catch (err: any) {
      console.error('[App] Failed to getDisplayMedia:', err);
    }
  };

  const handleStopStream = async () => {
    // Stop audio capture
    audioCaptureManager.stop();

    // Stop local media tracks
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    // Unpublish from LiveKit
    await livekitService.unpublishAllTracks();

    setIsStreaming(false);
    setSelectedSource(null);

    if (roomId) {
      socket.emit('stop-stream', { roomId });
    }
  };

  // ─── Quality Preset Change ──────────────────────────────────────────

  const handleQualityChange = (presetKey: string) => {
    setQualityPreset(presetKey);
    livekitService.setQualityPreset(presetKey);
  };

  const currentPreset = VIDEO_QUALITY_PRESETS[qualityPreset];
  const hasAnyRemoteStream = remoteStreams.size > 0;

  return (
    <div className="flex flex-col h-screen bg-[#1E1F22] text-[#DBDEE1] select-none font-sans overflow-hidden">

      {/* Clean Discord-Style Header */}
      <header className="h-12 px-4 bg-[#2B2D31] border-b border-[#1F2023] flex items-center justify-between z-30 shadow-sm">
        {/* Left: Discord Channel Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#5865F2] flex items-center justify-center text-white shadow-sm">
            <Radio className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-[#80848E]">#</span>
            <span className="font-bold text-[#F2F3F5] text-sm tracking-wide">
              transmissão-ao-vivo
            </span>
          </div>
        </div>

        {/* Right: User Profile & Interactive Room Controls */}
        <div className="flex items-center gap-2.5">
          {/* User Name Pill */}
          <div className="flex items-center gap-1.5 bg-[#1E1F22] px-2.5 py-1 rounded-md border border-[#313338] text-xs">
            <div className="w-4 h-4 rounded-full bg-[#5865F2] flex items-center justify-center text-[9px] font-bold text-white uppercase">
              {userName ? userName.charAt(0) : 'U'}
            </div>
            <span className="font-semibold text-[#F2F3F5] max-w-[110px] truncate">
              {userName || 'Convidado'}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#23A55A]"></span>
          </div>

          {/* Room Controls if In Room */}
          {isInRoom && (
            <div className="flex items-center gap-2">
              {/* Room Code Badge */}
              <div className="flex items-center gap-1 bg-[#1E1F22] px-2.5 py-1 rounded-md border border-[#313338] text-xs">
                <span className="text-[10px] text-[#949BA4] uppercase font-bold">Sala:</span>
                <span className="font-mono font-bold text-[#F2F3F5] tracking-wider">
                  {roomId}
                </span>
                <button
                  onClick={copyRoomCode}
                  className="p-0.5 hover:text-white text-[#949BA4] transition"
                  title="Copiar código"
                >
                  {copied ? <Check className="w-3 h-3 text-[#23A55A]" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>

              {/* Members Dropdown Menu Button */}
              <div className="relative" ref={membersMenuRef}>
                <button
                  onClick={() => setIsMembersMenuOpen(!isMembersMenuOpen)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition ${
                    isMembersMenuOpen
                      ? 'bg-[#5865F2] text-white border-[#5865F2]'
                      : 'bg-[#1E1F22] text-[#DBDEE1] hover:text-white border-[#313338] hover:bg-[#35373C]'
                  }`}
                  title="Ver participantes"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>{Math.max(1, members.length)}</span>
                  <ChevronDown className={`w-3 h-3 transition-transform ${isMembersMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Discord Members Popover Menu */}
                {isMembersMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-[#2B2D31] rounded-xl shadow-2xl border border-[#1E1F22] p-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#35373C] mb-1">
                      <span className="text-[11px] font-bold text-[#949BA4] uppercase tracking-wider">
                        Membros no Canal ({Math.max(1, members.length)})
                      </span>
                      <button
                        onClick={() => setIsMembersMenuOpen(false)}
                        className="text-[#949BA4] hover:text-white p-0.5 rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1 max-h-56 overflow-y-auto py-1">
                      {/* Local User (Self) */}
                      <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-[#35373C]/60 hover:bg-[#35373C] transition">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="relative">
                            <div className="w-6 h-6 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white uppercase">
                              {userName ? userName.charAt(0) : 'U'}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#23A55A] border border-[#2B2D31]"></span>
                          </div>
                          <div className="truncate">
                            <p className="text-xs font-bold text-[#F2F3F5] truncate">
                              {userName} <span className="text-[10px] font-normal text-[#949BA4]">(Você)</span>
                            </p>
                          </div>
                        </div>
                        {isHost ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold bg-[#F0B232]/20 text-[#F0B232] px-1.5 py-0.5 rounded border border-[#F0B232]/30">
                            <Crown className="w-2.5 h-2.5" /> Host
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#949BA4] font-medium">Convidado</span>
                        )}
                      </div>

                      {/* Remote Members */}
                      {members
                        .filter((m) => m.socketId !== socket.id)
                        .map((member) => (
                          <div
                            key={member.socketId}
                            className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-[#35373C] transition"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="relative">
                                <div className="w-6 h-6 rounded-full bg-[#35373C] flex items-center justify-center text-[10px] font-bold text-[#DBDEE1] uppercase border border-white/10">
                                  {member.identity ? member.identity.charAt(0) : 'C'}
                                </div>
                                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#23A55A] border border-[#2B2D31]"></span>
                              </div>
                              <p className="text-xs font-semibold text-[#DBDEE1] truncate">
                                {member.identity}
                              </p>
                            </div>
                            {member.isHost ? (
                              <span className="flex items-center gap-1 text-[10px] font-bold bg-[#F0B232]/20 text-[#F0B232] px-1.5 py-0.5 rounded border border-[#F0B232]/30">
                                <Crown className="w-2.5 h-2.5" /> Host
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#949BA4] font-medium">Espectador</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Leave Button */}
              <button
                onClick={handleLeaveRoom}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#DA373C] hover:bg-[#BE2F34] text-white transition text-xs font-semibold shadow-sm"
              >
                <LogOut className="w-3 h-3" />
                Sair
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 p-4 overflow-hidden relative bg-[#313338]">
        {!isInRoom ? (
          /* Discord-Style Join / Create Room Screen */
          <div className="h-full flex items-center justify-center">
            <div className="w-full max-w-md bg-[#2B2D31] p-7 rounded-2xl border border-[#1E1F22] shadow-2xl space-y-5">
              
              {/* Header Icon & Title */}
              <div className="text-center space-y-1.5">
                <div className="w-14 h-14 rounded-2xl bg-[#5865F2] mx-auto flex items-center justify-center text-white shadow-lg shadow-[#5865F2]/20 mb-2">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-extrabold text-[#F2F3F5]">Compartilhamento de Tela</h2>
                <p className="text-xs text-[#949BA4]">
                  Transmissão ao vivo com áudio de alta fidelidade sem ruídos.
                </p>
              </div>

              {/* Participant Name Input */}
              <div className="space-y-1">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#949BA4]">
                  Seu Nome de Exibição
                </label>
                <div className="relative flex items-center">
                  <div className="absolute left-3 text-[#949BA4]">
                    <User className="w-3.5 h-3.5" />
                  </div>
                  <input
                    type="text"
                    placeholder="Ex: Gabriel"
                    value={userName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    maxLength={25}
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#1E1F22] text-[#F2F3F5] text-xs placeholder:text-[#80848E] focus:outline-none focus:ring-2 focus:ring-[#5865F2] border border-transparent transition"
                  />
                </div>
              </div>

              {/* Create Room Button (Discord Blurple) */}
              <button
                onClick={handleCreateRoom}
                className="w-full py-2.5 px-4 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] active:bg-[#3C45A5] font-bold text-white text-xs shadow-sm flex items-center justify-center gap-1.5 transition"
              >
                <PlusCircle className="w-4 h-4" />
                Criar Nova Sala
              </button>

              {/* Separator */}
              <div className="relative flex items-center justify-center my-2">
                <div className="border-t border-[#3F4147] w-full"></div>
                <span className="bg-[#2B2D31] px-2.5 text-[9px] text-[#949BA4] uppercase tracking-widest font-bold absolute">
                  ou entrar com código
                </span>
              </div>

              {/* Join Room Form */}
              <form onSubmit={handleJoinRoom} className="space-y-2.5">
                <div>
                  <input
                    type="text"
                    placeholder="CÓDIGO DA SALA (EX: X9A2B4)"
                    value={inputRoomId}
                    onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
                    maxLength={8}
                    className="w-full px-3 py-2 rounded-lg bg-[#1E1F22] text-[#F2F3F5] font-mono placeholder:text-[#80848E] focus:outline-none focus:ring-2 focus:ring-[#23A55A] transition uppercase text-center text-sm tracking-widest border border-transparent"
                  />
                </div>

                {/* Join Button (Discord Green) */}
                <button
                  type="submit"
                  disabled={!inputRoomId.trim()}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#23A55A] hover:bg-[#1F9250] active:bg-[#197540] disabled:opacity-50 disabled:cursor-not-allowed font-bold text-white text-xs flex items-center justify-center gap-1.5 transition shadow-sm"
                >
                  <LogIn className="w-4 h-4" />
                  Entrar na Sala
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* In Room View — Unified Discord Stage */
          <div className="h-full flex flex-col gap-2.5">
            {/* Stream Action Toolbar */}
            <div className="flex items-center justify-between bg-[#2B2D31] px-4 py-2 rounded-xl border border-[#1E1F22] shadow-sm">
              <div className="flex items-center gap-2.5">
                {isStreaming ? (
                  <span className="flex items-center gap-1 text-xs font-bold text-white bg-[#DA373C] px-2 py-0.5 rounded shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                    AO VIVO
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[#949BA4]">
                    <Tv className="w-3.5 h-3.5 text-[#80848E]" />
                    {isHost ? 'Você é o Host da sala' : 'Aguardando transmissão'}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Quality Selector */}
                <div className="flex items-center gap-1 bg-[#1E1F22] px-2 py-1 rounded-md border border-[#313338]">
                  <Settings className="w-3 h-3 text-[#949BA4]" />
                  <select
                    value={qualityPreset}
                    onChange={(e) => handleQualityChange(e.target.value)}
                    disabled={isStreaming}
                    className="bg-transparent text-xs text-[#F2F3F5] font-semibold focus:outline-none disabled:opacity-50 cursor-pointer"
                  >
                    {Object.entries(VIDEO_QUALITY_PRESETS).map(([key, preset]) => (
                      <option key={key} value={key} className="bg-[#2B2D31] text-white">
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                {!isStreaming && (
                  <>
                    <button
                      onClick={handleStartNativeCapture}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#35373C] hover:bg-[#404249] text-[#F2F3F5] font-semibold text-xs transition"
                    >
                      <ScreenShare className="w-3.5 h-3.5 text-[#5865F2]" />
                      Seletor do Windows
                    </button>
                    <button
                      onClick={() => setIsModalOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-xs shadow-sm transition"
                    >
                      <Monitor className="w-3.5 h-3.5" />
                      Transmitir Tela
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Video Stream Stage — Adaptive Discord View */}
            <div className="flex-1 overflow-hidden">
              {/* Scenario 1: I am Streaming (Host/Publisher) */}
              {isStreaming ? (
                <div className="h-full">
                  <StreamPublisher
                    source={selectedSource}
                    localStream={localStream}
                    qualityPreset={currentPreset}
                    streamerName={userName}
                    onStopStream={handleStopStream}
                    onChangeSource={() => setIsModalOpen(true)}
                  />
                </div>
              ) : hasAnyRemoteStream ? (
                /* Scenario 2: Remote Stream is Active (Viewer) */
                <div className="h-full">
                  {Array.from(remoteStreams.entries()).map(([participantId, item]) => (
                    <StreamViewer
                      key={participantId}
                      remoteStream={item.stream}
                      peerId={participantId}
                      streamerName={item.identity}
                    />
                  ))}
                </div>
              ) : (
                /* Scenario 3: Nobody is Streaming (Clean Waiting Stage) */
                <div className="h-full bg-[#2B2D31] rounded-xl p-6 flex flex-col items-center justify-center text-center border border-[#1E1F22]">
                  <div className="w-14 h-14 rounded-2xl bg-[#1E1F22] flex items-center justify-center text-[#5865F2] mb-3 shadow-sm">
                    <Tv className="w-7 h-7" />
                  </div>
                  <h3 className="text-base font-bold text-[#F2F3F5] mb-1">
                    {isHost ? 'Pronto para Transmitir' : 'Aguardando o Streamer Iniciar'}
                  </h3>
                  <p className="text-xs text-[#949BA4] max-w-xs mb-4">
                    {isHost
                      ? 'Compartilhe sua tela ou janela para que todos na sala possam assistir com áudio limpo.'
                      : 'O streamer ainda não iniciou a transmissão. O vídeo aparecerá aqui automaticamente.'}
                  </p>
                  {isHost && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleStartNativeCapture}
                        className="px-3 py-1.5 rounded-lg bg-[#35373C] hover:bg-[#404249] text-[#F2F3F5] font-semibold text-xs transition flex items-center gap-1.5"
                      >
                        <ScreenShare className="w-3.5 h-3.5 text-[#5865F2]" />
                        Seletor do Windows
                      </button>
                      <button
                        onClick={() => setIsModalOpen(true)}
                        className="px-4 py-1.5 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-xs shadow-sm transition flex items-center gap-1.5"
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        Escolher Janela / Tela
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Source Selection Modal */}
      <SourcePickerModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelectSource={handleStartCapture}
        onSelectNativeDisplayMedia={handleStartNativeCapture}
      />
    </div>
  );
};

export default App;
