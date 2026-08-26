import { io, Socket } from 'socket.io-client';

// Resolve the backend server URL.
// Vite replaces import.meta.env.VITE_BACKEND_URL at build time.
// Fallback to production URL if not set.
const BACKEND_URL: string =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ||
  'https://tellas.fly.dev';

export const socket: Socket = io(BACKEND_URL, {
  autoConnect: true,
  transports: ['websocket', 'polling']
});

socket.on('connect', () => console.log('[SocketClient] Connected with ID:', socket.id));

socket.on('disconnect', (reason) => console.log('[SocketClient] Disconnected:', reason));
