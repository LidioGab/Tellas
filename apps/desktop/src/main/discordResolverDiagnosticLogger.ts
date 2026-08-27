import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

let logFilePath: string | null = null;
let isInitialized = false;

/**
 * Returns the target absolute path for tellas-discord-resolver.log.
 * Priority: Application's own folder where it is built / executed (e.g. release\win-unpacked),
 * with fallback to userData if exe folder is read-only.
 */
export function getResolverLogPath(): string {
  if (!logFilePath) {
    try {
      let baseDir = process.cwd();
      if (app && app.isPackaged && typeof app.getPath === 'function') {
        baseDir = path.dirname(app.getPath('exe'));
      } else if (app && typeof app.getAppPath === 'function') {
        baseDir = process.cwd();
      }

      const candidatePath = path.join(baseDir, 'tellas-discord-resolver.log');
      // Test if writable
      try {
        fs.appendFileSync(candidatePath, '', 'utf8');
        logFilePath = candidatePath;
      } catch (_) {
        // Fallback to userData if exe directory lacks write permissions
        const userDataDir = app?.getPath ? app.getPath('userData') : process.cwd();
        logFilePath = path.join(userDataDir, 'tellas-discord-resolver.log');
      }
    } catch (_) {
      logFilePath = path.join(process.cwd(), 'tellas-discord-resolver.log');
    }
  }
  return logFilePath;
}

/**
 * Truncates and initializes the log file on a new session / test attempt.
 */
export function initResolverLog(): string {
  const filePath = getResolverLogPath();
  try {
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(
      filePath,
      `==================================================\n` +
      `[TELLAS-DISCORD-RESOLVER] Diagnostic Session Started: ${new Date().toISOString()}\n` +
      `Log File: ${filePath}\n` +
      `==================================================\n\n`,
      'utf8'
    );
    isInitialized = true;
  } catch (err: any) {
    console.error('[TELLAS-DISCORD-RESOLVER] Failed to initialize log file:', err?.message);
  }
  return filePath;
}

/**
 * Appends a message to tellas-discord-resolver.log safely without throwing.
 */
export function resolverLog(message: string): void {
  try {
    const filePath = getResolverLogPath();
    if (!isInitialized) {
      initResolverLog();
    }
    fs.appendFileSync(filePath, message + '\n', 'utf8');
  } catch (_) {
    // Fail silently
  }
}
