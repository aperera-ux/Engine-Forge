/**
 * Exhaust system as a network of digital waveguides (bidirectional delay
 * lines) joined by plane-wave scattering junctions.
 *
 * Each pipe carries a forward (port → outlet) and a backward pressure wave.
 * Per sample: read both ends of every pipe (through a one-pole loss filter),
 * scatter at every node, write the new incoming waves.
 *
 *  - port:     valve end of a primary; reflection r(valve lift) plus the
 *              cylinder's injected pressure wave.
 *  - junction: lossless N-pipe Kelly–Lochbaum junction, weights 2·S_k/ΣS
 *              (pressure continuity + volume-velocity conservation). Area
 *              changes (muffler chamber) and collectors are both junctions.
 *  - turbine:  a lossy restriction (partial reflection, damped low-passed
 *              transmission, opened up by the wastegate).
 *  - outlet:   open end, R(ω) = −(1−g)·lowpass (Levine–Schwinger), output
 *              is the transmitted volume-velocity proxy (p⁺ − p⁻).
 */
import type { EngineSoundParams, NodeSpec, PipeSpec } from '../params';
import { Delay } from './dsp';

const MAX_DELAY_S = 0.02; // 20 ms per pipe is far longer than any pipe at hot c

interface JunctionRt {
  /** member pipe indices */
  pipes: Int32Array;
  /** 1 if the member's downstream end touches the node (incoming = fwd), 0 if upstream end (incoming = bwd). */
  isDown: Uint8Array;
  w: Float64Array;
}

export class ExhaustNetwork {
  readonly fs: number;
  readonly nPipes: number;
  readonly nOutlets: number;
  private fwd: Delay[] = [];
  private bwd: Delay[] = [];
  /** delay per direction, samples (smoothed) */
  delay: Float64Array;
  private delayTarget: Float64Array;
  private lossA: Float64Array; // one-pole coefficient per pipe
  private lossG: Float64Array; // broadband gain per pass
  private lpF: Float64Array; // filter states
  private lpB: Float64Array;
  private fwdOut: Float64Array;
  private bwdOut: Float64Array;
  private fwdIn: Float64Array;
  private bwdIn: Float64Array;
  /** Additive injection into the forward wave entering each pipe (pops etc.), cleared each step. */
  inject: Float64Array;
  private junctions: JunctionRt[] = [];
  private turbines: { up: number; down: number; lp: number }[] = [];
  private outletsRt: { pipe: number; lp: number; a: number; g: number }[] = [];
  /** port node → primary pipe */
  readonly portPipe: Int32Array;
  /** Port reflection coefficient per cylinder (set by the cylinder model). */
  portR: Float64Array;
  /** Pressure wave injected at each port this sample (set by the cylinder model). */
  portSrc: Float64Array;
  /** Acoustic pressure at each port after scattering (read by the cylinder model). */
  portP: Float64Array;
  /** Transmitted volume velocity proxy per outlet. */
  out: Float64Array;
  /** Turbine transmission 0..1 (wastegate opens it up). */
  turbineT = 0.35;
  turbineR = 0.5;
  private turbineA = 0.2;
  private pipes: PipeSpec[];

  constructor(p: EngineSoundParams, fs: number) {
    this.fs = fs;
    this.pipes = p.pipes;
    const n = p.pipes.length;
    this.nPipes = n;
    this.nOutlets = p.outlets.length;
    const maxD = Math.ceil(MAX_DELAY_S * fs);
    for (let i = 0; i < n; i++) {
      this.fwd.push(new Delay(maxD));
      this.bwd.push(new Delay(maxD));
    }
    this.delay = new Float64Array(n);
    this.delayTarget = new Float64Array(n);
    this.lossA = new Float64Array(n);
    this.lossG = new Float64Array(n);
    this.lpF = new Float64Array(n);
    this.lpB = new Float64Array(n);
    this.fwdOut = new Float64Array(n);
    this.bwdOut = new Float64Array(n);
    this.fwdIn = new Float64Array(n);
    this.bwdIn = new Float64Array(n);
    this.inject = new Float64Array(n);
    this.portPipe = new Int32Array(p.nCyl).fill(-1);
    this.portR = new Float64Array(p.nCyl).fill(0.85);
    this.portSrc = new Float64Array(p.nCyl);
    this.portP = new Float64Array(p.nCyl);
    this.out = new Float64Array(p.outlets.length);

    for (let i = 0; i < n; i++) {
      const pp = p.pipes[i];
      // Viscothermal + wall loss: corner falls with length, absorptive packing darkens further.
      // Packed muffler: fibre absorption grows with frequency, so the chamber is a
      // strong low-pass per pass (stock ≈1.1 kHz, straight-through sport ≈2.3 kHz).
      const fc =
        pp.kind === 'muffler'
          ? 600 + 2600 * (1 - pp.absorb) * (1 - pp.absorb)
          : Math.min(fs * 0.45, (6500 / Math.sqrt(Math.max(0.05, pp.lenM))) * (1 - 0.75 * pp.absorb));
      this.lossA[i] = 1 - Math.exp((-2 * Math.PI * fc) / fs);
      this.lossG[i] = 0.985 * Math.pow(0.97, pp.lenM) * (1 - 0.3 * pp.absorb) * (pp.kind === "muffler" ? 0.85 : 1);
    }
    this.buildNodes(p.nodes, p.pipes);
    this.setTemperature(1000, 1);
    this.delay.set(this.delayTarget);
  }

