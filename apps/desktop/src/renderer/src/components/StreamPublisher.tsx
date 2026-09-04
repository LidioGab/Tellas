import React, { useEffect, useRef, useState } from 'react';
import { Radio, Volume2, StopCircle, Settings, Maximize, Minimize } from 'lucide-react';
import type { DesktopSource, StreamViewerInfo, VideoQualityPreset } from '@stream-app/shared';
import { ViewerPresence } from './ViewerPresence';

interface StreamPublisherProps {
  source: DesktopSource | null;
  localStream: MediaStream | null;
  qualityPreset: VideoQualityPreset;
  streamerName?: string;
  onStopStream: () => void;
  onChangeSource: () => void;
  viewers?: StreamViewerInfo[];
}

export const StreamPublisher: React.FC<StreamPublisherProps> = ({
  source,
  localStream,
  qualityPreset,
  streamerName,
  onStopStream,
  onChangeSource,
  viewers = [],
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
    <div className="flex flex-col h-full bg-[#101217] rounded-xl p-3 overflow-hidden border border-[#252A34] shadow-card">
      {/* Streamer Header */}
      <div className="flex items-center justify-between pb-2.5 border-b border-[#252A34]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#F87171] shrink-0" />
          <div>
            <h3 className="font-semibold text-[#F4F6F8] text-xs flex items-center gap-1.5">
              Sua Transmissão
              <span className="text-[10px] uppercase font-bold text-[#F87171] bg-[#F87171]/10 border border-[#F87171]/20 px-1.5 py-0.5 rounded">
                Ao Vivo
              </span>
            </h3>
            <p className="text-[11px] text-[#687180] truncate max-w-[200px]">
              {source ? source.name : 'Tela Principal'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <ViewerPresence viewers={viewers} />
          <button
            onClick={onChangeSource}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] text-xs font-medium text-[#9DA5B4] hover:text-[#F4F6F8] transition"
          >
            <Settings className="w-3 h-3" />
            Fonte
          </button>
          <button
            onClick={onStopStream}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F87171]/10 hover:bg-[#F87171]/20 border border-[#F87171]/20 text-xs font-medium text-[#F87171] transition"
          >
            <StopCircle className="w-3 h-3" />
            Parar
          </button>
        </div>
      </div>

      {/* Pure Video Box */}
      <div
        ref={videoBoxRef}
        onDoubleClick={toggleFullscreen}
        className="relative flex-1 bg-black rounded-lg mt-2.5 overflow-hidden flex items-center justify-center border border-[#252A34] group select-none cursor-pointer"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-contain"
        />

        {/* Top-Left Streamer Name Pill */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-[#101217]/90 backdrop-blur-md px-2.5 py-1 rounded-md border border-[#252A34] shadow-subtle pointer-events-none z-20 transition-opacity duration-200">
          <div className="w-5 h-5 rounded-full bg-[#5B7CFA] flex items-center justify-center text-[10px] font-bold text-white uppercase">
            {streamerName ? streamerName.charAt(0) : 'V'}
          </div>
          <span className="text-xs font-medium text-[#F4F6F8] truncate max-w-[160px]">
            {streamerName || 'Você'} <span className="text-[11px] text-[#687180] font-normal">(Você)</span>
          </span>
          <span className="text-[9px] uppercase font-bold text-[#F87171] bg-[#F87171]/10 border border-[#F87171]/20 px-1 py-0.5 rounded flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#F87171]"></span>
            Ao Vivo
          </span>
        </div>

        {/* Floating Controls Overlay */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-between z-20"
        >
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] text-[#34D399] font-medium bg-[#101217]/80 border border-[#252A34] px-2 py-0.5 rounded">
              <Radio className="w-3 h-3" />
              {getResolutionLabel()}
            </span>
            <span className={`flex items-center gap-1 text-[11px] font-medium bg-[#101217]/80 border border-[#252A34] px-2 py-0.5 rounded ${hasAudio ? 'text-[#5B7CFA]' : 'text-[#687180]'}`}>
              <Volume2 className="w-3 h-3" />
              {hasAudio ? 'Áudio Ativo' : 'Sem Áudio'}
            </span>
          </div>

          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-[#9DA5B4] hover:text-[#F4F6F8] rounded-md hover:bg-white/10 bg-black/40 transition"
            title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia (Duplo clique)'}
          >
            {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
