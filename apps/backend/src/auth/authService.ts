import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as jose from 'jose';
import { z } from 'zod';
import { userRepository, toUserProfile } from '../db/userRepository';
import type { AuthResponse, AuthTokens, UserProfile } from '@stream-app/shared';

// ─── Environment & Secrets ───────────────────────────────────────────────────

const JWT_SECRET_STRING =
  process.env.JWT_SECRET ||
  'tellas-jwt-auth-secret-key-at-least-32-chars-long-123456';

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET é obrigatório em produção.');
}

if (process.env.NODE_ENV === 'production' && JWT_SECRET_STRING.length < 32) {
  throw new Error('O secret JWT de produção deve possuir pelo menos 32 caracteres.');
}

const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_DAYS = 30; // 30 days
const BCRYPT_SALT_ROUNDS = 12;

// ─── Zod Validation Schemas ──────────────────────────────────────────────────

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.')
    .max(30, 'O nome de usuário deve ter no máximo 30 caracteres.')
    .regex(/^[a-zA-Z0-9_]+$/, 'O nome de usuário pode conter apenas letras, números e underlines (_).')
    .trim(),
  email: z
    .string()
    .email('Formato de e-mail inválido.')
    .max(255, 'E-mail muito longo.')
    .trim()
    .toLowerCase(),
  password: z
    .string()
    .min(8, 'A senha deve ter pelo menos 8 caracteres.')
    .max(128, 'A senha deve ter no máximo 128 caracteres.')
    .refine((val) => /[A-Z]/.test(val), 'A senha deve conter pelo menos uma letra maiúscula.')
    .refine((val) => /[a-z]/.test(val), 'A senha deve conter pelo menos uma letra minúscula.')
    .refine((val) => /[0-9]/.test(val), 'A senha deve conter pelo menos um número.')
    .refine(
      (val) => /[^a-zA-Z0-9]/.test(val),
      'A senha deve conter pelo menos um caractere especial (!@#$%^&*...).'
    ),
  avatarUrl: z.string().url('URL de avatar inválida.').optional().or(z.literal('')),
});

