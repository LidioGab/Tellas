import * as jose from 'jose';
import * as crypto from 'crypto';

// ─── Configuration ────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production';
let sessionSecretString = process.env.TELLAS_SESSION_SECRET || '';

if (!sessionSecretString) {
  if (isProduction) {
    sessionSecretString = process.env.LIVEKIT_API_SECRET || crypto.randomBytes(32).toString('hex');
    console.warn(
      '[Security] WARNING: TELLAS_SESSION_SECRET not explicitly configured. Using derived secure session secret.'
    );
  } else {
    // Use stable secret in development to persist across dev restarts
    sessionSecretString = 'tellas-dev-secret-stable-key-at-least-32-chars-12345';
    console.log(
      '[Security] INFO: TELLAS_SESSION_SECRET not set in env. Using default development secret.'
    );
  }
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
