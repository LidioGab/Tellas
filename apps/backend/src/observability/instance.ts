import * as os from 'os';

export const backendInstance = Object.freeze({
  machineId: process.env.FLY_MACHINE_ID || os.hostname(),
  pid: process.pid,
  nodeEnv: process.env.NODE_ENV || 'development',
});

export function getUptimeSeconds(): number {
  return Math.floor(process.uptime());
}

export function logInstanceEvent(event: string, fields: Record<string, unknown> = {}): void {
  console.log(`[TELLAS][${event}]`, {
    machineId: backendInstance.machineId,
    ...fields,
  });
}
