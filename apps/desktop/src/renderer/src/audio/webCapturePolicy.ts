/**
 * Web Capture Policy Module
 *
 * Implements strict, pure, testable security and audio scoping rules for
 * Web / Browser screen sharing via getDisplayMedia().
 */

export type RequestedWebMode = 'browser' | 'window' | 'monitor';
export type ActualWebSurface = 'browser' | 'window' | 'monitor' | 'unknown';
export type WebAudioPolicyDecision = 'ALLOW_SCOPED_AUDIO' | 'FORCE_VIDEO_ONLY' | 'REJECT_SELECTION';

export interface WebCapturePolicyResult {
  decision: WebAudioPolicyDecision;
  actualSurface: ActualWebSurface;
  warningMessage: string | null;
  errorMessage: string | null;
}

/**
 * Pure function: Extracts and classifies the actual displaySurface from a MediaStream video track.
 */
export function getActualDisplaySurface(stream: MediaStream): ActualWebSurface {
  const videoTrack = stream?.getVideoTracks?.()[0];
  if (!videoTrack) return 'unknown';

  const settings = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : null;
  const surface = settings?.displaySurface;

  if (surface === 'browser' || surface === 'window' || surface === 'monitor') {
    return surface;
  }
  return 'unknown';
}

/**
 * Pure function: Evaluates the security and audio policy for Web capture based on requested mode and actual selected surface.
 */
export function resolveWebAudioPolicy(
  requestedMode: RequestedWebMode,
  actualSurface: ActualWebSurface,
  hasAudioTracks: boolean
): WebCapturePolicyResult {
  // If the user requested a specific surface (e.g. 'browser') but chose something else (e.g. 'window' or 'monitor'), reject
  if (requestedMode !== actualSurface && actualSurface !== 'unknown') {
    return {
      decision: 'REJECT_SELECTION',
      actualSurface,
      warningMessage: null,
      errorMessage: requestedMode === 'browser'
        ? 'Para compartilhar áudio com segurança, selecione uma guia do navegador no painel que foi aberto.'
        : requestedMode === 'window'
        ? 'Para compartilhar uma janela, selecione uma janela no painel que foi aberto.'
        : 'A superfície selecionada não corresponde ao modo escolhido. Tente novamente.'
    };
  }

  // If actualSurface is 'browser' (and matches requestedMode)
  if (actualSurface === 'browser') {
    if (hasAudioTracks) {
      return {
        decision: 'ALLOW_SCOPED_AUDIO',
        actualSurface,
        warningMessage: null,
        errorMessage: null
      };
    }
    return {
      decision: 'FORCE_VIDEO_ONLY',
      actualSurface,
      warningMessage: 'A guia foi compartilhada sem áudio (nenhum áudio foi fornecido pelo navegador).',
      errorMessage: null
    };
  }

  // If actualSurface is 'window'
  if (actualSurface === 'window') {
    return {
      decision: 'FORCE_VIDEO_ONLY',
      actualSurface,
      warningMessage: 'Na versão Web, o navegador não garante que o áudio de uma janela esteja isolado dos demais aplicativos. Para proteger suas conversas, esta janela será compartilhada somente com vídeo.',
      errorMessage: null
    };
  }

  // If actualSurface is 'monitor'
  if (actualSurface === 'monitor') {
    return {
      decision: 'FORCE_VIDEO_ONLY',
      actualSurface,
      warningMessage: 'Na versão Web, a tela inteira é transmitida somente com vídeo para impedir que conversas e sons de outros aplicativos sejam transmitidos.',
      errorMessage: null
    };
  }

  // If actualSurface is 'unknown' (browser did not provide displaySurface setting)
  return {
    decision: 'FORCE_VIDEO_ONLY',
    actualSurface,
    warningMessage: 'O navegador não permitiu verificar a origem da captura com segurança. O compartilhamento continuará apenas com vídeo.',
    errorMessage: null
  };
}

/**
 * Pure helper to safely stop and sanitize audio tracks according to policy decision
 */
export function sanitizeMediaStreamForPolicy(
  stream: MediaStream,
  decision: WebAudioPolicyDecision
): MediaStream {
  const videoTracks = stream?.getVideoTracks?.() || [];
  const audioTracks = stream?.getAudioTracks?.() || [];

  if (decision === 'ALLOW_SCOPED_AUDIO' && audioTracks.length > 0) {
    if (typeof MediaStream !== 'undefined') {
      return new MediaStream([videoTracks[0], audioTracks[0]]);
    }
    return stream;
  }

  // FORCE_VIDEO_ONLY: Stop all audio tracks immediately to prevent leakage
  audioTracks.forEach((track) => {
    try {
      track.stop();
    } catch (_) {}
    try {
      if (typeof stream.removeTrack === 'function') {
        stream.removeTrack(track);
      }
    } catch (_) {}
  });

  if (typeof MediaStream !== 'undefined') {
    return new MediaStream([videoTracks[0]]);
  }
  return stream;
}
