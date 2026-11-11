import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

export const WindowControls: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const controls = window.electronAPI?.windowControls;

  useEffect(() => {
    if (!controls) return;
    void controls.isMaximized().then(setIsMaximized).catch(() => {});
    const cleanup = controls.onStateChanged((state) => {
      setIsMaximized(state.isMaximized);
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, [controls]);

  if (!controls) return null;

  return (
    <div
      className="flex items-center h-full no-drag select-none ml-2 shrink-0"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => void controls.minimize()}
        title="Minimizar"
        aria-label="Minimizar"
        className="h-11 w-11 flex items-center justify-center text-[#8A8A8A] hover:text-[#FAFAFA] hover:bg-[#1F1F1F] transition-colors"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={() => void controls.maximize()}
        title={isMaximized ? 'Restaurar' : 'Maximizar'}
        aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
        className="h-11 w-11 flex items-center justify-center text-[#8A8A8A] hover:text-[#FAFAFA] hover:bg-[#1F1F1F] transition-colors"
      >
        {isMaximized ? (
          <Copy className="w-3 h-3 rotate-180" />
        ) : (
          <Square className="w-3 h-3" />
        )}
      </button>

      <button
        type="button"
        onClick={() => void controls.close()}
        title="Fechar"
        aria-label="Fechar"
        className="h-11 w-11 flex items-center justify-center text-[#8A8A8A] hover:text-white hover:bg-[#EF4444] transition-colors rounded-tr-lg"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
