import { io, Socket } from 'socket.io-client';

function getBackendUrl(): string {
  const envUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim();
  if (typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('file://')) {
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

const BACKEND_URL: string = getBackendUrl();

export const socket: Socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => console.log('[SocketClient] Connected with ID:', socket.id));

socket.on('disconnect', (reason) => console.log('[SocketClient] Disconnected:', reason));
