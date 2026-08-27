import { useState, useEffect, useCallback } from 'react';

export type LayoutMode = 'DESKTOP' | 'MOBILE_PORTRAIT' | 'MOBILE_LANDSCAPE';

export interface LayoutInfo {
  layoutMode: LayoutMode;
  isFullscreen: boolean;
  isTouchDevice: boolean;
  width: number;
  height: number;
}

export function useLayoutMode(): LayoutInfo & {
  requestFullscreenWithLock: (element: HTMLElement) => Promise<void>;
  exitFullscreenWithUnlock: () => Promise<void>;
} {
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => {
    return typeof document !== 'undefined' && !!document.fullscreenElement;
  });

  const [layoutInfo, setLayoutInfo] = useState<LayoutInfo>(() => {
    if (typeof window === 'undefined') {
      return {
        layoutMode: 'DESKTOP',
        isFullscreen: false,
        isTouchDevice: false,
        width: 1280,
        height: 720,
      };
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const isTouchDevice = isTouch || isCoarse;

    let layoutMode: LayoutMode = 'DESKTOP';

    if (isTouchDevice) {
      if (width > height || height <= 550) {
        layoutMode = 'MOBILE_LANDSCAPE';
      } else {
        layoutMode = 'MOBILE_PORTRAIT';
      }
    } else {
      if (width < 768) {
        layoutMode = 'MOBILE_PORTRAIT';
      } else {
        layoutMode = 'DESKTOP';
      }
    }

    return {
      layoutMode,
      isFullscreen: false,
      isTouchDevice,
      width,
      height,
    };
  });

  const evaluateLayout = useCallback(() => {
    if (typeof window === 'undefined') return;

    const width = window.innerWidth;
    const height = window.innerHeight;
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    const isTouchDevice = isTouch || isCoarse;
    const isFs = !!document.fullscreenElement;

    let layoutMode: LayoutMode = 'DESKTOP';

    // Dispositivo móvel / toque
    if (isTouchDevice) {
      // Se a altura for reduzida ou largura for maior que a altura = modo paisagem mobile
      if (width > height || height <= 550) {
        layoutMode = 'MOBILE_LANDSCAPE';
      } else {
        layoutMode = 'MOBILE_PORTRAIT';
      }
    } else {
      // Desktop / Mouse
      if (width < 768 && height > width) {
        layoutMode = 'MOBILE_PORTRAIT';
      } else {
        layoutMode = 'DESKTOP';
      }
    }

    setIsFullscreen(isFs);
    setLayoutInfo({
      layoutMode,
      isFullscreen: isFs,
      isTouchDevice,
      width,
      height,
    });
  }, []);

  useEffect(() => {
    evaluateLayout();

    window.addEventListener('resize', evaluateLayout, { passive: true });
    window.addEventListener('orientationchange', evaluateLayout, { passive: true });
    document.addEventListener('fullscreenchange', evaluateLayout, { passive: true });

    const mqlOrientation = window.matchMedia('(orientation: landscape)');
    const handleMql = () => evaluateLayout();
    if (mqlOrientation.addEventListener) {
      mqlOrientation.addEventListener('change', handleMql);
    }

    return () => {
      window.removeEventListener('resize', evaluateLayout);
      window.removeEventListener('orientationchange', evaluateLayout);
      document.removeEventListener('fullscreenchange', evaluateLayout);
      if (mqlOrientation.removeEventListener) {
        mqlOrientation.removeEventListener('change', handleMql);
      }
    };
  }, [evaluateLayout]);

  const requestFullscreenWithLock = useCallback(async (element: HTMLElement) => {
    try {
      if (!document.fullscreenElement && element.requestFullscreen) {
        await element.requestFullscreen();
      }

      // Progressive enhancement: try locking screen orientation if supported
      if (typeof screen !== 'undefined' && screen.orientation && 'lock' in screen.orientation) {
        // @ts-ignore
        await screen.orientation.lock('landscape').catch(() => {
          // Graceful fallback: orientation lock might be restricted or unsupported on iOS/certain webviews
        });
      }
    } catch (err) {
      console.warn('[useLayoutMode] Fullscreen request fallback:', err);
    }
  }, []);

  const exitFullscreenWithUnlock = useCallback(async () => {
    try {
      if (typeof screen !== 'undefined' && screen.orientation && 'unlock' in screen.orientation) {
        // @ts-ignore
        screen.orientation.unlock();
      }
    } catch (_) {}

    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('[useLayoutMode] Exit fullscreen error:', err);
    }
  }, []);

  return {
    ...layoutInfo,
    isFullscreen,
    requestFullscreenWithLock,
    exitFullscreenWithUnlock,
  };
}
