import * as os from 'os';
import { AudioCaptureStrategy, WindowsAudioEnvironment } from '@stream-app/shared';

/**
 * Pure function: Classify Windows version strictly for UI display based on build number.
 * Build >= 22000 represents Windows 11.
 * Build < 22000 represents Windows 10.
 */
export function getWindowsDisplayVersion(build: number): 'Windows 10' | 'Windows 11' | 'Unknown' {
  if (build >= 22000) {
    return 'Windows 11';
  }
  if (build > 0 && build < 22000) {
    return 'Windows 10';
  }
  return 'Unknown';
}

/**
 * Pure function: Select audio capture strategy based on actual hardware/OS capability.
 * - Windows 11 and Windows 10 build >= 20348 (Server 2022) -> PROCESS_LOOPBACK (Officially Supported)
 * - Windows 10 build 19041..20347 (2004, 20H2, 21H1, 21H2, 22H2) -> PROCESS_LOOPBACK_PROBE (Probe Eligible)
 * - Windows build < 19041 -> VIRTUAL_AUDIO_REQUIRED
 */
export function selectAudioCaptureStrategy(
  officialSupported: boolean,
  probeEligible: boolean
): AudioCaptureStrategy {
  if (officialSupported) {
    return AudioCaptureStrategy.PROCESS_LOOPBACK;
  }
  if (probeEligible) {
    return AudioCaptureStrategy.PROCESS_LOOPBACK_PROBE;
  }
  return AudioCaptureStrategy.VIRTUAL_AUDIO_REQUIRED;
}

/**
 * Extract system build number from OS release string (e.g. "10.0.19045" -> 19045, "10.0.26100" -> 26100).
 */
export function parseWindowsBuild(releaseStr = os.release()): number {
  try {
    const parts = releaseStr.split('.');
    if (parts.length >= 3) {
      const buildNum = parseInt(parts[2], 10);
      if (!isNaN(buildNum)) return buildNum;
    }
  } catch (_) {}
  return 0;
}

/**
 * Centrally determine the complete Windows audio environment and capture strategy.
 */
export function getWindowsAudioEnvironment(
  isNativeOfficiallySupported: boolean,
  isNativeProbeEligible: boolean
): WindowsAudioEnvironment {
  const platform = process.platform;
  const release = os.release();
  const build = parseWindowsBuild(release);
  const windowsVersion = platform === 'win32' ? getWindowsDisplayVersion(build) : 'Unknown';

  const officialProcessLoopbackSupported = isNativeOfficiallySupported;
  const processLoopbackProbeEligible = isNativeProbeEligible;
  const processLoopbackSupported = officialProcessLoopbackSupported || processLoopbackProbeEligible;

  const strategy = selectAudioCaptureStrategy(
    officialProcessLoopbackSupported,
    processLoopbackProbeEligible
  );

  return {
    platform,
    release,
    build,
    windowsVersion,
    officialProcessLoopbackSupported,
    processLoopbackProbeEligible,
    processLoopbackSupported,
    strategy,
  };
}
