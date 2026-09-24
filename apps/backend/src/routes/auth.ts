import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ZodError } from 'zod';
import {
  authService,
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  updateProfileSchema,
} from '../auth/authService';
import { checkRateLimit } from '../security/rateLimiter';
import { resolveClientIp } from '../security/ipResolver';

export function registerAuthRoutes(app: FastifyInstance) {
  // ─── POST /api/auth/register ───────────────────────────────────────────────
  app.post('/api/auth/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp = resolveClientIp(
      request.headers as Record<string, string | string[] | undefined>,
      request.ip
    );

    // Rate Limit: 5 registration attempts per 15 minutes per IP
    const rateCheck = checkRateLimit(`register:ip:${clientIp}`, 5, 15 * 60 * 1000);
    if (!rateCheck.allowed) {
      reply.header('Retry-After', (rateCheck.retryAfterSec || 60).toString());
      return reply.status(429).send({
        error: `Muitas tentativas de cadastro. Tente novamente em ${rateCheck.retryAfterSec}s.`,
        code: 'RATE_LIMITED',
      });
    }

    try {
      const result = await authService.register(request.body as any);
      return reply.status(201).send(result);
    } catch (err: any) {
      if (err instanceof ZodError) {
        return reply.status(400).send({
          error: err.issues[0]?.message || 'Dados de cadastro inválidos.',
          details: err.issues,
          code: 'VALIDATION_ERROR',
        });
      }
      return reply.status(400).send({
        error: err.message || 'Erro ao registrar usuário.',
        code: 'REGISTRATION_FAILED',
      });
    }
  });

  // ─── POST /api/auth/login ──────────────────────────────────────────────────
  app.post('/api/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientIp = resolveClientIp(
      request.headers as Record<string, string | string[] | undefined>,
      request.ip
    );

    const body = (request.body || {}) as any;
    const identifier = String(body.emailOrUsername || '').toLowerCase().trim();

    // Rate Limit: 10 login attempts per 10 minutes per IP & 5 per identifier
    const ipRate = checkRateLimit(`login:ip:${clientIp}`, 10, 10 * 60 * 1000);
    const idRate = identifier
      ? checkRateLimit(`login:id:${identifier}`, 5, 10 * 60 * 1000)
      : { allowed: true, remaining: 5, retryAfterSec: undefined };

    if (!ipRate.allowed || !idRate.allowed) {
      const retrySec = Math.max(ipRate.retryAfterSec || 60, idRate.retryAfterSec || 60);
      reply.header('Retry-After', retrySec.toString());
      return reply.status(429).send({
        error: `Muitas tentativas de login incorretas. Tente novamente em ${retrySec}s.`,
        code: 'RATE_LIMITED',
      });
    }

    try {
      const result = await authService.login(body);
      return reply.status(200).send(result);
    } catch (err: any) {
      if (err instanceof ZodError) {
        return reply.status(400).send({
          error: err.issues[0]?.message || 'Dados de login inválidos.',
          details: err.issues,
          code: 'VALIDATION_ERROR',
        });
      }
      return reply.status(401).send({
        error: err.message || 'Credenciais inválidas.',
        code: 'INVALID_CREDENTIALS',
      });
    }
  });

  // ─── POST /api/auth/refresh ────────────────────────────────────────────────
  app.post('/api/auth/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = (request.body || {}) as any;
      const { refreshToken } = refreshTokenSchema.parse(body);
      const tokens = await authService.refreshTokens(refreshToken);
      return reply.status(200).send({ tokens });
    } catch (err: any) {
      return reply.status(401).send({
        error: err.message || 'Token de renovação inválido ou expirado.',
        code: 'UNAUTHORIZED_REFRESH',
      });
    }
  });

  // ─── POST /api/auth/logout ─────────────────────────────────────────────────
  app.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body || {}) as any;
    if (body.refreshToken) {
      await authService.logout(body.refreshToken);
    }
    return reply.status(200).send({ success: true });
  });


  // ─── GET /api/auth/me ──────────────────────────────────────────────────────
  app.get('/api/auth/me', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Token de autenticação não fornecido.',
        code: 'UNAUTHORIZED',
      });
    }

    const token = authHeader.slice(7).trim();
    const payload = await authService.verifyAccessToken(token);

    if (!payload) {
      return reply.status(401).send({
        error: 'Token de autenticação inválido ou expirado.',
        code: 'UNAUTHORIZED',
      });
    }

    const user = await authService.getProfile(payload.sub);
    if (!user) {
      return reply.status(404).send({
        error: 'Usuário não encontrado.',
        code: 'USER_NOT_FOUND',
      });
    }

    return reply.status(200).send({ user });
  });

  // ─── PATCH /api/auth/profile ───────────────────────────────────────────────
  app.patch('/api/auth/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'Token de autenticação não fornecido.',
        code: 'UNAUTHORIZED',
      });
    }

    const token = authHeader.slice(7).trim();
    const payload = await authService.verifyAccessToken(token);

    if (!payload) {
      return reply.status(401).send({
        error: 'Token de autenticação inválido ou expirado.',
        code: 'UNAUTHORIZED',
      });
    }

    try {
      const user = await authService.updateProfile(payload.sub, request.body as any);
      return reply.status(200).send({ user });
    } catch (err: any) {
      if (err instanceof ZodError) {
        return reply.status(400).send({
          error: err.issues[0]?.message || 'Dados inválidos.',
          details: err.issues,
          code: 'VALIDATION_ERROR',
        });
      }
      return reply.status(400).send({
        error: err.message || 'Erro ao atualizar perfil.',
        code: 'UPDATE_FAILED',
      });
    }
  });
}

