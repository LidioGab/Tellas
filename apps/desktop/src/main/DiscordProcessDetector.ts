import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolverLog, getResolverLogPath } from './discordResolverDiagnosticLogger';

import * as path from 'path';

// Safely import native addon for audio sessions
let NativeAudioModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  NativeAudioModule = require('@stream-app/native-audio');
} catch (err: any) {
  const candidatePaths = [
    process.resourcesPath ? path.join(process.resourcesPath, 'packages', 'native-audio', 'index.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'native_audio.node') : null,
    path.join(__dirname, '..', '..', '..', 'packages', 'native-audio', 'index.js'),
    path.join(process.cwd(), 'packages', 'native-audio', 'index.js')
  ].filter(Boolean) as string[];

  for (const candidate of candidatePaths) {
    try {
      NativeAudioModule = require(candidate);
      if (NativeAudioModule) break;
    } catch (_) { }
  }
}

const execFileAsync = promisify(execFile);

export interface RawProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  executablePath: string;
  commandLine?: string;
}

export interface AudioSessionEntry {
  processId: number;
  state: 'active' | 'inactive' | 'expired' | string;
}

export type DiscordDetectionResult =
  | { success: true; rootPid: number; evidence: string; allPids: number[] }
  | { success: false; reason: 'NOT_FOUND'; allPids: number[] }
  | { success: false; reason: 'AMBIGUOUS_AUDIO_ROOTS' | 'AMBIGUOUS_ROOTS'; roots: number[]; allPids: number[] }
  | { success: false; reason: 'ERROR'; error: string; allPids: number[] };

const KNOWN_STRONG_DISCORD_EXECUTABLES = new Set([
  'discord.exe',
  'discordcanary.exe',
  'discordptb.exe',
  'discorddevelopment.exe'
]);

const DISCORD_PATH_REGEX = /[\\/](discord|discordcanary|discordptb|discorddevelopment)[\\/]/i;

export interface ProcessClassification {
  isDiscord: boolean;
  isStrongExecutable: boolean;
  isMainCandidate: boolean;
  isAudioServiceCommandLine: boolean;
  isWeakOrphanHelper: boolean;
  reason: string;
}

/**
 * Classifies whether a given process belongs to Discord and determines its evidence level.
 */
export function classifyProcess(proc: RawProcessInfo): ProcessClassification {
  if (!proc) {
    return {
      isDiscord: false,
      isStrongExecutable: false,
      isMainCandidate: false,
      isAudioServiceCommandLine: false,
      isWeakOrphanHelper: false,
      reason: 'null-process'
    };
  }

  const nameLower = (proc.name || '').toLowerCase().trim();
  const execPath = proc.executablePath || '';
  const cmd = proc.commandLine || '';
  const hasDiscordPath = execPath ? DISCORD_PATH_REGEX.test(execPath) : false;

  const isStrongName = KNOWN_STRONG_DISCORD_EXECUTABLES.has(nameLower);
  const isHelperName = nameLower === 'discordsystemhelper.exe' || nameLower.startsWith('discordsystemhelper');
  const isGenericDiscordName = isStrongName || isHelperName || nameLower.startsWith('discord');

  const isAudioServiceCommandLine = cmd.includes('--utility-sub-type=audio.mojom.AudioService') || cmd.includes('audio.mojom.AudioService');
  const isMainCandidate = (isStrongName || hasDiscordPath) && !cmd.includes('--type=');

  if (isStrongName) {
    return {
      isDiscord: true,
      isStrongExecutable: true,
      isMainCandidate,
      isAudioServiceCommandLine,
      isWeakOrphanHelper: false,
      reason: `strong-name-match:${proc.name}`
    };
  }

  if (hasDiscordPath) {
    return {
      isDiscord: true,
      isStrongExecutable: true,
      isMainCandidate,
      isAudioServiceCommandLine,
      isWeakOrphanHelper: false,
      reason: `path-match:${execPath}`
    };
  }

  if (isHelperName) {
    // If it's a helper without valid path and without parent in process table, it's a weak orphan helper
    const isWeak = !execPath && (!cmd || cmd === 'N/A');
    return {
      isDiscord: true,
      isStrongExecutable: false,
      isMainCandidate: false,
      isAudioServiceCommandLine,
      isWeakOrphanHelper: isWeak,
      reason: isWeak ? `weak-orphan-helper:${proc.name}` : `helper-name-match:${proc.name}`
    };
  }

  if (isGenericDiscordName) {
    return {
      isDiscord: true,
      isStrongExecutable: false,
      isMainCandidate,
      isAudioServiceCommandLine,
      isWeakOrphanHelper: false,
      reason: `generic-name-match:${proc.name}`
    };
  }

  return {
    isDiscord: false,
    isStrongExecutable: false,
    isMainCandidate: false,
    isAudioServiceCommandLine: false,
    isWeakOrphanHelper: false,
    reason: `no-discord-match (name=${proc.name || 'unknown'}, path=${execPath || 'empty'})`
  };
}

