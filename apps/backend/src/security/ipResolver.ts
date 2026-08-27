import * as net from 'net';

/**
 * Resolves a trusted client IP address across Fastify HTTP and Socket.IO handshakes.
 *
 * Priority:
 * 1. Fly-Client-IP header (injected by Fly.io edge proxy).
 * 2. Validated direct remote address (request.ip or socket.handshake.address).
 *
 * Untrusted client headers like X-Forwarded-For are deliberately ignored to prevent
 * rate limit bypass via IP rotation.
 */
export function resolveClientIp(
  headers?: Record<string, string | string[] | undefined>,
  remoteAddress?: string
): string {
  if (headers) {
    const rawFlyIp = headers['fly-client-ip'];
    const flyIp = Array.isArray(rawFlyIp) ? rawFlyIp[0] : rawFlyIp;

    if (typeof flyIp === 'string') {
      const trimmed = flyIp.trim();
      if (net.isIP(trimmed)) {
        return trimmed;
      }
    }
  }

  if (typeof remoteAddress === 'string') {
    let cleanAddress = remoteAddress.trim();
    // Normalize IPv6-mapped IPv4 addresses (e.g. "::ffff:127.0.0.1" -> "127.0.0.1")
    if (cleanAddress.startsWith('::ffff:')) {
      cleanAddress = cleanAddress.slice(7);
    }

    if (net.isIP(cleanAddress)) {
      return cleanAddress;
    }
  }

  return '127.0.0.1';
}
