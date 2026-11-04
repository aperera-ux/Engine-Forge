/** Small allocation-free DSP primitives (pure TS, no DOM/WebAudio). */

export const TAU = Math.PI * 2;

/** xorshift32 RNG; deterministic so offline renders are reproducible. */
export class Rng {
  s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  /** Uniform in [0,1). */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s / 4294967296;
  }
  /** Uniform in [-1,1). */
  bi(): number {
    return this.next() * 2 - 1;
  }
  /** Approximately normal (sum of 4 uniforms), unit variance. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }
}

/** One-pole low-pass  y += a (x − y). */
export class OnePole {
  a = 1;
  y = 0;
  setCutoff(hz: number, fs: number) {
    this.a = 1 - Math.exp((-TAU * Math.min(hz, fs * 0.49)) / fs);
  }
  process(x: number): number {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}

/** DC blocker / leaky differentiator  y = x − x1 + R y1. */
export class DcBlock {
  x1 = 0;
  y1 = 0;
  r = 0.995;
  setCutoff(hz: number, fs: number) {
    this.r = Math.exp((-TAU * hz) / fs);
  }
  process(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
}

/** Biquad, transposed direct form II, RBJ cookbook coefficients. */
export class Biquad {
  b0 = 1;
  b1 = 0;
  b2 = 0;
  a1 = 0;
  a2 = 0;
  z1 = 0;
  z2 = 0;
  private set(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  lowpass(f: number, q: number, fs: number) {
    const w = (TAU * Math.min(f, fs * 0.45)) / fs;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
    return this;
  }
  highpass(f: number, q: number, fs: number) {
    const w = (TAU * Math.min(f, fs * 0.45)) / fs;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
    return this;
  }
  /** Band-pass, 0 dB peak gain. */
  bandpass(f: number, q: number, fs: number) {
    const w = (TAU * Math.min(f, fs * 0.45)) / fs;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    this.set(al, 0, -al, 1 + al, -2 * c, 1 - al);
    return this;
  }
  peak(f: number, q: number, gainDb: number, fs: number) {
    const A = Math.pow(10, gainDb / 40);
    const w = (TAU * Math.min(f, fs * 0.45)) / fs;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
    return this;
  }
  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() {
    this.z1 = this.z2 = 0;
  }
}

/**
 * Two-pole modal resonator (impulse-excited ringing mode). Gain normalised so
 * an impulse of 1 gives a peak of ≈1.
 */
export class Mode {
  c1 = 0;
  c2 = 0;
  y1 = 0;
  y2 = 0;
  g = 0;
  set(f: number, decayS: number, fs: number) {
    const r = Math.exp(-1 / (decayS * fs));
    const w = (TAU * Math.min(f, fs * 0.45)) / fs;
    this.c1 = 2 * r * Math.cos(w);
    this.c2 = -r * r;
    this.g = Math.sin(w);
  }
  process(x: number): number {
    const y = this.g * x + this.c1 * this.y1 + this.c2 * this.y2;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Power-of-two ring buffer delay with linear-interpolated fractional read. */
export class Delay {
  buf: Float32Array;
  mask: number;
  w = 0;
  constructor(maxSamples: number) {
    let n = 16;
    while (n < maxSamples + 4) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
  }
  write(x: number) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }
  /** Before the next write at time n, returns x[n − d] (d ≥ 1, fractional). */
  read(d: number): number {
    const di = d | 0;
    const f = d - di;
    const i0 = (this.w - di) & this.mask;
    const i1 = (this.w - di - 1) & this.mask;
    return this.buf[i0] + (this.buf[i1] - this.buf[i0]) * f;
  }
}

/** Cheap tanh-like soft clipper, |y| < 1. */
export function softClip(x: number): number {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
