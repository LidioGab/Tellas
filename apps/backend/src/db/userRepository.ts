import { db } from './database';
import type { UserProfile } from '@stream-app/shared';

export interface DbUser {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  avatar_url: string | null;
  created_at: number;
  updated_at: number;
}

export interface DbRefreshToken {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: number;
  revoked: number;
  created_at: number;
}

export function toUserProfile(dbUser: DbUser): UserProfile {
  return {
    id: dbUser.id,
    username: dbUser.username,
    email: dbUser.email,
    avatarUrl: dbUser.avatar_url || undefined,
    createdAt: dbUser.created_at,
  };
}

export const userRepository = {
  async create(user: {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    avatarUrl?: string;
  }): Promise<DbUser> {
    const now = Date.now();
    const cleanUsername = user.username.trim().toLowerCase();
    const cleanEmail = user.email.trim().toLowerCase();

    await db.execute({
      sql: `INSERT INTO users (id, username, email, password_hash, avatar_url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        user.id,
        cleanUsername,
        cleanEmail,
        user.passwordHash,
        user.avatarUrl || null,
        now,
        now,
      ],
    });

    return {
      id: user.id,
      username: cleanUsername,
      email: cleanEmail,
      password_hash: user.passwordHash,
      avatar_url: user.avatarUrl || null,
      created_at: now,
      updated_at: now,
    };
  },

  async findById(id: string): Promise<DbUser | null> {
    const rs = await db.execute({
      sql: `SELECT * FROM users WHERE id = ? LIMIT 1`,
      args: [id],
    });

    if (rs.rows.length === 0) return null;
    return rs.rows[0] as unknown as DbUser;
  },

  async findByEmail(email: string): Promise<DbUser | null> {
    const clean = email.trim().toLowerCase();
    const rs = await db.execute({
      sql: `SELECT * FROM users WHERE email = ? COLLATE NOCASE LIMIT 1`,
      args: [clean],
    });

    if (rs.rows.length === 0) return null;
    return rs.rows[0] as unknown as DbUser;
  },

  async findByUsername(username: string): Promise<DbUser | null> {
    const clean = username.trim().toLowerCase();
    const rs = await db.execute({
      sql: `SELECT * FROM users WHERE username = ? COLLATE NOCASE LIMIT 1`,
      args: [clean],
    });

    if (rs.rows.length === 0) return null;
    return rs.rows[0] as unknown as DbUser;
  },

  async findByEmailOrUsername(identifier: string): Promise<DbUser | null> {
    const clean = identifier.trim().toLowerCase();
    const rs = await db.execute({
      sql: `SELECT * FROM users 
            WHERE email = ? COLLATE NOCASE OR username = ? COLLATE NOCASE 
            LIMIT 1`,
      args: [clean, clean],
    });

    if (rs.rows.length === 0) return null;
    return rs.rows[0] as unknown as DbUser;
  },

  async updateProfile(
    userId: string,
    updates: { username?: string; avatarUrl?: string | null; passwordHash?: string }
  ): Promise<DbUser | null> {
    const user = await this.findById(userId);
    if (!user) return null;

    const newUsername = updates.username ? updates.username.trim().toLowerCase() : user.username;
    const newAvatar = updates.avatarUrl !== undefined ? updates.avatarUrl : user.avatar_url;
    const newPasswordHash = updates.passwordHash || user.password_hash;
    const now = Date.now();

    await db.execute({
      sql: `UPDATE users 
            SET username = ?, avatar_url = ?, password_hash = ?, updated_at = ?
            WHERE id = ?`,
      args: [newUsername, newAvatar, newPasswordHash, now, userId],
    });

    return this.findById(userId);
  },

  async saveRefreshToken(token: {
    id: string;
    userId: string;
    tokenHash: string;
    expiresAt: number;
  }): Promise<void> {
    const now = Date.now();
    await db.execute({
      sql: `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
            VALUES (?, ?, ?, ?, 0, ?)`,
      args: [token.id, token.userId, token.tokenHash, token.expiresAt, now],
    });
  },

  async findRefreshToken(tokenHash: string): Promise<DbRefreshToken | null> {
    const rs = await db.execute({
      sql: `SELECT * FROM refresh_tokens 
            WHERE token_hash = ? AND revoked = 0 AND expires_at > ?
            LIMIT 1`,
      args: [tokenHash, Date.now()],
    });

    if (rs.rows.length === 0) return null;
    return rs.rows[0] as unknown as DbRefreshToken;
  },

  async revokeRefreshToken(tokenHash: string): Promise<void> {
    await db.execute({
      sql: `UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?`,
      args: [tokenHash],
    });
  },

  async revokeAllUserTokens(userId: string): Promise<void> {
    await db.execute({
      sql: `UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?`,
      args: [userId],
    });
  },

  async cleanExpiredTokens(): Promise<void> {
    await db.execute({
      sql: `DELETE FROM refresh_tokens WHERE expires_at < ? OR revoked = 1`,
      args: [Date.now()],
    });
  },
};
