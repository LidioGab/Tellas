const CLOUDFLARE_REALTIME_BASE_URL = 'https://rtc.live.cloudflare.com/v1';
const REQUEST_TIMEOUT_MS = 12_000;
const DEV = process.env.NODE_ENV !== 'production';

export interface CloudflareSessionDescription {
  sdp: string;
  type: 'offer' | 'answer';
}

export interface CloudflareTrack {
  location: 'local' | 'remote';
  mid?: string;
  sessionId?: string;
  trackName?: string;
  kind?: 'audio' | 'video';
  errorCode?: string;
  errorDescription?: string;
}

export interface CloudflareTracksResponse {
  errorCode?: string;
  errorDescription?: string;
  requiresImmediateRenegotiation?: boolean;
  sessionDescription?: CloudflareSessionDescription;
  tracks?: CloudflareTrack[];
}

export interface CloudflareRealtimeApi {
  createSession(correlationId: string): Promise<{ sessionId: string }>;
  addTracks(sessionId: string, body: { sessionDescription?: CloudflareSessionDescription; tracks: CloudflareTrack[] }): Promise<CloudflareTracksResponse>;
  renegotiate(sessionId: string, sessionDescription: CloudflareSessionDescription): Promise<void>;
  closeTracks(sessionId: string, mids: string[]): Promise<CloudflareTracksResponse>;
}

export class CloudflareRealtimeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly operation?: string,
  ) {
    super(message);
    this.name = 'CloudflareRealtimeError';
  }
}

export class CloudflareRealtimeClient implements CloudflareRealtimeApi {
  constructor(
    private readonly appId: string,
    private readonly apiToken: string,
  ) {}

  public get configured(): boolean {
    return Boolean(this.appId && this.apiToken);
  }

  private async request<T>(path: string, method: 'POST' | 'PUT', operation: string, body?: unknown): Promise<T> {
    if (!this.configured) {
      throw new CloudflareRealtimeError('Cloudflare Realtime não configurado.', 503, 'CLOUDFLARE_NOT_CONFIGURED');
    }

    const startedAt = performance.now();
    let response: Response;
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.apiToken}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      response = await fetch(`${CLOUDFLARE_REALTIME_BASE_URL}/apps/${encodeURIComponent(this.appId)}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      if (DEV) console.error('[CLOUDFLARE][API_ERROR]', {
        operation,
        status: isTimeout ? 504 : 502,
        errorCode: isTimeout ? 'CLOUDFLARE_TIMEOUT' : 'CLOUDFLARE_UNREACHABLE',
        messageSanitized: isTimeout ? 'Request timeout' : 'Network request failed',
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      throw new CloudflareRealtimeError(
        isTimeout ? 'Cloudflare Realtime excedeu o tempo limite.' : 'Falha ao acessar Cloudflare Realtime.',
        isTimeout ? 504 : 502,
        isTimeout ? 'CLOUDFLARE_TIMEOUT' : 'CLOUDFLARE_UNREACHABLE',
        operation,
      );
    }

    const payload = await response.json().catch(() => ({})) as T & {
      errorCode?: string;
      errorDescription?: string;
    };
    if (!response.ok || payload.errorCode) {
      const errorCode = payload.errorCode || `CLOUDFLARE_HTTP_${response.status}`;
      const errorDescription = payload.errorDescription || `Cloudflare Realtime respondeu HTTP ${response.status}.`;
      if (DEV) console.error('[CLOUDFLARE][API_ERROR]', {
        operation,
        status: response.status,
        errorCode,
        messageSanitized: errorDescription,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
      throw new CloudflareRealtimeError(
        errorDescription,
        response.ok ? 502 : response.status,
        errorCode,
        operation,
      );
    }
    return payload;
  }

  async createSession(correlationId: string): Promise<{ sessionId: string }> {
    const query = `?correlationId=${encodeURIComponent(correlationId)}`;
    // Cloudflare session creation and media negotiation are separate steps.
    return this.request(`/sessions/new${query}`, 'POST', 'SESSION_CREATE_FAILED');
  }

  async addTracks(sessionId: string, body: {
    sessionDescription?: CloudflareSessionDescription;
    tracks: CloudflareTrack[];
  }): Promise<CloudflareTracksResponse> {
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/tracks/new`, 'POST', 'TRACKS_NEW_FAILED', body);
  }

  async renegotiate(sessionId: string, sessionDescription: CloudflareSessionDescription): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(sessionId)}/renegotiate`, 'PUT', 'RENEGOTIATE_FAILED', { sessionDescription });
  }

  async closeTracks(sessionId: string, mids: string[]): Promise<CloudflareTracksResponse> {
    if (mids.length === 0) return { tracks: [] };
    return this.request(`/sessions/${encodeURIComponent(sessionId)}/tracks/close`, 'PUT', 'TRACKS_CLOSE_FAILED', {
      tracks: mids.map((mid) => ({ mid })),
      force: true,
    });
  }
}
