import React, { useEffect, useMemo, useState } from 'react';
import { DesktopSource } from '@stream-app/shared';
import { Layout, Monitor, RefreshCw, X } from 'lucide-react';

interface SourcePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSource: (source: DesktopSource) => void;
}

export const SourcePickerModal: React.FC<SourcePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectSource,
}) => {
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'screen' | 'window'>('all');
  const [loading, setLoading] = useState(false);

  const fetchSources = async () => {
    if (!window.electronAPI?.getSources) return;
    setLoading(true);
    try {
      setSources(await window.electronAPI.getSources());
    } catch (error) {
      console.error('[SourcePickerModal] Failed to fetch desktop sources:', error);
      setSources([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) void fetchSources();
  }, [isOpen]);

  const filteredSources = useMemo(() => sources.filter((source) => {
    if (activeTab === 'screen') return source.id.startsWith('screen');
    if (activeTab === 'window') return source.id.startsWith('window');
    return true;
  }), [activeTab, sources]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-[#101217] rounded-xl p-6 shadow-card flex flex-col max-h-[85vh] border border-[#252A34] animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-[#252A34]">
          <div>
            <h2 className="text-base font-semibold text-[#F4F6F8] flex items-center gap-2">
              <Monitor className="w-4 h-4 text-[#5B7CFA]" />
              Compartilhar Tela
            </h2>
            <p className="text-xs text-[#9DA5B4] mt-0.5">Escolha uma tela inteira ou janela de aplicativo.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void fetchSources()}
              disabled={loading}
              className="p-1.5 text-[#9DA5B4] hover:text-[#F4F6F8] rounded-md hover:bg-[#16191F] border border-transparent hover:border-[#252A34] transition"
              title="Atualizar fontes"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button onClick={onClose} className="p-1.5 text-[#9DA5B4] hover:text-[#F4F6F8] rounded-md hover:bg-[#16191F] transition" aria-label="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-[#16191F] p-0.5 rounded-lg border border-[#252A34] my-3 self-start">
          {([
            ['all', `Todas (${sources.length})`, Monitor],
            ['screen', 'Telas inteiras', Monitor],
            ['window', 'Janelas', Layout],
          ] as const).map(([tab, label, Icon]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition ${activeTab === tab
                ? 'bg-[#1D2129] text-[#F4F6F8] shadow-subtle border border-[#323846]'
                : 'text-[#9DA5B4] hover:text-[#F4F6F8]'
                }`}
            >
              <Icon className="w-3 h-3" />
              {label}
            </button>
          ))}
        </div>

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
              <p className="text-xs text-[#687180] mt-1">Atualize a lista para procurar novamente.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filteredSources.map((source) => (
                <button
                  type="button"
                  key={source.id}
                  onClick={() => onSelectSource(source)}
                  className="group text-left flex flex-col bg-[#16191F] hover:bg-[#1D2129] rounded-lg p-2 border border-[#252A34] hover:border-[#5B7CFA] transition-all duration-150 hover:-translate-y-0.5 shadow-subtle"
                >
                  <div className="relative aspect-video w-full bg-[#0B0D10] rounded overflow-hidden flex items-center justify-center border border-black/40">
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt={source.name} className="w-full h-full object-cover" />
                    ) : (
                      <Monitor className="w-6 h-6 text-[#5B7CFA]" />
                    )}
                    <div className="absolute inset-0 bg-[#5B7CFA]/0 group-hover:bg-[#5B7CFA]/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 bg-[#5B7CFA] text-white font-medium text-[11px] px-2.5 py-0.5 rounded shadow-cta transition-opacity">Transmitir</span>
                    </div>
                  </div>
                  <p className="mt-2 text-xs font-medium text-[#F4F6F8] truncate w-full" title={source.name}>{source.name}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
