import React, { useEffect, useState, useCallback, useRef } from 'react';
import { socket } from './services/socket';
import {
  cloudflareRealtimeService,
  isRoomNotFoundError,
  type RemoteStreamInfo,
} from './services/cloudflareRealtimeService';
import { audioCaptureManager } from './audio/AudioCaptureManager';
import {
  getActualDisplaySurface,
  resolveWebAudioPolicy,
  sanitizeMediaStreamForPolicy
} from './audio/webCapturePolicy';
import { DesktopSource, VIDEO_QUALITY_PRESETS, WindowsAudioEnvironment, AudioCaptureStrategy, type StreamViewerInfo } from '@stream-app/shared';
import { SourcePickerModal } from './components/SourcePickerModal';
import { StreamPublisher } from './components/StreamPublisher';
import { StreamViewer } from './components/StreamViewer';
import { TellasLogo } from './components/TellasLogo';
import { AppUpdateControl } from './components/AppUpdateControl';
import {
  Monitor,
  Users,
  Copy,
  Check,
  Tv,
  PlusCircle,
  LogIn,
  LogOut,
  User,
  Settings,
  Crown,
  X,
  AlertTriangle,
  Play,
  Radio,
  Lock,
  Unlock,
  UserX,
  History,
  ArrowRight,
  ClipboardPaste,
  Loader2,
  ChevronDown,
  Video,
  VideoOff,
  MonitorUp,
  Grid
} from 'lucide-react';

import { StageGrid } from './components/StageGrid';

import { useLayoutMode } from './hooks/useLayoutMode';
import { runAtomicPublishLifecycle, type PublishCommandResponse } from './services/publishLifecycle';

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

interface ActiveStreamerInfo {
  participantId: string;
  displayName: string;
}

interface ActionModalState {
  type: 'kick' | 'transfer';
  targetParticipantId?: string;
  targetSocketId?: string;
  targetName: string;
}

const LAST_ROOM_KEY = 'tellas_last_room';
const LEGACY_LAST_DESKTOP_ROOM_KEY = 'tellas_desktop_last_room';

function getLastRoom(): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(LAST_ROOM_KEY)
      || localStorage.getItem(LEGACY_LAST_DESKTOP_ROOM_KEY)
      || '';
  } catch (_) {
    return '';
  }
}

function emitStreamCommand(
  event: 'reserve-stream' | 'confirm-stream' | 'release-stream-reservation',
  roomId: string,
): Promise<PublishCommandResponse> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`Tempo limite em ${event}.`)), 10_000);
    socket.emit(event, { roomId }, (response: PublishCommandResponse) => {
      window.clearTimeout(timeout);
      resolve(response || { success: false, error: `Resposta inválida em ${event}.` });
    });
  });
}

function emitStopStreamCommand(roomId: string): Promise<PublishCommandResponse> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Tempo limite ao encerrar transmissão.')), 10_000);
    socket.emit('stop-stream', { roomId }, (response: PublishCommandResponse) => {
      window.clearTimeout(timeout);
      resolve(response || { success: false, error: 'Resposta inválida ao encerrar transmissão.' });
    });
  });
}

