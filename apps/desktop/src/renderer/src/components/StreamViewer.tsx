import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Maximize, Minimize, Volume1, Tv } from 'lucide-react';

interface StreamViewerProps {
  remoteStream: MediaStream | null;
  peerId: string;
  streamerName?: string;
}

export const StreamViewer: React.FC<StreamViewerProps> = ({ remoteStream, streamerName }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Keyboard shortcut 'F' for fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'f' || e.key === 'F') && remoteStream && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        toggleFullscreen();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [remoteStream]);

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
          console.warn('Autoplay with audio blocked by browser, playing muted until user click:', err);
          setAutoplayBlocked(true);
          if (videoRef.current) {
            videoRef.current.muted = true;
            videoRef.current.play().catch(() => {});
          }
        });
    }
  }, [remoteStream]);

  const enableAudio = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAutoplayBlocked(false);
    setIsMuted(false);
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.volume = volume > 0 ? volume : 1;
      videoRef.current.play().catch((err) => {
        console.warn('User click play unmuted:', err);
      });
    }
  };

  const toggleMute = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (videoRef.current) {
      const nextMuted = !isMuted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
      setAutoplayBlocked(false);
      if (!nextMuted) {
        videoRef.current.play().catch(() => {});
      }
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
      if (val > 0) {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  const toggleFullscreen = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (videoBoxRef.current) {
      if (!document.fullscreenElement) {
        videoBoxRef.current.requestFullscreen().catch((err) => console.error(err));
      } else {
        document.exitFullscreen().catch((err) => console.error(err));
      }
    }
  };

  const hasAudioTrack = remoteStream ? remoteStream.getAudioTracks().length > 0 : false;

  return (
    <div
      onClick={enableAudio}
      className="relative flex flex-col h-full bg-[#2B2D31] rounded-xl overflow-hidden border border-[#1E1F22] shadow-sm"
    >
      {/* Pure Video Box (Fullscreen target in F11) */}
      <div
        ref={videoBoxRef}
        onDoubleClick={toggleFullscreen}
        className="relative flex-1 bg-black flex items-center justify-center group select-none overflow-hidden cursor-pointer"
      >
        {remoteStream ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />

            {/* Top-Left Streamer Name Pill (Discord Style) */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-[#1E1F22]/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 shadow-lg pointer-events-none z-20 transition-opacity duration-200">
              <div className="w-5 h-5 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-sm">
                {streamerName ? streamerName.charAt(0) : 'S'}
              </div>
              <span className="text-xs font-bold text-[#F2F3F5] truncate max-w-[160px]">
                {streamerName || 'Streamer'}
              </span>
              <span className="text-[9px] uppercase font-extrabold bg-[#DA373C] text-white px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                AO VIVO
              </span>
            </div>

            {/* Autoplay Unmute Overlay Banner */}
            {autoplayBlocked && (
              <div
                onClick={enableAudio}
                className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center gap-3 p-6 z-30 animate-in fade-in duration-200"
              >
                <div className="w-12 h-12 rounded-full bg-[#5865F2]/20 border border-[#5865F2] flex items-center justify-center text-[#5865F2] animate-pulse">
                  <Volume1 className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-[#F2F3F5]">Clique para Ativar o Áudio</h3>
                <p className="text-xs text-[#949BA4] max-w-xs text-center">
                  O navegador pausou a saída de som automática. Clique para ouvir!
                </p>
                <button
                  type="button"
                  onClick={enableAudio}
                  className="mt-1 px-4 py-1.5 rounded-md bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-xs shadow-md transition cursor-pointer z-40"
                >
                  🔊 Ouvir Áudio Agora
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#1E1F22] flex items-center justify-center text-[#5865F2] mb-3">
              <Tv className="w-6 h-6 animate-pulse" />
            </div>
            <h4 className="text-sm font-bold text-[#F2F3F5]">Aguardando transmissão...</h4>
            <p className="text-xs text-[#949BA4] max-w-xs mt-1">
              O streamer ainda não iniciou o compartilhamento da tela nesta sala.
            </p>
          </div>
        )}

        {/* Video Control Bar Overlay */}
        {remoteStream && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 left-0 right-0 px-4 py-2.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-between z-20"
          >
            {/* Left: Volume & Mute */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="p-1 text-[#DBDEE1] hover:text-white rounded hover:bg-white/10 transition"
                title={isMuted ? 'Desmutar' : 'Mutar'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-[#DA373C]" />
                ) : (
                  <Volume2 className="w-4 h-4 text-[#23A55A]" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                className="w-16 accent-[#5865F2] cursor-pointer h-1"
              />

              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded bg-black/40 ${
                  hasAudioTrack ? 'text-[#23A55A]' : 'text-[#949BA4]'
                }`}
              >
                {hasAudioTrack ? 'Áudio ON' : 'Sem Áudio'}
              </span>
            </div>

            {/* Right: Discrete Compact Fullscreen Button */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={toggleFullscreen}
                className="p-1.5 text-[#DBDEE1] hover:text-white rounded hover:bg-white/15 bg-black/40 transition"
                title={isFullscreen ? 'Sair da Tela Cheia (F / Esc)' : 'Tela Cheia (F / Duplo clique)'}
              >
                {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
