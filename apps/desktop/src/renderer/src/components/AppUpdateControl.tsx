import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, RotateCw, X } from 'lucide-react';
import type { AppInfo, UpdaterStatus } from '../../../updater/types';

interface AppUpdateControlProps {
  mediaActive: boolean;
}

const initialStatus: UpdaterStatus = {
  state: 'idle',
  currentVersion: '',
};
function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AppUpdateControl: React.FC<AppUpdateControlProps> = ({ mediaActive }) => {
  const isDesktop = Boolean(window.electronAPI?.updater && window.electronAPI?.appInfo);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<UpdaterStatus>(initialStatus);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isDesktop || !window.electronAPI) return;
    let active = true;
    const unsubscribe = window.electronAPI.updater.onStatusChanged((nextStatus) => {
      if (active) setStatus(nextStatus);
    });
    void Promise.all([
      window.electronAPI.appInfo.get(),
      window.electronAPI.updater.getStatus(),
    ]).then(([info, updaterStatus]) => {
      if (!active) return;
      setAppInfo(info);
      setStatus(updaterStatus);
    }).catch((error) => {
      console.warn('[AppUpdateControl] Failed to load updater status:', error);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [isDesktop]);

  if (!isDesktop) {
    return <span className="text-[10px] font-medium text-[#687180]">Tellas Web</span>;
  }

  const checking = status.state === 'checking';
  const downloading = status.state === 'downloading';
  const version = appInfo?.version || status.currentVersion;
  const hasAttention = status.state === 'available' || status.state === 'downloaded';

  const run = async (operation: 'check' | 'download' | 'install') => {
    const updater = window.electronAPI?.updater;
    if (!updater) return;
    try {
      if (operation === 'check') setStatus(await updater.check());
      else if (operation === 'download') setStatus(await updater.download());
      else await updater.install();
    } catch (error) {
      console.warn(`[AppUpdateControl] Updater ${operation} failed:`, error);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-medium transition ${hasAttention
          ? 'bg-[#5B7CFA]/15 border-[#5B7CFA]/35 text-[#AFC0FF]'
          : 'bg-[#16191F] border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] hover:border-[#323846]'
          }`}
        aria-label="Atualizações do Tellas Desktop"
      >
        {checking ? <RefreshCw className="w-3 h-3 animate-spin" /> : hasAttention ? <Download className="w-3 h-3" /> : null}
        <span>Tellas Desktop{version ? ` · v${version}` : ''}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[70] w-72 rounded-xl border border-[#252A34] bg-[#16191F] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-[#F4F6F8]">Tellas Desktop</p>
              <p className="mt-0.5 text-[10px] text-[#687180]">v{version || '—'}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="text-[#687180] hover:text-[#F4F6F8]" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {status.state === 'idle' && <p className="text-xs text-[#9DA5B4]">Verifique se existe uma nova versão.</p>}
            {status.state === 'checking' && <p className="text-xs text-[#9DA5B4]">Verificando atualizações…</p>}
            {status.state === 'upToDate' && <p className="text-xs text-[#34D399]">Você está usando a versão mais recente.</p>}
            {status.state === 'available' && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#F4F6F8]">Nova versão disponível</p>
                <p className="text-[11px] text-[#9DA5B4]">Tellas {status.availableVersion} · Atual: {version}</p>
              </div>
            )}
            {status.state === 'downloading' && (
              <div className="space-y-2">
                <div className="flex justify-between text-[11px] text-[#9DA5B4]">
                  <span>Baixando atualização</span>
                  <span>{Math.round(status.progress?.percent || 0)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#252A34]">
                  <div className="h-full rounded-full bg-[#5B7CFA] transition-all" style={{ width: `${status.progress?.percent || 0}%` }} />
                </div>
                {!!status.progress?.total && (
                  <p className="text-[10px] text-[#687180]">
                    {formatMegabytes(status.progress.transferred)} / {formatMegabytes(status.progress.total)}
                  </p>
                )}
              </div>
            )}
            {status.state === 'downloaded' && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#34D399]">Atualização pronta</p>
                <p className="text-[11px] text-[#9DA5B4]">Tellas {status.availableVersion} foi baixado.</p>
                {mediaActive && <p className="text-[10px] text-[#FBBF24]">Encerre a transmissão ou visualização antes de atualizar.</p>}
              </div>
            )}
            {status.state === 'error' && (
              <p className="text-xs text-[#F87171]">Não foi possível verificar atualizações. O Tellas continua funcionando normalmente.</p>
            )}

            {status.state === 'available' ? (
              <button type="button" onClick={() => void run('download')} className="w-full rounded-md bg-[#5B7CFA] px-3 py-2 text-xs font-medium text-white hover:bg-[#6C89FF]">
                Baixar atualização
              </button>
            ) : status.state === 'downloaded' ? (
              <button
                type="button"
                disabled={mediaActive}
                onClick={() => void run('install')}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#5B7CFA] px-3 py-2 text-xs font-medium text-white hover:bg-[#6C89FF] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCw className="h-3.5 w-3.5" />
                Reiniciar e atualizar
              </button>
            ) : (
              <button
                type="button"
                disabled={checking || downloading}
                onClick={() => void run('check')}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[#323846] bg-[#1D2129] px-3 py-2 text-xs font-medium text-[#F4F6F8] hover:bg-[#252A34] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
                Verificar atualizações
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