export function isDiscordProcess(proc: RawProcessInfo): boolean {
  return classifyProcess(proc).isDiscord;
}

/**
 * Traces the ancestry of a starting process to find its top-most Discord-owned ancestor root.
 * Never climbs to generic OS processes (explorer.exe, services.exe, svchost.exe).
 */
export function resolveTopMostDiscordRoot(
  startProc: RawProcessInfo,
  processMap: Map<number, RawProcessInfo>
): { rootPid: number; rootProc: RawProcessInfo; chain: number[]; stopReason: string } {
  let current = startProc;
  const chain: number[] = [current.pid];
  const visited = new Set<number>([current.pid]);
  let stopReason = 'STOP_ROOT_REACHED';

  while (current.parentPid) {
    if (!processMap.has(current.parentPid)) {
      stopReason = `STOP_PARENT_NOT_FOUND (PPID ${current.parentPid} not in process table)`;
      break;
    }

    const parent = processMap.get(current.parentPid)!;

    if (visited.has(parent.pid)) {
      stopReason = `STOP_CYCLE_DETECTED (PPID ${parent.pid} cycle)`;
      break;
    }
    visited.add(parent.pid);

    const parentCls = classifyProcess(parent);
    if (!parentCls.isDiscord) {
      stopReason = `STOP_PARENT_NOT_DISCORD (Parent PID ${parent.pid} ${parent.name}: ${parentCls.reason})`;
      break;
    }

    current = parent;
    chain.push(current.pid);
  }

  return {
    rootPid: current.pid,
    rootProc: current,
    chain,
    stopReason
  };
}

/**
 * Pure function to resolve Discord root PID using a tiered evidence system.
 */
