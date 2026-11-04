/**
 * AudioWorklet processor: runs the shared EngineSynth core on the audio
 * thread. Loaded by live.ts via Vite's `?worker&url` (bundled into one file).
 *
 * Messages (main → worklet):
 *   { type: 'engine', params: EngineSoundParams }
 *   { type: 'state', state: Partial<EngineState> }   (~60 Hz; smoothed inside the synth)
 *   { type: 'stats' }                                → replies { type: 'stats', stats }
 */
import { EngineSynth, type EngineState } from './synth/EngineSynth';
import type { EngineSoundParams } from './params';

interface ProcessorBase {
  readonly port: MessagePort;
}
type ProcessorCtor = new () => ProcessorBase;
const scope = globalThis as unknown as {
  AudioWorkletProcessor: ProcessorCtor;
  registerProcessor: (name: string, ctor: unknown) => void;
  sampleRate: number;
};

type Msg = { type: 'engine'; params: EngineSoundParams } | { type: 'state'; state: Partial<EngineState> } | { type: 'stats' };

class EngineForgeProcessor extends scope.AudioWorkletProcessor {
  private synth = new EngineSynth(scope.sampleRate);
  private scratch = new Float32Array(128);
  private ready = false;
  private settled = false;
  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.type === 'engine') {
        this.synth.setEngine(m.params);
        this.ready = true;
      } else if (m.type === 'state') {
        this.synth.setState(m.state);
        if (this.ready && !this.settled) {
          this.synth.settle();
          this.settled = true;
        }
      } else if (m.type === 'stats') this.port.postMessage({ type: 'stats', stats: this.synth.stats });
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const L = out[0];
    let R = out[1];
    if (!R) {
      if (this.scratch.length !== L.length) this.scratch = new Float32Array(L.length);
      R = this.scratch;
    }
    if (!this.ready) {
      L.fill(0);
      R.fill(0);
      return true;
    }
    this.synth.process(L, R);
    return true;
  }
}

scope.registerProcessor('engine-forge-synth', EngineForgeProcessor);
