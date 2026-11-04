/** Diagnostic: exhaust network transfer function (impulse at port 0 → outlets).  npx tsx scripts/audio/tf.ts <engineId> [portTempK] */
import { paramsFor, testEngine } from '../../src/audio/offline';
import { ExhaustNetwork } from '../../src/audio/synth/exhaust';
import { fftInPlace, db } from '../../src/audio/analysis/analysis';
const e = testEngine(process.argv[2]);
const p = paramsFor(e.config);
const net = new ExhaustNetwork(p, 48000);
net.setTemperature(+(process.argv[3] ?? 1150), 1); net.smoothDelays(1);
const N = 1 << 16; const y = new Float64Array(N);
for (let i = 0; i < N; i++) { net.portSrc[0] = i === 0 ? 1 : 0; net.step(); y[i] = net.out[0] + (net.out[1] ?? 0); }
const im = new Float64Array(N); fftInPlace(y, im); const m = y.map((v, i) => Math.hypot(v, im[i]));
const bins = [25, 40, 50, 70, 100, 150, 200, 300, 400, 600, 800, 1200, 2000, 3000, 5000];
console.log(bins.map(f => f + ':' + db(m[Math.round(f * N / 48000)]).toFixed(0)).join(' '));
// peaks
const pk: string[] = []; for (let i = 2; i < N/2 && pk.length < 14; i++) { const f = i*48000/N; if (f>1500) break; if (m[i]>m[i-1]&&m[i]>m[i+1]&&m[i]>m[i-3]*1.5&&m[i]>m[i+3]*1.5) pk.push(f.toFixed(0)+'('+db(m[i]).toFixed(0)+')'); }
console.log('peaks', pk.join(' '));
const rows: string[] = [];
for (let f = 20; f < 3000; f *= Math.pow(2, 1/4)) { const i0 = Math.round(f/Math.pow(2,1/8)*N/48000), i1 = Math.round(f*Math.pow(2,1/8)*N/48000); let s=0; for (let i=i0;i<=i1;i++) s+=m[i]*m[i]; rows.push(f.toFixed(0)+':'+(10*Math.log10(s/(i1-i0+1))).toFixed(0)); }
console.log(rows.join(' '));
