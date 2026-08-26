import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Maximize, Minimize, Volume1, Tv, Radio, Users, Copy, Check } from 'lucide-react';

interface StreamViewerProps {
  remoteStream: MediaStream | null;
  peerId: string;
  streamerName?: string;
  roomId?: string;
  memberCount?: number;
}

export const StreamViewer: React.FC<StreamViewerProps> = ({
  remoteStream,
  streamerName,
  roomId,
  memberCount = 1
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMobile = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // ─── Fullscreen change listener ───────────────────────────────────────
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // ─── Keyboard shortcut F ─────────────────────────────────────────────
  useEffect(() => {
    if (isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === 'f' || e.key === 'F') &&
        remoteStream &&
        !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)
      ) {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [remoteStream, isMobile]);

  // ─── Attach stream to video element ─────────────────────────────────
  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.muted = false;
      videoRef.current
        .play()
        .then(() => {
          setAutoplayBlocked(false);
          setIsMuted(false);
        })
        .catch((err) => {
          console.warn('[StreamViewer] Autoplay blocked, playing muted:', err);
          setAutoplayBlocked(true);
          if (videoRef.current) {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          }
        });
    }
  }, [remoteStream]);

  // ─── Actions ─────────────────────────────────────────────────────────

  const enableAudio = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.stopPropagation();
    setAutoplayBlocked(false);
    setIsMuted(false);
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.volume = volume > 0 ? volume : 1;
      videoRef.current.play().catch(() => {});
    }
  };

  const toggleMute = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.stopPropagation();
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
      setAutoplayBlocked(false);
      if (!nextMuted) videoRef.current.play().catch(() => {});
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const val = parseFloat(e.target.value);
    setVolume(val);
    setAutoplayBlocked(false);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
      if (val > 0) videoRef.current.play().catch(() => {});
    }
  };

  const toggleFullscreen = (e?: React.MouseEvent | React.TouchEvent) => {
    if (e) e.stopPropagation();
    if (!videoBoxRef.current) return;
    if (!document.fullscreenElement) {
      videoBoxRef.current.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  };

  // ─── Tap to toggle controls with 3.5s auto-hide ───────────────────────
  const showControlsTemporarily = () => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), 3500);
  };

  const handleVideoTap = (e: React.TouchEvent | React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    if (autoplayBlocked) {
      enableAudio(e);
      showControlsTemporarily();
      return;
    }

    if (controlsVisible) {
      setControlsVisible(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      showControlsTemporarily();
    }
  };

  const handleCopyRoom = () => {
    if (roomId) {
      navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const hasAudioTrack = remoteStream ? remoteStream.getAudioTracks().length > 0 : false;

  // On desktop: show controls on hover. On mobile: show on tap or in fullscreen.
  const overlayClass = isMobile
    ? `transition-opacity duration-200 ${controlsVisible || isFullscreen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`
    : 'opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto';

  return (
    <div className={`flex flex-col ${isFullscreen ? 'h-full w-full' : 'w-full h-full max-w-6xl mx-auto'} ${isMobile && !isFullscreen ? 'justify-start gap-3' : 'justify-center items-center'}`}>
      {/* ─── 16:9 Dedicated Video Player Monitor ─── */}
      <div
        ref={videoBoxRef}
        onDoubleClick={!isMobile ? toggleFullscreen : undefined}
        onClick={!isMobile ? handleVideoTap : undefined}
        onTouchEnd={isMobile ? handleVideoTap : undefined}
        className={`relative w-full ${
          isFullscreen
            ? 'h-full max-w-none rounded-none'
            : 'aspect-video sm:aspect-auto sm:h-full max-h-[80vh] rounded-2xl border border-[#1E1F22] shadow-2xl'
        } bg-black flex items-center justify-center group select-none overflow-hidden cursor-pointer`}
      >
        {remoteStream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />

            {/* Top-Left: Streamer & Live Indicator */}
            <div className={`absolute top-2.5 left-2.5 sm:top-3 sm:left-3 flex items-center gap-1.5 bg-[#1E1F22]/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 shadow-lg pointer-events-none z-20 transition-opacity duration-200 ${isMobile && !controlsVisible && !autoplayBlocked && !isFullscreen ? 'opacity-70' : 'opacity-100'}`}>
              <div className="w-5 h-5 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-sm">
                {streamerName ? streamerName.charAt(0) : 'S'}
              </div>
              <span className="text-xs font-bold text-[#F2F3F5] truncate max-w-[110px] sm:max-w-[160px]">
                {streamerName || 'Streamer'}
              </span>
              <span className="text-[9px] uppercase font-extrabold bg-[#DA373C] text-white px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                AO VIVO
              </span>
            </div>

            {/* Center: Autoplay Blocked Alert */}
            {autoplayBlocked && (
              <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-4 z-30 animate-in fade-in duration-200">
                <div className="w-12 h-12 rounded-full bg-[#5865F2]/20 border border-[#5865F2] flex items-center justify-center text-[#5865F2] animate-pulse">
                  <Volume1 className="w-6 h-6" />
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-bold text-[#F2F3F5]">Toque para Ouvir o Áudio</h3>
                  <p className="text-xs text-[#949BA4] mt-0.5 max-w-xs">
                    O navegador bloqueou a reprodução automática do som.
                  </p>
                </div>
                <button
                  type="button"
                  onTouchEnd={(e) => { e.stopPropagation(); enableAudio(e); }}
                  onClick={(e) => { e.stopPropagation(); enableAudio(e); }}
                  className="mt-1 px-5 py-2 rounded-xl bg-[#5865F2] hover:bg-[#4752C4] active:bg-[#3C45A5] text-white font-bold text-xs shadow-lg transition cursor-pointer z-40 touch-manipulation flex items-center gap-1.5"
                >
                  <Volume2 className="w-4 h-4" />
                  Ativar Áudio Agora
                </button>
              </div>
            )}

            {/* Integrated Player Controls Bar (Bottom of Video Monitor) */}
            <div
              onClick={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              className={`absolute bottom-0 left-0 right-0 px-3 sm:px-4 py-2.5 bg-gradient-to-t from-black/90 via-black/50 to-transparent flex items-center justify-between z-20 ${overlayClass}`}
            >
              {/* Left: Volume Controls */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onTouchEnd={(e) => { e.stopPropagation(); toggleMute(e); }}
                  onClick={toggleMute}
                  className="p-2 text-[#DBDEE1] hover:text-white rounded-full hover:bg-white/15 bg-black/40 transition touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center"
                  title={isMuted ? 'Desmutar' : 'Mutar'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-5 h-5 text-[#DA373C]" />
                  ) : (
                    <Volume2 className="w-5 h-5 text-[#23A55A]" />
                  )}
                </button>

                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={handleVolumeChange}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="w-16 sm:w-24 accent-[#5865F2] cursor-pointer touch-manipulation"
                  style={{ height: '4px' }}
                />

                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded bg-black/50 border border-white/10 ${hasAudioTrack ? 'text-[#23A55A]' : 'text-[#949BA4]'}`}>
                  {hasAudioTrack ? 'Áudio ON' : 'Sem Áudio'}
                </span>
              </div>

              {/* Right: Fullscreen Toggle */}
              <button
                type="button"
                onTouchEnd={(e) => { e.stopPropagation(); toggleFullscreen(e); }}
                onClick={toggleFullscreen}
                className="p-2 text-[#DBDEE1] hover:text-white rounded-lg hover:bg-white/15 bg-black/40 border border-white/10 transition touch-manipulation min-w-[36px] min-h-[36px] flex items-center justify-center"
                title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
              >
                {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </button>
            </div>
          </>
        ) : (
          /* Waiting for stream state */
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#1E1F22] flex items-center justify-center text-[#5865F2] mb-3 shadow-inner">
              <Tv className="w-6 h-6 animate-pulse" />
            </div>
            <h4 className="text-sm font-bold text-[#F2F3F5]">Aguardando transmissão...</h4>
            <p className="text-xs text-[#949BA4] max-w-xs mt-1">
              O streamer ainda não iniciou o compartilhamento de tela nesta sala.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
