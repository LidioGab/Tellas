/** Low-latency bounded PCM ring buffer for a 48 kHz stereo WebRTC track. */
export const PCM_WORKLET_CODE = /* js */`
class PcmStreamProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._channels = 2;
    this._capacity = Math.round(sampleRate * this._channels * 0.2);
    this._target = Math.round(sampleRate * this._channels * 0.06);
    this._prime = Math.round(sampleRate * this._channels * 0.04);
    this._emergency = Math.round(sampleRate * this._channels * 0.15);
    this._ring = new Float32Array(this._capacity);
    this._read = 0;
    this._write = 0;
    this._available = 0;
    this._state = 'PRIMING';
    this._underflows = 0;
    this._droppedSamples = 0;
    this._emergencyResyncs = 0;
    this._sequenceGaps = 0;
    this._lastSequence = null;
    this._quanta = 0;
    this._driftDrops = 0;
    this._driftCounter = 0;
    this._lastReportFrame = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'reset') this._reset();
      if (data.type === 'audio-frame' && data.samples) this._enqueue(data);
    };
    this._report('WORKLET_INIT');
  }

  _reset() {
    this._read = this._write = this._available = 0;
    this._state = 'PRIMING';
    this._lastSequence = null;
  }

  _drop(count) {
    const aligned = Math.min(this._available, count - (count % this._channels));
    this._read = (this._read + aligned) % this._capacity;
    this._available -= aligned;
    this._droppedSamples += aligned;
  }

  _enqueue(frame) {
    if (this._lastSequence !== null && frame.sequence > this._lastSequence + 1) {
      this._sequenceGaps += frame.sequence - this._lastSequence - 1;
    }
    this._lastSequence = frame.sequence;
    const samples = frame.samples;
    if (samples.length >= this._capacity) {
      this._drop(this._available);
      const start = samples.length - this._target;
      for (let i = start; i < samples.length; i++) this._writeOne(samples[i]);
      this._emergencyResyncs++;
      return;
    }
    if (this._available + samples.length > this._emergency) {
      this._drop(this._available - this._target + samples.length);
      this._emergencyResyncs++;
      this._state = 'RUNNING';
    }
    for (let i = 0; i < samples.length; i++) this._writeOne(samples[i]);
  }

  _writeOne(value) {
    if (this._available === this._capacity) this._drop(this._channels);
    this._ring[this._write] = value;
    this._write = (this._write + 1) % this._capacity;
    this._available++;
  }

  _report(category = 'WORKLET_STATS') {
    this.port.postMessage({ type: 'diagnostic', category, data: {
      state: this._state,
      queuedMs: Math.round(this._available / this._channels / sampleRate * 1000),
      underflows: this._underflows,
      droppedSamples: this._droppedSamples,
      emergencyResyncs: this._emergencyResyncs,
      sequenceGaps: this._sequenceGaps,
      driftDrops: this._driftDrops,
      quanta: this._quanta
    }});
  }

  process(inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1];
    if (!left) return true;
    const needed = left.length * this._channels;
    if (this._state === 'PRIMING' && this._available >= this._prime) this._state = 'RUNNING';
    if (this._state !== 'RUNNING' || this._available < needed) {
      left.fill(0);
      if (right) right.fill(0);
      if (this._state === 'RUNNING') {
        this._underflows++;
        this._state = 'PRIMING';
      }
    } else {
      // Gently correct positive clock drift above 100 ms (about +0.2%).
      if (this._available > sampleRate * this._channels * 0.1 && ++this._driftCounter >= 4) {
        this._drop(this._channels);
        this._driftDrops++;
        this._driftCounter = 0;
      }
      for (let i = 0; i < left.length; i++) {
        left[i] = this._ring[this._read];
        this._read = (this._read + 1) % this._capacity;
        right[i] = this._ring[this._read];
        this._read = (this._read + 1) % this._capacity;
      }
      this._available -= needed;
      this._quanta++;
      if (this._state === 'RECOVERY') this._state = 'RUNNING';
    }
    if (currentFrame - this._lastReportFrame >= sampleRate) {
      this._lastReportFrame = currentFrame;
      this._report();
    }
    return true;
  }
}
registerProcessor('pcm-stream-processor', PcmStreamProcessor);
`;
