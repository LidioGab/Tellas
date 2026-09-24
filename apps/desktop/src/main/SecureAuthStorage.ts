import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

const AUTH_FILE_NAME = 'auth-session.bin';

function authFilePath(): string {
  return path.join(app.getPath('userData'), AUTH_FILE_NAME);
}

export const secureAuthStorage = {
  saveRefreshToken(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Armazenamento seguro indisponível neste dispositivo.');
    }
    const encrypted = safeStorage.encryptString(token);
    fs.writeFileSync(authFilePath(), encrypted, { mode: 0o600 });
  },

  getRefreshToken(): string | null {
    const filePath = authFilePath();
    if (!fs.existsSync(filePath) || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(filePath));
    } catch (error) {
      console.error('[SecureAuthStorage] Failed to decrypt auth session:', error);
      this.clear();
      return null;
    }
  },

  clear(): void {
    const filePath = authFilePath();
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  },
};
