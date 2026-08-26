import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';

// ffmpeg-static provides a pre-compiled ffmpeg binary for Windows — no install needed
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static') as string;

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
        // Parse ffmpeg DirectShow device list from stderr
        // Audio devices appear after "DirectShow audio devices"
        const audioSection = stderr.split('DirectShow audio devices')[1] || '';
        const lines = audioSection.split('\n');

        let inAudioSection = true;
        for (const line of lines) {
          if (line.includes('DirectShow video devices')) {
            inAudioSection = false;
          }
          if (!inAudioSection) continue;

          // Match lines like: [dshow @ ...] "Device Name"
          const match = line.match(/"([^"]+)"\s*$/);
          if (match) {
            const name = match[1].trim();
            if (name && !name.includes('@device')) {
              devices.push({
                id: name,
                name,
                type: name.toLowerCase().includes('microfone') || name.toLowerCase().includes('microphone')
                  ? 'input'
                  : 'output'
              });
            }
          }
        }

        resolve(devices);
      });

      // Kill after 3s if it hangs
      setTimeout(() => {
        ffmpeg.kill();
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
      // Only log actual errors, not ffmpeg's normal verbose output
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
      } catch (_) {}
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
   * Falls back to the first available output device.
   */
  private async autoDetectLoopbackDevice(): Promise<string> {
    const devices = await this.listDevices();
    console.log('[AudioCapture] Available devices:', devices.map(d => d.name));

    // Priority list: Stereo Mix > What U Hear > NVIDIA > Speaker/Alto-falante
    const priority = ['stereo mix', 'what u hear', 'nvidia', 'alto-falante', 'speaker', 'saída', 'output'];
    for (const keyword of priority) {
      const found = devices.find(d => d.name.toLowerCase().includes(keyword));
      if (found) {
        console.log('[AudioCapture] Auto-selected device:', found.name);
        return found.name;
      }
    }

    // Last resort: first device that isn't a microphone
    const output = devices.find(d => d.type === 'output');
    if (output) return output.name;

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
