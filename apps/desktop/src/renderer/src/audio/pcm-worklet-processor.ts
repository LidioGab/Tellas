/**
 * PCM AudioWorklet Processor
 * Runs inside the AudioWorklet thread. Receives Float32 PCM chunks
 * from the main thread via MessagePort and outputs them to the audio graph.
 * This is bundled as a separate script loaded via addModule().
 */

class PcmWorkletProcessor extends AudioWorkletNode {
  // This is the AudioWorkletProcessor definition (separate thread context)
}

// AudioWorkletProcessor runs in its own thread — declare as string to be loaded via Blob URL
export const PCM_WORKLET_CODE = /* js */`
class PcmStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._totalSamples = 0;
    // Listen for PCM data messages from the main thread
    this.port.onmessage = (event) => {
      const { data } = event;
      if (data.type === 'pcm') {
        // data.samples is a Float32Array (stereo interleaved)
        this._buffer.push(data.samples);
        this._totalSamples += data.samples.length;
      }
    };
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const leftChannel = output[0];
    const rightChannel = output[1];

    if (!leftChannel) return true;

    const frameSize = leftChannel.length; // typically 128 samples
    const needed = frameSize * 2; // stereo interleaved

    if (this._totalSamples < needed) {
      // Not enough data yet — output silence
      leftChannel.fill(0);
      if (rightChannel) rightChannel.fill(0);
      return true;
    }

    // Pull samples from our queue
    const combined = new Float32Array(needed);
    let filled = 0;
    while (filled < needed && this._buffer.length > 0) {
      const chunk = this._buffer[0];
      const toCopy = Math.min(chunk.length, needed - filled);
      combined.set(chunk.subarray(0, toCopy), filled);
      filled += toCopy;

      if (toCopy < chunk.length) {
        this._buffer[0] = chunk.subarray(toCopy);
      } else {
        this._buffer.shift();
      }
      this._totalSamples -= toCopy;
    }

    // De-interleave stereo: L, R, L, R... → separate channels
    for (let i = 0; i < frameSize; i++) {
      leftChannel[i] = combined[i * 2] || 0;
      if (rightChannel) {
        rightChannel[i] = combined[i * 2 + 1] || 0;
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor('pcm-stream-processor', PcmStreamProcessor);
`;
