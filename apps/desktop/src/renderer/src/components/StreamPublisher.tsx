import React, { useEffect, useRef, useState } from 'react';
import { Radio, Volume2, StopCircle, Settings, Maximize, Minimize } from 'lucide-react';
import type { DesktopSource, VideoQualityPreset } from '@stream-app/shared';

interface StreamPublisherProps {
  source: DesktopSource | null;
  localStream: MediaStream | null;
  qualityPreset: VideoQualityPreset;
  streamerName?: string;
  onStopStream: () => void;
  onChangeSource: () => void;
}

export const StreamPublisher: React.FC<StreamPublisherProps> = ({
  source,
  localStream,
  qualityPreset,
  streamerName,
  onStopStream,
  onChangeSource
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const hasAudio = localStream ? localStream.getAudioTracks().length > 0 : false;

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

  const getResolutionLabel = (): string => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        if (settings.width && settings.height) {
          const fps = settings.frameRate ? Math.round(settings.frameRate) : qualityPreset.frameRate;
          return `${settings.width}×${settings.height} @ ${fps}fps`;
        }
      }
    }
    return qualityPreset.label;
  };

  return (
    <div className="flex flex-col h-full bg-[#2B2D31] rounded-xl p-3 overflow-hidden border border-[#1E1F22] shadow-sm">
      {/* Streamer Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#35373C]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#DA373C] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#DA373C]"></span>
          </span>
          <div>
            <h3 className="font-bold text-[#F2F3F5] text-xs flex items-center gap-1">
              Sua Transmissão
              <span className="text-[9px] uppercase font-bold bg-[#DA373C] text-white px-1 py-0.2 rounded">
                LIVE
              </span>
            </h3>
            <p className="text-[10px] text-[#949BA4] truncate max-w-[200px]">
              {source ? source.name : 'Tela Principal'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onChangeSource}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#35373C] hover:bg-[#404249] text-[11px] font-semibold text-[#DBDEE1] transition"
          >
            <Settings className="w-3 h-3" />
            Fonte
          </button>
          <button
            onClick={onStopStream}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#DA373C] hover:bg-[#BE2F34] text-[11px] font-semibold text-white transition shadow-sm"
          >
            <StopCircle className="w-3 h-3" />
            Parar
          </button>
        </div>
      </div>

      {/* Pure Video Box (Fullscreen target in F11) */}
      <div
        ref={videoBoxRef}
        onDoubleClick={toggleFullscreen}
        className="relative flex-1 bg-black rounded-lg mt-2 overflow-hidden flex items-center justify-center border border-[#1E1F22] group select-none cursor-pointer"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />

        {/* Top-Left Streamer Name Pill */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-[#1E1F22]/85 backdrop-blur-md px-2.5 py-1 rounded-lg border border-white/10 shadow-lg pointer-events-none z-20 transition-opacity duration-200">
          <div className="w-5 h-5 rounded-full bg-[#5865F2] flex items-center justify-center text-[10px] font-bold text-white uppercase shadow-sm">
            {streamerName ? streamerName.charAt(0) : 'V'}
          </div>
          <span className="text-xs font-bold text-[#F2F3F5] truncate max-w-[160px]">
            {streamerName || 'Você'} <span className="text-[10px] text-[#949BA4] font-normal">(Você)</span>
          </span>
          <span className="text-[9px] uppercase font-extrabold bg-[#DA373C] text-white px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
            AO VIVO
          </span>
        </div>

        {/* Floating Controls Overlay (Discrete on Hover) */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-between z-20"
        >
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[10px] text-[#23A55A] font-semibold bg-black/40 px-1.5 py-0.5 rounded">
              <Radio className="w-2.5 h-2.5 animate-pulse" />
              {getResolutionLabel()}
            </span>
            <span className={`flex items-center gap-1 text-[10px] font-medium bg-black/40 px-1.5 py-0.5 rounded ${hasAudio ? 'text-[#5865F2]' : 'text-[#949BA4]'}`}>
              <Volume2 className="w-2.5 h-2.5" />
              {hasAudio ? 'Áudio Ativo' : 'Sem Áudio'}
            </span>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-1 text-[#DBDEE1] hover:text-white rounded hover:bg-white/15 bg-black/40 transition"
            title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia (Duplo clique)'}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
