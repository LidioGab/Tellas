import React, { useEffect, useState } from 'react';
import { DesktopSource } from '@stream-app/shared';
import { Monitor, Layout, X, RefreshCw, ScreenShare } from 'lucide-react';

interface SourcePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (source: DesktopSource) => void;
  onSelectNativeDisplayMedia: () => void;
}

export const SourcePickerModal: React.FC<SourcePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectSource,
  onSelectNativeDisplayMedia
}) => {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'screen' | 'window'>('all');
  const [loading, setLoading] = useState<boolean>(false);
  const [isElectron, setIsElectron] = useState<boolean>(false);

  const fetchSources = async () => {
    if (typeof window !== 'undefined' && window.electronAPI && typeof window.electronAPI.getSources === 'function') {
      setIsElectron(true);
      setLoading(true);
      try {
        const availableSources = await window.electronAPI.getSources();
        setSources(availableSources || []);
      } catch (err) {
        console.error('Failed to fetch Electron desktop sources:', err);
      } finally {
        setLoading(false);
      }
    } else {
      setIsElectron(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchSources();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredSources = sources.filter((s) => {
    if (activeTab === 'screen') return s.id.startsWith('screen');
    if (activeTab === 'window') return s.id.startsWith('window');
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-[#101217] rounded-xl p-6 shadow-card flex flex-col max-h-[85vh] border border-[#252A34] animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#252A34]">
          <div>
            <h2 className="text-base font-semibold text-[#F4F6F8] flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[#5B7CFA]" />
              Compartilhar Tela
            </h2>
            <p className="text-xs text-[#9DA5B4] mt-0.5">
              Escolha uma tela inteira ou janela de aplicativo.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {isElectron && (
              <button
                onClick={fetchSources}
                disabled={loading}
                className="p-1.5 text-[#9DA5B4] hover:text-[#F4F6F8] rounded-md hover:bg-[#16191F] border border-transparent hover:border-[#252A34] transition"
                title="Atualizar fontes"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-[#9DA5B4] hover:text-[#F4F6F8] rounded-md hover:bg-[#16191F] border border-transparent hover:border-[#252A34] transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs & Native Selection */}
        <div className="flex items-center justify-between my-3 gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-[#16191F] p-0.5 rounded-lg border border-[#252A34]">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                activeTab === 'all'
                  ? 'bg-[#1D2129] text-[#F4F6F8] shadow-subtle border border-[#323846]'
                  : 'text-[#9DA5B4] hover:text-[#F4F6F8]'
              }`}
            >
              Todas ({sources.length})
            </button>
            <button
              onClick={() => setActiveTab('screen')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition ${
                activeTab === 'screen'
                  ? 'bg-[#1D2129] text-[#F4F6F8] shadow-subtle border border-[#323846]'
                  : 'text-[#9DA5B4] hover:text-[#F4F6F8]'
              }`}
            >
              <Monitor className="w-3 h-3" />
              Telas Inteiras
            </button>
            <button
              onClick={() => setActiveTab('window')}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition ${
                activeTab === 'window'
                  ? 'bg-[#1D2129] text-[#F4F6F8] shadow-subtle border border-[#323846]'
                  : 'text-[#9DA5B4] hover:text-[#F4F6F8]'
              }`}
            >
              <Layout className="w-3 h-3" />
              Janelas
            </button>
          </div>

          <button
            onClick={onSelectNativeDisplayMedia}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] text-xs font-medium transition"
          >
            <ScreenShare className="w-3.5 h-3.5 text-[#5B7CFA]" />
            Seletor do Windows
          </button>
        </div>

        {/* Source Grid */}
        <div className="flex-1 overflow-y-auto pr-1 my-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <RefreshCw className="w-5 h-5 text-[#5B7CFA] animate-spin" />
              <p className="text-xs text-[#687180]">Buscando janelas e monitores...</p>
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-6 bg-[#16191F] rounded-xl border border-[#252A34]">
              <Monitor className="w-8 h-8 text-[#687180] mb-2" />
              <h3 className="text-xs font-semibold text-[#F4F6F8]">Nenhuma fonte encontrada</h3>
              <p className="text-xs text-[#687180] max-w-sm mt-1 mb-3">
                Você pode utilizar o seletor nativo do sistema operacional.
              </p>
              <button
                onClick={onSelectNativeDisplayMedia}
                className="px-3.5 py-1.5 rounded-md bg-[#5B7CFA] hover:bg-[#6C89FF] text-white font-medium text-xs shadow-cta transition"
              >
                Abrir Seletor do Windows
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filteredSources.map((source) => (
                <div
                  key={source.id}
                  onClick={() => onSelectSource(source)}
                  className="group relative flex flex-col bg-[#16191F] hover:bg-[#1D2129] rounded-lg p-2 border border-[#252A34] hover:border-[#5B7CFA] cursor-pointer transition-all duration-150 transform hover:-translate-y-0.5 shadow-subtle"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full bg-[#0B0D10] rounded overflow-hidden flex items-center justify-center border border-black/40">
                    {source.thumbnail ? (
                      <img
                        src={source.thumbnail}
                        alt={source.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Monitor className="w-6 h-6 text-[#5B7CFA]" />
                    )}

                    <div className="absolute inset-0 bg-[#5B7CFA]/0 group-hover:bg-[#5B7CFA]/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 bg-[#5B7CFA] text-white font-medium text-[11px] px-2.5 py-0.5 rounded shadow-cta transition-opacity duration-150">
                        Transmitir
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <div className="mt-1.5 flex items-center gap-1.5 px-0.5">
                    {source.id.startsWith('screen') ? (
                      <Monitor className="w-3 h-3 text-[#5B7CFA] shrink-0" />
                    ) : (
                      <Layout className="w-3 h-3 text-[#34D399] shrink-0" />
                    )}
                    <span className="text-xs font-medium text-[#9DA5B4] truncate group-hover:text-[#F4F6F8]">
                      {source.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 mt-2 border-t border-[#252A34] flex items-center justify-between text-xs text-[#687180]">
          <span>O áudio do Discord é isolado automaticamente pelo WASAPI nativo.</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] font-medium transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
