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
        console.log('[SourcePicker] Received desktop sources:', availableSources);
        setSources(availableSources || []);
      } catch (err) {
        console.error('Failed to fetch Electron desktop sources:', err);
      } finally {
        setLoading(false);
      }
    } else {
      setIsElectron(false);
      console.warn('Electron API not detected. Browser fallback active.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-[#313338] rounded-2xl p-6 shadow-2xl flex flex-col max-h-[85vh] border border-[#1E1F22] animate-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#3F4147]">
          <div>
            <h2 className="text-lg font-bold text-[#F2F3F5] flex items-center gap-2">
              <Monitor className="w-5 h-5 text-[#5865F2]" />
              Compartilhar sua Tela
            </h2>
            <p className="text-xs text-[#949BA4] mt-0.5">
              Escolha uma tela inteira, jogo ou janela de aplicativo.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {isElectron && (
              <button
                onClick={fetchSources}
                disabled={loading}
                className="p-1.5 text-[#949BA4] hover:text-white rounded-lg hover:bg-[#35373C] transition"
                title="Atualizar fontes"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-[#949BA4] hover:text-white rounded-lg hover:bg-[#35373C] transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tabs & Native Selection */}
        <div className="flex items-center justify-between my-3 gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                activeTab === 'all'
                  ? 'bg-[#5865F2] text-white shadow-sm'
                  : 'bg-[#2B2D31] text-[#949BA4] hover:text-[#DBDEE1]'
              }`}
            >
              Todas ({sources.length})
            </button>
            <button
              onClick={() => setActiveTab('screen')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                activeTab === 'screen'
                  ? 'bg-[#5865F2] text-white shadow-sm'
                  : 'bg-[#2B2D31] text-[#949BA4] hover:text-[#DBDEE1]'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              Telas Inteiras
            </button>
            <button
              onClick={() => setActiveTab('window')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition ${
                activeTab === 'window'
                  ? 'bg-[#5865F2] text-white shadow-sm'
                  : 'bg-[#2B2D31] text-[#949BA4] hover:text-[#DBDEE1]'
              }`}
            >
              <Layout className="w-3.5 h-3.5" />
              Janelas de Aplicativos
            </button>
          </div>

          <button
            onClick={onSelectNativeDisplayMedia}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#35373C] hover:bg-[#404249] text-[#F2F3F5] text-xs font-semibold transition"
          >
            <ScreenShare className="w-3.5 h-3.5 text-[#5865F2]" />
            Seletor Nativo do Windows
          </button>
        </div>

        {/* Source Grid */}
        <div className="flex-1 overflow-y-auto pr-1 my-1">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <RefreshCw className="w-6 h-6 text-[#5865F2] animate-spin" />
              <p className="text-xs text-[#949BA4]">Buscando janelas e monitores...</p>
            </div>
          ) : filteredSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center p-6 bg-[#2B2D31] rounded-xl border border-[#1E1F22]">
              <Monitor className="w-10 h-10 text-[#5865F2] mb-2" />
              <h3 className="text-sm font-bold text-[#F2F3F5]">Nenhuma fonte encontrada</h3>
              <p className="text-xs text-[#949BA4] max-w-sm mt-1 mb-3">
                Não foi possível listar as janelas via Electron. Você pode utilizar o seletor nativo do sistema operacional.
              </p>
              <button
                onClick={onSelectNativeDisplayMedia}
                className="px-4 py-2 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold text-xs shadow-md transition"
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
                  className="group relative flex flex-col bg-[#2B2D31] hover:bg-[#35373C] rounded-xl p-2.5 border border-[#1E1F22] hover:border-[#5865F2] cursor-pointer transition-all duration-150 transform hover:-translate-y-0.5 shadow-sm"
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full bg-[#111214] rounded-lg overflow-hidden flex items-center justify-center border border-black/30">
                    {source.thumbnail ? (
                      <img
                        src={source.thumbnail}
                        alt={source.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Monitor className="w-8 h-8 text-[#5865F2]" />
                    )}

                    <div className="absolute inset-0 bg-[#5865F2]/0 group-hover:bg-[#5865F2]/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 bg-[#5865F2] text-white font-bold text-xs px-3 py-1 rounded-md shadow-lg transition-opacity duration-150">
                        Transmitir
                      </span>
                    </div>
                  </div>

                  {/* Title */}
                  <div className="mt-2 flex items-center gap-1.5 px-0.5">
                    {source.id.startsWith('screen') ? (
                      <Monitor className="w-3.5 h-3.5 text-[#5865F2] flex-shrink-0" />
                    ) : (
                      <Layout className="w-3.5 h-3.5 text-[#23A55A] flex-shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-[#F2F3F5] truncate group-hover:text-white">
                      {source.name}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 mt-2 border-t border-[#3F4147] flex items-center justify-between text-xs text-[#949BA4]">
          <span>💡 O som do Discord será isolado automaticamente pelo WASAPI nativo.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-[#35373C] hover:bg-[#404249] text-[#F2F3F5] font-semibold transition"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};
