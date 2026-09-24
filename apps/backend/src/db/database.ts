import { createClient, Client } from '@libsql/client';
import path from 'path';
import fs from 'fs';

// ─── Database Connection & Setup ─────────────────────────────────────────────

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const defaultDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const dbPath = process.env.DATABASE_PATH || path.join(defaultDir, 'tellas.db');
  const targetDir = path.dirname(dbPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(`[Database] Created directory: ${targetDir}`);
  }

  const normalized = dbPath.replace(/\\/g, '/');
  return `file:${normalized}`;
}

export function createDatabaseClient(customUrl?: string): Client {
  const url = customUrl || resolveDatabaseUrl();
  console.log(`[Database] Initializing SQLite / LibSQL at: ${url}`);
  
  const client = createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  return client;
}

export async function runDatabaseMigrations(client: Client): Promise<void> {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      email TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`,
    `CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`,
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);`,
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);`,
  ], 'write');

  console.log('[Database] Migrations and indices verified successfully.');
}

// Global database client instance
export const db = createDatabaseClient();
