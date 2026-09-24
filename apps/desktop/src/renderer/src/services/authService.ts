import type {
  AuthResponse,
  AuthTokens,
  LoginRequest,
  RegisterRequest,
  UpdateProfileRequest,
  UserProfile,
} from '@stream-app/shared';

function getBackendUrl(): string {
  const envUrl = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim().replace(/\/$/, '');
  return 'https://tellas.fly.dev';
}

const STORAGE_KEY_USER = 'tellas_auth_user';
const STORAGE_KEY_TOKENS = 'tellas_auth_tokens';

type AuthListener = (user: UserProfile | null) => void;

class ClientAuthService {
  private user: UserProfile | null = null;
  private tokens: AuthTokens | null = null;
  private listeners: Set<AuthListener> = new Set();
  private isRefreshing: boolean = false;
  private refreshPromise: Promise<AuthTokens | null> | null = null;
  private initialized = false;
  private legacyMigration: Promise<void> = Promise.resolve();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const savedUser = localStorage.getItem(STORAGE_KEY_USER);
      const savedTokens = localStorage.getItem(STORAGE_KEY_TOKENS);
      if (savedUser) {
        this.user = JSON.parse(savedUser);
        if (savedTokens) {
          const legacyTokens = JSON.parse(savedTokens) as AuthTokens;
          if (window.electronAPI?.auth) {
            this.tokens = { ...legacyTokens, refreshToken: '' };
            this.legacyMigration = window.electronAPI.auth.storeRefreshToken(legacyTokens.refreshToken)
              .then(() => { localStorage.removeItem(STORAGE_KEY_TOKENS); })
              .catch((error) => {
                console.error('[AuthService] Failed to migrate legacy refresh token:', error);
              });
          } else {
            this.tokens = legacyTokens;
          }
        }
      }
    } catch (e) {
      console.error('[AuthService] Failed to load auth from storage:', e);
      this.clearStorage();
    }
  }

  private async saveToStorage(user: UserProfile, tokens: AuthTokens): Promise<void> {
    try {
      this.user = user;
      this.tokens = { ...tokens, refreshToken: window.electronAPI?.auth ? '' : tokens.refreshToken };
      localStorage.setItem(STORAGE_KEY_USER, JSON.stringify(user));
      if (window.electronAPI?.auth) {
        if (tokens.refreshToken) await window.electronAPI.auth.storeRefreshToken(tokens.refreshToken);
        localStorage.removeItem(STORAGE_KEY_TOKENS);
      } else {
        localStorage.setItem(STORAGE_KEY_TOKENS, JSON.stringify(tokens));
      }
      this.notifyListeners();
    } catch (e) {
      console.error('[AuthService] Failed to save auth to storage:', e);
    }
  }

  private clearStorage(): void {
    this.user = null;
    this.tokens = null;
    localStorage.removeItem(STORAGE_KEY_USER);
    localStorage.removeItem(STORAGE_KEY_TOKENS);
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.user);
      } catch (err) {
        console.error('[AuthService] Listener error:', err);
      }
    }
  }

  public onAuthStateChanged(listener: AuthListener): () => void {
    this.listeners.add(listener);
    listener(this.isAuthenticated() ? this.user : null);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getCurrentUser(): UserProfile | null {
    return this.isAuthenticated() ? this.user : null;
  }

  public isAuthenticated(): boolean {
    return Boolean(this.user && this.tokens?.accessToken);
  }

  public getAccessToken(): string | null {
    return this.tokens?.accessToken || null;
  }

  public async initializeSession(): Promise<UserProfile | null> {
    if (this.initialized) return this.user;
    this.initialized = true;
    await this.legacyMigration;
    const refreshed = await this.refreshTokens();
    if (!refreshed) {
      this.clearStorage();
      return null;
    }
    return this.getProfile();
  }

  public async register(payload: RegisterRequest): Promise<AuthResponse> {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Falha ao registrar usuário');
    }

    const authRes = data as AuthResponse;
    await this.saveToStorage(authRes.user, authRes.tokens);
    return authRes;
  }

  public async login(payload: LoginRequest): Promise<AuthResponse> {
    const backendUrl = getBackendUrl();
    const response = await fetch(`${backendUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Falha ao realizar login');
    }

    const authRes = data as AuthResponse;
    await this.saveToStorage(authRes.user, authRes.tokens);
    return authRes;
  }

  public async refreshTokens(): Promise<AuthTokens | null> {
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = (async () => {
      try {
        const backendUrl = getBackendUrl();
        if (window.electronAPI?.auth) {
          const secureTokens = await window.electronAPI.auth.refresh(backendUrl);
          if (!secureTokens) return null;
          const newTokens: AuthTokens = { ...secureTokens, refreshToken: '' };
          this.tokens = newTokens;
          return newTokens;
        }
        if (!this.tokens?.refreshToken) return null;
        const response = await fetch(`${backendUrl}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: this.tokens!.refreshToken }),
        });

        if (!response.ok) {
          this.clearStorage();
          return null;
        }

        const data = await response.json();
        const newTokens = data.tokens as AuthTokens;
        if (this.user) {
          await this.saveToStorage(this.user, newTokens);
        }
        return newTokens;
      } catch (err) {
        console.error('[AuthService] Token refresh network error:', err);
        return null;
      } finally {
        this.isRefreshing = false;
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  public async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    let token = this.getAccessToken();

    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    let response = await fetch(url, { ...options, headers });

    // If 401 Unauthorized, attempt refresh once
    if (response.status === 401) {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
        response = await fetch(url, { ...options, headers });
      }
    }

    return response;
  }

  public async getProfile(): Promise<UserProfile | null> {
    if (!this.isAuthenticated()) return null;

    const backendUrl = getBackendUrl();
    const res = await this.fetchWithAuth(`${backendUrl}/api/auth/me`);
    if (!res.ok) {
      if (res.status === 401) {
        this.clearStorage();
      }
      return null;
    }

    const data = await res.json();
    if (data.user) {
      this.user = data.user;
      if (this.tokens) {
        await this.saveToStorage(this.user, this.tokens);
      }
      return this.user;
    }
    return null;
  }

  public async updateProfile(payload: UpdateProfileRequest): Promise<UserProfile> {
    const backendUrl = getBackendUrl();
    const res = await this.fetchWithAuth(`${backendUrl}/api/auth/profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao atualizar perfil');
    }

    this.user = data.user;
    if (this.tokens) {
      await this.saveToStorage(this.user, this.tokens);
    }
    return this.user!;
  }

  public async logout(): Promise<void> {
    const refreshToken = this.tokens?.refreshToken;
    this.clearStorage();

    const backendUrl = getBackendUrl();
    if (window.electronAPI?.auth) {
      await window.electronAPI.auth.logout(backendUrl).catch((err) => {
        console.error('[AuthService] Secure logout error:', err);
      });
      return;
    }

    if (refreshToken) {
      try {
        await fetch(`${backendUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
      } catch (err) {
        console.error('[AuthService] Logout api call error:', err);
      }
    }
  }
}

export const clientAuthService = new ClientAuthService();