export function resolveDiscordRootEvidenceBased(
  processes: RawProcessInfo[],
  audioSessions: AudioSessionEntry[] = []
): DiscordDetectionResult {
  const timestamp = new Date().toISOString();
  resolverLog(`==================================================`);
  resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT START`);
  resolverLog(`timestamp=${timestamp}`);
  resolverLog(`totalProcessesInTable=${processes ? processes.length : 0}`);
  resolverLog(`totalAudioSessionsReported=${audioSessions ? audioSessions.length : 0}`);
  resolverLog(`==================================================\n`);

  if (!processes || processes.length === 0) {
    resolverLog(`[TELLAS-DISCORD-RESOLVER] Process table is empty.`);
    resolverLog(`==================================================`);
    resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
    resolverLog(`decision=NOT_FOUND`);
    resolverLog(`==================================================\n`);
    return { success: false, reason: 'NOT_FOUND', allPids: [] };
  }

  const processMap = new Map<number, RawProcessInfo>();
  for (const p of processes) {
    if (p && typeof p.pid === 'number' && !isNaN(p.pid) && p.pid > 0) {
      processMap.set(p.pid, p);
    }
  }

  // Identify all Discord processes and classify them
  const discordProcesses: RawProcessInfo[] = [];
  const discordPids: number[] = [];
  const classifications = new Map<number, ProcessClassification>();

  for (const proc of processMap.values()) {
    const cls = classifyProcess(proc);
    if (cls.isDiscord) {
      discordProcesses.push(proc);
      discordPids.push(proc.pid);
      classifications.set(proc.pid, cls);
    }
  }

  // Log audio sessions
  resolverLog(`--- AUDIO SESSION DISCOVERY ---`);
  resolverLog(`Audio sessions count=${audioSessions.length}`);
  audioSessions.forEach((s, idx) => {
    const p = processMap.get(s.processId);
    resolverLog(`  session[${idx}]: PID=${s.processId} state=${s.state} procName=${p?.name || 'unknown'}`);
  });
  resolverLog('');

  if (discordProcesses.length === 0) {
    resolverLog(`[TELLAS-DISCORD-RESOLVER] No Discord processes found in process table.`);
    resolverLog(`==================================================`);
    resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
    resolverLog(`decision=NOT_FOUND`);
    resolverLog(`==================================================\n`);
    return { success: false, reason: 'NOT_FOUND', allPids: [] };
  }

  // ─── TIER 1: Windows Render Audio Sessions Intersection ──────────────────
  const discordAudioSessions = audioSessions.filter((s) => {
    const p = processMap.get(s.processId);
    return p && isDiscordProcess(p) && s.state !== 'expired';
  });

  resolverLog(`--- DISCORD AUDIO INTERSECTION ---`);
  resolverLog(`Discord audio session candidates count=${discordAudioSessions.length}`);
  discordAudioSessions.forEach((s) => {
    const p = processMap.get(s.processId)!;
    resolverLog(`  matched session: PID=${s.processId} state=${s.state} name=${p.name} path=${p.executablePath || 'N/A'}`);
  });
  resolverLog('');

  if (discordAudioSessions.length > 0) {
    resolverLog(`--- TIER 1: EVALUATING WINDOWS AUDIO SESSIONS ---`);
    const sessionRoots = new Set<number>();

    for (const session of discordAudioSessions) {
      const proc = processMap.get(session.processId)!;
      const res = resolveTopMostDiscordRoot(proc, processMap);
      sessionRoots.add(res.rootPid);
      resolverLog(`  session PID=${session.processId} (${proc.name}) -> root PID=${res.rootPid} (${res.rootProc.name}) [chain: ${res.chain.join(' -> ')}] [${res.stopReason}]`);
    }

    const uniqueSessionRoots = Array.from(sessionRoots);
    resolverLog(`Unique Tier 1 Roots: [${uniqueSessionRoots.join(', ')}] (count=${uniqueSessionRoots.length})`);

    if (uniqueSessionRoots.length === 1) {
      const selected = uniqueSessionRoots[0];
      resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=UNIQUE_ROOT selectedPid=${selected} evidence=TIER_1_WINDOWS_AUDIO_SESSION`);
      resolverLog(`==================================================`);
      resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
      resolverLog(`decision=UNIQUE_ROOT (selectedPid=${selected}, evidence=TIER_1_WINDOWS_AUDIO_SESSION)`);
      resolverLog(`==================================================\n`);
      return {
        success: true,
        rootPid: selected,
        evidence: 'TIER_1_WINDOWS_AUDIO_SESSION',
        allPids: discordPids
      };
    }

    // Multiple independent audio roots -> Fail Closed
    resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=AMBIGUOUS_AUDIO_ROOTS roots=[${uniqueSessionRoots.join(', ')}]`);
    resolverLog(`==================================================`);
    resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
    resolverLog(`decision=AMBIGUOUS_AUDIO_ROOTS (roots=[${uniqueSessionRoots.join(', ')}])`);
    resolverLog(`==================================================\n`);
    return {
      success: false,
      reason: 'AMBIGUOUS_AUDIO_ROOTS',
      roots: uniqueSessionRoots,
      allPids: discordPids
    };
  }

  // ─── TIER 2: Secondary Audio Evidence (CommandLine AudioService) ─────────
  resolverLog(`--- TIER 2: EVALUATING AUDIO SERVICE COMMAND LINE (FALLBACK 1) ---`);
  const audioServiceProcesses = discordProcesses.filter((p) => {
    const cls = classifications.get(p.pid);
    return cls && cls.isAudioServiceCommandLine;
  });

  resolverLog(`CommandLine AudioService processes count=${audioServiceProcesses.length}`);
  audioServiceProcesses.forEach((p) => {
    resolverLog(`  audioService candidate: PID=${p.pid} PPID=${p.parentPid} name=${p.name}`);
  });

  if (audioServiceProcesses.length > 0) {
    const audioServiceRoots = new Set<number>();
    for (const proc of audioServiceProcesses) {
      const res = resolveTopMostDiscordRoot(proc, processMap);
      audioServiceRoots.add(res.rootPid);
      resolverLog(`  audioService PID=${proc.pid} -> root PID=${res.rootPid} (${res.rootProc.name}) [chain: ${res.chain.join(' -> ')}] [${res.stopReason}]`);
    }

    const uniqueAudioRoots = Array.from(audioServiceRoots);
    resolverLog(`Unique Tier 2 Roots: [${uniqueAudioRoots.join(', ')}] (count=${uniqueAudioRoots.length})`);

    if (uniqueAudioRoots.length === 1) {
      const selected = uniqueAudioRoots[0];
      resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=UNIQUE_ROOT selectedPid=${selected} evidence=TIER_2_AUDIO_SERVICE_COMMAND_LINE`);
      resolverLog(`==================================================`);
      resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
      resolverLog(`decision=UNIQUE_ROOT (selectedPid=${selected}, evidence=TIER_2_AUDIO_SERVICE_COMMAND_LINE)`);
      resolverLog(`==================================================\n`);
      return {
        success: true,
        rootPid: selected,
        evidence: 'TIER_2_AUDIO_SERVICE_COMMAND_LINE',
        allPids: discordPids
      };
    }

    resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=AMBIGUOUS_AUDIO_ROOTS roots=[${uniqueAudioRoots.join(', ')}]`);
    resolverLog(`==================================================`);
    resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
    resolverLog(`decision=AMBIGUOUS_AUDIO_ROOTS (roots=[${uniqueAudioRoots.join(', ')}])`);
    resolverLog(`==================================================\n`);
    return {
      success: false,
      reason: 'AMBIGUOUS_AUDIO_ROOTS',
      roots: uniqueAudioRoots,
      allPids: discordPids
    };
  }

  // ─── TIER 3: Strong Main Process Fallback ──────────────────────────────────
  resolverLog(`--- TIER 3: EVALUATING STRONG MAIN DISCORD PROCESSES (FALLBACK 2) ---`);
  // Prioritize main processes without --type=
  let mainCandidates = discordProcesses.filter((p) => {
    const cls = classifications.get(p.pid);
    return cls && cls.isMainCandidate && !cls.isWeakOrphanHelper;
  });

  if (mainCandidates.length === 0) {
    // If none without --type=, consider all strong executables
    mainCandidates = discordProcesses.filter((p) => {
      const cls = classifications.get(p.pid);
      return cls && cls.isStrongExecutable && !cls.isWeakOrphanHelper;
    });
  }

  resolverLog(`Strong main candidates count=${mainCandidates.length}`);
  mainCandidates.forEach((p) => {
    resolverLog(`  main candidate: PID=${p.pid} PPID=${p.parentPid} name=${p.name} path=${p.executablePath || 'N/A'}`);
  });

  if (mainCandidates.length > 0) {
    const mainRoots = new Set<number>();
    for (const proc of mainCandidates) {
      const res = resolveTopMostDiscordRoot(proc, processMap);
      mainRoots.add(res.rootPid);
      resolverLog(`  candidate PID=${proc.pid} -> root PID=${res.rootPid} (${res.rootProc.name}) [chain: ${res.chain.join(' -> ')}] [${res.stopReason}]`);
    }

    const uniqueMainRoots = Array.from(mainRoots);
    resolverLog(`Unique Tier 3 Roots: [${uniqueMainRoots.join(', ')}] (count=${uniqueMainRoots.length})`);

    if (uniqueMainRoots.length === 1) {
      const selected = uniqueMainRoots[0];
      resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=UNIQUE_ROOT selectedPid=${selected} evidence=TIER_3_MAIN_PROCESS`);
      resolverLog(`==================================================`);
      resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
      resolverLog(`decision=UNIQUE_ROOT (selectedPid=${selected}, evidence=TIER_3_MAIN_PROCESS)`);
      resolverLog(`==================================================\n`);
      return {
        success: true,
        rootPid: selected,
        evidence: 'TIER_3_MAIN_PROCESS',
        allPids: discordPids
      };
    }

    resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=AMBIGUOUS_ROOTS roots=[${uniqueMainRoots.join(', ')}]`);
    resolverLog(`==================================================`);
    resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
    resolverLog(`decision=AMBIGUOUS_ROOTS (roots=[${uniqueMainRoots.join(', ')}])`);
    resolverLog(`==================================================\n`);
    return {
      success: false,
      reason: 'AMBIGUOUS_ROOTS',
      roots: uniqueMainRoots,
      allPids: discordPids
    };
  }

  // ─── TIER 4: Only Weak Orphan Helpers Exist ──────────────────────────────
  resolverLog(`--- TIER 4: ONLY WEAK ORPHAN HELPERS EXIST ---`);
  resolverLog(`[TELLAS-DISCORD-RESOLVER] Only weak orphan helpers found without verifiable main Discord process.`);
  resolverLog(`[TELLAS-DISCORD-RESOLVER] DECISION=AMBIGUOUS_ROOTS (failing closed)`);
  resolverLog(`==================================================`);
  resolverLog(`[TELLAS-DISCORD-RESOLVER] RESOLVER ATTEMPT END`);
  resolverLog(`decision=AMBIGUOUS_ROOTS (only weak orphan helpers)`);
  resolverLog(`==================================================\n`);

  return {
    success: false,
    reason: 'AMBIGUOUS_ROOTS',
    roots: discordPids,
    allPids: discordPids
  };
}

/**
 * Fetches all Windows processes via static CIM query without user inputs.
 */
export async function queryAllProcesses(): Promise<RawProcessInfo[]> {
  if (process.platform !== 'win32') return [];

  try {
    const psScript = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress`;
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { windowsHide: true, timeout: 4000 }
    );

    if (!stdout || !stdout.trim()) return [];
    const parsed = JSON.parse(stdout.trim());
    const list = Array.isArray(parsed) ? parsed : [parsed];

    return list
      .filter((item: any) => item && item.ProcessId)
      .map((item: any) => ({
        pid: Number(item.ProcessId),
        parentPid: Number(item.ParentProcessId || 0),
        name: String(item.Name || ''),
        executablePath: String(item.ExecutablePath || ''),
        commandLine: item.CommandLine ? String(item.CommandLine) : undefined
      }));
  } catch (err: any) {
    resolverLog(`[TELLAS-DISCORD-RESOLVER][ERROR] Failed to query processes via CIM: ${err?.message}`);
    return [];
  }
}

