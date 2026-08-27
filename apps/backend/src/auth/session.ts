import * as jose from 'jose';
import * as crypto from 'crypto';

// ─── Configuration ────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';
let sessionSecretString = process.env.TELLAS_SESSION_SECRET || '';

if (!sessionSecretString) {
  if (isProduction) {
    throw new Error(
      '[Security] FATAL: TELLAS_SESSION_SECRET environment variable is missing in production! Startup aborted.'
    );
  } else {
    // Generate a secure ephemeral secret for local development
    sessionSecretString = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[Security] WARNING: TELLAS_SESSION_SECRET not set. Using ephemeral in-memory secret for development.'
    );
  }
} else if (isProduction && sessionSecretString.length < 32) {
  throw new Error(
    '[Security] FATAL: TELLAS_SESSION_SECRET must be at least 32 characters long in production! Startup aborted.'
  );
}

const SESSION_SECRET = new TextEncoder().encode(sessionSecretString);

export const TELLAS_SESSION_TTL_SECONDS = process.env.TELLAS_SESSION_TTL
  ? parseInt(process.env.TELLAS_SESSION_TTL, 10)
  : 12 * 60 * 60; // 12 hours default

export interface SessionPayload {
  roomId: string;
  participantId: string;
  sessionRole: 'host' | 'participant';
  canPublish: boolean;
}

/**
 * Creates a cryptographically signed Tellas Session JWT.
 */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + TELLAS_SESSION_TTL_SECONDS;

  return new jose.SignJWT({
    roomId: payload.roomId,
    participantId: payload.participantId,
    sessionRole: payload.sessionRole,
    canPublish: payload.canPublish,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.participantId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(SESSION_SECRET);
}

/**
 * Verifies and decodes a Tellas Session JWT.
 * Returns null if token is missing, invalid, or expired.
 */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const { payload } = await jose.jwtVerify(token, SESSION_SECRET, {
      algorithms: ['HS256'],
    });

    if (
      !payload.roomId ||
      !payload.participantId ||
      !payload.sessionRole ||
      typeof payload.roomId !== 'string' ||
      typeof payload.participantId !== 'string'
    ) {
      return null;
    }

    return {
      roomId: String(payload.roomId),
      participantId: String(payload.participantId),
      sessionRole: (payload.sessionRole as 'host' | 'participant') || 'participant',
      canPublish: Boolean(payload.canPublish),
    };
  } catch (_) {
    return null;
  }
}
