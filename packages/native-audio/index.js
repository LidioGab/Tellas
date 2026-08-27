const path = require('path');
const fs = require('fs');

let isPackaged = false;
try {
  const electron = require('electron');
  if (electron && electron.app) {
    isPackaged = electron.app.isPackaged;
  }
} catch (_) {}

const isDev = !isPackaged && process.env.NODE_ENV !== 'production';
console.log(`[NativeAudio] Environment: ${isDev ? 'development' : 'production'}`);
console.log(`[NativeAudio] Electron app.isPackaged: ${isPackaged}`);

let nativeBinding = null;
let loadError = null;
let resolvedPath = null;

const possiblePaths = [];

if (process.resourcesPath) {
  possiblePaths.push(path.join(process.resourcesPath, 'native_audio.node'));
  possiblePaths.push(path.join(process.resourcesPath, 'resources', 'native_audio.node'));
  possiblePaths.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'packages', 'native-audio', 'build', 'Release', 'native_audio.node'));
  possiblePaths.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'native_audio.node'));
}

possiblePaths.push(
  path.join(__dirname, 'build', 'Release', 'native_audio.node'),
  path.join(__dirname, 'build', 'Debug', 'native_audio.node'),
  path.join(__dirname, 'native_audio.node'),
  path.join(__dirname, '..', '..', 'packages', 'native-audio', 'build', 'Release', 'native_audio.node'),
  path.join(process.cwd(), 'packages', 'native-audio', 'build', 'Release', 'native_audio.node'),
  path.join(process.cwd(), 'resources', 'native_audio.node')
);

for (const candidate of possiblePaths) {
  const exists = fs.existsSync(candidate);
  if (exists) {
    console.log(`[NativeAudio] Resolved addon path: ${candidate}`);
    console.log(`[NativeAudio] Addon file exists: true`);
    try {
      nativeBinding = require(candidate);
      loadError = null;
      resolvedPath = candidate;
      console.log(`[NativeAudio] Addon loaded successfully`);
      break;
    } catch (err) {
      loadError = err;
      console.error(`[NativeAudio] Error requiring candidate ${candidate}:`, err.message);
    }
  }
}

if (!nativeBinding) {
  console.error(`[NativeAudio] Failed to load addon`);
  if (loadError) {
    console.error(`[NativeAudio] Error:`, loadError.message);
  } else {
    console.error(`[NativeAudio] Error: No valid native_audio.node binary found in search paths:`, possiblePaths);
  }
}

class ProcessLoopbackCaptureWrapper {
  constructor() {
    if (nativeBinding && nativeBinding.ProcessLoopbackCapture) {
      this._instance = new nativeBinding.ProcessLoopbackCapture();
    } else {
      this._instance = null;
    }
  }

  static isSupported() {
    if (!nativeBinding || !nativeBinding.ProcessLoopbackCapture) {
      return false;
    }
    try {
      return nativeBinding.ProcessLoopbackCapture.isSupported();
    } catch (_) {
      return false;
    }
  }

  start(targetPid, onData) {
    if (!this._instance) {
      throw new Error('Native audio addon not loaded: ' + (loadError ? loadError.message : 'Binary not found'));
    }
    return this._instance.start(targetPid, onData);
  }

  stop() {
    if (this._instance) {
      this._instance.stop();
    }
  }

  isCapturing() {
    return this._instance ? this._instance.isCapturing() : false;
  }
}

function getRenderAudioSessions() {
  if (nativeBinding && typeof nativeBinding.getRenderAudioSessions === 'function') {
    try {
      return nativeBinding.getRenderAudioSessions();
    } catch (err) {
      console.error('[NativeAudio] Error querying render audio sessions:', err.message);
      return [];
    }
  }
  return [];
}

module.exports = {
  ProcessLoopbackCapture: ProcessLoopbackCaptureWrapper,
  isNativeAddonAvailable: () => nativeBinding !== null,
  getLoadError: () => loadError,
  getResolvedPath: () => resolvedPath,
  getRenderAudioSessions
};

