/**
 * Offline analysis helpers (pure TS): FFT, spectra, order levels, fundamental
 * detection, spectral centroid, crest factor, hygiene checks, WAV encoding.
 * Used by scripts/audio/analyze.ts and the vitest suite.
 */

export function fftInPlace(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Hann-windowed magnitude spectrum of x[start .. start+n) (n power of two). */
export function magSpectrum(x: ArrayLike<number>, start: number, n: number): Float64Array {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = (x[start + i] ?? 0) * w;
  }
  fftInPlace(re, im);
  const m = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]) / n;
  return m;
}

/** Hann-windowed single-frequency DFT magnitude (exact frequency, no bin quantisation). */
export function toneLevel(x: ArrayLike<number>, fs: number, f: number, start = 0, len = x.length - start): number {
  let sr = 0;
  let si = 0;
  const w0 = (2 * Math.PI * f) / fs;
  for (let i = 0; i < len; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1));
    const v = (x[start + i] ?? 0) * w;
    sr += v * Math.cos(w0 * i);
    si -= v * Math.sin(w0 * i);
  }
  return (2 * Math.hypot(sr, si)) / (len * 0.5);
}

/**
 * Engine-order levels at constant rpm: amplitude of order k (k events per crank
 * revolution, f = k·rpm/60). Takes the max over ±0.6 % to tolerate smoothing.
 */
export function orderLevels(x: ArrayLike<number>, fs: number, rpm: number, orders: number[], start = 0, len = x.length - start): number[] {
  return orders.map((k) => {
    const f = (k * rpm) / 60;
    let best = 0;
    for (const d of [-0.006, -0.003, 0, 0.003, 0.006]) best = Math.max(best, toneLevel(x, fs, f * (1 + d), start, len));
    return best;
  });
}

export const db = (a: number, ref = 1) => 20 * Math.log10(Math.max(1e-12, a) / Math.max(1e-12, ref));

/**
 * Fundamental by sub-harmonic summation on a long spectrum: for each candidate
 * f0 in [fMin, fMax] score Σ 0.84^(k-1)·|X(k·f0)| over 8 harmonics (log-magnitude
 * compressed). Returns the best f0, refined by parabolic interpolation.
 */
export function detectFundamental(x: ArrayLike<number>, fs: number, fMin: number, fMax: number, start = 0, n = 1 << 16): number {
  while (n > 1024 && start + n > x.length) n >>= 1;
  const mag = magSpectrum(x, start, n);
  const binHz = fs / n;
  const comp = new Float64Array(mag.length);
  let mx = 0;
  for (let i = 0; i < mag.length; i++) mx = Math.max(mx, mag[i]);
  for (let i = 0; i < mag.length; i++) comp[i] = Math.max(0, Math.log10(mag[i] / mx + 1e-12) + 6); // 60 dB range
  const at = (f: number) => {
    const b = f / binHz;
    const i = Math.round(b);
    if (i < 1 || i + 1 >= comp.length) return 0;
    return Math.max(comp[i - 1], comp[i], comp[i + 1]);
  };
  let best = fMin;
  let bestS = -1;
  for (let f = fMin; f <= fMax; f *= 1.002) {
    let s = 0;
    for (let k = 1; k <= 8; k++) s += Math.pow(0.84, k - 1) * at(k * f);
    if (s > bestS) {
      bestS = s;
      best = f;
    }
  }
  // Octave-error check: if the odd harmonics of the winner are ≥ 6 dB below its
  // even harmonics, the true fundamental is twice as high.
  const raw = (f: number) => {
    const i = Math.round(f / binHz);
    return i < 1 || i + 1 >= mag.length ? 0 : Math.max(mag[i - 1], mag[i], mag[i + 1]);
  };
  for (let it = 0; it < 2 && best * 2 <= fMax; it++) {
    let odd = 0;
    let even = 0;
    for (let k = 1; k <= 8; k += 2) odd += raw(k * best) ** 2;
    for (let k = 2; k <= 8; k += 2) even += raw(k * best) ** 2;
    if (odd * 4 < even) best *= 2;
    else break;
  }
  // Refine on the strongest spectral peak near the candidate.
  const b0 = Math.round(best / binHz);
  let bi = b0;
  for (let i = Math.max(1, b0 - 3); i <= Math.min(mag.length - 2, b0 + 3); i++) if (mag[i] > mag[bi]) bi = i;
  const a = mag[bi - 1];
  const b = mag[bi];
  const c = mag[bi + 1];
  const d = (0.5 * (a - c)) / (a - 2 * b + c || 1);
  return (bi + (Number.isFinite(d) ? d : 0)) * binHz;
}

