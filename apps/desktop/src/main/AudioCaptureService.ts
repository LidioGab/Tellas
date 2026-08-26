import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

import * as fs from 'fs';

function getFfmpegPath(): string {
  if (process.resourcesPath) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
    if (fs.existsSync(unpacked)) {
      return unpacked;
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require('ffmpeg-static') as string;
    if (raw) return raw.replace('app.asar', 'app.asar.unpacked');
  } catch (_) { }
  return 'ffmpeg';
}

const ffmpegPath: string = getFfmpegPath();

export interface AudioDevice {
  id: string;
  name: string;
  type: 'output' | 'input';
}

export class AudioCaptureService extends EventEmitter {
  private ffmpegProcess: ChildProcess | null = null;
  private isCapturing = false;
  private sampleRate = 48000;
  private channels = 2;
  // PCM S16LE: 2 bytes/sample * channels * sampleRate = bytes/sec
  // We want ~20ms chunks → 20ms * 48000 * 2 * 2 = 3840 bytes
  private readonly CHUNK_BYTES = 3840;

  /**
   * Helper to check if a device is a microphone or input device.
   */
  private static isMicrophoneDevice(name: string): boolean {
    const lower = name.toLowerCase();
    return (
      lower.includes('microfone') ||
      lower.includes('microphone') ||
      lower.includes('microf') ||
      lower.includes('droidcam') ||
      lower.includes('mic array') ||
      lower.includes('entrada') ||
      lower.includes('input')
    );
  }

