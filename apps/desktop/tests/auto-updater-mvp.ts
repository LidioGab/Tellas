import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AppUpdater } from 'electron-updater';
import { AppUpdaterService } from '../src/main/AppUpdaterService';

class MockUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checkCalls = 0;
  downloadCalls = 0;
  installCalls = 0;
  pendingCheck: Promise<void> | null = null;

  async checkForUpdates(): Promise<null> {
    this.checkCalls += 1;
    this.emit('checking-for-update');
    if (this.pendingCheck) await this.pendingCheck;
    return null;
  }

  async downloadUpdate(): Promise<string[]> {
    this.downloadCalls += 1;
    return [];
  }

  quitAndInstall(): void {
    this.installCalls += 1;
  }
}

function createService(updater: MockUpdater, isPackaged: boolean) {
  const statuses: string[] = [];
  const service = new AppUpdaterService({
    updater: updater as unknown as AppUpdater,
    isPackaged,
    currentVersion: '1.0.4',
    startupDelayMs: 60_000,
    onStatusChanged: (status) => statuses.push(status.state),
  });
  return { service, statuses };
}

async function main() {
  const devUpdater = new MockUpdater();
  const dev = createService(devUpdater, false);
  dev.service.initialize();
  assert.equal(devUpdater.checkCalls, 0, 'dev mode must not check for updates');

  const updater = new MockUpdater();
  const packaged = createService(updater, true);
  packaged.service.initialize();
  assert.equal(updater.autoDownload, false, 'autoDownload must be disabled');
  assert.equal(updater.autoInstallOnAppQuit, false, 'auto install on app quit must be disabled');
  assert.equal(packaged.service.getStatus().currentVersion, '1.0.4', 'desktop version must come from the injected app version');

  let resolveCheck: (() => void) | undefined;
  updater.pendingCheck = new Promise<void>((resolve) => { resolveCheck = resolve; });
  const firstCheck = packaged.service.checkForUpdates();
  const secondCheck = packaged.service.checkForUpdates();
  assert.equal(updater.checkCalls, 1, 'concurrent checks must share one operation');
  resolveCheck?.();
  await Promise.all([firstCheck, secondCheck]);
  assert.ok(packaged.statuses.includes('checking'), 'checking event must update state');

  updater.emit('update-available', { version: '1.0.5' });
  assert.equal(packaged.service.getStatus().state, 'available');
  assert.equal(packaged.service.getStatus().availableVersion, '1.0.5');
  assert.equal(packaged.service.installUpdate(), false, 'install must be rejected before download completion');
  assert.equal(updater.installCalls, 0, 'quitAndInstall must not run without explicit valid action');

  await packaged.service.downloadUpdate();
  assert.equal(updater.downloadCalls, 1, 'download must start only after the explicit command');
  updater.emit('download-progress', { percent: 42.4, transferred: 42, total: 100, bytesPerSecond: 10 });
  assert.equal(packaged.service.getStatus().progress?.percent, 42.4);
  updater.emit('update-downloaded', { version: '1.0.5' });
  assert.equal(packaged.service.getStatus().state, 'downloaded');
  assert.equal(updater.installCalls, 0, 'download completion must not install automatically');

  assert.equal(packaged.service.installUpdate(), true, 'explicit install action must be accepted after download');
  assert.equal(updater.installCalls, 1, 'quitAndInstall must run exactly once after explicit action');

  updater.emit('error', new Error('offline'));
  assert.equal(packaged.service.getStatus().state, 'error', 'updater errors must become non-fatal state');

  const componentPath = path.resolve('src/renderer/src/components/AppUpdateControl.tsx');
  const componentSource = fs.readFileSync(componentPath, 'utf8');
  assert.match(componentSource, /if \(!isDesktop\)/, 'web runtime must have an explicit desktop guard');
  assert.match(componentSource, /Tellas Web/, 'web runtime must identify itself as Tellas Web');
  assert.match(componentSource, /appInfo\.get\(\)/, 'desktop version must be requested from the main process');

  console.log('[TELLAS][TEST][AUTO_UPDATER_MVP] PASS');
}

void main().catch((error) => {
  console.error('[TELLAS][TEST][AUTO_UPDATER_MVP] FAIL', error);
  process.exitCode = 1;
});