/** Spectral centroid (Hz) of a frame, magnitude-weighted (the usual definition, e.g. librosa). */
export function centroid(x: ArrayLike<number>, fs: number, start: number, n = 4096): number {
  const m = magSpectrum(x, start, n);
  let num = 0;
  let den = 0;
  for (let i = 1; i < m.length; i++) {
    const p = m[i];
    num += p * ((i * fs) / n);
    den += p;
  }
  return den > 0 ? num / den : 0;
}

export function rms(x: ArrayLike<number>, start = 0, len = x.length - start): number {
  let s = 0;
  for (let i = 0; i < len; i++) s += (x[start + i] ?? 0) ** 2;
  return Math.sqrt(s / Math.max(1, len));
}

export function crestDb(x: ArrayLike<number>, start = 0, len = x.length - start): number {
  let pk = 0;
  for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(x[start + i] ?? 0));
  return db(pk, rms(x, start, len));
}

export interface Hygiene {
  nan: number;
  clipped: number;
  dc: number;
  peak: number;
}

export function hygiene(x: ArrayLike<number>): Hygiene {
  let nan = 0;
  let clipped = 0;
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) nan++;
    else {
      sum += v;
      const a = Math.abs(v);
      if (a >= 0.999) clipped++;
      if (a > peak) peak = a;
    }
  }
  return { nan, clipped, dc: sum / Math.max(1, x.length), peak };
}

/** Energy in a band (Hz) of a frame, linear power. */
export function bandPower(x: ArrayLike<number>, fs: number, start: number, f0: number, f1: number, n = 8192): number {
  const m = magSpectrum(x, start, n);
  let s = 0;
  for (let i = Math.floor((f0 * n) / fs); i <= Math.min(m.length - 1, Math.ceil((f1 * n) / fs)); i++) s += m[i] * m[i];
  return s;
}

/** STFT magnitude in dB: frames × bins (bins limited to fMax). */
export function spectrogram(x: ArrayLike<number>, fs: number, n = 2048, hop = 512, fMax = 8000): { frames: Float32Array[]; binHz: number; hopS: number } {
  const frames: Float32Array[] = [];
  const nb = Math.min(n / 2, Math.ceil((fMax * n) / fs));
  for (let s = 0; s + n <= x.length; s += hop) {
    const m = magSpectrum(x, s, n);
    const f = new Float32Array(nb);
    for (let i = 0; i < nb; i++) f[i] = db(m[i]);
    frames.push(f);
  }
  return { frames, binHz: fs / n, hopS: hop / fs };
}

/** 16-bit PCM WAV (interleaved stereo or mono). */
export function encodeWav(channels: Float32Array[], fs: number): Uint8Array {
  const nc = channels.length;
  const n = channels[0].length;
  const data = n * nc * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + data, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, fs, true);
  v.setUint32(28, fs * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  return new Uint8Array(buf);
}

/** Parse a 16-bit PCM WAV written by encodeWav. */
export function decodeWav(bytes: Uint8Array): { fs: number; channels: Float32Array[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nc = v.getUint16(22, true);
  const fs = v.getUint32(24, true);
  let o = 12;
  while (o < bytes.length - 8) {
    const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    const sz = v.getUint32(o + 4, true);
    if (id === 'data') {
      const n = sz / (2 * nc);
      const ch = Array.from({ length: nc }, () => new Float32Array(n));
      for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) ch[c][i] = v.getInt16(o + 8 + (i * nc + c) * 2, true) / 32768;
      return { fs, channels: ch };
    }
    o += 8 + sz;
  }
  throw new Error('no data chunk');
}
