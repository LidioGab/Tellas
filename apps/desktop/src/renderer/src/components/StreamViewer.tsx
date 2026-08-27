import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Maximize, Minimize, Volume1, X } from 'lucide-react';

interface StreamViewerProps {
  remoteStream: MediaStream | null;
  peerId: string;
  streamerName?: string;
  roomId?: string;
  memberCount?: number;
  onClose?: () => void;
}

export const StreamViewer: React.FC<StreamViewerProps> = ({
  remoteStream,
  streamerName,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const [isAdjustingVolume, setIsAdjustingVolume] = useState<boolean>(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMobile = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // ─── Auto-Hide Controls Handler ───────────────────────────────────────
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);

    // Only set auto-hide timer if not actively adjusting slider and stream is active
    if (!isAdjustingVolume) {
      hideTimer.current = setTimeout(() => {
        setControlsVisible(false);
      }, isMobile ? 3500 : 2500);
    }
  }, [isAdjustingVolume, isMobile]);

  const handleMouseMove = () => {
    if (!isMobile) {
      resetHideTimer();
    }
  };

  const handleMouseLeave = () => {
    if (!isMobile && !isAdjustingVolume && !autoplayBlocked) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControlsVisible(false);
    }
  };

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
      } else if (e.key === 'Escape' && onClose && !document.fullscreenElement) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [remoteStream, isMobile, onClose]);

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
          resetHideTimer();
        })
        .catch((err) => {
          console.warn('[StreamViewer] Autoplay blocked, playing muted:', err);
          setAutoplayBlocked(true);
          setControlsVisible(true);
          if (videoRef.current) {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          }
        });
    }
  }, [remoteStream, resetHideTimer]);

  // Initial timer setup
  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [resetHideTimer]);

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
    resetHideTimer();
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
    resetHideTimer();
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
    resetHideTimer();
  };

  const handleVideoTap = (e: React.TouchEvent | React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    if (autoplayBlocked) {
      enableAudio(e);
      return;
    }

    if (controlsVisible) {
      setControlsVisible(false);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      resetHideTimer();
    }
  };

  const hasAudioTrack = remoteStream ? remoteStream.getAudioTracks().length > 0 : false;

  // Visual overlay visibility (auto-hide smooth transition)
  const isOverlayActive = controlsVisible || autoplayBlocked || isAdjustingVolume;
  const overlayVisibilityClass = isOverlayActive
    ? 'opacity-100 pointer-events-auto'
    : 'opacity-0 pointer-events-none';

  return (
    <div
      ref={videoBoxRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={!isMobile ? toggleFullscreen : undefined}
      onClick={!isMobile ? handleVideoTap : undefined}
      onTouchEnd={isMobile ? handleVideoTap : undefined}
      className={`relative w-full h-full bg-[#080A0D] flex items-center justify-center select-none overflow-hidden ${
        isFullscreen
          ? 'fixed inset-0 z-50 rounded-none'
          : 'rounded-[10px] border border-[#252A34] shadow-[0_20px_50px_rgba(0,0,0,0.40)]'
      } ${!isOverlayActive && !isMobile ? 'cursor-none' : 'cursor-default'}`}
    >
      {remoteStream ? (
        <>
          {/* Main Video Stream */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />

          {/* ─── Top Overlay: Streamer info & Close button ─── */}
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className={`absolute top-0 left-0 right-0 px-4 py-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent flex items-center justify-between z-20 transition-opacity duration-150 ${overlayVisibilityClass}`}
          >
            {/* Streamer Name & Discreet Live Dot */}
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-[#F4F6F8] tracking-tight">
                {streamerName || 'Streamer'}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#D5D9E0]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F87171]"></span>
                Ao vivo
              </span>
            </div>

            {/* Discreet Close Button */}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar transmissão"
                title="Fechar (Esc)"
                className="w-8 h-8 rounded-md bg-[#0F1115]/70 hover:bg-[#1C1F25]/90 border border-white/[0.08] flex items-center justify-center text-[#B2B8C3] hover:text-white transition touch-manipulation focus:outline-none focus:ring-1 focus:ring-[#5B7CFA]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* ─── Contextual Autoplay Blocked Alert ─── */}
          {autoplayBlocked && (
            <div className="absolute inset-0 bg-black/75 flex flex-col items-center justify-center gap-3 p-4 z-30 animate-in fade-in duration-150">
              <button
                type="button"
                onTouchEnd={(e) => { e.stopPropagation(); enableAudio(e); }}
                onClick={(e) => { e.stopPropagation(); enableAudio(e); }}
                className="px-4 py-2 rounded-md bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] text-white font-medium text-xs shadow-cta transition cursor-pointer z-40 touch-manipulation flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#5B7CFA]"
              >
                <Volume1 className="w-4 h-4" />
                Ativar áudio
              </button>
            </div>
          )}

          {/* ─── Bottom Overlay: Integrated Volume & Fullscreen Controls ─── */}
          <div
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className={`absolute bottom-0 left-0 right-0 px-4 py-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between z-20 transition-opacity duration-150 ${overlayVisibilityClass}`}
          >
            {/* Left: Volume Toggle & Thin Slider */}
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onTouchEnd={(e) => { e.stopPropagation(); toggleMute(e); }}
                onClick={toggleMute}
                aria-label={isMuted || volume === 0 ? 'Ativar áudio' : 'Desativar áudio'}
                title={isMuted || volume === 0 ? 'Ativar áudio' : 'Desativar áudio'}
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#D6DAE1] hover:text-white hover:bg-white/[0.08] transition touch-manipulation focus:outline-none focus:ring-1 focus:ring-[#5B7CFA]"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-[18px] h-[18px] text-[#F87171]" />
                ) : (
                  <Volume2 className="w-[18px] h-[18px]" />
                )}
              </button>

              <div className="flex items-center">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  onMouseDown={() => setIsAdjustingVolume(true)}
                  onMouseUp={() => {
                    setIsAdjustingVolume(false);
                    resetHideTimer();
                  }}
                  onTouchStart={() => setIsAdjustingVolume(true)}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    setIsAdjustingVolume(false);
                    resetHideTimer();
                  }}
                  aria-label="Controle de volume"
                  className="w-20 sm:w-28 accent-[#5B7CFA] cursor-pointer touch-manipulation focus:outline-none"
                  style={{ height: '3px' }}
                />
              </div>
            </div>

            {/* Right: Fullscreen Button */}
            <button
              type="button"
              onTouchEnd={(e) => { e.stopPropagation(); toggleFullscreen(e); }}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Entrar em tela cheia'}
              title={isFullscreen ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[#D6DAE1] hover:text-white hover:bg-white/[0.08] transition touch-manipulation focus:outline-none focus:ring-1 focus:ring-[#5B7CFA]"
            >
              {isFullscreen ? (
                <Minimize className="w-[18px] h-[18px]" />
              ) : (
                <Maximize className="w-[18px] h-[18px]" />
              )}
            </button>
          </div>
        </>
      ) : (
        /* Discreet Loading / Waiting for Stream */
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-xs font-medium text-[#737C8A]">
            Carregando transmissão...
          </p>
        </div>
      )}
    </div>
  );
};