export const loginSchema = z.object({
  emailOrUsername: z.string().min(3, 'Informe seu e-mail ou nome de usuário.').trim(),
  password: z.string().min(1, 'Informe sua senha.'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token inválido.'),
});

export const updateProfileSchema = z.object({
  username: z
    .string()
    .min(3, 'O nome de usuário deve ter pelo menos 3 caracteres.')
    .max(30, 'O nome de usuário deve ter no máximo 30 caracteres.')
    .regex(/^[a-zA-Z0-9_]+$/, 'O nome de usuário pode conter apenas letras, números e underlines (_).')
    .optional(),
  avatarUrl: z.string().url('URL de avatar inválida.').optional().or(z.literal('')),
  currentPassword: z.string().optional(),
  newPassword: z
    .string()
    .min(8, 'A nova senha deve ter pelo menos 8 caracteres.')
    .max(128, 'A nova senha deve ter no máximo 128 caracteres.')
    .refine((val) => /[A-Z]/.test(val), 'A nova senha deve conter pelo menos uma letra maiúscula.')
    .refine((val) => /[a-z]/.test(val), 'A nova senha deve conter pelo menos uma letra minúscula.')
    .refine((val) => /[0-9]/.test(val), 'A nova senha deve conter pelo menos um número.')
    .refine(
      (val) => /[^a-zA-Z0-9]/.test(val),
      'A nova senha deve conter pelo menos um caractere especial (!@#$%^&*...).'
    )
    .optional(),
});

export interface UserTokenPayload {
  sub: string; // user id
  username: string;
  email: string;
  avatarUrl?: string;
  sessionVersion: number;
}

// ─── Token Utilities ─────────────────────────────────────────────────────────

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function generateAccessToken(user: { id: string; username: string; email: string; avatar_url: string | null; updated_at: number }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TOKEN_TTL_SECONDS;

  return new jose.SignJWT({
    username: user.username,
    email: user.email,
    avatarUrl: user.avatar_url || undefined,
    sessionVersion: user.updated_at,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(JWT_SECRET);
}

async function generateRefreshToken(userId: string): Promise<{ rawToken: string; expiresAt: number }> {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  const tokenId = crypto.randomUUID();

  await userRepository.saveRefreshToken({
    id: tokenId,
    userId,
    tokenHash,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

// ─── Auth Service ────────────────────────────────────────────────────────────

export const authService = {
  async register(input: z.infer<typeof registerSchema>): Promise<AuthResponse> {
    const validated = registerSchema.parse(input);

    const existingEmail = await userRepository.findByEmail(validated.email);
    if (existingEmail) {
      throw new Error('Este e-mail já está cadastrado.');
    }

    const existingUsername = await userRepository.findByUsername(validated.username);
    if (existingUsername) {
      throw new Error('Este nome de usuário já está em uso.');
    }

    const passwordHash = await bcrypt.hash(validated.password, BCRYPT_SALT_ROUNDS);
    const userId = crypto.randomUUID();

    // Default avatar if not provided
    const avatarUrl =
      validated.avatarUrl ||
      `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(validated.username)}`;

    const dbUser = await userRepository.create({
      id: userId,
      username: validated.username,
      email: validated.email,
      passwordHash,
      avatarUrl,
    });

    const accessToken = await generateAccessToken(dbUser);
    const { rawToken: refreshToken } = await generateRefreshToken(dbUser.id);

    return {
      user: toUserProfile(dbUser),
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  },

  async login(input: z.infer<typeof loginSchema>): Promise<AuthResponse> {
    const validated = loginSchema.parse(input);
    const user = await userRepository.findByEmailOrUsername(validated.emailOrUsername);

    if (!user) {
      throw new Error('Credenciais inválidas. Verifique seu e-mail/usuário e senha.');
    }

    const isMatch = await bcrypt.compare(validated.password, user.password_hash);
    if (!isMatch) {
      throw new Error('Credenciais inválidas. Verifique seu e-mail/usuário e senha.');
    }

    const accessToken = await generateAccessToken(user);
    const { rawToken: refreshToken } = await generateRefreshToken(user.id);

    return {
      user: toUserProfile(user),
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    };
  },

  async refreshTokens(refreshTokenRaw: string): Promise<AuthTokens> {
    if (!refreshTokenRaw) {
      throw new Error('Refresh token não fornecido.');
    }

    const tokenHash = hashToken(refreshTokenRaw);
    const storedToken = await userRepository.findRefreshToken(tokenHash);

    if (!storedToken) {
      throw new Error('Refresh token inválido, expirado ou revogado.');
    }

    const user = await userRepository.findById(storedToken.user_id);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    // Revoke the old token (Token Rotation Security)
    await userRepository.revokeRefreshToken(tokenHash);

    // Issue a new token pair
    const newAccessToken = await generateAccessToken(user);
    const { rawToken: newRefreshToken } = await generateRefreshToken(user.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  },

  async logout(refreshTokenRaw: string): Promise<void> {
    if (!refreshTokenRaw) return;
    const tokenHash = hashToken(refreshTokenRaw);
    await userRepository.revokeRefreshToken(tokenHash);
  },

  async verifyAccessToken(token: string): Promise<UserTokenPayload | null> {
    if (!token || typeof token !== 'string') return null;

    try {
      const { payload } = await jose.jwtVerify(token, JWT_SECRET, {
        algorithms: ['HS256'],
      });

      if (!payload.sub || typeof payload.sub !== 'string') {
        return null;
      }

      const user = await userRepository.findById(payload.sub);
      if (!user || Number(payload.sessionVersion) !== user.updated_at) return null;

      return {
        sub: payload.sub,
        username: String(payload.username || ''),
        email: String(payload.email || ''),
        avatarUrl: payload.avatarUrl ? String(payload.avatarUrl) : undefined,
        sessionVersion: Number(payload.sessionVersion),
      };
    } catch (_) {
      return null;
    }
  },

  async getProfile(userId: string): Promise<UserProfile | null> {
    const user = await userRepository.findById(userId);
    return user ? toUserProfile(user) : null;
  },

  async updateProfile(userId: string, input: z.infer<typeof updateProfileSchema>): Promise<UserProfile> {
    const validated = updateProfileSchema.parse(input);
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }

    if (validated.username && validated.username !== user.username) {
      const existing = await userRepository.findByUsername(validated.username);
      if (existing && existing.id !== userId) {
        throw new Error('Este nome de usuário já está em uso.');
      }
    }

    let passwordHash: string | undefined = undefined;
    if (validated.newPassword) {
      if (!validated.currentPassword) {
        throw new Error('Informe sua senha atual para alterar a senha.');
      }
      const isMatch = await bcrypt.compare(validated.currentPassword, user.password_hash);
      if (!isMatch) {
        throw new Error('A senha atual informada está incorreta.');
      }
      passwordHash = await bcrypt.hash(validated.newPassword, BCRYPT_SALT_ROUNDS);
    }

    const updated = await userRepository.updateProfile(userId, {
      username: validated.username,
      avatarUrl: validated.avatarUrl,
      passwordHash,
    });

    if (!updated) {
      throw new Error('Erro ao atualizar o perfil.');
    }

    if (validated.newPassword) {
      await userRepository.revokeAllUserTokens(userId);
    }

    return toUserProfile(updated);
  },
};
