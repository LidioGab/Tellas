import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface DiscordProcessInfo {
  name: string;
  rootPid: number;
  allPids: number[];
}

const DISCORD_PROCESS_NAMES = [
  'discord.exe',
  'discordcanary.exe',
  'discordptb.exe',
  'discorddevelopment.exe'
];

/**
 * DiscordProcessDetector
 * Fast and lightweight dynamic discovery of Discord, Canary, PTB processes on Windows.
 */
export class DiscordProcessDetector {
  public static async detectDiscord(): Promise<DiscordProcessInfo | null> {
    if (process.platform !== 'win32') {
      return null;
    }

    try {
      // Fast tasklist execution (10-30ms)
      const { stdout } = await execAsync('tasklist /fo csv /nh', {
        windowsHide: true,
        timeout: 2000
      });

      const lines = stdout.split(/\r?\n/);
      const foundPids: number[] = [];
      let detectedName = 'Discord.exe';

      for (const line of lines) {
        if (!line.trim()) continue;
        // Format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const parts = line.split('","').map((p) => p.replace(/"/g, '').trim());
        if (parts.length >= 2) {
          const procName = parts[0].toLowerCase();
          const pid = parseInt(parts[1], 10);

          if (DISCORD_PROCESS_NAMES.some((d) => procName === d || procName.startsWith('discord'))) {
            if (!isNaN(pid) && pid > 0) {
              foundPids.push(pid);
              detectedName = parts[0];
            }
          }
        }
      }

      if (foundPids.length === 0) {
        return null;
      }

      // Root PID in Windows tasklist is usually the lowest PID or first created
      return {
        name: detectedName,
        rootPid: Math.min(...foundPids),
        allPids: foundPids
      };
    } catch (_) {
      return null;
    }
  }
}
