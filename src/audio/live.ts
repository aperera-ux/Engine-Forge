/**
 * Live audio path (main thread): AudioContext → AudioWorkletNode running the
 * EngineSynth core → analyser → master gain → destination.
 *
 * - Engine parameters are re-derived (deriveSoundParams) when the config or
 *   sim result changes, debounced, and posted to the worklet.
 * - Engine state (rpm, load, running, mute) is posted at ~60 Hz; the synth
 *   smooths it internally.
 * - Fallback when AudioWorklet is unavailable or fails to load: a
 *   ScriptProcessorNode running the same core on the main thread.
 * - Debug hook for e2e tests: window.__engineForgeAudio.
 */
import { useStore } from '../ui/store';
import { deriveSoundParams, type EngineSoundParams } from './params';
import { EngineSynth, type EngineState } from './synth/EngineSynth';
import workletUrl from './worklet.ts?worker&url';

type Mode = 'worklet' | 'script' | 'none';

interface Graph {
  ctx: AudioContext;
  mode: Mode;
  node: AudioNode;
  analyser: AnalyserNode;
  master: GainNode;
  post: (msg: unknown) => void;
  /** main-thread synth for the ScriptProcessor fallback */
  synth?: EngineSynth;
}

let g: Graph | null = null;
let building: Promise<Graph | null> | null = null;
let unsub: (() => void) | null = null;
let timer: number | undefined;
let paramsTimer: number | undefined;
let lastCfg: unknown = null;
let lastResult: unknown = null;

declare global {
  interface Window {
    __engineForgeAudio?: { ctx: AudioContext; mode: Mode; analyser: AnalyserNode; rms: () => number; stats: () => Promise<unknown> };
  }
}

function currentParams(): EngineSoundParams {
  const s = useStore.getState();
  lastCfg = s.config;
  lastResult = s.result;
  return deriveSoundParams(s.config, s.result);
}

function currentState(): Partial<EngineState> {
  const s = useStore.getState();
  return { rpm: s.rpm, load: s.load, running: s.running, volume: s.muted ? 0 : 1 };
}

async function build(): Promise<Graph | null> {
  const Ctx: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: 'interactive' });
  void ctx.resume(); // still inside the user gesture
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.connect(master).connect(ctx.destination);

  let graph: Graph | null = null;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'engine-forge-synth', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      node.connect(analyser);
      graph = { ctx, mode: 'worklet', node, analyser, master, post: (m) => node.port.postMessage(m) };
    } catch (e) {
      console.warn('[engine-forge] AudioWorklet unavailable, falling back to ScriptProcessor', e);
    }
  }
  if (!graph) {
    const synth = new EngineSynth(ctx.sampleRate);
    const node = ctx.createScriptProcessor(1024, 0, 2);
    node.onaudioprocess = (ev) => synth.process(ev.outputBuffer.getChannelData(0), ev.outputBuffer.getChannelData(1));
    node.connect(analyser);
    graph = {
      ctx,
      mode: 'script',
      node,
      analyser,
      master,
      synth,
      post: (m) => {
        const msg = m as { type: string; params?: EngineSoundParams; state?: Partial<EngineState> };
        if (msg.type === 'engine' && msg.params) synth.setEngine(msg.params);
        else if (msg.type === 'state' && msg.state) synth.setState(msg.state);
      },
    };
  }
  const gr = graph;
  gr.post({ type: 'engine', params: currentParams() });
  gr.post({ type: 'state', state: currentState() });
  if (gr.synth) gr.synth.settle();
  const buf = new Float32Array(analyser.fftSize);
  window.__engineForgeAudio = {
    ctx,
    mode: gr.mode,
    analyser,
    rms: () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (const v of buf) s += v * v;
      return Math.sqrt(s / buf.length);
    },
    stats: () =>
      new Promise((resolve) => {
        if (gr.synth) return resolve(gr.synth.stats);
        const n = gr.node as AudioWorkletNode;
        const h = (e: MessageEvent) => {
          if (e.data?.type === 'stats') {
            n.port.removeEventListener('message', h);
            resolve(e.data.stats);
          }
        };
        n.port.addEventListener('message', h);
        n.port.start();
        n.port.postMessage({ type: 'stats' });
      }),
  };
  return gr;
}

function startLoops() {
  if (!unsub) {
    unsub = useStore.subscribe((s) => {
      if (!g) return;
      if (s.config !== lastCfg || s.result !== lastResult) {
        lastCfg = s.config;
        lastResult = s.result;
        window.clearTimeout(paramsTimer);
        paramsTimer = window.setTimeout(() => g?.post({ type: 'engine', params: currentParams() }), 60);
      }
    });
  }
  if (timer === undefined) {
    // 60 Hz state stream (setInterval keeps running in background tabs, throttled).
    timer = window.setInterval(() => g?.post({ type: 'state', state: currentState() }), 16);
  }
}

function stopLoops() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
}

/** Call from a user gesture (the audio toggle). */
export function setAudioEnabled(on: boolean) {
  if (on) {
    if (g) {
      void g.ctx.resume();
      g.post({ type: 'state', state: currentState() });
      startLoops();
      return;
    }
    if (!building) {
      building = build()
        .then((gr) => {
          g = gr;
          if (gr) {
            startLoops();
            void gr.ctx.resume();
          }
          return gr;
        })
        .catch((e) => {
          console.warn('[engine-forge] audio unavailable', e);
          return null;
        })
        .finally(() => {
          building = null;
        });
    }
  } else if (g) {
    g.post({ type: 'state', state: currentState() });
    const ctx = g.ctx;
    window.setTimeout(() => {
      if (useStore.getState().muted) {
        stopLoops();
        void ctx.suspend();
      }
    }, 300);
  }
}

export function disposeAudio() {
  unsub?.();
  unsub = null;
  stopLoops();
  if (g) void g.ctx.close();
  g = null;
  delete window.__engineForgeAudio;
}
