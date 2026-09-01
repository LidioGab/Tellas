import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import type { UpdaterStatus } from '../updater/types';

type StatusListener = (status: UpdaterStatus) => void;

export interface AppUpdaterServiceOptions {
  updater: AppUpdater;
  isPackaged: boolean;
  currentVersion: string;
  onStatusChanged: StatusListener;
  startupDelayMs?: number;
}
export class AppUpdaterService {
  private status: UpdaterStatus;
  private initialized = false;
  private checkPromise: Promise<UpdaterStatus> | null = null;
  private downloadPromise: Promise<UpdaterStatus> | null = null;

  constructor(private readonly options: AppUpdaterServiceOptions) {
    this.status = { state: 'idle', currentVersion: options.currentVersion };
  }

  initialize(): void {
    if (this.initialized || !this.options.isPackaged) return;
    this.initialized = true;

    const updater = this.options.updater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;

    updater.on('checking-for-update', () => {
      console.log('[TELLAS][UPDATER][CHECKING]');
      this.updateStatus({ state: 'checking', progress: undefined, error: undefined });
    });
    updater.on('update-available', (info: UpdateInfo) => {
      console.log('[TELLAS][UPDATER][AVAILABLE]', { version: info.version });
      this.updateStatus({ state: 'available', availableVersion: info.version, progress: undefined, error: undefined });
    });
    updater.on('update-not-available', (info: UpdateInfo) => {
      console.log('[TELLAS][UPDATER][NOT_AVAILABLE]', { version: info.version });
      this.updateStatus({ state: 'upToDate', availableVersion: undefined, progress: undefined, error: undefined });
    });
    updater.on('download-progress', (progress: ProgressInfo) => {
      const normalizedProgress = {
        percent: Math.max(0, Math.min(100, progress.percent)),
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      };
      console.log('[TELLAS][UPDATER][DOWNLOAD]', { percent: Math.round(normalizedProgress.percent) });
      this.updateStatus({ state: 'downloading', progress: normalizedProgress, error: undefined });
    });
    updater.on('update-downloaded', (info: UpdateInfo) => {
      console.log('[TELLAS][UPDATER][DOWNLOADED]', { version: info.version });
      this.updateStatus({ state: 'downloaded', availableVersion: info.version, progress: undefined, error: undefined });
    });
    updater.on('error', (error: Error) => {
      const message = error?.message || 'Falha desconhecida ao atualizar.';
      console.error('[TELLAS][UPDATER][ERROR]', { message });
      this.updateStatus({ state: 'error', progress: undefined, error: message });
    });

    const delay = this.options.startupDelayMs ?? 5_000;
    setTimeout(() => void this.checkForUpdates(), delay).unref?.();
  }

  getStatus(): UpdaterStatus {
    return { ...this.status, progress: this.status.progress ? { ...this.status.progress } : undefined };
  }

  async checkForUpdates(): Promise<UpdaterStatus> {
    if (!this.options.isPackaged) return this.getStatus();
    if (this.checkPromise) return this.checkPromise;

    this.checkPromise = (async () => {
      try {
        await this.options.updater.checkForUpdates();
      } catch (error) {
        this.handleOperationError(error);
      } finally {
        this.checkPromise = null;
      }
      return this.getStatus();
    })();
    return this.checkPromise;
  }

  async downloadUpdate(): Promise<UpdaterStatus> {
    if (!this.options.isPackaged || this.status.state !== 'available') return this.getStatus();
    if (this.downloadPromise) return this.downloadPromise;

    this.updateStatus({ state: 'downloading', progress: { percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 }, error: undefined });
    this.downloadPromise = (async () => {
      try {
        await this.options.updater.downloadUpdate();
      } catch (error) {
        this.handleOperationError(error);
      } finally {
        this.downloadPromise = null;
      }
      return this.getStatus();
    })();
    return this.downloadPromise;
  }

  installUpdate(): boolean {
    if (!this.options.isPackaged || this.status.state !== 'downloaded') return false;
    this.options.updater.quitAndInstall(false, true);
    return true;
  }

  private updateStatus(patch: Partial<UpdaterStatus>): void {
    this.status = { ...this.status, ...patch };
    this.options.onStatusChanged(this.getStatus());
  }

  private handleOperationError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[TELLAS][UPDATER][ERROR]', { message });
    this.updateStatus({ state: 'error', progress: undefined, error: message });
  }
}