  /**
   * Lists available DirectShow audio capture devices on Windows.
   * Includes both real capture devices and virtual loopback devices.
   */
  public async listDevices(): Promise<AudioDevice[]> {
    return new Promise((resolve) => {
      const ffmpeg = spawn(ffmpegPath, [
        '-list_devices', 'true',
        '-f', 'dshow',
        '-i', 'dummy'
      ], { windowsHide: true });

      let stderr = '';
      ffmpeg.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', () => {
        const devices: AudioDevice[] = [];
        const lines = stderr.split(/\r?\n/);

        let isAudioSection = false;
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line) continue;

          if (line.includes('DirectShow audio devices')) {
            isAudioSection = true;
            continue;
          }
          if (line.includes('DirectShow video devices')) {
            isAudioSection = false;
            continue;
          }

          // Modern FFmpeg: "Device Name" (audio)
          const modernMatch = line.match(/"([^"]+)"\s+\(audio\)/i);
          if (modernMatch) {
            const name = modernMatch[1].trim();
            if (name && !name.startsWith('@device') && !devices.some(d => d.name === name)) {
              devices.push({
                id: name,
                name,
                type: AudioCaptureService.isMicrophoneDevice(name) ? 'input' : 'output'
              });
            }
            continue;
          }

          // Legacy FFmpeg: section header followed by quoted names
          if (isAudioSection && !line.includes('(video)')) {
            const legacyMatch = line.match(/"([^"]+)"/);
            if (legacyMatch) {
              const name = legacyMatch[1].trim();
              if (name && !name.startsWith('@device') && !devices.some(d => d.name === name)) {
                devices.push({
                  id: name,
                  name,
                  type: AudioCaptureService.isMicrophoneDevice(name) ? 'input' : 'output'
                });
              }
            }
          }
        }

        resolve(devices);
      });

      // Kill after 3s if it hangs
      setTimeout(() => {
        try {
          ffmpeg.kill();
        } catch (_) {}
      }, 3000);
    });
  }

  /**
   * Start capturing system audio loopback.
   * On Windows, "Stereo Mix" or "What U Hear" devices are the system loopback.
   * If no loopback device is found, we use the default output device name.
   * 
   * @param deviceName Optional DirectShow device name. Auto-detected if omitted.
   * emits 'data' events with Float32Array PCM buffers (stereo interleaved, 48kHz)
   */
  public async start(deviceName?: string): Promise<void> {
    if (this.isCapturing) {
      this.stop();
    }

    const device = deviceName || await this.autoDetectLoopbackDevice();
    console.log(`[AudioCapture] Starting capture from: "${device}"`);

    // ffmpeg DirectShow loopback capture → raw PCM S16LE on stdout
    this.ffmpegProcess = spawn(ffmpegPath, [
      '-f', 'dshow',
      '-i', `audio=${device}`,
      '-f', 's16le',            // signed 16-bit little-endian PCM
      '-ar', String(this.sampleRate),
      '-ac', String(this.channels),
      'pipe:1'                  // write to stdout
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.isCapturing = true;
    let remainder = Buffer.alloc(0);

    this.ffmpegProcess.stdout!.on('data', (chunk: Buffer) => {
      // Accumulate and emit fixed-size chunks for consistent latency
      const combined = Buffer.concat([remainder, chunk]);
      let offset = 0;

      while (offset + this.CHUNK_BYTES <= combined.length) {
        const slice = combined.slice(offset, offset + this.CHUNK_BYTES);
        const float32 = this.s16leToFloat32(slice);
        this.emit('data', float32);
        offset += this.CHUNK_BYTES;
      }

      remainder = combined.slice(offset);
    });

    this.ffmpegProcess.stderr!.on('data', (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
        console.error('[AudioCapture] ffmpeg stderr:', msg.trim());
      }
    });

    this.ffmpegProcess.on('close', (code) => {
      console.log(`[AudioCapture] ffmpeg process exited with code ${code}`);
      this.isCapturing = false;
      this.ffmpegProcess = null;
      this.emit('stopped');
    });

    this.ffmpegProcess.on('error', (err) => {
      console.error('[AudioCapture] ffmpeg process error:', err);
      this.isCapturing = false;
      this.emit('error', err);
    });
  }

  public stop(): void {
    if (this.ffmpegProcess) {
      try {
        this.ffmpegProcess.kill('SIGTERM');
      } catch (_) { }
      this.ffmpegProcess = null;
    }
    this.isCapturing = false;
  }

  public get capturing(): boolean {
    return this.isCapturing;
  }

  public get audioFormat() {
    return {
      sampleRate: this.sampleRate,
      channels: this.channels,
      chunkDurationMs: (this.CHUNK_BYTES / (this.sampleRate * this.channels * 2)) * 1000
    };
  }

  /**
   * Try to auto-detect a Windows loopback/stereo mix audio device.
   * STRICT: NEVER select a microphone as a system audio loopback.
   */
  private async autoDetectLoopbackDevice(): Promise<string> {
    const devices = await this.listDevices();
    console.log('[AudioCapture] Available devices:', devices.map(d => d.name));

    // Exclude any device identified as microphone/input
    const nonMicDevices = devices.filter(d => !AudioCaptureService.isMicrophoneDevice(d.name) && d.type !== 'input');

    // Priority list for loopback candidates
    const priority = ['stereo mix', 'mixagem estéreo', 'mixagem estereo', 'what u hear', 'what you hear'];
    for (const keyword of priority) {
      const found = nonMicDevices.find(d => d.name.toLowerCase().includes(keyword));
      if (found) {
        console.log('[AudioCapture] Auto-selected loopback device:', found.name);
        return found.name;
      }
    }

    // Secondary output candidates (speakers/headphones output stream, not mic)
    const secondaryPriority = ['alto-falante', 'alto falante', 'speaker', 'saída', 'saida', 'output', 'headphone'];
    for (const keyword of secondaryPriority) {
      const found = nonMicDevices.find(d => d.name.toLowerCase().includes(keyword));
      if (found) {
        console.log('[AudioCapture] Selected output device:', found.name);
        return found.name;
      }
    }

    if (nonMicDevices.length > 0) {
      return nonMicDevices[0].name;
    }

    throw new Error('No suitable audio loopback device found on this system. Please enable "Stereo Mix" in Windows Sound settings.');
  }

  /** Convert signed 16-bit LE PCM buffer → Float32Array in range [-1, 1] */
  private s16leToFloat32(buffer: Buffer): Float32Array {
    const samples = buffer.length / 2;
    const float32 = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const s16 = buffer.readInt16LE(i * 2);
      float32[i] = s16 / 32768.0;
    }
    return float32;
  }
}

export const audioCaptureService = new AudioCaptureService();
