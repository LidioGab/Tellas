import React, { useEffect, useState, useCallback, useRef } from 'react';
import { socket } from './services/socket';
import { livekitService, type RemoteStreamInfo } from './services/livekitService';
import { audioCaptureManager } from './audio/AudioCaptureManager';
import { DesktopSource, VIDEO_QUALITY_PRESETS, WindowsAudioEnvironment, AudioCaptureStrategy } from '@stream-app/shared';
import { ConnectionState } from 'livekit-client';
import { SourcePickerModal } from './components/SourcePickerModal';
import { StreamPublisher } from './components/StreamPublisher';
import { StreamViewer } from './components/StreamViewer';
import { TellasLogo } from './components/TellasLogo';
import {
  Monitor,
  Users,
  Copy,
  Check,
  Tv,
  PlusCircle,
  LogIn,
  LogOut,
  ScreenShare,
  User,
  Settings,
  Crown,
  X,
  AlertTriangle,
  Play,
  Radio,
  Lock,
  Unlock,
  UserX
} from 'lucide-react';

import { useLayoutMode } from './hooks/useLayoutMode';

interface Member {
  participantId?: string;
  socketId?: string;
  identity: string;
  isHost?: boolean;
  canPublish?: boolean;
  role?: 'host' | 'participant';
}

