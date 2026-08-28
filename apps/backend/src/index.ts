import 'dotenv/config';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import * as jose from 'jose';
import { setupSignaling, getRoom } from './socket/signaling';
import { verifySessionToken } from './auth/session';
import { checkRateLimit } from './security/rateLimiter';
import { resolveClientIp } from './security/ipResolver';
import type { LiveKitTokenRequest } from '@stream-app/shared';

// ─── Environment Variables ──────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

// Security: Reduced default LiveKit join token TTL to 30 minutes (1800s)
const LIVEKIT_TOKEN_TTL = process.env.LIVEKIT_TOKEN_TTL
  ? parseInt(process.env.LIVEKIT_TOKEN_TTL, 10)
  : 30 * 60; // 30 minutes default

// ─── Fastify Application ────────────────────────────────────────────────────

export const app = Fastify({
  logger: process.env.NODE_ENV !== 'test',
  bodyLimit: 16384, // 16 KB request body limit
});

export async function buildApp() {
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  });

  // ─── Health Check (Public & Safe) ───────────────────────────────────
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // ─── Protected LiveKit Token Endpoint (SEC-001 Resolved) ─────────────
  app.post<{ Body: LiveKitTokenRequest }>('/api/livekit/token', async (request: FastifyRequest<{ Body: LiveKitTokenRequest }>, reply: FastifyReply) => {
    // Trusted IP resolution: Fly-Client-IP priority with fallback to remote IP
    const clientIp = resolveClientIp(
      request.headers as Record<string, string | string[] | undefined>,
      request.ip
    );

    // 1. Verify Tellas Session Token from Authorization Header
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Token de sessão ausente. Autentique-se criando ou entrando em uma sala.',
        code: 'UNAUTHORIZED_MISSING_SESSION',
      });
    }

    const sessionJwt = authHeader.slice(7).trim();
    const session = await verifySessionToken(sessionJwt);

    if (!session) {
      return reply.status(401).send({
        error: 'Token de sessão inválido ou expirado.',
        code: 'UNAUTHORIZED_INVALID_SESSION',
      });
    }

    // 2. Validate LiveKit Server configuration
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
      return reply.status(500).send({
        error: 'LiveKit não configurado no servidor.',
        code: 'LIVEKIT_NOT_CONFIGURED',
      });
    }

    // 3. Verify Room Existence (Token endpoint NEVER creates room!)
    const room = getRoom(session.roomId);
    if (!room) {
      return reply.status(404).send({
        error: 'A sala associada a esta sessão não existe ou foi encerrada.',
        code: 'ROOM_NOT_FOUND',
      });
    }

    // 4. Verify Participant Membership
    const member = room.members.get(session.participantId);
    if (!member) {
      return reply.status(403).send({
        error: 'Participante não registrado nesta sala.',
        code: 'PARTICIPANT_NOT_IN_ROOM',
      });
    }

    // 5. Rate Limiting: 10 requests / min / participant & 30 requests / min / IP
    const participantRate = checkRateLimit(`participant:${session.participantId}:token`, 10, 60 * 1000);
    const ipRate = checkRateLimit(`ip:${clientIp}:token`, 30, 60 * 1000);

    if (!participantRate.allowed || !ipRate.allowed) {
      const retryAfter = Math.max(participantRate.retryAfterSec || 1, ipRate.retryAfterSec || 1);
      reply.header('Retry-After', retryAfter.toString());
      return reply.status(429).send({
        error: `Muitas solicitações de token. Tente novamente em ${retryAfter}s.`,
        code: 'RATE_LIMITED',
      });
    }

    // 6. Determine LiveKit Grants Server-Side (Least Privilege: canPublishData = false)
    const requestedRole = request.body?.role || 'viewer';
    const isPublisherRequested = requestedRole === 'publisher';
    const canPublish = isPublisherRequested && member.canPublish;

    const videoGrant = {
      room: session.roomId,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: false, // Least Privilege Principle: DataChannel is not used by Tellas
    };

    // 7. Mint LiveKit JWT
    try {
      const secret = new TextEncoder().encode(LIVEKIT_API_SECRET);

      // Offset issue time 10 minutes into the past to prevent NTP clock drift rejection
      const now = Math.floor(Date.now() / 1000) - 600;
      const exp = now + LIVEKIT_TOKEN_TTL + 600;

      const livekitJwt = await new jose.SignJWT({
        video: videoGrant,
        name: member.identity,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(LIVEKIT_API_KEY)
        .setSubject(session.participantId)
        .setIssuedAt(now)
        .setNotBefore(now)
        .setExpirationTime(exp)
        .sign(secret);

      console.log(
        `[Token] Minted LiveKit token for participant ${session.participantId} in ${session.roomId} (canPublish: ${canPublish})`
      );

      return reply.status(200).send({
        token: livekitJwt,
        livekitUrl: LIVEKIT_URL,
        roomName: session.roomId,
        participantId: session.participantId,
      });
    } catch (err: any) {
      request.log.error(err, 'Error generating LiveKit token');
      return reply.status(500).send({ error: 'Erro ao gerar token do LiveKit' });
    }
  });

  return app;
}

async function main() {
  await buildApp();
  await app.ready();

  const io = new SocketIOServer(app.server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  setupSignaling(io);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  console.log(`\n==================================================`);
  console.log(`🚀 Tellas Backend running at http://0.0.0.0:${PORT}`);
  console.log(`   Health:  GET  http://localhost:${PORT}/health`);
  console.log(`   Token:   POST http://localhost:${PORT}/api/livekit/token (Protected with Tellas Session Bearer)`);
  console.log(`   LiveKit: ${LIVEKIT_URL || '⚠️  NOT CONFIGURED'}`);
  console.log(`==================================================\n`);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('Error starting server:', err);
    process.exit(1);
  });
}
