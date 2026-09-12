import assert from 'node:assert/strict';
import { PCM_WORKLET_CODE } from '../src/renderer/src/audio/pcm-worklet-processor';

class MockPort {
  onmessage: ((event: { data: any }) => void) | null = null;
  messages: any[] = [];
  postMessage(message: any) { this.messages.push(message); }
}
class MockProcessor { port = new MockPort(); }

let Processor: any;
Object.assign(globalThis, {
  AudioWorkletProcessor: MockProcessor,
  sampleRate: 48000,
  currentFrame: 0,
  registerProcessor: (_name: string, ctor: any) => { Processor = ctor; },
});
(0, eval)(PCM_WORKLET_CODE);
const processor = new Processor();
const send = (sequence: number) => processor.port.onmessage({ data: {
  type: 'audio-frame', sequence, capturedAtUs: sequence * 10_000,
  sampleRate: 48000, channels: 2, frameCount: 480,
  samples: new Float32Array(960).fill(sequence / 100),
}});
const render = (count: number) => {
  for (let i = 0; i < count; i++) {
    (globalThis as any).currentFrame += 128;
    processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
  }
};

for (let i = 0; i < 6; i++) send(i);
render(10);
assert.equal(processor._state, 'RUNNING');
for (let i = 6; i < 106; i++) send(i);
assert.ok(processor._available <= 48000 * 2 * 0.15);
assert.ok(processor._emergencyResyncs > 0);
assert.ok(processor._droppedSamples > 0);
send(110);
assert.ok(processor._sequenceGaps >= 4);
render(100);
assert.ok(processor._available <= 48000 * 2 * 0.15);
console.log('audio low-latency worklet tests passed');