function generateRandomName(): string {
  const adjectives = ['Player', 'Cyber', 'Shadow', 'Neo', 'Gamer', 'Apex', 'Hyper', 'Sonic'];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]}${num}`;
}

interface RemoteStreamItem {
  stream: MediaStream;
  participantId: string;
  displayName: string;
}

interface ActionModalState {
  type: 'kick' | 'transfer';
  targetParticipantId?: string;
  targetSocketId?: string;
  targetName: string;
}

export const App: React.FC = () => {
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('stream_username') || generateRandomName();
  });
  const [roomId, setRoomId] = useState<string>('');
  const [inputRoomId, setInputRoomId] = useState<string>('');
  const [isInRoom, setIsInRoom] = useState<boolean>(false);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [isRoomLocked, setIsRoomLocked] = useState<boolean>(false);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [myParticipantId, setMyParticipantId] = useState<string>(() => {
    return sessionStorage.getItem('tellas_participant_id') || '';
  });
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState<boolean>(false);



  // Audio environment & strategy
  const [audioEnv, setAudioEnv] = useState<WindowsAudioEnvironment | null>(null);
  const [audioWarningMessage, setAudioWarningMessage] = useState<string | null>(null);

  // Stream state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [watchModalOpen, setWatchModalOpen] = useState<boolean>(false);
  const [selectedStreamParticipantId, setSelectedStreamParticipantId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStreamItem>>(new Map());
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [connectionState, setConnectionState] = useState<ConnectionState | null>(null);

  // Who is streaming (display name string)
  const [streamingIdentity, setStreamingIdentity] = useState<string | null>(null);

  // Quality preset
  const [qualityPreset, setQualityPreset] = useState<string>('1080p30');

  // Device & layout classification (DESKTOP, MOBILE_PORTRAIT, MOBILE_LANDSCAPE)
  const { layoutMode, isFullscreen } = useLayoutMode();

  // Query audio environment on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.electronAPI?.getAudioEnvironment) {
      window.electronAPI.getAudioEnvironment()
        .then((env) => {
          setAudioEnv(env);
        })
        .catch((err) => {
          console.warn('[App] Failed to fetch audio environment:', err);
        });
    }
  }, []);

  const hasAnyRemoteStream = remoteStreams.size > 0;

  // Handle nickname persistence
  const handleNameChange = (name: string) => {
    setUserName(name);
    localStorage.setItem('stream_username', name);
  };

  const getEffectiveIdentity = useCallback(() => {
    const trimmed = userName.trim();
    return trimmed.length > 0 ? trimmed : `User-${Math.random().toString(36).substring(2, 6)}`;
  }, [userName]);

  // Resolves a user-friendly display name for a given participantId
  const resolveDisplayName = useCallback(
    (participantId: string, liveKitName?: string): string => {
      const member = members.find((m) => m.participantId === participantId);
      if (member?.identity && member.identity.trim().length > 0) {
        return member.identity;
      }
      if (liveKitName && liveKitName.trim().length > 0) {
        return liveKitName;
      }
      return 'Participante';
    },
    [members]
  );

  // ─── LiveKit Callbacks ──────────────────────────────────────────────

  useEffect(() => {
    livekitService.setCallbacks({
      onRemoteTrackSubscribed: (info: RemoteStreamInfo) => {
        console.log('[App] Remote track subscribed for participantId:', info.participantId, 'displayName:', info.displayName);
        const resolvedName = resolveDisplayName(info.participantId, info.displayName);
        setRemoteStreams((prev) =>
          new Map(prev).set(info.participantId, {
            stream: info.stream,
            participantId: info.participantId,
            displayName: resolvedName,
          })
        );
        setStreamingIdentity(resolvedName);
      },
      onRemoteTrackUnsubscribed: (participantId: string) => {
        console.log('[App] Remote track removed:', participantId);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        if (remoteStreams.size <= 1) setStreamingIdentity(null);
      },
      onConnectionStateChanged: (state: ConnectionState) => {
        setConnectionState(state);
      },
      onError: (error: Error) => {
        console.error('[App] LiveKit error:', error);
      },
    });
  }, [resolveDisplayName, remoteStreams.size]);

  // ─── Socket.IO Room Events ──────────────────────────────────────────

  useEffect(() => {
    socket.on('user-joined', ({ socketId, participantId, identity, isHost: joinedHost }: any) => {
      console.log('[App] user-joined received:', { socketId, participantId, identity, joinedHost });
      setMembers((prev) => {
        const filtered = prev.filter((m) =>
          participantId && m.participantId ? m.participantId !== participantId : m.socketId !== socketId
        );
        return [
          ...filtered,
          {
            socketId,
            participantId,
            identity: identity || 'Convidado',
            isHost: !!joinedHost,
          },
        ];
      });
    });

    socket.on('user-left', ({ socketId, participantId }: any) => {
      console.log('[App] user-left received:', { socketId, participantId });
      setMembers((prev) =>
        prev.filter((m) => {
          if (participantId && m.participantId) return m.participantId !== participantId;
          return m.socketId !== socketId;
        })
      );
    });

    socket.on('room-members-updated', (updatedMembers: Member[]) => {
      console.log('[App] room-members-updated received:', updatedMembers);
      if (Array.isArray(updatedMembers)) {
        setMembers(updatedMembers);
        const me = updatedMembers.find((m) =>
          myParticipantId && m.participantId ? m.participantId === myParticipantId : m.socketId === socket.id
        );
        if (me && typeof me.isHost === 'boolean') {
          setIsHost(me.isHost);
        }
        setRemoteStreams((prev) => {
          if (prev.size === 0) return prev;
          let changed = false;
          const next = new Map(prev);
          for (const [pid, item] of next.entries()) {
            const member = updatedMembers.find((m) => m.participantId === pid);
            if (member?.identity && member.identity !== item.displayName) {
              next.set(pid, { ...item, displayName: member.identity });
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      }
    });

    socket.on('stream-started', ({ participantId, identity }: { streamerSocketId?: string; participantId?: string; identity?: string } = {}) => {
      if (identity) setStreamingIdentity(identity);
      if (participantId && identity) {
        setRemoteStreams((prev) => {
          const existing = prev.get(participantId);
          if (existing && existing.displayName !== identity) {
            const next = new Map(prev);
            next.set(participantId, { ...existing, displayName: identity });
            return next;
          }
          return prev;
        });
      }
      if (roomId && !livekitService.connected && !livekitService.isConnecting) {
        connectAsViewer(roomId, getEffectiveIdentity());
      }
    });

    socket.on('stream-stopped', ({ participantId }: { participantId?: string } = {}) => {
      if (participantId) {
        setRemoteStreams((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        if (remoteStreams.size <= 1) {
          setStreamingIdentity(null);
        }
      } else {
        setRemoteStreams(new Map());
        setStreamingIdentity(null);
        setWatchModalOpen(false);
      }
    });

    // ─── Host Administrative Events ──────────────────────────────────
    socket.on('kicked-from-room', ({ reason }: { reason?: string } = {}) => {
      alert(reason || 'Você foi expulso da sala pelo host.');
      handleLeaveRoom();
    });

    socket.on('room-lock-status-changed', ({ isLocked }: { isLocked: boolean }) => {
      setIsRoomLocked(isLocked);
    });

    socket.on('role-updated', ({ role, isHost: newIsHost, sessionToken }: any) => {
      console.log('[App] role-updated received:', { role, newIsHost });
      if (typeof newIsHost === 'boolean') {
        setIsHost(newIsHost);
      }
      if (sessionToken) {
        livekitService.setSessionToken(sessionToken);
        try {
          sessionStorage.setItem('tellas_session_token', sessionToken);
        } catch (_) {}
      }
    });

    socket.on('host-transferred', ({ newHostParticipantId }: any) => {
      console.log('[App] host-transferred received:', newHostParticipantId);
      if (myParticipantId && newHostParticipantId === myParticipantId) {
        setIsHost(true);
      }
    });


    return () => {
      socket.off('user-joined');
      socket.off('user-left');
      socket.off('room-members-updated');
      socket.off('stream-started');
      socket.off('stream-stopped');
      socket.off('kicked-from-room');
      socket.off('room-lock-status-changed');
      socket.off('role-updated');
      socket.off('host-transferred');
    };
  }, [roomId, isHost, getEffectiveIdentity, myParticipantId]);

  // ─── Connect As Viewer Helper ───────────────────────────────────────

  const connectAsViewer = useCallback(async (room: string, identity: string) => {
    if (livekitService.connected || livekitService.isConnecting) return;
    try {
      const tokenResponse = await livekitService.requestToken({ roomId: room, identity, role: 'viewer' });
      await livekitService.connect(tokenResponse);
    } catch (err: any) {
      console.error('[App] Failed to connect as viewer:', err);
    }
  }, []);

  // ─── Host Administrative Actions ───────────────────────────────────

  const handleToggleRoomLock = useCallback(() => {
    if (!roomId || !isHost) return;
    const targetLocked = !isRoomLocked;
    socket.emit('set-room-locked', { roomId, locked: targetLocked }, (res: any) => {
      if (res.success) {
        setIsRoomLocked(res.isLocked);
      } else {
        alert(res.error || 'Erro ao alterar estado da sala');
      }
    });
  }, [roomId, isHost, isRoomLocked]);

  const handleOpenKickModal = useCallback((targetParticipantId?: string, targetSocketId?: string, targetName?: string) => {
    if (!roomId || !isHost) return;
    setActionModal({
      type: 'kick',
      targetParticipantId,
      targetSocketId,
      targetName: targetName || 'o participante',
    });
  }, [roomId, isHost]);

  const handleOpenTransferModal = useCallback((targetParticipantId?: string, targetSocketId?: string, targetName?: string) => {
    if (!roomId || !isHost) return;
    setActionModal({
      type: 'transfer',
      targetParticipantId,
      targetSocketId,
      targetName: targetName || 'o participante',
    });
  }, [roomId, isHost]);

  const handleConfirmModalAction = useCallback(() => {
    if (!actionModal || !roomId || !isHost) return;
    const { type, targetParticipantId, targetSocketId } = actionModal;

    if (type === 'kick') {
      socket.emit('kick-participant', { roomId, targetParticipantId, targetSocketId }, (res: any) => {
        if (res.success) {
          if (res.members && Array.isArray(res.members)) {
            setMembers(res.members);
          } else {
            setMembers((prev) =>
              prev.filter((m) =>
                targetParticipantId && m.participantId
                  ? m.participantId !== targetParticipantId
                  : m.socketId !== targetSocketId
              )
            );
          }
        }
      });
    } else if (type === 'transfer') {
      socket.emit('transfer-host', { roomId, targetParticipantId, targetSocketId }, (res: any) => {
        if (res.success) {
          setIsHost(false);
          if (res.members && Array.isArray(res.members)) {
            setMembers(res.members);
          }
        }
      });
    }

    setActionModal(null);
  }, [actionModal, roomId, isHost]);

  const handleCloseModalAction = useCallback(() => {
    setActionModal(null);
  }, []);




  // ─── Room Actions ───────────────────────────────────────────────────

  const handleCreateRoom = useCallback(() => {
    const identity = getEffectiveIdentity();
    try {
      sessionStorage.removeItem('tellas_session_token');
      sessionStorage.removeItem('tellas_session_room');
      sessionStorage.removeItem('tellas_participant_id');
    } catch (_) {}

    socket.emit('create-room', { identity }, (res: any) => {
      if (res.success) {
        if (res.sessionToken) {
          livekitService.setSessionToken(res.sessionToken);
          try {
            sessionStorage.setItem('tellas_session_token', res.sessionToken);
            sessionStorage.setItem('tellas_session_room', res.roomId);
            sessionStorage.setItem('tellas_participant_id', res.participantId || '');
          } catch (_) {}
        }
        setMyParticipantId(res.participantId || '');
        setRoomId(res.roomId);
        setIsInRoom(true);
        setIsHost(true);
        setIsRoomLocked(false);
        setMembers(res.members || [{ socketId: socket.id, participantId: res.participantId, identity, isHost: true }]);
        connectAsViewer(res.roomId, identity);
      } else {
        alert(res.error || 'Erro ao criar sala');
      }
    });
  }, [getEffectiveIdentity, connectAsViewer]);

  const handleJoinRoom = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!inputRoomId.trim()) return;

    const cleanRoomId = inputRoomId.trim().toUpperCase();
    const identity = getEffectiveIdentity();
    const savedRoom = sessionStorage.getItem('tellas_session_room');
    const savedToken = (savedRoom === cleanRoomId ? sessionStorage.getItem('tellas_session_token') : null) || undefined;

    socket.emit('join-room', { roomId: cleanRoomId, identity, sessionToken: savedToken }, (res: any) => {
      if (res.success) {
        if (res.sessionToken) {
          livekitService.setSessionToken(res.sessionToken);
          try {
            sessionStorage.setItem('tellas_session_token', res.sessionToken);
            sessionStorage.setItem('tellas_session_room', res.roomId);
            sessionStorage.setItem('tellas_participant_id', res.participantId || '');
          } catch (_) {}
        }
        setMyParticipantId(res.participantId || '');
        setRoomId(res.roomId);
        setIsInRoom(true);
        setIsHost(res.isHost);
        setIsRoomLocked(res.isLocked || false);
        setMembers(res.members || [{ socketId: socket.id, participantId: res.participantId, identity, isHost: res.isHost }]);
        connectAsViewer(res.roomId, identity);
      } else {
        alert(res.error || 'Erro ao entrar na sala');
      }
    });
  }, [inputRoomId, getEffectiveIdentity]);

  const handleLeaveRoom = useCallback(async () => {
    if (roomId) socket.emit('leave-room', { roomId });
    await handleStopStream();
    await livekitService.disconnect();
    livekitService.setSessionToken(null);
    try {
      sessionStorage.removeItem('tellas_session_token');
      sessionStorage.removeItem('tellas_session_room');
      sessionStorage.removeItem('tellas_participant_id');
    } catch (_) {}
    setMyParticipantId('');
    setIsInRoom(false);
    setIsHost(false);
    setIsRoomLocked(false);
    setRoomId('');
    setMembers([]);
    setRemoteStreams(new Map());
    setConnectionState(null);
    setStreamingIdentity(null);
    setWatchModalOpen(false);
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

    if (window.electronAPI?.startAudioCapture) {
      try {
        const audioRes = await audioCaptureManager.start(48000);
        if (!audioRes.success) {
          if (audioRes.code === 'VIRTUAL_AUDIO_REQUIRED') {
            setAudioWarningMessage('O áudio do sistema não está disponível nesta versão do Windows. A transmissão continuará apenas com vídeo.');
          }
        } else {
          setAudioWarningMessage(null);
        }

        const audioTrack = audioCaptureManager.getAudioTrack();
        if (audioTrack) {
          const videoTracks = videoStream.getVideoTracks();
          finalStream = new MediaStream([...videoTracks, audioTrack]);
        }
      } catch (audioErr) {
        console.warn('[App] WASAPI audio capture failed:', audioErr);
      }
    }

    try {
      const tokenResponse = await livekitService.requestToken({ roomId, identity, role: 'publisher' });

      if (livekitService.connected) await livekitService.disconnect();
      await livekitService.connect(tokenResponse);

      livekitService.setQualityPreset(qualityPreset);
      await livekitService.publishStream(finalStream);

      setLocalStream(finalStream);
      setIsStreaming(true);
      setStreamingIdentity(identity);

      socket.emit('start-stream', { roomId, identity });
    } catch (err: any) {
      console.error('[App] Failed to publish stream:', err);
      alert(`Erro ao iniciar transmissão: ${err.message}`);
      setIsStreaming(false);
      setLocalStream(null);
      if (finalStream) finalStream.getTracks().forEach((t) => t.stop());
    }
  };

  const handleStartCapture = async (source: DesktopSource) => {
    setSelectedSource(source);
    const preset = VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: source.id,
            minWidth: preset.width, maxWidth: preset.width,
            minHeight: preset.height, maxHeight: preset.height,
            maxFrameRate: preset.frameRate
          }
        }
      });

      setIsModalOpen(false);
      await startStreamingViaLiveKit(stream);
      stream.getVideoTracks()[0].onended = () => handleStopStream();
    } catch (err: any) {
      console.error('[App] Failed to capture screen source:', err);
    }
  };

  const handleStartNativeCapture = async () => {
    const preset = VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate } },
        audio: false
      });

      setSelectedSource({ id: 'native:screen', name: 'Tela Selecionada', thumbnail: '' });
      setIsModalOpen(false);
      await startStreamingViaLiveKit(stream);
      stream.getVideoTracks()[0].onended = () => handleStopStream();
    } catch (err: any) {
      console.error('[App] Failed to getDisplayMedia:', err);
    }
  };

  const handleStopStream = async () => {
    audioCaptureManager.stop();
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    await livekitService.unpublishAllTracks();
    setIsStreaming(false);
    setSelectedSource(null);
    if (roomId) socket.emit('stop-stream', { roomId });
  };



  const handleQualityChange = (presetKey: string) => {
    setQualityPreset(presetKey);
    livekitService.setQualityPreset(presetKey);
  };

  const currentPreset = VIDEO_QUALITY_PRESETS[qualityPreset];

  // Active stream entry for watch modal (supports multiple concurrent streams)
  const activeStreamEntry = selectedStreamParticipantId && remoteStreams.has(selectedStreamParticipantId)
    ? [selectedStreamParticipantId, remoteStreams.get(selectedStreamParticipantId)!] as [string, RemoteStreamItem]
    : hasAnyRemoteStream ? Array.from(remoteStreams.entries())[0] : null;

  return (
    <div className="flex flex-col h-screen bg-[#0B0D10] text-[#F4F6F8] select-none font-sans overflow-hidden">

      {/* ── Topbar (Height: 48px) ────────────────────────────────────── */}
      <header className="h-12 px-4 bg-[#101217] border-b border-[#1D2129] flex items-center justify-between z-30 shrink-0">
        {/* Left: Branding & Room info */}
        <div className="flex items-center gap-2.5">
          <TellasLogo className="w-6 h-6" />
          <span className="font-semibold text-sm text-[#F4F6F8] tracking-tight">Tellas</span>
          {isInRoom && (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-[#505764] text-xs">/</span>
              <button
                onClick={copyRoomCode}
                className="flex items-center gap-1 text-xs text-[#9DA5B4] hover:text-[#F4F6F8] transition font-mono tracking-wider"
                title="Clique para copiar o código da sala"
              >
                {roomId}
                {copied ? <Check className="w-3 h-3 text-[#34D399]" /> : <Copy className="w-3 h-3 text-[#687180]" />}
              </button>
            </div>
          )}
        </div>


        {/* Right: User Profile & Leave Action */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-[#16191F] transition">
            <div className="w-5 h-5 rounded-full bg-[#1D2129] border border-[#252A34] flex items-center justify-center text-[10px] font-bold text-[#F4F6F8] uppercase">
              {userName ? userName.charAt(0) : 'U'}
            </div>
            <span className="hidden sm:block text-xs font-medium text-[#F4F6F8] max-w-[100px] truncate">{userName}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] shrink-0" />
          </div>

          {isInRoom && (
            <button
              onClick={handleLeaveRoom}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F87171]/10 hover:bg-[#F87171]/20 border border-[#F87171]/20 text-[#F87171] transition text-xs font-medium"
            >
              <LogOut className="w-3 h-3" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Main Workspace ───────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden relative bg-[#0B0D10]">
        {!isInRoom ? (
          /* ── Landing / Login Screen ─────────────────────────────────── */
          <div className="h-full flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#16191F] p-7 rounded-xl border border-[#252A34] shadow-card space-y-5">
              
              {/* Header Icon & Title */}
              <div className="text-center space-y-2">
                <div className="flex justify-center mb-1">
                  <TellasLogo className="w-14 h-14" glow />
                </div>
                <h1 className="text-xl font-bold text-[#F4F6F8] tracking-tight">Tellas</h1>
                <p className="text-xs text-[#9DA5B4]">
                  Compartilhamento de tela em tempo real com áudio isolado.
                </p>
              </div>


              {/* Display Name Input */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                  Seu nome de exibição
                </label>
                <div className="relative flex items-center">
                  <User className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                  <input
                    type="text"
                    placeholder="Ex: Gabriel"
                    value={userName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    maxLength={25}
                    className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                  />
                </div>
              </div>

              {/* Create Room Button */}
              <button
                onClick={handleCreateRoom}
                className="w-full py-2.5 px-4 rounded-lg bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] font-medium text-white text-xs shadow-cta flex items-center justify-center gap-1.5 transition transform hover:-translate-y-0.5 active:translate-y-0"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Criar Nova Sala
              </button>

              {/* Subtle Divider */}
              <div className="relative flex items-center justify-center my-2">
                <div className="border-t border-[#252A34] w-full"></div>
                <span className="bg-[#16191F] px-2.5 text-[10px] text-[#505764] uppercase tracking-wider font-semibold absolute">
                  ou entrar com código
                </span>
              </div>

              {/* Join Room Form */}
              <form onSubmit={handleJoinRoom} className="space-y-2.5">
                <input
                  type="text"
                  placeholder="CÓDIGO DA SALA"
                  value={inputRoomId}
                  onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
                  maxLength={8}
                  className="w-full px-3 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] font-mono placeholder:text-[#505764] focus:outline-none focus:border-[#323846] transition uppercase text-center text-xs tracking-widest border border-[#252A34]"
                />
                <button
                  type="submit"
                  disabled={!inputRoomId.trim()}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] hover:border-[#323846] disabled:opacity-40 disabled:cursor-not-allowed font-medium text-[#F4F6F8] text-xs flex items-center justify-center gap-1.5 transition shadow-subtle"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#9DA5B4]" />
                  Entrar na Sala
                </button>
              </form>
            </div>
          </div>
        ) : layoutMode === 'MOBILE_LANDSCAPE' ? (
          /* ── 1. Mobile Landscape Layout (Immersive Viewport, No Chrome) ── */
          <div className="fixed inset-0 w-screen h-screen z-50 bg-black flex items-center justify-center overflow-hidden">
            {hasAnyRemoteStream && activeStreamEntry ? (
              <div className="w-full h-full relative">
                <StreamViewer
                  key={activeStreamEntry[0]}
                  remoteStream={activeStreamEntry[1].stream}
                  peerId={activeStreamEntry[0]}
                  streamerName={activeStreamEntry[1].displayName}
                  roomId={roomId}
                  memberCount={members.length}
                />
                {/* Floating Multi-Stream Switcher in Landscape */}
                {remoteStreams.size > 1 && (
                  <div className="absolute top-3 left-4 z-40 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
                    {Array.from(remoteStreams.entries()).map(([pid, item]) => {
                      const isSelected = activeStreamEntry?.[0] === pid;
                      return (
                        <button
                          key={pid}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedStreamParticipantId(pid);
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition ${
                            isSelected ? 'bg-[#5B7CFA] text-white' : 'text-[#9DA5B4] hover:text-white'
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-[#F87171]'}`} />
                          {item.displayName}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-[#16191F] border border-[#252A34] flex items-center justify-center mb-3 shadow-subtle">
                  <Tv className="w-6 h-6 text-[#687180]" />
                </div>
                <p className="text-sm font-semibold text-[#EDEFF3]">Aguardando transmissão</p>
                <p className="text-xs text-[#687180] mt-1 max-w-[280px]">
                  A transmissão aparecerá automaticamente aqui assim que o streamer iniciar.
                </p>
                <button
                  onClick={handleLeaveRoom}
                  className="mt-4 px-3.5 py-1.5 rounded-md bg-[#F87171]/15 hover:bg-[#F87171]/25 text-[#F87171] text-xs font-medium flex items-center gap-1.5 transition"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sair da Sala
                </button>
              </div>
            )}
          </div>
        ) : layoutMode === 'MOBILE_PORTRAIT' ? (
          /* ── 2. Mobile Portrait Layout (Viewer-First Stack) ── */
          <div className="h-full flex flex-col overflow-hidden bg-[#0B0D10]">
            {/* 16:9 Dedicated Video Area */}
            <div className="w-full aspect-video bg-[#080A0D] border-b border-[#1D2129] relative shrink-0 overflow-hidden flex items-center justify-center">
              {hasAnyRemoteStream && activeStreamEntry ? (
                <StreamViewer
                  key={activeStreamEntry[0]}
                  remoteStream={activeStreamEntry[1].stream}
                  peerId={activeStreamEntry[0]}
                  streamerName={activeStreamEntry[1].displayName}
                  roomId={roomId}
                  memberCount={members.length}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-4 text-center">
                  <div className="w-10 h-10 rounded-xl bg-[#16191F] border border-[#252A34] flex items-center justify-center mb-2 shadow-subtle">
                    <Tv className="w-5 h-5 text-[#687180]" />
                  </div>
                  <p className="text-xs font-semibold text-[#EDEFF3]">Aguardando transmissão</p>
                  <p className="text-[11px] text-[#687180] mt-0.5 max-w-[240px]">
                    A transmissão aparecerá automaticamente aqui assim que o streamer iniciar.
                  </p>
                </div>
              )}
            </div>

            {/* Multi-Streamer Switcher Bar (when 2 or more people are streaming) */}
            {remoteStreams.size > 1 && (
              <div className="px-3 py-2 bg-[#101217] border-b border-[#1D2129] flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#687180] shrink-0">Ao vivo:</span>
                {Array.from(remoteStreams.entries()).map(([pid, item]) => {
                  const isSelected = activeStreamEntry?.[0] === pid;
                  return (
                    <button
                      key={pid}
                      onClick={() => setSelectedStreamParticipantId(pid)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition ${
                        isSelected
                          ? 'bg-[#5B7CFA] text-white shadow-cta'
                          : 'bg-[#16191F] border border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8]'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-[#F87171]'}`} />
                      {item.displayName}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Mobile Scrollable Details */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
              {/* Room Code Card & Lock Toggle */}
              <div className="p-3 rounded-lg bg-[#16191F] border border-[#252A34] flex items-center justify-between shadow-subtle">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#687180]">Sala</p>
                    {isHost ? (
                      <button
                        onClick={handleToggleRoomLock}
                        title={isRoomLocked ? 'Sala trancada (toque para abrir)' : 'Sala aberta (toque para trancar)'}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                          isRoomLocked
                            ? 'bg-[#F87171]/15 text-[#F87171] border border-[#F87171]/30 hover:bg-[#F87171]/25'
                            : 'bg-[#34D399]/15 text-[#34D399] border border-[#34D399]/30 hover:bg-[#34D399]/25'
                        }`}
                      >
                        {isRoomLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                        {isRoomLocked ? 'Trancada' : 'Aberta'}
                      </button>
                    ) : isRoomLocked ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F87171]/15 text-[#F87171] border border-[#F87171]/30">
                        <Lock className="w-2.5 h-2.5" /> Trancada
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs font-mono font-bold text-[#F4F6F8] tracking-wider">{roomId}</p>
                </div>
                <button
                  onClick={copyRoomCode}
                  className="px-2.5 py-1.5 rounded-md bg-[#1D2129] hover:bg-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] text-xs font-medium flex items-center gap-1.5 transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#34D399]" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado!' : 'Copiar código'}
                </button>
              </div>

              {/* Participants Section */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#687180] px-1">
                  Participantes — {Math.max(1, members.length)}
                </p>
                <div className="rounded-lg bg-[#16191F] border border-[#252A34] divide-y divide-[#1D2129] overflow-hidden">
                  {/* Self */}
                  <div className="flex items-center gap-2.5 px-3 py-2.5">
                    <div className="relative shrink-0">
                      <div className="w-7 h-7 rounded-full bg-[#1D2129] border border-[#252A34] flex items-center justify-center text-[10px] font-bold text-[#F4F6F8] uppercase">
                        {userName ? userName.charAt(0) : 'U'}
                      </div>
                      <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34D399] border border-[#16191F]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[#F4F6F8] truncate">
                        {userName} <span className="text-[#687180] font-normal">(você)</span>
                      </p>
                      <span className="text-[10px] text-[#687180]">Espectador</span>
                    </div>
                  </div>

                  {/* Remote Members */}
                  {members
                    .filter((m) => (myParticipantId && m.participantId ? m.participantId !== myParticipantId : m.socketId !== socket.id))
                    .map((member) => {
                      const streamItem = member.participantId ? remoteStreams.get(member.participantId) : null;
                      const isStreamingRemote = !!streamItem;
                      const isCurrentlyWatching = !!(member.participantId && activeStreamEntry?.[0] === member.participantId);

                      return (
                        <div
                          key={member.participantId || member.socketId}
                          onClick={() => {
                            if (member.participantId && remoteStreams.has(member.participantId)) {
                              setSelectedStreamParticipantId(member.participantId);
                            }
                          }}
                          className={`flex items-center gap-2.5 px-3 py-2.5 transition ${
                            streamItem ? 'cursor-pointer hover:bg-[#1D2129]' : ''
                          }`}
                        >
                          <div className="relative shrink-0">
                            <div className="w-7 h-7 rounded-full bg-[#1D2129] border border-[#252A34] flex items-center justify-center text-[10px] font-medium text-[#9DA5B4] uppercase">
                              {member.identity ? member.identity.charAt(0) : 'C'}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34D399] border border-[#16191F]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-[#9DA5B4] truncate">{member.identity}</p>
                            <div className="flex items-center gap-1.5">
                              {member.isHost && (
                                <span className="text-[10px] text-[#FBBF24] flex items-center gap-0.5 font-medium">
                                  <Crown className="w-2.5 h-2.5" /> Host
                                </span>
                              )}
                              {isStreamingRemote ? (
                                <span className={`text-[10px] flex items-center gap-0.5 font-medium ${isCurrentlyWatching ? 'text-[#34D399]' : 'text-[#F87171]'}`}>
                                  <Radio className="w-2.5 h-2.5" /> {isCurrentlyWatching ? 'Assistindo agora' : 'Ao vivo (toque para ver)'}
                                </span>
                              ) : (
                                <span className="text-[10px] text-[#687180]">Espectador</span>
                              )}
                            </div>
                          </div>
                          {isHost && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenTransferModal(member.participantId, member.socketId, member.identity);
                                }}
                                title="Tornar Host"
                                className="p-1.5 rounded bg-[#FBBF24]/10 hover:bg-[#FBBF24]/20 text-[#FBBF24] transition"
                              >
                                <Crown className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenKickModal(member.participantId, member.socketId, member.identity);
                                }}
                                title="Expulsar da sala"
                                className="p-1.5 rounded bg-[#F87171]/10 hover:bg-[#F87171]/20 text-[#F87171] transition"
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}

                        </div>
                      );
                    })}

                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ── 3. Desktop Layout (>= 768px): Sidebar + Stage ───────────── */
          <div className="h-full flex overflow-hidden">
            {/* ── Left Sidebar (Width: 240px) ─────────────────────────── */}
            <aside className="w-60 shrink-0 bg-[#101217] border-r border-[#1D2129] flex flex-col overflow-hidden">
              {/* Sala Header */}
              <div className="px-4 pt-3.5 pb-2.5 border-b border-[#1D2129] flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#687180]">Sala</p>
                    {isHost ? (
                      <button
                        onClick={handleToggleRoomLock}
                        title={isRoomLocked ? 'Sala trancada (clique para abrir)' : 'Sala aberta (clique para trancar)'}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                          isRoomLocked
                            ? 'bg-[#F87171]/15 text-[#F87171] border border-[#F87171]/30 hover:bg-[#F87171]/25'
                            : 'bg-[#34D399]/15 text-[#34D399] border border-[#34D399]/30 hover:bg-[#34D399]/25'
                        }`}
                      >
                        {isRoomLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                        {isRoomLocked ? 'Trancada' : 'Aberta'}
                      </button>
                    ) : isRoomLocked ? (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#F87171]/15 text-[#F87171] border border-[#F87171]/30">
                        <Lock className="w-2.5 h-2.5" /> Trancada
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#F4F6F8] font-mono tracking-wider">{roomId}</span>
                    <button onClick={copyRoomCode} className="text-[#687180] hover:text-[#F4F6F8] transition" title="Copiar">
                      {copied ? <Check className="w-3 h-3 text-[#34D399]" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Streamers Cards (Multi-stream support) */}
              {Array.from(remoteStreams.entries()).map(([participantId, item]) => (
                <div key={participantId} className="mx-3 mt-2.5 p-2.5 rounded-lg bg-[#16191F] border border-[#252A34] shadow-subtle flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full bg-[#F87171] shrink-0" />
                    <div className="truncate">
                      <p className="text-xs font-medium text-[#F4F6F8] truncate leading-tight">
                        {item.displayName}
                      </p>
                      <p className="text-[11px] text-[#687180]">Transmitindo</p>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedStreamParticipantId(participantId);
                      setWatchModalOpen(true);
                    }}
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#5B7CFA]/12 hover:bg-[#5B7CFA]/18 border border-[#5B7CFA]/20 text-[#8FA5FF] text-[11px] font-medium transition"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                    Assistir
                  </button>
                </div>
              ))}

              {/* Participants List */}
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#687180] px-1 mb-2">
                  Participantes — {Math.max(1, members.length)}
                </p>

                {/* Self */}
                <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#16191F] transition">
                  <div className="relative shrink-0">
                    <div className="w-7 h-7 rounded-full bg-[#1D2129] border border-[#252A34] flex items-center justify-center text-[10px] font-bold text-[#F4F6F8] uppercase">
                      {userName ? userName.charAt(0) : 'U'}
                    </div>
                    <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34D399] border border-[#101217]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-[#F4F6F8] truncate">
                      {userName} <span className="text-[#687180] font-normal">(você)</span>
                    </p>
                    <div className="flex items-center gap-1.5">
                      {isHost && (
                        <span className="text-[10px] text-[#FBBF24] flex items-center gap-0.5 font-medium">
                          <Crown className="w-2.5 h-2.5" /> Host
                        </span>
                      )}
                      {isStreaming && (
                        <span className="text-[10px] text-[#F87171] flex items-center gap-0.5 font-medium">
                          <Radio className="w-2.5 h-2.5" /> Ao vivo
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Remote Members */}
                {members
                  .filter((m) => (myParticipantId && m.participantId ? m.participantId !== myParticipantId : m.socketId !== socket.id))
                  .map((member) => {
                    const isStreamer = !!(member.participantId && remoteStreams.has(member.participantId));
                    return (
                      <div
                        key={member.participantId || member.socketId}
                        className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#16191F] transition"
                      >
                        <div className="relative shrink-0">
                          <div className="w-7 h-7 rounded-full bg-[#1D2129] border border-[#252A34] flex items-center justify-center text-[10px] font-medium text-[#9DA5B4] uppercase">
                            {member.identity ? member.identity.charAt(0) : 'C'}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#34D399] border border-[#101217]" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-[#9DA5B4] truncate">{member.identity}</p>
                          <div className="flex items-center gap-1.5">
                            {member.isHost && (
                              <span className="text-[10px] text-[#FBBF24] flex items-center gap-0.5 font-medium">
                                <Crown className="w-2.5 h-2.5" /> Host
                              </span>
                            )}
                            {isStreamer && (
                              <span className="text-[10px] text-[#F87171] flex items-center gap-0.5 font-medium">
                                <Radio className="w-2.5 h-2.5" /> Ao vivo
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Host Controls for Remote Member */}
                        {isHost && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenTransferModal(member.participantId, member.socketId, member.identity);
                              }}
                              title="Tornar Host da sala"
                              className="p-1 rounded bg-[#FBBF24]/10 hover:bg-[#FBBF24]/20 text-[#FBBF24] transition flex items-center justify-center"
                            >
                              <Crown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenKickModal(member.participantId, member.socketId, member.identity);
                              }}
                              title="Expulsar da sala"
                              className="p-1 rounded bg-[#F87171]/10 hover:bg-[#F87171]/20 text-[#F87171] transition flex items-center justify-center"
                            >
                              <UserX className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                      </div>
                    );
                  })}
              </div>



              {/* Bottom Stream Controls (always available when local user is not streaming) */}


              {!isStreaming && (
                <div className="p-3 border-t border-[#1D2129] space-y-2">
                  <div className="flex items-center gap-1 bg-[#16191F] px-2 py-1 rounded-md border border-[#252A34]">
                    <Settings className="w-3 h-3 text-[#687180]" />
                    <select
                      value={qualityPreset}
                      onChange={(e) => handleQualityChange(e.target.value)}
                      className="bg-transparent text-[#9DA5B4] focus:outline-none cursor-pointer text-[11px] flex-1"
                    >
                      {Object.entries(VIDEO_QUALITY_PRESETS).map(([key, preset]) => (
                        <option key={key} value={key} className="bg-[#101217] text-[#F4F6F8]">
                          {preset.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    onClick={handleStartNativeCapture}
                    className="w-full py-1.5 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] text-xs font-medium flex items-center justify-center gap-1.5 transition"
                  >
                    <ScreenShare className="w-3.5 h-3.5 text-[#5B7CFA]" />
                    Seletor do Windows
                  </button>

                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="w-full py-2 rounded-md bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] text-white text-xs font-medium flex items-center justify-center gap-1.5 shadow-cta transition"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                    Transmitir Tela
                  </button>
                </div>
              )}
            </aside>

            {/* ── Main Stage Area ──────────────────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#0B0D10]">
              {/* Audio warning banner */}
              {audioWarningMessage && (
                <div className="mx-4 mt-3 flex items-center gap-2.5 bg-[#FBBF24]/10 border border-[#FBBF24]/20 rounded-lg px-3.5 py-2 text-xs text-[#FBBF24]">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{audioWarningMessage}</span>
                  <button onClick={() => setAudioWarningMessage(null)} className="text-[#FBBF24]/60 hover:text-[#FBBF24]">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Stage Content */}
              <div className="flex-1 overflow-hidden p-4">
                {isStreaming ? (
                  /* Publisher Stream Stage */
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
                ) : (
                  /* Clean Stage State */
                  <div className="h-full flex flex-col items-center justify-center text-center gap-3">
                    <div className="w-14 h-14 rounded-2xl bg-[#15181E] border border-[#252A34] flex items-center justify-center shadow-subtle">
                      <Tv className="w-6 h-6 text-[#828A98]" />
                    </div>

                    <div>
                      <h3 className="text-[17px] font-semibold text-[#EDEFF3]">
                        {hasAnyRemoteStream
                          ? remoteStreams.size === 1
                            ? `${Array.from(remoteStreams.values())[0]?.displayName || 'Alguém'} está transmitindo`
                            : `${remoteStreams.size} transmissões ao vivo disponíveis`
                          : 'Nenhuma transmissão ativa'}
                      </h3>
                      <p className="text-xs text-[#737C8A] mt-1 max-w-[340px] leading-relaxed">
                        {hasAnyRemoteStream
                          ? 'Você pode assistir ou iniciar seu compartilhamento simultaneamente.'
                          : 'Compartilhe sua tela para começar.'}
                      </p>
                    </div>

                    <div className="flex flex-col items-center gap-2.5 mt-1">
                      {hasAnyRemoteStream && (
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                          {Array.from(remoteStreams.entries()).map(([participantId, item]) => (
                            <button
                              key={participantId}
                              onClick={() => {
                                setSelectedStreamParticipantId(participantId);
                                setWatchModalOpen(true);
                              }}
                              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] text-white font-medium text-xs shadow-cta transition transform hover:-translate-y-0.5"
                            >
                              <Play className="w-3.5 h-3.5 fill-white" />
                              Assistir {item.displayName}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={handleStartNativeCapture}
                          className="px-3.5 py-1.5 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] text-xs font-medium flex items-center gap-1.5 transition"
                        >
                          <ScreenShare className="w-3.5 h-3.5 text-[#5B7CFA]" />
                          Seletor do Windows
                        </button>
                        <button
                          onClick={() => setIsModalOpen(true)}
                          className={`px-4 py-1.5 rounded-md font-medium text-xs flex items-center gap-1.5 transition ${
                            hasAnyRemoteStream
                              ? 'bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] hover:border-[#5B7CFA] text-[#F4F6F8]'
                              : 'bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] text-white shadow-cta'
                          }`}
                        >
                          <Monitor className="w-3.5 h-3.5" />
                          {hasAnyRemoteStream ? 'Transmitir também' : 'Transmitir Tela'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── Watch Modal (Theatre Mode) ─────────────────────────────────── */}
      {watchModalOpen && activeStreamEntry && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) setWatchModalOpen(false); }}
        >
          <div className="relative w-full max-w-[94vw] lg:max-w-6xl max-h-[90vh] aspect-video flex items-center justify-center animate-in zoom-in-95 duration-150">
            <StreamViewer
              remoteStream={activeStreamEntry[1].stream}
              peerId={activeStreamEntry[0]}
              streamerName={activeStreamEntry[1].displayName}
              roomId={roomId}
              memberCount={members.length}
              onClose={() => setWatchModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ── Action Confirmation Modal (Kick / Transfer Host) ── */}
      {actionModal && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) handleCloseModalAction(); }}
        >
          <div className="relative w-full max-w-sm rounded-xl bg-[#16191F] border border-[#252A34] shadow-2xl p-5 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3.5">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  actionModal.type === 'kick'
                    ? 'bg-[#F87171]/15 text-[#F87171] border border-[#F87171]/30'
                    : 'bg-[#FBBF24]/15 text-[#FBBF24] border border-[#FBBF24]/30'
                }`}
              >
                {actionModal.type === 'kick' ? <UserX className="w-5 h-5" /> : <Crown className="w-5 h-5" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-[#F4F6F8]">
                  {actionModal.type === 'kick' ? 'Expulsar Participante' : 'Transferir Host'}
                </h3>
                <p className="text-xs text-[#9DA5B4] mt-1 leading-relaxed">
                  {actionModal.type === 'kick' ? (
                    <>
                      Tem certeza de que deseja expulsar <strong className="text-[#F4F6F8]">"{actionModal.targetName}"</strong> da sala? O usuário será desconectado imediatamente.
                    </>
                  ) : (
                    <>
                      Deseja transferir a liderança da sala para <strong className="text-[#F4F6F8]">"{actionModal.targetName}"</strong>? Você deixará de ser Host e passará os poderes administrativos.
                    </>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#1D2129]">
              <button
                onClick={handleCloseModalAction}
                className="px-3.5 py-1.5 rounded-lg bg-[#1D2129] hover:bg-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] text-xs font-medium transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmModalAction}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold shadow-cta transition ${
                  actionModal.type === 'kick'
                    ? 'bg-[#F87171] hover:bg-[#EF4444] text-white'
                    : 'bg-[#FBBF24] hover:bg-[#F59E0B] text-[#101217]'
                }`}
              >
                {actionModal.type === 'kick' ? 'Expulsar' : 'Transferir'}
              </button>
            </div>
          </div>
        </div>
      )}

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