/**
 * Fetches Windows Core Audio Render Sessions from the native addon.
 */
export function queryRenderAudioSessions(): AudioSessionEntry[] {
  if (NativeAudioModule && typeof NativeAudioModule.getRenderAudioSessions === 'function') {
    try {
      return NativeAudioModule.getRenderAudioSessions() || [];
    } catch (err: any) {
      resolverLog(`[TELLAS-DISCORD-RESOLVER][ERROR] Exception querying render audio sessions: ${err?.message}`);
      return [];
    }
  }
  return [];
}

/**
 * Verifies if a given process ID still exists in the system.
 */
export async function isProcessAlive(pid: number): Promise<boolean> {
  if (process.platform !== 'win32' || pid <= 0) return false;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`],
      { windowsHide: true, timeout: 2000 }
    );
    return Boolean(stdout && stdout.trim());
  } catch (_) {
    return false;
  }
}

/**
 * DiscordProcessDetector
 * Scalable evidence-based resolver using Windows Core Audio Sessions + Process Tree.
 */
export class DiscordProcessDetector {
  public static async detectDiscord(): Promise<DiscordDetectionResult> {
    const logPath = getResolverLogPath();
    console.log(`[TELLAS-DISCORD-RESOLVER] Diagnostic log: ${logPath}`);

    if (process.platform !== 'win32') {
      return { success: false, reason: 'NOT_FOUND', allPids: [] };
    }

    try {
      // 1. Fetch complete process table and render audio sessions
      let processes = await queryAllProcesses();
      let audioSessions = queryRenderAudioSessions();
      let result = resolveDiscordRootEvidenceBased(processes, audioSessions);

      // 2. Liveness check & controlled retry
      if (result.success) {
        const initialPid = result.rootPid;
        const alive = await isProcessAlive(initialPid);
        resolverLog(`[TELLAS-DISCORD-RESOLVER] Liveness check: initialSelectedPid=${initialPid} stillAlive=${alive}`);

        if (!alive) {
          resolverLog(`[TELLAS-DISCORD-RESOLVER] RETRY_REASON=PROCESS_DISAPPEARED. Re-querying process table and audio sessions...`);
          processes = await queryAllProcesses();
          audioSessions = queryRenderAudioSessions();
          result = resolveDiscordRootEvidenceBased(processes, audioSessions);
          if (result.success) {
            const retryAlive = await isProcessAlive(result.rootPid);
            resolverLog(`[TELLAS-DISCORD-RESOLVER] Retry liveness check: retrySelectedPid=${result.rootPid} stillAlive=${retryAlive}`);
            if (!retryAlive) {
              resolverLog(`[TELLAS-DISCORD-RESOLVER] Retry failed: root disappeared again. Failing to NOT_FOUND.`);
              result = { success: false, reason: 'NOT_FOUND', allPids: result.allPids };
            }
          }
        }
      }

      const decisionStr = result.success
        ? `UNIQUE_ROOT (pid=${result.rootPid}, evidence=${result.evidence})`
        : result.reason === 'AMBIGUOUS_AUDIO_ROOTS' || result.reason === 'AMBIGUOUS_ROOTS'
        ? `${result.reason} (roots=[${result.roots.join(', ')}])`
        : result.reason;

      console.log(`[TELLAS-DISCORD-RESOLVER] Decision=${decisionStr}`);

      return result;
    } catch (err: any) {
      resolverLog(`[TELLAS-DISCORD-RESOLVER][ERROR] Exception in detectDiscord: ${err?.message}`);
      return { success: false, reason: 'ERROR', error: err?.message || 'Unknown error', allPids: [] };
    }
  }
}