export const App: React.FC = () => {
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('stream_username') || generateRandomName();
  });
  const [roomId, setRoomId] = useState<string>(() => sessionStorage.getItem('tellas_session_room') || '');
  const [inputRoomId, setInputRoomId] = useState<string>('');
  const [lastRoomId, setLastRoomId] = useState<string>(getLastRoom);
  const [isJoiningRoom, setIsJoiningRoom] = useState<boolean>(false);
  const [isInRoom, setIsInRoom] = useState<boolean>(() => Boolean(
    sessionStorage.getItem('tellas_session_room') && sessionStorage.getItem('tellas_session_token')
  ));
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
  const [diagnosticLogPath, setDiagnosticLogPath] = useState<string | null>(null);

  // Stream state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [watchModalOpen, setWatchModalOpen] = useState<boolean>(false);
  const [selectedStreamParticipantId, setSelectedStreamParticipantId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<DesktopSource | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStreamItem>>(new Map());
  const [remoteCameraStreams, setRemoteCameraStreams] = useState<Map<string, MediaStream>>(new Map());
  const [activeStreamers, setActiveStreamers] = useState<Map<string, ActiveStreamerInfo>>(new Map());
  const [streamViewers, setStreamViewers] = useState<Map<string, StreamViewerInfo[]>>(new Map());
  const [isStreamLoading, setIsStreamLoading] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [isStartingStream, setIsStartingStream] = useState<boolean>(false);

  // Who is streaming (display name string)
  const [streamingIdentity, setStreamingIdentity] = useState<string | null>(null);

  // Quality preset
  const [qualityPreset, setQualityPreset] = useState<string>('1080p30');

  // Camera & Grid View Mode (Discord-style stage)
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isCameraLoading, setIsCameraLoading] = useState<boolean>(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(null);
  const [cameraLoadingParticipants, setCameraLoadingParticipants] = useState<Set<string>>(() => new Set());
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [stageViewMode, setStageViewMode] = useState<'grid' | 'focus'>('grid');
  const [focusedStreamId, setFocusedStreamId] = useState<string | null>(null);

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
  const hasAnyActiveStreamer = activeStreamers.size > 0;
  const selectedStreamParticipantIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const stoppingPublicationRef = useRef(false);
  const roomMembershipReadyRef = useRef(false);
  const roomRecoveryPromiseRef = useRef<Promise<void> | null>(null);
  const roomLossHandledRef = useRef(false);

  useEffect(() => {
    selectedStreamParticipantIdRef.current = selectedStreamParticipantId;
  }, [selectedStreamParticipantId]);

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

  const resetLostRoom = useCallback(async (message: string) => {
    if (roomLossHandledRef.current) return;
    roomLossHandledRef.current = true;
    roomMembershipReadyRef.current = false;
    audioCaptureManager.stop();
    localStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    localStreamRef.current = null;
    try {
      sessionStorage.removeItem('tellas_session_token');
      sessionStorage.removeItem('tellas_session_room');
      sessionStorage.removeItem('tellas_participant_id');
    } catch (_) { }
    setMyParticipantId('');
    setIsInRoom(false);
    setIsHost(false);
    setIsRoomLocked(false);
    setRoomId('');
    setMembers([]);
    setLocalStream(null);
    setIsStreaming(false);
    setIsStartingStream(false);
    setSelectedSource(null);
    setStreamingIdentity(null);
    setIsCameraLoading(false);
    setIsCameraActive(false);
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams(new Map());
    setRemoteCameraStreams(new Map());
    setActiveStreamers(new Map());
    setStreamViewers(new Map());
    setSelectedStreamParticipantId(null);
    setSelectedSource(null);
    setIsStreamLoading(false);
    setStreamError(null);
    setIsStreaming(false);
    setStreamingIdentity(null);
    setWatchModalOpen(false);
    await cloudflareRealtimeService.disconnect();
    cloudflareRealtimeService.setSessionToken(null);
    cloudflareRealtimeService.setDiagnosticContext(null, null);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    alert(message);
  }, []);

  const recoverRoomMembership = useCallback((): Promise<void> => {
    if (!isInRoom || !roomId) return Promise.resolve();
    if (roomRecoveryPromiseRef.current) return roomRecoveryPromiseRef.current;

    const savedRoom = sessionStorage.getItem('tellas_session_room');
    const savedToken = sessionStorage.getItem('tellas_session_token');
    if (!savedToken || savedRoom !== roomId) {
      return resetLostRoom('Sua sessão da sala não está mais disponível. Entre novamente.');
    }

    roomMembershipReadyRef.current = false;
    const recovery = new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Tempo limite ao recuperar a sala.'));
      }, 10_000);
      socket.emit('join-room', {
        roomId,
        identity: getEffectiveIdentity(),
        sessionToken: savedToken,
      }, (res: any) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        if (!res?.success) {
          reject(Object.assign(new Error(res?.error || 'Não foi possível recuperar a sala.'), { code: res?.code }));
          return;
        }

        cloudflareRealtimeService.setSessionToken(res.sessionToken || savedToken);
        cloudflareRealtimeService.setDiagnosticContext(res.roomId, res.participantId);
        setMyParticipantId(res.participantId || '');
        setRoomId(res.roomId);
        setIsInRoom(true);
        setIsHost(Boolean(res.isHost));
        setIsRoomLocked(Boolean(res.isLocked));
        const recoveredMembers: Member[] = res.members || [];
        setMembers(recoveredMembers);
        setActiveStreamers(new Map((res.activeStreamers || []).map((participantId: string) => {
          const member = recoveredMembers.find((item) => item.participantId === participantId);
          return [participantId, { participantId, displayName: member?.identity || 'Participante' }];
        })));
        setStreamViewers(new Map(Object.entries(res.streamViewers || {}) as [string, StreamViewerInfo[]][]));
        roomLossHandledRef.current = false;
        roomMembershipReadyRef.current = true;
        resolve();
      });
    }).catch(async (error: Error & { code?: string }) => {
      if (error.code === 'ROOM_NOT_FOUND') {
        await resetLostRoom('A sala foi encerrada no servidor. Crie ou entre em uma nova sala.');
      }
      throw error;
    });

    roomRecoveryPromiseRef.current = recovery.finally(() => {
      roomRecoveryPromiseRef.current = null;
    });
    return roomRecoveryPromiseRef.current;
  }, [getEffectiveIdentity, isInRoom, resetLostRoom, roomId]);

  const ensureRoomMembershipReady = useCallback(async (): Promise<void> => {
    if (!isInRoom || !roomId) throw new Error('Entre em uma sala antes de usar mídia.');
    if (roomMembershipReadyRef.current && socket.connected) return;
    if (!socket.connected) throw new Error('Reconectando à sala. Aguarde alguns segundos.');
    await recoverRoomMembership();
    if (!roomMembershipReadyRef.current) throw new Error('A sala ainda não foi recuperada.');
  }, [isInRoom, recoverRoomMembership, roomId]);

  useEffect(() => {
    const savedToken = sessionStorage.getItem('tellas_session_token');
    if (savedToken) cloudflareRealtimeService.setSessionToken(savedToken);

    const handleConnect = () => {
      if (!isInRoom || !roomId) return;
      void recoverRoomMembership().catch((error) => {
        if ((error as { code?: string })?.code !== 'ROOM_NOT_FOUND') {
          console.error('[App] Failed to recover room membership:', error);
        }
      });
    };
    const handleDisconnect = () => {
      if (isInRoom && roomId) roomMembershipReadyRef.current = false;
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    if (socket.connected) handleConnect();
    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, [isInRoom, recoverRoomMembership, roomId]);

  useEffect(() => {
    cloudflareRealtimeService.setDiagnosticContext(roomId, myParticipantId);
  }, [roomId, myParticipantId]);

  // ─── LiveKit Callbacks ──────────────────────────────────────────────

  useEffect(() => {
    cloudflareRealtimeService.setCallbacks({
      onRemoteTrackSubscribed: (info: RemoteStreamInfo) => {
        const resolvedName = resolveDisplayName(info.participantId, info.displayName);
        if (info.source === 'camera') {
          setRemoteCameraStreams((prev) => new Map(prev).set(info.participantId, info.stream));
          setCameraLoadingParticipants((prev) => {
            if (!prev.has(info.participantId)) return prev;
            const next = new Set(prev);
            next.delete(info.participantId);
            return next;
          });
          return;
        }
        setRemoteStreams((prev) =>
          new Map(prev).set(info.participantId, {
            stream: info.stream,
            participantId: info.participantId,
            displayName: resolvedName,
          })
        );
        setStreamingIdentity(resolvedName);
      },
      onRemoteTrackUnsubscribed: (participantId: string, source?: 'screen' | 'camera') => {
        if (source === 'camera' || !source) {
          setRemoteCameraStreams((prev) => {
            const next = new Map(prev);
            next.delete(participantId);
            return next;
          });
        }
        if (source === 'screen' || !source) {
          setRemoteStreams((prev) => {
            const next = new Map(prev);
            next.delete(participantId);
            return next;
          });
        }
        if (remoteStreams.size <= 1) setStreamingIdentity(null);
      },
      onConnectionStateChanged: () => undefined,
      onError: (error: Error) => {
        console.error('[App] Cloudflare Realtime error:', error);
      },
      onPublicationRecoveryFailed: (error: Error) => {
        console.error('[App] Cloudflare publication recovery failed:', error);
        const stream = localStreamRef.current;
        stream?.getVideoTracks().forEach((track) => { track.onended = null; });
        stream?.getTracks().forEach((track) => track.stop());
        audioCaptureManager.stop();
        localStreamRef.current = null;
        setLocalStream(null);
        setIsStreaming(false);
        setSelectedSource(null);
      },
      onSubscriptionFailed: (participantId: string, error: Error, cameraOnly = false) => {
        if (cameraOnly) {
          setCameraLoadingParticipants((prev) => {
            const next = new Set(prev);
            next.delete(participantId);
            return next;
          });
          setCameraErrorMessage('Não foi possível receber a câmera deste participante. Tente novamente.');
          return;
        }
        if (participantId !== selectedStreamParticipantIdRef.current) return;
        setIsStreamLoading(false);
        setStreamError(error.message || 'Não foi possível conectar à transmissão.');
      },
      onParticipantDisconnected: (participantId: string) => {
        setActiveStreamers((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        if (participantId === selectedStreamParticipantIdRef.current) {
          setSelectedStreamParticipantId(null);
          setWatchModalOpen(false);
          setIsStreamLoading(false);
        }
      },
    });
  }, [resolveDisplayName, remoteStreams.size]);

  useEffect(() => {
    if (!isInRoom || activeStreamers.size === 0) return;
    void cloudflareRealtimeService.connect().catch((error) => {
      console.warn('[App] Failed to prepare Cloudflare viewer session:', error);
    });
  }, [activeStreamers.size, isInRoom]);

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
      if (participantId) {
        setCameraLoadingParticipants((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Set(prev);
          next.delete(participantId);
          return next;
        });
        setRemoteStreams((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        setRemoteCameraStreams((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        setActiveStreamers((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        if (participantId === selectedStreamParticipantIdRef.current
          || cloudflareRealtimeService.subscribedParticipantId === participantId) {
          void cloudflareRealtimeService.unsubscribeFromParticipant(participantId, true, 'user-left');
        }
        if (participantId === selectedStreamParticipantIdRef.current) {
          setSelectedStreamParticipantId(null);
          setWatchModalOpen(false);
          setIsStreamLoading(false);
        }
      }
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
      if (participantId) {
        if (import.meta.env.DEV) console.log('[CLOUDFLARE][STREAM_DISCOVERED]', { participantId, roomId, displayName: identity || resolveDisplayName(participantId) });
        setActiveStreamers((prev) => new Map(prev).set(participantId, {
          participantId,
          displayName: identity || resolveDisplayName(participantId),
        }));
      }
    });

    socket.on('stream-stopped', ({ participantId }: { participantId?: string } = {}) => {
      if (participantId) {
        if (import.meta.env.DEV) console.log('[CLOUDFLARE][TARGET_STREAM_STOPPED]', { participantId, wasCurrentTarget: participantId === selectedStreamParticipantIdRef.current });
        setRemoteStreams((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        setRemoteCameraStreams((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        setActiveStreamers((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        setStreamViewers((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        if (cloudflareRealtimeService.subscribedParticipantId === participantId
          && !cloudflareRealtimeService.cameraOnlySubscription) {
          const cameraWasActive = remoteCameraStreams.has(participantId);
          void cloudflareRealtimeService.unsubscribeFromParticipant(participantId, true, 'stream-stopped')
            .then(() => cameraWasActive
              ? cloudflareRealtimeService.subscribeToParticipant(participantId, true)
              : undefined)
            .catch((error) => console.warn('[App] Failed to retain camera subscription after screen stopped:', error));
        }
        if (participantId === selectedStreamParticipantIdRef.current) {
          setSelectedStreamParticipantId(null);
          setWatchModalOpen(false);
          setIsStreamLoading(false);
        }
      } else {
        setCameraLoadingParticipants(new Set());
        setActiveStreamers(new Map());
        setStreamViewers(new Map());
        setStreamViewers(new Map());
        void cloudflareRealtimeService.unsubscribeAll();
        setRemoteStreams(new Map());
        setRemoteCameraStreams(new Map());
        setStreamingIdentity(null);
        setWatchModalOpen(false);
      }
    });

    socket.on('camera-loading', ({ participantId, loading }: { participantId?: string; loading?: boolean } = {}) => {
      if (!participantId || participantId === myParticipantId) return;
      setCameraLoadingParticipants((prev) => {
        const next = new Set(prev);
        if (loading) next.add(participantId);
        else next.delete(participantId);
        return next;
      });
    });

    socket.on('camera-track-updated', ({ participantId, active }: { participantId?: string; active?: boolean } = {}) => {
      if (!participantId || participantId === myParticipantId) return;
      const subscribedParticipantId = cloudflareRealtimeService.subscribedParticipantId;
      if (active && subscribedParticipantId === participantId) {
        void cloudflareRealtimeService.refreshSubscription(participantId)
          .catch((error) => console.warn('[App] Failed to refresh camera subscription:', error));
      } else if (active && !subscribedParticipantId) {
        void ensureRoomMembershipReady()
          .then(() => cloudflareRealtimeService.subscribeToParticipant(participantId, true))
          .catch((error) => console.warn('[App] Failed to subscribe to remote camera:', error));
      } else if (!active && subscribedParticipantId === participantId) {
        setCameraLoadingParticipants((prev) => {
          if (!prev.has(participantId)) return prev;
          const next = new Set(prev);
          next.delete(participantId);
          return next;
        });
        if (cloudflareRealtimeService.cameraOnlySubscription) {
          void cloudflareRealtimeService.unsubscribeFromParticipant(participantId);
          setRemoteCameraStreams((prev) => {
            const next = new Map(prev);
            next.delete(participantId);
            return next;
          });
        } else {
          void cloudflareRealtimeService.refreshSubscription(participantId)
            .catch((error) => console.warn('[App] Failed to refresh screen subscription:', error));
        }
      }
    });

    socket.on('stream-viewers-updated', ({ streamerParticipantId, viewers }: { streamerParticipantId: string; viewers: StreamViewerInfo[] }) => {
      setStreamViewers((prev) => new Map(prev).set(streamerParticipantId, viewers));
    });

    // ─── Host Administrative Events ──────────────────────────────────
    socket.on('kicked-from-room', ({ reason }: { reason?: string } = {}) => {
      void resetLostRoom(reason || 'Você foi expulso da sala pelo host.');
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
        cloudflareRealtimeService.setSessionToken(sessionToken);
        try {
          sessionStorage.setItem('tellas_session_token', sessionToken);
        } catch (_) { }
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
      socket.off('camera-loading');
      socket.off('camera-track-updated');
      socket.off('stream-viewers-updated');
      socket.off('kicked-from-room');
      socket.off('room-lock-status-changed');
      socket.off('role-updated');
      socket.off('host-transferred');
    };
  }, [roomId, isHost, getEffectiveIdentity, myParticipantId, resetLostRoom, resolveDisplayName]);

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

  const rememberRoom = useCallback((nextRoomId: string) => {
    const normalizedRoomId = nextRoomId.trim().toUpperCase();
    try {
      localStorage.setItem(LAST_ROOM_KEY, normalizedRoomId);
      localStorage.removeItem(LEGACY_LAST_DESKTOP_ROOM_KEY);
    } catch (_) { }
    setLastRoomId(normalizedRoomId);
  }, []);

  const forgetRoom = useCallback((staleRoomId: string) => {
    if (lastRoomId !== staleRoomId) return;
    try {
      localStorage.removeItem(LAST_ROOM_KEY);
      localStorage.removeItem(LEGACY_LAST_DESKTOP_ROOM_KEY);
    } catch (_) { }
    setLastRoomId('');
  }, [lastRoomId]);

  const handleCreateRoom = useCallback(() => {
    const identity = getEffectiveIdentity();
    try {
      sessionStorage.removeItem('tellas_session_token');
      sessionStorage.removeItem('tellas_session_room');
      sessionStorage.removeItem('tellas_participant_id');
    } catch (_) { }

    socket.emit('create-room', { identity }, (res: any) => {
      if (res.success) {
        roomMembershipReadyRef.current = true;
        roomLossHandledRef.current = false;
        if (res.sessionToken) {
          cloudflareRealtimeService.setSessionToken(res.sessionToken);
          cloudflareRealtimeService.setDiagnosticContext(res.roomId, res.participantId);
          try {
            sessionStorage.setItem('tellas_session_token', res.sessionToken);
            sessionStorage.setItem('tellas_session_room', res.roomId);
            sessionStorage.setItem('tellas_participant_id', res.participantId || '');
          } catch (_) { }
        }
        setMyParticipantId(res.participantId || '');
        setRoomId(res.roomId);
        rememberRoom(res.roomId);
        setIsInRoom(true);
        setIsHost(true);
        setIsRoomLocked(false);
        setMembers(res.members || [{ socketId: socket.id, participantId: res.participantId, identity, isHost: true }]);
        setActiveStreamers(new Map());
      } else {
        alert(res.error || 'Erro ao criar sala');
      }
    });
  }, [getEffectiveIdentity, rememberRoom]);

  const joinRoom = useCallback((requestedRoomId: string, fromLastRoomShortcut = false) => {
    const cleanRoomId = requestedRoomId.trim().toUpperCase();
    if (!cleanRoomId || isJoiningRoom) return;

    setIsJoiningRoom(true);
    const identity = getEffectiveIdentity();
    const savedRoom = sessionStorage.getItem('tellas_session_room');
    const savedToken = (savedRoom === cleanRoomId ? sessionStorage.getItem('tellas_session_token') : null) || undefined;

    socket.emit('join-room', { roomId: cleanRoomId, identity, sessionToken: savedToken }, (res: any) => {
      setIsJoiningRoom(false);
      if (res.success) {
        roomMembershipReadyRef.current = true;
        roomLossHandledRef.current = false;
        if (res.sessionToken) {
          cloudflareRealtimeService.setSessionToken(res.sessionToken);
          cloudflareRealtimeService.setDiagnosticContext(res.roomId, res.participantId);
          try {
            sessionStorage.setItem('tellas_session_token', res.sessionToken);
            sessionStorage.setItem('tellas_session_room', res.roomId);
            sessionStorage.setItem('tellas_participant_id', res.participantId || '');
          } catch (_) { }
        }
        setMyParticipantId(res.participantId || '');
        setRoomId(res.roomId);
        rememberRoom(res.roomId);
        setIsInRoom(true);
        setIsHost(res.isHost);
        setIsRoomLocked(res.isLocked || false);
        setMembers(res.members || [{ socketId: socket.id, participantId: res.participantId, identity, isHost: res.isHost }]);
        const joinedMembers: Member[] = res.members || [];
        setActiveStreamers(new Map((res.activeStreamers || []).map((participantId: string) => {
          const member = joinedMembers.find((item) => item.participantId === participantId);
          return [participantId, { participantId, displayName: member?.identity || 'Participante' }];
        })));
        setStreamViewers(new Map(Object.entries(res.streamViewers || {}) as [string, StreamViewerInfo[]][]));
      } else {
        if (fromLastRoomShortcut && res.code === 'ROOM_NOT_FOUND') {
          forgetRoom(cleanRoomId);
        }
        alert(res.error || 'Erro ao entrar na sala');
      }
    });
  }, [forgetRoom, getEffectiveIdentity, isJoiningRoom, rememberRoom]);

  const handleJoinRoom = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    joinRoom(inputRoomId);
  }, [inputRoomId, joinRoom]);

  const handleJoinLastRoom = useCallback(() => {
    joinRoom(lastRoomId, true);
  }, [joinRoom, lastRoomId]);

  const handlePasteAndJoin = useCallback(async () => {
    if (isJoiningRoom) return;

    try {
      const clipboardText = await navigator.clipboard.readText();
      const pastedRoomId = clipboardText.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,8}$/.test(pastedRoomId)) {
        alert('O conteúdo copiado não parece ser um código de sala válido.');
        return;
      }

      setInputRoomId(pastedRoomId);
      joinRoom(pastedRoomId);
    } catch (_) {
      alert('Não foi possível acessar a área de transferência. Cole o código manualmente.');
    }
  }, [isJoiningRoom, joinRoom]);

  const handleLeaveRoom = useCallback(() => {
    roomMembershipReadyRef.current = false;
    const stream = localStreamRef.current;
    stream?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    localStreamRef.current = null;
    cameraStream?.getTracks().forEach((track) => track.stop());
    audioCaptureManager.stop();
    stoppingPublicationRef.current = false;

    const disconnectPromise = cloudflareRealtimeService.disconnect();
    if (roomId) socket.emit('leave-room', { roomId });
    cloudflareRealtimeService.setSessionToken(null);
    cloudflareRealtimeService.setDiagnosticContext(null, null);
    void disconnectPromise.catch((error) => {
      console.warn('[App] Media cleanup completed with an error after leaving:', error);
    });
    try {
      sessionStorage.removeItem('tellas_session_token');
      sessionStorage.removeItem('tellas_session_room');
      sessionStorage.removeItem('tellas_participant_id');
    } catch (_) { }
    setMyParticipantId('');
    setIsInRoom(false);
    setIsHost(false);
    setIsRoomLocked(false);
    setRoomId('');
    setMembers([]);
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    setCameraStream(null);
    setCameraLoadingParticipants(new Set());
    setRemoteStreams(new Map());
    setRemoteCameraStreams(new Map());
    setActiveStreamers(new Map());
    setStreamViewers(new Map());
    setSelectedStreamParticipantId(null);
    setIsStreamLoading(false);
    setStreamError(null);
    setStreamingIdentity(null);
    setWatchModalOpen(false);
  }, [roomId, cameraStream]);

  const handleToggleCamera = useCallback(async () => {
    if (isCameraLoading) return;
    if (isCameraActive) {
      try {
        await cloudflareRealtimeService.setCameraTrack(null);
      } catch (error) {
        console.error('[Camera] Failed to unpublish camera:', error);
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      setCameraStream(null);
      setIsCameraActive(false);
      socket.emit('camera-loading', { roomId, loading: false });
    } else {
      setIsCameraLoading(true);
      let cameraPublished = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        socket.emit('camera-loading', { roomId, loading: true });
        stream.getVideoTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            void cloudflareRealtimeService.setCameraTrack(null).catch((error) => {
              console.error('[Camera] Failed to unpublish ended camera track:', error);
            });
            setCameraStream((currentStream) => currentStream === stream ? null : currentStream);
            setIsCameraActive(false);
            socket.emit('camera-loading', { roomId, loading: false });
          }, { once: true });
        });
        setCameraStream(stream);
        setIsCameraActive(true);
        if (stream.getVideoTracks()[0]) {
          try {
            await cloudflareRealtimeService.setCameraTrack(stream.getVideoTracks()[0]);
            cameraPublished = true;
          } catch (error) {
            console.error('[Camera] Failed to publish camera:', error);
            setCameraErrorMessage('A câmera foi ativada neste dispositivo, mas não foi possível enviá-la aos participantes.');
          }
        }
      } catch (err) {
        console.error('[Camera] Could not access camera:', err);
        const message = err instanceof Error && err.name === 'NotAllowedError'
          ? 'Permita o acesso à câmera nas configurações do navegador ou do Windows.'
          : 'Não foi possível acessar uma câmera. Verifique se ela está conectada e disponível.';
        setCameraErrorMessage(message);
      } finally {
        setIsCameraLoading(false);
        if (!cameraPublished) socket.emit('camera-loading', { roomId, loading: false });
      }
    }
  }, [isCameraActive, isCameraLoading, cameraStream]);

  const copyRoomCode = useCallback(() => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomId]);

  // ─── Streaming Actions ───────────────────────────────────────

  const stopCurrentPublication = async (): Promise<boolean> => {
    const stream = localStreamRef.current;
    if (!stream || stoppingPublicationRef.current) return true;
    stoppingPublicationRef.current = true;

    // Release browser capture immediately; network cleanup can finish afterward.
    stream.getVideoTracks().forEach((track) => { track.onended = null; });
    stream.getTracks().forEach((track) => track.stop());
    audioCaptureManager.stop();
    localStreamRef.current = null;
    setLocalStream(null);
    setIsStreaming(false);
    setSelectedSource(null);

    let unpublishError: unknown = null;
    try {
      await cloudflareRealtimeService.unpublishAllTracks();
    } catch (error) {
      unpublishError = error;
      console.error('[App] Failed to unpublish Cloudflare tracks; signaling stop anyway:', error);
    }

    try {
      if (roomId) {
        const response = await emitStopStreamCommand(roomId);
        if (!response.success) throw new Error(response.error || 'Não foi possível encerrar a transmissão atual.');
      }
      if (unpublishError) {
        console.warn('[App] Screen publication state cleared; remote media cleanup may finish asynchronously.');
      }
      return true;
    } catch (error) {
      console.error('[App] Failed to announce stopped stream:', error);
      alert(error instanceof Error ? error.message : 'Não foi possível atualizar o estado da transmissão.');
      return false;
    } finally {
      stoppingPublicationRef.current = false;
    }
  };

  const startStreamingViaCloudflare = async (videoStream: MediaStream) => {
    try {
      await ensureRoomMembershipReady();
    } catch (error) {
      videoStream.getTracks().forEach((track) => track.stop());
      if (!isRoomNotFoundError(error)) {
        const message = error instanceof Error ? error.message : 'Não foi possível recuperar a sala.';
        alert(message);
      }
      throw error;
    }

    if (isStreaming && localStream) {
      const newVideoTrack = videoStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        videoStream.getTracks().forEach((track) => track.stop());
        throw new Error('A nova fonte não forneceu vídeo.');
      }
      try {
        const preset = VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];
        const previousVideoTrack = await cloudflareRealtimeService.replacePublishedVideoTrack(newVideoTrack, preset);
        previousVideoTrack.onended = null;
        previousVideoTrack.stop();
        const replacementStream = new MediaStream([newVideoTrack, ...localStream.getAudioTracks()]);
        localStreamRef.current = replacementStream;
        setLocalStream(replacementStream);
        return;
      } catch (error) {
        videoStream.getTracks().forEach((track) => track.stop());
        console.error('[App] Failed to replace published video track:', error);
        alert(error instanceof Error ? error.message : 'Não foi possível alterar a fonte da transmissão.');
        throw error;
      }
    }

    let finalStream = videoStream;
    const identity = getEffectiveIdentity();

    if (window.electronAPI?.startAudioCapture) {
      try {
        const audioRes = await audioCaptureManager.start(48000);
        if (audioRes.diagnosticLogPath) {
          setDiagnosticLogPath(audioRes.diagnosticLogPath);
        }

        if (!audioRes.success) {
          if (audioRes.code === 'VIRTUAL_AUDIO_REQUIRED') {
            setAudioWarningMessage('O áudio do sistema requer Windows 10 build 19041+ ou Windows 11. A transmissão continuará apenas com vídeo.');
          } else if (audioRes.code === 'WASAPI_START_FAILED' || audioRes.code === 'PROCESS_LOOPBACK_UNAVAILABLE') {
            setAudioWarningMessage('O Process Loopback não pôde ser ativado neste sistema. A transmissão continuará apenas com vídeo.');
          } else if (audioRes.code === 'DISCORD_PROCESS_TREE_AMBIGUOUS') {
            setAudioWarningMessage('Não foi possível isolar com segurança o áudio do Discord. A transmissão continuará sem áudio.');
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
      const audioTrack = finalStream.getAudioTracks()[0];
      const videoTrack = finalStream.getVideoTracks()[0];

      window.electronAPI?.sendAudioDiagnosticEvent?.('PUBLISH_STREAM_INIT', {
        hasAudioTrack: Boolean(audioTrack),
        audioTrackId: audioTrack?.id || 'NONE',
        audioTrackState: audioTrack?.readyState || 'NONE',
        videoTrackId: videoTrack?.id || 'NONE'
      }, 'CLOUDFLARE');

      await runAtomicPublishLifecycle({
        reserve: () => emitStreamCommand('reserve-stream', roomId),
        publish: () => cloudflareRealtimeService.publishStream(
          finalStream,
          VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'],
        ),
        confirm: () => emitStreamCommand('confirm-stream', roomId),
        rollbackPublish: () => cloudflareRealtimeService.unpublishAllTracks(),
        releaseReservation: () => emitStreamCommand('release-stream-reservation', roomId),
        onCleanupError: (operation, cleanupError) => {
          console.error(`[App] Failed atomic publish cleanup (${operation}):`, cleanupError);
        },
      });
      cloudflareRealtimeService.markPublicationConfirmed();

      window.electronAPI?.sendAudioDiagnosticEvent?.('PUBLISH_STREAM_SUCCESS', {
        status: 'STREAM_PUBLISHED',
        hasAudioTrack: Boolean(audioTrack),
        finalAudioResult: audioTrack ? 'AUDIO_PUBLISHED' : 'VIDEO_ONLY'
      }, 'CLOUDFLARE');

      localStreamRef.current = finalStream;
      setLocalStream(finalStream);
      setIsStreaming(true);
      setStreamingIdentity(identity);

    } catch (err: any) {
      console.error('[App] Failed to publish stream:', err);
      window.electronAPI?.sendAudioDiagnosticEvent?.('PUBLISH_STREAM_ERROR', {
        error: err.message
      }, 'CLOUDFLARE');
      if (isRoomNotFoundError(err)) {
        await resetLostRoom('A sala foi encerrada no servidor. Crie ou entre em uma nova sala.');
      } else {
        alert(`Erro ao iniciar transmissão: ${err.message}`);
      }
      setIsStreaming(false);
      localStreamRef.current = null;
      setLocalStream(null);
      if (finalStream) finalStream.getTracks().forEach((t) => t.stop());
    }
  };

  const handleStartCapture = async (source: DesktopSource) => {
    setIsStartingStream(true);
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
      await startStreamingViaCloudflare(stream);
      setSelectedSource(source);
      stream.getVideoTracks()[0].onended = () => handleStopStream();
    } catch (err: any) {
      console.error('[App] Failed to capture screen source:', err);
    } finally {
      setIsStartingStream(false);
    }
  };

  const handleStartWebCapture = async () => {
    setIsStartingStream(true);
    const preset = VIDEO_QUALITY_PRESETS[qualityPreset] || VIDEO_QUALITY_PRESETS['1080p30'];

    const videoConstraints: any = {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate },
    };

    const displayMediaOptions: any = {
      video: videoConstraints,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      systemAudio: 'include',
    };

    try {
      const captureStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      const actualSurface = getActualDisplaySurface(captureStream);
      const hasAudio = captureStream.getAudioTracks().length > 0;
      const selectedMode = actualSurface === 'unknown' ? 'browser' : actualSurface;
      const policyResult = resolveWebAudioPolicy(selectedMode, actualSurface, hasAudio);

      // Sanitize stream: stops audio tracks if policy decision is FORCE_VIDEO_ONLY
      const finalStream = sanitizeMediaStreamForPolicy(captureStream, policyResult.decision);

      if (policyResult.warningMessage) {
        setAudioWarningMessage(policyResult.warningMessage);
      } else {
        setAudioWarningMessage(null);
      }

      const sourceName = actualSurface === 'browser'
        ? 'Guia do Navegador'
        : actualSurface === 'window'
          ? 'Janela'
          : 'Tela Inteira';

      setIsModalOpen(false);
      await startStreamingViaCloudflare(finalStream);
      setSelectedSource({ id: `web:${actualSurface}`, name: sourceName, thumbnail: '' });
      finalStream.getVideoTracks()[0].onended = () => handleStopStream();
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        console.error('[App] Failed to getDisplayMedia on Web:', err);
      }
    } finally {
      setIsStartingStream(false);
    }
  };

  const handleOpenSharePicker = () => {
    if (window.electronAPI?.getSources) {
      setIsModalOpen(true);
      return;
    }
    void handleStartWebCapture();
  };

  const handleStopStream = async () => {
    await stopCurrentPublication();
  };



  const handleQualityChange = (presetKey: string) => {
    setQualityPreset(presetKey);
  };

  const handleFirstVideoFrame = useCallback(() => {
    setIsStreamLoading(false);
    setStreamError(null);
  }, []);

  const handleWatchStream = useCallback(async (participantId: string) => {
    setSelectedStreamParticipantId(participantId);
    setWatchModalOpen(true);
    setIsStreamLoading(true);
    setStreamError(null);
    try {
      await ensureRoomMembershipReady();
      await cloudflareRealtimeService.subscribeToParticipant(participantId);
    } catch (error) {
      if (isRoomNotFoundError(error)) {
        await resetLostRoom('A sala foi encerrada no servidor. Crie ou entre em uma nova sala.');
        return;
      }
      const message = error instanceof Error ? error.message : 'Não foi possível conectar à transmissão.';
      setIsStreamLoading(false);
      setStreamError(message);
    }
  }, [ensureRoomMembershipReady, resetLostRoom]);

  const handleStopWatch = useCallback(async () => {
    const target = selectedStreamParticipantIdRef.current;
    const cameraWasActive = target ? remoteCameraStreams.has(target) : false;
    if (target) {
      await cloudflareRealtimeService.unsubscribeFromParticipant(target);
      if (cameraWasActive) {
        await cloudflareRealtimeService.subscribeToParticipant(target, true).catch((error) => {
          console.warn('[App] Failed to resume camera-only subscription:', error);
        });
      }
    }
    setSelectedStreamParticipantId(null);
    setWatchModalOpen(false);
    setIsStreamLoading(false);
    setStreamError(null);
  }, [remoteCameraStreams]);

  const currentPreset = VIDEO_QUALITY_PRESETS[qualityPreset];

  // Active stream entry for watch modal (supports multiple concurrent streams)
  const activeStreamEntry = selectedStreamParticipantId && remoteStreams.has(selectedStreamParticipantId)
    ? [selectedStreamParticipantId, remoteStreams.get(selectedStreamParticipantId)!] as [string, RemoteStreamItem]
    : null;

  const displayStreamersList = React.useMemo(() => {
    const list: Array<{ id: string; displayName: string }> = [];
    if (isStreaming) {
      list.push({ id: 'local', displayName: userName });
    }
    activeStreamers.forEach((item, pid) => {
      list.push({ id: pid, displayName: item.displayName });
    });
    return list;
  }, [isStreaming, userName, activeStreamers]);

  return (
    <div className="flex flex-col h-screen bg-[#313338] text-[#F2F3F5] select-none font-sans overflow-hidden">

      {/* ── Topbar (Height: 44px, matching reference) ────────────────────── */}
      <header className="h-11 px-4 bg-[#2B2D31] flex items-center justify-between z-30 shrink-0 border-b border-[#202225]/40 select-none">
        {/* Left: Tellas / {RoomId} */}
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-[#F2F3F5] tracking-tight">Tellas</span>
          {isInRoom && (
            <div className="flex items-center gap-1.5 ml-0.5">
              <span className="text-[#80848E] text-xs">/</span>
              <button
                onClick={copyRoomCode}
                className="flex items-center gap-1 text-xs text-[#DBDEE1] hover:text-white transition font-mono tracking-wider"
                title="Clique para copiar o código da sala"
              >
                {roomId}
                {copied ? <Check className="w-3 h-3 text-[#23A55A]" /> : <Copy className="w-3 h-3 text-[#80848E]" />}
              </button>
              {isHost ? (
                <button
                  onClick={handleToggleRoomLock}
                  title={isRoomLocked ? 'Sala trancada' : 'Sala aberta'}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${
                    isRoomLocked
                      ? 'bg-[#ED4245]/15 text-[#ED4245] border border-[#ED4245]/30'
                      : 'bg-[#23A55A]/15 text-[#23A55A] border border-[#23A55A]/30'
                  }`}
                >
                  {isRoomLocked ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                  {isRoomLocked ? 'Trancada' : 'Aberta'}
                </button>
              ) : isRoomLocked ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#ED4245]/15 text-[#ED4245] border border-[#ED4245]/30">
                  <Lock className="w-2.5 h-2.5" /> Trancada
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* Right: Version & Profile with dropdown */}
        <div className="flex items-center gap-3">
          <AppUpdateControl mediaActive={isStreaming || watchModalOpen} />

          <div className="flex items-center gap-1.5 px-2 py-1 rounded-md">
            <div className="relative shrink-0">
              <div className="w-6 h-6 rounded-full bg-[#5865F2] flex items-center justify-center text-[11px] font-bold text-white uppercase shadow-sm">
                {isCameraLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : userName ? userName.charAt(0) : 'G'}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#23A55A] ring-2 ring-[#2B2D31]" />
            </div>
            <span className="text-xs font-medium text-[#F2F3F5] max-w-[120px] truncate">{userName}</span>
          </div>
        </div>
      </header>

      {/* ── Main Workspace ───────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden relative bg-[#313338]">
        {!isInRoom ? (
          /* ── Landing / Login Screen ─────────────────────────────────── */
          <div className="h-full flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#2B2D31] p-7 rounded-2xl border border-[#383A40] shadow-2xl space-y-5">

              {/* Header Icon & Title */}
              <div className="text-center space-y-2">
                <div className="flex justify-center mb-1">
                  <TellasLogo className="w-14 h-14" glow />
                </div>
                <h1 className="text-xl font-bold text-[#F2F3F5] tracking-tight">Tellas</h1>
                <p className="text-xs text-[#949BA4]">
                  Compartilhamento de tela em tempo real com áudio isolado.
                </p>
              </div>

              {/* Display Name Input */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#949BA4]">
                  Seu nome de exibição
                </label>
                <div className="relative flex items-center">
                  <User className="absolute left-3 w-3.5 h-3.5 text-[#80848E]" />
                  <input
                    type="text"
                    placeholder="Ex: Gabriel"
                    value={userName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    maxLength={25}
                    className="w-full pl-8 pr-3 py-2.5 rounded-lg bg-[#1E1F22] text-[#F2F3F5] text-xs placeholder:text-[#6D6F78] focus:outline-none focus:border-[#5865F2] border border-[#383A40] transition"
                  />
                </div>
              </div>

              {/* Create Room Button */}
              <button
                onClick={handleCreateRoom}
                className="w-full py-2.5 px-4 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] active:bg-[#3C45A5] font-semibold text-white text-xs shadow-md flex items-center justify-center gap-1.5 transition transform active:scale-95"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Criar Nova Sala
              </button>

              {/* Subtle Divider */}
              <div className="relative flex items-center justify-center my-2">
                <div className="border-t border-[#383A40] w-full"></div>
                <span className="bg-[#2B2D31] px-2.5 text-[10px] text-[#949BA4] uppercase tracking-wider font-semibold absolute">
                  ou entrar com código
                </span>
              </div>

              {/* Join Room Form */}
              <form onSubmit={handleJoinRoom} className="space-y-2.5">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                  Código da sala
                </label>
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <span className="absolute inset-y-0 left-3 flex items-center font-mono text-sm text-[#687180]">#</span>
                    <input
                      type="text"
                      placeholder="Digite o código da sala"
                      value={inputRoomId}
                      onChange={(e) => setInputRoomId(e.target.value.toUpperCase())}
                      maxLength={8}
                      className="w-full rounded-lg border border-[#252A34] bg-[#101217] py-2 pl-8 pr-3 font-mono text-xs uppercase tracking-widest text-[#F4F6F8] placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-[#505764] transition focus:border-[#5B7CFA] focus:outline-none"
                    />
                  </div>
                  {window.electronAPI && (
                    <button
                      type="button"
                      onClick={handlePasteAndJoin}
                      disabled={isJoiningRoom}
                      className="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#33477E] bg-[#111725] px-3 text-xs font-medium text-[#7D97FF] transition hover:border-[#5B7CFA] hover:bg-[#151D30] disabled:cursor-wait disabled:opacity-50"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      Colar
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={!inputRoomId.trim() || isJoiningRoom}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#16191F] hover:bg-[#1D2129] border border-[#323846] hover:border-[#4A5364] disabled:opacity-40 disabled:cursor-not-allowed font-medium text-[#F4F6F8] text-xs flex items-center justify-center gap-1.5 transition shadow-subtle"
                >
                  <LogIn className="w-3.5 h-3.5 text-[#9DA5B4]" />
                  {isJoiningRoom ? 'Entrando...' : 'Entrar na Sala'}
                </button>
              </form>

              {lastRoomId && (
                <button
                  type="button"
                  onClick={handleJoinLastRoom}
                  disabled={isJoiningRoom}
                  className="group w-full rounded-lg border border-[#405A9D] bg-[#11151C] px-3.5 py-3 text-left transition hover:border-[#5B7CFA] hover:bg-[#151A23] disabled:cursor-wait disabled:opacity-60"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#5B7CFA]/10 text-[#7D97FF]">
                      <History className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-[#687180]">
                        Última sala
                      </span>
                      <span className="mt-0.5 block font-mono text-sm font-semibold tracking-widest text-[#F4F6F8]">
                        {lastRoomId}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-medium text-[#7D97FF]">
                      {isJoiningRoom ? 'Entrando...' : 'Entrar'}
                      {!isJoiningRoom && <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />}
                    </span>
                  </span>
                </button>
              )}

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
                  viewers={streamViewers.get(activeStreamEntry[0]) || []}
                  isLoading={isStreamLoading}
                  onFirstVideoFrame={handleFirstVideoFrame}
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
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition ${isSelected ? 'bg-[#5B7CFA] text-white' : 'text-[#9DA5B4] hover:text-white'
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
                  {hasAnyActiveStreamer ? 'Escolha uma transmissão para assistir.' : 'Aguardando alguém iniciar uma transmissão.'}
                </p>
                {hasAnyActiveStreamer && (
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    {Array.from(activeStreamers.values()).map((streamer) => (
                      <button key={streamer.participantId} onClick={() => void handleWatchStream(streamer.participantId)} className="px-3 py-1.5 rounded-md bg-[#5B7CFA] text-white text-xs font-medium">
                        Assistir {streamer.displayName}
                      </button>
                    ))}
                  </div>
                )}
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
                  viewers={streamViewers.get(activeStreamEntry[0]) || []}
                  isLoading={isStreamLoading}
                  onFirstVideoFrame={handleFirstVideoFrame}
                />
              ) : (
                <div className="flex flex-col items-center justify-center p-4 text-center">
                  <div className="w-10 h-10 rounded-xl bg-[#16191F] border border-[#252A34] flex items-center justify-center mb-2 shadow-subtle">
                    <Tv className="w-5 h-5 text-[#687180]" />
                  </div>
                  <p className="text-xs font-semibold text-[#EDEFF3]">Aguardando transmissão</p>
                  <p className="text-[11px] text-[#687180] mt-0.5 max-w-[240px]">
                    {hasAnyActiveStreamer ? 'Toque em um participante ao vivo abaixo para assistir.' : 'Aguardando alguém iniciar uma transmissão.'}
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
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition ${isSelected
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
                        {isCameraLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : userName ? userName.charAt(0) : 'U'}
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
                      const streamerItem = member.participantId ? activeStreamers.get(member.participantId) : null;
                      const isStreamingRemote = !!streamerItem;
                      const isCurrentlyWatching = !!(member.participantId && activeStreamEntry?.[0] === member.participantId);

                      return (
                        <div
                          key={member.participantId || member.socketId}
                          onClick={() => {
                            if (member.participantId && activeStreamers.has(member.participantId)) {
                              void handleWatchStream(member.participantId);
                            }
                          }}
                          className={`flex items-center gap-2.5 px-3 py-2.5 transition ${streamerItem ? 'cursor-pointer hover:bg-[#1D2129]' : ''
                            }`}
                        >
                          <div className="relative shrink-0">
                            <div className="w-7 h-7 rounded-full bg-[#1D2129] border border-[#252A34] flex items-center justify-center text-[10px] font-medium text-[#9DA5B4] uppercase">
                              {member.participantId && cameraLoadingParticipants.has(member.participantId)
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : member.identity ? member.identity.charAt(0) : 'C'}
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
            {/* ── Left Sidebar (Width: 230px, Fundo #2B2D31) ─────────────── */}
            <aside className="w-56 shrink-0 bg-[#2B2D31] flex flex-col justify-between overflow-hidden select-none border-r border-[#202225]/40">
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
                {/* 1. PARTICIPANTES Section */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#949BA4] px-1 mb-2">
                    PARTICIPANTES
                  </p>

                  <div className="space-y-1">
                    {members.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-[#949BA4]">Nenhum participante conectado</p>
                    )}
                    {members.map((member, idx) => {
                      const isSelf = member.identity === userName;
                      return (
                        <div
                          key={member.participantId || member.socketId || `${member.identity}-${idx}`}
                          className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[#35373C] transition cursor-pointer"
                        >
                          <div className="relative shrink-0">
                            <div className="w-7 h-7 rounded-full bg-[#1E1F22] flex items-center justify-center text-[11px] font-bold text-white uppercase overflow-hidden border border-white/10">
                                {member.participantId && cameraLoadingParticipants.has(member.participantId)
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : member.identity ? member.identity.charAt(0) : 'U'}
                            </div>
                            <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#23A55A] ring-2 ring-[#2B2D31]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-[#DBDEE1] truncate leading-tight">
                              {member.identity} {isSelf && <span className="text-[#949BA4] font-normal">(você)</span>}
                            </p>
                            {member.isHost && (
                              <p className="text-[10px] text-[#949BA4] font-medium leading-tight">Host</p>
                            )}
                          </div>

                          {/* Host Controls for Remote Member */}
                          {isHost && !isSelf && (
                            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 shrink-0 transition">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenTransferModal(member.participantId, member.socketId, member.identity);
                                }}
                                title="Tornar Host"
                                className="p-1 rounded hover:bg-[#404249] text-[#FEE75C]"
                              >
                                <Crown className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenKickModal(member.participantId, member.socketId, member.identity);
                                }}
                                title="Expulsar"
                                className="p-1 rounded hover:bg-[#404249] text-[#ED4245]"
                              >
                                <UserX className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2. TRANSMISSÕES Section */}
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#949BA4] px-1 mb-2">
                    TRANSMISSÕES
                  </p>

                  <div className="space-y-1">
                    {displayStreamersList.length === 0 && (
                      <p className="px-2 py-1.5 text-xs text-[#949BA4]">Nenhuma transmissão ativa</p>
                    )}
                    {displayStreamersList.map((streamer, idx) => {
                      const isSelected =
                        (selectedStreamParticipantId === streamer.id) ||
                        (focusedStreamId === streamer.id) ||
                        (idx === 0 && !selectedStreamParticipantId && !focusedStreamId);

                      return (
                        <div
                          key={streamer.id}
                          onClick={() => {
                            if (streamer.id !== 'local') {
                              void handleWatchStream(streamer.id);
                            }
                            setFocusedStreamId(streamer.id);
                          }}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition cursor-pointer ${
                            isSelected
                              ? 'bg-[#35373C] text-white shadow-sm'
                              : 'text-[#DBDEE1] hover:bg-[#35373C]/60 hover:text-white'
                          }`}
                        >
                          <div className="w-6 h-6 rounded-full bg-[#1E1F22] flex items-center justify-center text-[10px] font-bold text-white shrink-0 overflow-hidden border border-white/10">
                            {streamer.displayName.charAt(0)}
                          </div>
                          <span className="text-xs font-medium truncate flex-1">
                            {streamer.displayName} <span className="text-[11px] text-[#949BA4] font-normal">(Ao vivo)</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

            </aside>

            {/* ── Main Stage Area: StageGrid ──────────────────────────── */}
            <div className="flex-1 flex flex-col overflow-hidden bg-[#313338] relative">
              {/* Audio warning banner */}
              {audioWarningMessage && (
                <div className="mx-4 mt-3 flex flex-col gap-1.5 bg-[#FEE75C]/15 border border-[#FEE75C]/30 rounded-lg px-3.5 py-2 text-xs text-[#FEE75C] z-20">
                  <div className="flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{audioWarningMessage}</span>
                    <button onClick={() => setAudioWarningMessage(null)} className="text-[#FEE75C]/60 hover:text-[#FEE75C]">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <StageGrid
                members={members}
                currentUser={{
                  name: userName,
                  isHost: isHost,
                  participantId: myParticipantId,
                }}
                cameraStream={cameraStream}
                isCameraActive={isCameraActive}
                isCameraLoading={isCameraLoading}
                cameraLoadingParticipants={cameraLoadingParticipants}
                localStream={localStream}
                isStreaming={isStreaming}
                remoteStreams={remoteStreams}
                remoteCameraStreams={remoteCameraStreams}
                activeStreamers={activeStreamers}
                streamViewers={streamViewers}
                viewMode={stageViewMode}
                focusedStreamId={focusedStreamId}
                qualityPreset={qualityPreset}
                onWatchStream={(pid) => void handleWatchStream(pid)}
                onToggleCamera={handleToggleCamera}
                onToggleScreenShare={isStreaming ? handleStopStream : handleOpenSharePicker}
                onChangeQuality={handleQualityChange}
                onLeaveRoom={handleLeaveRoom}
                onToggleViewMode={setStageViewMode}
                onSelectFocus={setFocusedStreamId}
              />
            </div>
          </div>
        )}
      </main>

      {/* ── Watch Modal (Theatre Mode) ─────────────────────────────────── */}
      {watchModalOpen && selectedStreamParticipantId && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-150"
          onClick={(e) => { if (e.target === e.currentTarget) void handleStopWatch(); }}
        >
          <div className="relative w-full max-w-[94vw] lg:max-w-6xl max-h-[90vh] aspect-video flex items-center justify-center animate-in zoom-in-95 duration-150">
            <StreamViewer
              remoteStream={activeStreamEntry?.[1].stream || null}
              peerId={selectedStreamParticipantId}
              streamerName={activeStreamers.get(selectedStreamParticipantId)?.displayName || activeStreamEntry?.[1].displayName}
              roomId={roomId}
              memberCount={members.length}
              viewers={streamViewers.get(selectedStreamParticipantId) || []}
              onClose={() => void handleStopWatch()}
              isLoading={isStreamLoading}
              errorMessage={streamError}
              onFirstVideoFrame={handleFirstVideoFrame}
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
                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${actionModal.type === 'kick'
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
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold shadow-cta transition ${actionModal.type === 'kick'
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
      />

      {isStartingStream && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm">
          <div className="flex min-w-64 items-center gap-3 rounded-lg border border-[#252A34] bg-[#101217] px-5 py-4 shadow-card">
            <Loader2 className="h-5 w-5 animate-spin text-[#5B7CFA]" />
            <div>
              <p className="text-sm font-semibold text-[#F4F6F8]">Preparando transmissão...</p>
              <p className="mt-0.5 text-xs text-[#9DA5B4]">Conectando áudio e vídeo.</p>
            </div>
          </div>
        </div>
      )}

      {cameraErrorMessage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(event) => { if (event.target === event.currentTarget) setCameraErrorMessage(null); }}
        >
          <div className="w-full max-w-sm rounded-xl border border-[#F87171]/30 bg-[#16191F] p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#F87171]/30 bg-[#F87171]/15 text-[#F87171]">
                <VideoOff className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-[#F4F6F8]">Câmera indisponível</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#9DA5B4]">{cameraErrorMessage}</p>
              </div>
              <button
                onClick={() => setCameraErrorMessage(null)}
                title="Fechar"
                className="rounded-md p-1 text-[#687180] transition hover:bg-[#252A34] hover:text-[#F4F6F8]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 flex justify-end border-t border-[#252A34] pt-3">
              <button
                onClick={() => setCameraErrorMessage(null)}
                className="rounded-lg bg-[#5865F2] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#4752C4]"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


export default App;
