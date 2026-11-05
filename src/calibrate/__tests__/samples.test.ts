/**
 * Sample dyno files in public/samples/, generated from the reference dyno curves
 * in src/sim/validation/dynoCurves.ts. Run with GEN_SAMPLES=1 to rewrite them;
 * otherwise the tests check that the committed files are up to date and import cleanly.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DYNO_CURVES } from '../../sim/validation/dynoCurves';
import { importDyno } from '../parse';

const DIR = resolve(__dirname, '../../../public/samples');
const curve = (id: string) => DYNO_CURVES.find((c) => c.engineId === id)!;

function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
}

const header = (c: (typeof DYNO_CURVES)[number], extra: string[]) =>
  [
    `# Engine Forge sample dyno file. Engine: ${c.engineId}`,
    `# Source: ${c.source.title}`,
    `# URL: ${c.source.url}`,
    `# Published curve digitised in src/sim/validation/dynoCurves.ts (${c.sourceType}, correction standard: ${c.standard}).`,
    ...extra.map((l) => `# ${l}`),
  ].join('\n');

function ls3(): string {
  const c = curve('gm-ls3');
  const rows = c.points.map((p) => `${p.rpm},${(p.torqueNm * 0.737562).toFixed(1)},${p.hp.toFixed(1)}`);
  return [
    header(c, ['Engine (crank) figures, SAE J1349. Preset: "GM LS3 6.2 - Corvette C6".', 'Columns: rpm, torque in lb-ft, power in hp.']),
    'RPM,Torque (lb-ft),Power (hp)',
    ...rows,
  ].join('\n') + '\n';
}

function b58(): string {
  const c = curve('bmw-b58-340i');
  const rows = c.points.map((p) => `${p.rpm};${p.torqueNm.toFixed(1).replace('.', ',')};${((p.torqueNm * p.rpm) / 9549.3).toFixed(1).replace('.', ',')}`);
  return [
    header(c, ['Engine (crank) figures, ECE. Preset: "BMW B58 3.0T - 340i (F30)".', 'European format: semicolon-separated, decimal commas. Columns: rpm, torque in Nm, power in kW.']),
    'rpm;Torque [Nm];Power [kW]',
    ...rows,
  ].join('\n') + '\n';
}

function ls7Wheel(): string {
  const c = curve('gm-ls7');
  const rnd = lcg(20260519);
  const pts = c.points;
  const rows: string[] = [];
  for (let rpm = pts[0].rpm; rpm <= pts[pts.length - 1].rpm; rpm += 100) {
    let i = 1;
    while (i < pts.length - 1 && pts[i].rpm < rpm) i++;
    const a = pts[i - 1];
    const b = pts[i];
    const crankNm = a.torqueNm + ((b.torqueNm - a.torqueNm) * (rpm - a.rpm)) / (b.rpm - a.rpm);
    const wheelNm = crankNm * 0.85 * (1 + 0.012 * rnd());
    rows.push(`${rpm}\t${(wheelNm * 0.737562).toFixed(1)}\t${((wheelNm * rpm) / 7121).toFixed(1)}`);
  }
  return [
    header(c, [
      'SYNTHETIC wheel-dyno style data, NOT a measurement: the published crank curve x 0.85 (15 % drivetrain loss) with +/-1.2 % random noise, resampled every 100 rpm.',
      'Use with basis = wheel, drivetrain loss 15 %. Preset: "GM LS7 7.0 - Corvette Z06 (C6)".',
      'Tab-separated, no decimal commas. Columns: rpm, wheel torque in lb-ft, wheel hp.',
    ]),
    'RPM\tWTQ (lb-ft)\tWHP',
    ...rows,
  ].join('\n') + '\n';
}

const FILES: Record<string, () => string> = {
  'ls3_crank_lbft_hp.csv': ls3,
  'b58_340i_crank_nm_kw_semicolon.csv': b58,
  'ls7_wheel_synthetic.tsv': ls7Wheel,
};

if (process.env.GEN_SAMPLES) {
  it('writes the sample files', () => {
    mkdirSync(DIR, { recursive: true });
    for (const [name, gen] of Object.entries(FILES)) writeFileSync(resolve(DIR, name), gen());
  });
}

describe('sample dyno files', () => {
  for (const [name, gen] of Object.entries(FILES)) {
    it(`${name} is up to date and imports`, () => {
      if (process.env.GEN_SAMPLES) return;
      expect(existsSync(resolve(DIR, name))).toBe(true);
      const text = readFileSync(resolve(DIR, name), 'utf8');
      expect(text).toBe(gen());
      const r = importDyno(text);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(text).toContain('# Source:');
      expect(r.curve.rpm.length).toBeGreaterThan(10);
    });
  }
  it('sample metadata is detected as intended', () => {
    if (process.env.GEN_SAMPLES) return;
    const a = importDyno(readFileSync(resolve(DIR, 'ls3_crank_lbft_hp.csv'), 'utf8'));
    const b = importDyno(readFileSync(resolve(DIR, 'b58_340i_crank_nm_kw_semicolon.csv'), 'utf8'));
    const c = importDyno(readFileSync(resolve(DIR, 'ls7_wheel_synthetic.tsv'), 'utf8'));
    if (!a.ok || !b.ok || !c.ok) throw new Error('import failed');
    expect(a.options.torqueUnit).toBe('lbft');
    expect(a.options.powerUnit).toBe('hp');
    expect(b.table.delimiter).toBe(';');
    expect(b.table.decimalComma).toBe(true);
    expect(b.options.torqueUnit).toBe('Nm');
    expect(c.table.delimiter).toBe('\t');
    expect(c.options.basis).toBe('wheel');
  });
});
