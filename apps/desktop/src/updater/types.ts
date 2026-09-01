export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdaterProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}
export interface UpdaterStatus {
  state: UpdaterState;
  currentVersion: string;
  availableVersion?: string;
  progress?: UpdaterProgress;
  error?: string;
}

export interface AppInfo {
  runtime: 'desktop';
  version: string;
}
