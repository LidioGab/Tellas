import { io, Socket } from 'socket.io-client';

// Resolve the backend server URL.
// In development we fallback to localhost:3001.
// Vite will replace import.meta.env at build time.
const getBackendUrl = () => {
  const envUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (envUrl) return envUrl;

  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return `http://${window.location.hostname}:3001`;
  }
  return 'http://localhost:3001';
};

const BACKEND_URL = getBackendUrl();

export const socket: Socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => console.log('[SocketClient] Connected with ID:', socket.id));

socket.on('disconnect', (reason) => console.log('[SocketClient] Disconnected:', reason));