  private buildNodes(nodes: NodeSpec[], pipes: PipeSpec[]) {
    const fs = this.fs;
    nodes.forEach((nd, ni) => {
      const ups: number[] = []; // pipes whose downstream end is at this node
      const downs: number[] = []; // pipes whose upstream end is at this node
      pipes.forEach((pp, pi) => {
        if (pp.down === ni) ups.push(pi);
        if (pp.up === ni) downs.push(pi);
      });
      if (nd.type === 'port') {
        this.portPipe[nd.ref] = downs[0];
      } else if (nd.type === 'outlet') {
        const pipe = ups[0];
        const a = pipes[pipe].diamM / 2;
        // ka = 1 corner of the open-end reflection low-pass.
        const fc = 520 / (2 * Math.PI * a);
        this.outletsRt[nd.ref] = { pipe, lp: 0, a: 1 - Math.exp((-2 * Math.PI * Math.min(fc, fs * 0.45)) / fs), g: 0.03 };
      } else if (nd.type === 'turbine' && ups.length === 1 && downs.length === 1) {
        this.turbines.push({ up: ups[0], down: downs[0], lp: 0 });
        this.turbineA = 1 - Math.exp((-2 * Math.PI * 1800) / fs);
      } else {
        const members = [...ups, ...downs];
        const isDown = new Uint8Array(members.length);
        ups.forEach((_, k) => (isDown[k] = 1));
        let sumS = 0;
        for (const m of members) sumS += pipes[m].diamM * pipes[m].diamM;
        const w = new Float64Array(members.length);
        // 0.985: small broadband junction / bend loss.
        members.forEach((m, k) => (w[k] = (0.985 * 2 * pipes[m].diamM * pipes[m].diamM) / sumS));
        this.junctions.push({ pipes: Int32Array.from(members), isDown, w });
      }
    });
  }

  /**
   * Gas temperature at the port, K; pipes downstream cool by ~130 K/m.
   * `coolFactor` scales the taper (1 = normal).
   */
  setTemperature(portK: number, coolFactor: number) {
    const fs = this.fs;
    for (let i = 0; i < this.nPipes; i++) {
      const pp = this.pipes[i];
      const T = Math.max(330, portK - 80 - 130 * coolFactor * pp.distM);
      const c = Math.sqrt(1.35 * 288 * T);
      // End correction ~0.3·a per pipe (junction ends are partly flanged).
      const L = pp.lenM + 0.3 * pp.diamM;
      this.delayTarget[i] = Math.max(1.5, (L / c) * fs);
    }
  }

  /** Smoothly move delays to their targets (call at control rate). */
  smoothDelays(k: number) {
    for (let i = 0; i < this.nPipes; i++) this.delay[i] += (this.delayTarget[i] - this.delay[i]) * k;
  }

  step() {
    const n = this.nPipes;
    const fo = this.fwdOut;
    const bo = this.bwdOut;
    const fi = this.fwdIn;
    const bi = this.bwdIn;
    for (let i = 0; i < n; i++) {
      const d = this.delay[i];
      const a = this.lossA[i];
      const g = this.lossG[i];
      this.lpF[i] += a * (this.fwd[i].read(d) - this.lpF[i]);
      this.lpB[i] += a * (this.bwd[i].read(d) - this.lpB[i]);
      fo[i] = g * this.lpF[i];
      bo[i] = g * this.lpB[i];
    }
    // Ports
    const pp = this.portPipe;
    for (let c = 0; c < pp.length; c++) {
      const p = pp[c];
      if (p < 0) continue;
      const inc = bo[p];
      const outW = this.portR[c] * inc + this.portSrc[c];
      fi[p] = outW;
      this.portP[c] = inc + outW;
    }
    // Junctions
    for (let j = 0; j < this.junctions.length; j++) {
      const J = this.junctions[j];
      const m = J.pipes;
      let pj = 0;
      for (let k = 0; k < m.length; k++) pj += J.w[k] * (J.isDown[k] ? fo[m[k]] : bo[m[k]]);
      for (let k = 0; k < m.length; k++) {
        const q = m[k];
        if (J.isDown[k]) bi[q] = pj - fo[q];
        else fi[q] = pj - bo[q];
      }
    }
    // Turbines
    for (let t = 0; t < this.turbines.length; t++) {
      const T = this.turbines[t];
      const inU = fo[T.up];
      const inD = bo[T.down];
      T.lp += this.turbineA * (inU - T.lp);
      bi[T.up] = this.turbineR * inU + this.turbineT * 0.5 * inD;
      fi[T.down] = this.turbineT * T.lp + this.turbineR * 0.5 * inD;
    }
    // Outlets
    for (let o = 0; o < this.outletsRt.length; o++) {
      const O = this.outletsRt[o];
      const inc = fo[O.pipe];
      O.lp += O.a * (inc - O.lp);
      const refl = -(1 - O.g) * O.lp;
      bi[O.pipe] = refl;
      this.out[o] = inc - refl;
    }
    // Write
    const inj = this.inject;
    for (let i = 0; i < n; i++) {
      this.fwd[i].write(fi[i] + inj[i]);
      this.bwd[i].write(bi[i]);
      inj[i] = 0;
    }
  }
}
