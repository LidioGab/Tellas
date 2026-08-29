import * as fs from 'fs';
import * as path from 'path';
import { app, shell } from 'electron';

export interface DiagnosticLogEntry {
  layer: 'MAIN' | 'NATIVE' | 'PRELOAD' | 'RENDERER' | 'WORKLET' | 'LIVEKIT';
  category: string;
  data: string | Record<string, any>;
}

export class Win10AudioDiagnosticLogger {
  private static instance: Win10AudioDiagnosticLogger;
  private currentLogFilePath: string | null = null;
  private currentSessionId: string | null = null;
  private logDirectory: string = '';
  private writeBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isWriting = false;

  private constructor() {
    try {
      const userDataPath = app ? app.getPath('userData') : process.cwd();
      this.logDirectory = path.join(userDataPath, 'logs');
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }
    } catch (err) {
      console.error('[Win10AudioDiagnosticLogger] Failed to initialize log directory:', err);
    }
  }

  public static getInstance(): Win10AudioDiagnosticLogger {
    if (!Win10AudioDiagnosticLogger.instance) {
      Win10AudioDiagnosticLogger.instance = new Win10AudioDiagnosticLogger();
    }
    return Win10AudioDiagnosticLogger.instance;
  }

  /**
   * Start a new diagnostic logging session
   */
  public startSession(prefix = 'audio'): string {
    const now = new Date();
    const timestampStr = now.toISOString().replace(/[:.]/g, '-');
    const randomHex = Math.random().toString(16).substring(2, 6);
    this.currentSessionId = `${prefix}-${timestampStr}-${randomHex}`;

    // Format filename: tellas-audio-win10-YYYY-MM-DD-HHmmss.txt
    const yyyy = now.getFullYear();
    const MM = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const filename = `tellas-audio-win10-${yyyy}-${MM}-${dd}-${HH}${mm}${ss}.txt`;

    this.currentLogFilePath = path.join(this.logDirectory, filename);

    // Rotate old logs: keep max 10
    this.rotateLogs(10);

    // Initial session header
    this.logImmediate('MAIN', 'SESSION', {
      event: 'Diagnostic session started',
      sessionId: this.currentSessionId,
      logFile: this.currentLogFilePath,
      startTime: now.toISOString()
    });

    return this.currentSessionId;
  }

  public getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  public getCurrentLogFilePath(): string | null {
    return this.currentLogFilePath;
  }

  public getLogDirectory(): string {
    return this.logDirectory;
  }

  /**
   * Append log entry with rate-limited periodic buffer flush
   */
  public log(layer: DiagnosticLogEntry['layer'], category: string, data: string | Record<string, any>): void {
    if (!this.currentLogFilePath) return;

    const timestamp = new Date().toISOString();
    let formattedData = '';

    if (typeof data === 'string') {
      formattedData = data;
    } else {
      formattedData = Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
    }

    const sessionPrefix = this.currentSessionId ? `[${this.currentSessionId}] ` : '';
    const line = `${timestamp} ${sessionPrefix}[${layer}] [${category}]\n${formattedData}\n`;
    this.writeBuffer.push(line);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushBuffer();
      }, 500);
    }
  }

  /**
   * Log critical event with immediate disk flush
   */
  public logImmediate(layer: DiagnosticLogEntry['layer'], category: string, data: string | Record<string, any>): void {
    this.log(layer, category, data);
    this.flushBuffer();
  }

  /**
   * Write session summary block
   */
  public writeSummary(summary: Record<string, any>): void {
    const timestamp = new Date().toISOString();
    const lines: string[] = [];
    lines.push('\n==================================================');
    lines.push('TELLAS WIN10 AUDIO DIAGNOSTIC SUMMARY');
    lines.push(`TIMESTAMP: ${timestamp}`);
    lines.push(`SESSION_ID: ${this.currentSessionId || 'N/A'}`);
    lines.push('==================================================');

    for (const [key, value] of Object.entries(summary)) {
      lines.push(`${key}=${value !== undefined && value !== null ? value : 'N/A'}`);
    }

    lines.push('==================================================\n');
    const summaryBlock = lines.join('\n');
    this.writeBuffer.push(summaryBlock);
    this.flushBuffer();
  }

  private flushBuffer(): void {
    if (this.writeBuffer.length === 0 || !this.currentLogFilePath || this.isWriting) {
      return;
    }

    const contentToWrite = this.writeBuffer.join('\n');
    this.writeBuffer = [];
    this.isWriting = true;

    fs.appendFile(this.currentLogFilePath, contentToWrite, 'utf8', (err) => {
      this.isWriting = false;
      if (err) {
        console.error('[Win10AudioDiagnosticLogger] Error writing to log file:', err.message);
      }
      if (this.writeBuffer.length > 0) {
        this.flushBuffer();
      }
    });
  }

  /**
   * Keep maximum N recent tellas-audio-win10-*.txt log files
   */
  private rotateLogs(maxFiles: number): void {
    try {
      if (!fs.existsSync(this.logDirectory)) return;

      const files = fs.readdirSync(this.logDirectory);
      const diagnosticLogs = files
        .filter((file) => file.startsWith('tellas-audio-win10-') && file.endsWith('.txt'))
        .map((file) => ({
          filename: file,
          fullPath: path.join(this.logDirectory, file),
          mtime: fs.statSync(path.join(this.logDirectory, file)).mtime.getTime()
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      if (diagnosticLogs.length > maxFiles) {
        const toDelete = diagnosticLogs.slice(maxFiles);
        for (const item of toDelete) {
          try {
            fs.unlinkSync(item.fullPath);
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[Win10AudioDiagnosticLogger] Error rotating logs:', err);
    }
  }

  /**
   * Open the log folder in Windows Explorer
   */
  public openLogFolder(): boolean {
    try {
      if (this.currentLogFilePath && fs.existsSync(this.currentLogFilePath)) {
        shell.showItemInFolder(this.currentLogFilePath);
        return true;
      } else if (this.logDirectory && fs.existsSync(this.logDirectory)) {
        shell.openPath(this.logDirectory);
        return true;
      }
    } catch (err) {
      console.error('[Win10AudioDiagnosticLogger] Failed to open log folder:', err);
    }
    return false;
  }
}

export const win10AudioLogger = Win10AudioDiagnosticLogger.getInstance();
