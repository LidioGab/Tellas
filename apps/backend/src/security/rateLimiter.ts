/**
 * Safe in-memory sliding-window rate limiter with automatic periodic cleanup
 * to protect against Denial of Service and financial abuse.
 */

interface RateLimitEntry {
  timestamps: number[];
  lastSeen: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Purge entries older than 5 minutes every 60 seconds to prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_ENTRY_IDLE_MS = 5 * 60 * 1000;

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer() {
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of rateLimitStore.entries()) {
        if (now - entry.lastSeen > MAX_ENTRY_IDLE_MS) {
          rateLimitStore.delete(key);
        }
      }
    }, CLEANUP_INTERVAL_MS);
    if (cleanupTimer.unref) {
      cleanupTimer.unref();
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec?: number;
}

/**
 * Checks and records a hit against a rate-limited key.
 *
 * @param key Unique identifier for the rate limit target (e.g. "ip:1.2.3.4:token" or "participant:uuid:stream")
 * @param limit Maximum allowed hits in the window
 * @param windowMs Time window in milliseconds
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  ensureCleanupTimer();
  const now = Date.now();
  const cutoff = now - windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [], lastSeen: now };
    rateLimitStore.set(key, entry);
  }

  entry.lastSeen = now;
  // Filter timestamps within current window
  entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);

  if (entry.timestamps.length >= limit) {
    const oldestTimestamp = entry.timestamps[0];
    const retryAfterSec = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: retryAfterSec > 0 ? retryAfterSec : 1,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: limit - entry.timestamps.length,
  };
}

/**
 * Resets the in-memory store (used for unit testing).
 */
export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}
