import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import * as jose from 'jose';
import { setupSignaling, getOrCreateRoom } from './socket/signaling';
import type { LiveKitTokenRequest } from '@stream-app/shared';

// ─── Environment Variables ──────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
const LIVEKIT_TOKEN_TTL = process.env.LIVEKIT_TOKEN_TTL
  ? parseInt(process.env.LIVEKIT_TOKEN_TTL, 10)
  : 6 * 60 * 60; // 6 hours default

// ─── Fastify App ────────────────────────────────────────────────────────────

const app = Fastify({ logger: true });

async function main() {
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  });

  // ─── Health Check ───────────────────────────────────────────────────
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // ─── LiveKit Token Endpoint ─────────────────────────────────────────
  app.post<{ Body: LiveKitTokenRequest }>('/api/livekit/token', async (request, reply) => {
    // 1. Validate LiveKit configuration
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return reply.status(500).send({
        error: 'LiveKit não configurado. Defina LIVEKIT_URL, LIVEKIT_API_KEY e LIVEKIT_API_SECRET no .env'
      });
    }

    // 2. Validate request body
    const { roomId, identity, role } = request.body || ({} as LiveKitTokenRequest);

    if (!roomId || typeof roomId !== 'string' || roomId.trim().length === 0) {
      return reply.status(400).send({ error: 'roomId é obrigatório' });
    }
    if (!identity || typeof identity !== 'string' || identity.trim().length === 0) {
      return reply.status(400).send({ error: 'identity é obrigatório' });
    }
    if (!role || !['publisher', 'viewer'].includes(role)) {
      return reply.status(400).send({ error: 'role deve ser "publisher" ou "viewer"' });
    }

    const cleanRoomId = roomId.trim().toUpperCase();

    // 3. Register or get room in state
    getOrCreateRoom(cleanRoomId);

    // 4. Generate token with clock drift tolerance
    try {
      const secret = new TextEncoder().encode(LIVEKIT_API_SECRET);

      // Offset issue time 10 minutes into the past so that any local clock skew
      // relative to LiveKit Cloud NTP servers will never cause an 'invalid token (nbf)' rejection
      const now = Math.floor(Date.now() / 1000) - 600;
      const exp = now + LIVEKIT_TOKEN_TTL + 600;

      const videoGrant = {
        room: cleanRoomId,
        roomJoin: true,
        canPublish: role === 'publisher',
        canSubscribe: true,
        canPublishData: role === 'publisher',
      };

      const jwt = await new jose.SignJWT({ video: videoGrant })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(LIVEKIT_API_KEY)
        .setSubject(identity.trim())
        .setIssuedAt(now)
        .setNotBefore(now)
        .setExpirationTime(exp)
        .sign(secret);

      console.log(`[Token] Generated token for ${identity} (role: ${role}) in room ${cleanRoomId}`);

      // 5. Return token + connection info (never return secrets)
      return reply.status(200).send({
        token: jwt,
        livekitUrl: LIVEKIT_URL,
        roomName: cleanRoomId,
      });
    } catch (err: any) {
      request.log.error(err, 'Error generating LiveKit token');
      return reply.status(500).send({ error: 'Erro ao gerar token do LiveKit' });
    }
  });

  // ─── Attach Socket.IO to Fastify server ─────────────────────────────

  await app.ready();

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  setupSignaling(io);

  // ─── Start Fastify Server ───────────────────────────────────────────

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`\n==================================================`);
  console.log(`🚀 Backend Server running at http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Token:   POST http://localhost:${PORT}/api/livekit/token`);
  console.log(`   LiveKit: ${LIVEKIT_URL || '⚠️  NOT CONFIGURED'}`);
  console.log(`==================================================\n`);
}

main().catch((err) => {
  console.error('Error starting server:', err);
  process.exit(1);
});
