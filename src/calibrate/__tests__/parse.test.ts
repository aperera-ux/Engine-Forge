import { describe, expect, it } from 'vitest';
import { DIN_TO_SAE, importDyno, smoothResample, type DynoImportOk } from '../parse';

/** Engine-like torque curve in N.m. */
const tq = (rpm: number) => 300 + 90 * Math.sin(((rpm - 1500) / 5500) * Math.PI);
const RPMS = [2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000];
const kw = (rpm: number) => (tq(rpm) * rpm) / 9549.297;

/** Curve value at an rpm on the output grid. */
const at = (r: DynoImportOk, rpm: number, k: 'torqueNm' | 'powerKw' = 'torqueNm') => r.curve[k][r.curve.rpm.indexOf(rpm)];

function ok(text: string, opts = {}): DynoImportOk {
  const r = importDyno(text, opts);
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r;
}

describe('delimiters, headers and decimals', () => {
  it('comma-separated with header, Nm + kW', () => {
    const text = 'RPM,Torque (Nm),Power (kW)\n' + RPMS.map((r) => `${r},${tq(r).toFixed(1)},${kw(r).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.table.delimiter).toBe(',');
    expect(r.table.hasHeader).toBe(true);
    expect(r.options.torqueUnit).toBe('Nm');
    expect(r.options.powerUnit).toBe('kW');
    expect(r.curve.rpm[0]).toBe(2000);
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
  });

  it('tab-separated, lb-ft + hp from the header', () => {
    const text = 'RPM\tTorque (lb-ft)\tPower (hp)\n' + RPMS.map((r) => `${r}\t${(tq(r) / 1.35582).toFixed(1)}\t${(kw(r) / 0.7457).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.table.delimiter).toBe('\t');
    expect(r.options.torqueUnit).toBe('lbft');
    expect(r.options.powerUnit).toBe('hp');
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
    expect(r.warnings.filter((w) => /ambiguous|assumed/.test(w))).toHaveLength(0);
  });

  it('semicolon-separated with decimal commas', () => {
    const text = 'rpm;Drehmoment [Nm];Leistung [kW]\n' + RPMS.map((r) => `${r};${tq(r).toFixed(1).replace('.', ',')};${kw(r).toFixed(1).replace('.', ',')}`).join('\n');
    const r = ok(text);
    expect(r.table.delimiter).toBe(';');
    expect(r.table.decimalComma).toBe(true);
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
    expect(r.curve.powerKw[0]).toBeCloseTo(kw(2000), 0);
  });

  it('whitespace-separated with decimal commas and a spaced header', () => {
    const text = 'RPM Torque (Nm) Power (kW)\n' + RPMS.map((r) => `${r} ${tq(r).toFixed(1).replace('.', ',')} ${kw(r).toFixed(1).replace('.', ',')}`).join('\n');
    const r = ok(text);
    expect(r.table.delimiter).toBe(' ');
    expect(r.table.decimalComma).toBe(true);
    expect(r.table.headers).toHaveLength(3);
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
  });

  it('no header: rpm column and the torque/power pair are inferred from the data', () => {
    const text = RPMS.map((r) => `${r},${tq(r).toFixed(1)},${(kw(r) / 0.7457).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.table.hasHeader).toBe(false);
    expect(r.options.rpmCol).toBe(0);
    // N.m + hp is the ambiguous pair, but both readings must give back the same torque within ~1 %.
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), -1);
  });

  it('no header, lb-ft + hp: the pair is identified by the 5252 relation', () => {
    const text = RPMS.map((r) => `${r}\t${(tq(r) / 1.35582).toFixed(1)}\t${(kw(r) / 0.7457).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.options.torqueUnit).toBe('lbft');
    expect(r.options.powerUnit).toBe('hp');
    expect(at(r, 3500)).toBeCloseTo(tq(3500), 0);
  });

  it('no header, power column first and torque second is still sorted out', () => {
    const text = RPMS.map((r) => `${r},${kw(r).toFixed(1)},${tq(r).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.options.torqueCol).toBe(2);
    expect(r.options.powerCol).toBe(1);
    expect(r.options.torqueUnit).toBe('Nm');
  });

  it('skips comment lines, a BOM, blank lines and CRLF', () => {
    const text = '﻿# source: test\r\n\r\nrpm,tq_nm\r\n' + RPMS.map((r) => `${r},${tq(r).toFixed(1)}`).join('\r\n') + '\r\n';
    const r = ok(text);
    expect(r.curve.rpm.length).toBeGreaterThan(5);
    expect(r.options.powerCol).toBeNull();
  });

  it('power-only file derives torque (hp)', () => {
    const text = 'rpm,hp\n' + RPMS.map((r) => `${r},${(kw(r) / 0.7457).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.options.torqueCol).toBeNull();
    expect(at(r, 3500)).toBeCloseTo(tq(3500), 0);
    expect(r.notes.join(' ')).toMatch(/derived from power/i);
  });

  it('ignores extra columns such as AFR and notes them', () => {
    const text = 'rpm,torque nm,power kw,AFR\n' + RPMS.map((r) => `${r},${tq(r).toFixed(1)},${kw(r).toFixed(1)},12.5`).join('\n');
    const r = ok(text);
    expect(r.notes.join(' ')).toMatch(/Ignored columns: AFR/);
  });

  it('thousands separators in rpm are not read as decimal commas', () => {
    const text = 'RPM\tTorque (Nm)\n' + RPMS.map((r) => `${String(r).replace(/(\d)(\d{3})$/, '$1,$2')}\t${tq(r).toFixed(1)}`).join('\n');
    const r = ok(text);
    expect(r.curve.rpm[0]).toBe(2000);
  });
});

describe('units', () => {
  const body = RPMS.map((r) => [r, tq(r), kw(r)]);
  it.each([
    ['lb-ft', 'hp', (t: number) => t / 1.35582, (p: number) => p / 0.7457],
    ['Nm', 'kW', (t: number) => t, (p: number) => p],
    ['Nm', 'PS', (t: number) => t, (p: number) => p / 0.73549875],
  ])('header units %s + %s convert to N.m + kW', (tu, pu, ft, fp) => {
    const text = `rpm,Torque (${tu}),Power (${pu})\n` + body.map(([r, t, p]) => `${r},${ft(t).toFixed(2)},${fp(p).toFixed(2)}`).join('\n');
    const r = ok(text);
    expect(at(r, 4500)).toBeCloseTo(tq(4500), 0);
    expect(at(r, 4500, 'powerKw')).toBeCloseTo(kw(4500), 0);
  });

  it('a unit override replaces the header', () => {
    const text = 'rpm,Torque\n' + RPMS.map((r) => `${r},${(tq(r) / 1.35582).toFixed(1)}`).join('\n');
    const guess = ok(text);
    expect(guess.warnings.join(' ')).toMatch(/assumed N·m/);
    const r = ok(text, { torqueUnit: 'lbft' });
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
  });

  it('warns when torque and power columns disagree', () => {
    const text = 'rpm,Torque (Nm),Power (kW)\n' + RPMS.map((r) => `${r},${tq(r).toFixed(1)},${(kw(r) * 1.4).toFixed(1)}`).join('\n');
    expect(ok(text).warnings.join(' ')).toMatch(/disagree/);
  });
});

describe('wheel vs crank and correction standard', () => {
  const text = 'rpm,Torque (Nm)\n' + RPMS.map((r) => `${r},${tq(r).toFixed(1)}`).join('\n');
  it('crank is the default and applies no gain', () => {
    expect(ok(text).curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
  });
  it('wheel data is divided by (1 - loss), default 15 %', () => {
    const r = ok(text, { basis: 'wheel' });
    expect(r.options.drivetrainLossPct).toBe(15);
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000) / 0.85, 0);
  });
  it('the loss is editable', () => {
    const r = ok(text, { basis: 'wheel', drivetrainLossPct: 20 });
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000) / 0.8, 0);
  });
  it('a wheel header (WHP / WTQ) defaults the basis to wheel', () => {
    const t2 = 'RPM\tWTQ (lb-ft)\tWHP\n' + RPMS.map((r) => `${r}\t${(tq(r) / 1.35582).toFixed(1)}\t${(kw(r) / 0.7457).toFixed(1)}`).join('\n');
    expect(ok(t2).options.basis).toBe('wheel');
  });
  it('rejects an absurd drivetrain loss', () => {
    const r = importDyno(text, { basis: 'wheel', drivetrainLossPct: 80 });
    expect(r.ok).toBe(false);
  });
  it('DIN 70020 data is scaled to the SAE J1349 basis; the note says so', () => {
    const r = ok(text, { standard: 'din-70020' });
    expect(r.curve.torqueNm[0] / tq(2000)).toBeCloseTo(DIN_TO_SAE, 2);
    expect(DIN_TO_SAE).toBeGreaterThan(0.96);
    expect(DIN_TO_SAE).toBeLessThan(0.98);
    expect(r.notes.join(' ')).toMatch(/DIN 70020/);
  });
  it('unknown standard applies nothing and warns', () => {
    const r = ok(text, { standard: 'unknown' });
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
    expect(r.warnings.join(' ')).toMatch(/standard unknown/i);
  });
});

describe('resampling and smoothing', () => {
  it('resamples to a uniform grid inside the measured range', () => {
    const r = ok('rpm,nm\n' + RPMS.map((x) => `${x + 13},${tq(x).toFixed(1)}`).join('\n'), { stepRpm: 250 });
    expect(r.curve.rpm[0]).toBe(2250);
    expect(r.curve.rpm[r.curve.rpm.length - 1]).toBe(7000);
    for (let i = 1; i < r.curve.rpm.length; i++) expect(r.curve.rpm[i] - r.curve.rpm[i - 1]).toBe(250);
  });

  it('smooths noisy data toward the underlying curve', () => {
    let s = 3;
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2;
    const rows: string[] = [];
    for (let rpm = 2000; rpm <= 7000; rpm += 25) rows.push(`${rpm},${(tq(rpm) * (1 + 0.03 * rnd())).toFixed(1)}`);
    const r = ok('rpm,nm\n' + rows.join('\n'));
    expect(r.curve.smoothingSigmaRpm).toBeGreaterThan(0);
    expect(r.curve.noisePct).toBeGreaterThan(0.5);
    let sse = 0;
    let sseRaw = 0;
    r.curve.rpm.forEach((x, i) => {
      sse += ((r.curve.torqueNm[i] - tq(x)) / tq(x)) ** 2;
    });
    r.curve.raw.forEach((p) => (sseRaw += ((p.torqueNm - tq(p.rpm)) / tq(p.rpm)) ** 2));
    expect(Math.sqrt(sse / r.curve.rpm.length)).toBeLessThan(0.5 * Math.sqrt(sseRaw / r.curve.raw.length));
  });

  it('smooth data is not smoothed (interpolated only)', () => {
    const r = ok('rpm,nm\n' + RPMS.map((x) => `${x},${tq(x).toFixed(2)}`).join('\n'));
    expect(r.curve.smoothingSigmaRpm).toBe(0);
  });

  it('removes a single-point spike', () => {
    const rows = RPMS.map((x, i) => `${x},${(i === 4 ? tq(x) * 1.6 : tq(x)).toFixed(1)}`);
    const r = ok('rpm,nm\n' + rows.join('\n'));
    expect(r.warnings.join(' ')).toMatch(/spike/);
    expect(Math.max(...r.curve.torqueNm)).toBeLessThan(tq(3000) * 1.4);
  });

  it('local-linear smoothing preserves a linear trend including at the edges', () => {
    const x = Array.from({ length: 40 }, (_, i) => 1000 + i * 100);
    const y = x.map((v) => 100 + 0.05 * v);
    const out = smoothResample(x, y, [1000, 2500, 4900], 200);
    expect(out[0]).toBeCloseTo(150, 3);
    expect(out[1]).toBeCloseTo(225, 3);
    expect(out[2]).toBeCloseTo(345, 3);
  });

  it('merges duplicate rpm and sorts unsorted data', () => {
    const rows = [...RPMS].reverse().map((x) => `${x},${tq(x).toFixed(1)}`);
    rows.push(`3000,${tq(3000).toFixed(1)}`);
    const r = ok('rpm,nm\n' + rows.join('\n'));
    expect(r.curve.raw.map((p) => p.rpm)).toEqual(RPMS);
  });
});

describe('clear errors for bad files', () => {
  const code = (t: string, o = {}) => {
    const r = importDyno(t, o);
    return r.ok ? 'ok' : r.error.code;
  };
  it('empty', () => {
    expect(code('')).toBe('empty');
    expect(code('   \n\n  ')).toBe('empty');
    expect(code('# only a comment\n')).toBe('empty');
  });
  it('binary content', () => {
    expect(code('PK\u0003\u0004\u0000\u0000data')).toBe('binary');
  });
  it('a single column is not a table', () => {
    expect(code('rpm\n2000\n3000\n4000\n5000')).toBe('no-table');
  });
  it('text that is not numeric', () => {
    expect(code('hello world\nfoo bar\nbaz qux\nlorem ipsum')).toBe('no-table');
  });
  it('no rpm column', () => {
    expect(code('a,b\n1.5,2.5\n1.6,2.4\n1.1,2.0\n1.2,2.2\n1.0,3.1\n1.9,2.9')).toBe('no-rpm');
  });
  it('rpm but no torque or power', () => {
    expect(code('rpm,note\n2000,x\n3000,y\n4000,z\n5000,w')).not.toBe('ok');
  });
  it('too few points', () => {
    expect(code('rpm,nm\n2000,300\n3000,320\n4000,330')).toBe('too-few-points');
  });
  it('rpm span too small', () => {
    const rows = Array.from({ length: 10 }, (_, i) => `${3000 + i * 50},300`);
    expect(code('rpm,nm\n' + rows.join('\n'))).toBe('rpm-range');
  });
  it('implausible values (wrong units)', () => {
    const rows = RPMS.map((x) => `${x},${tq(x) * 100}`);
    expect(code('rpm,nm\n' + rows.join('\n'))).toBe('implausible');
  });
  it('a manual column that does not exist', () => {
    const text = 'rpm,nm\n' + RPMS.map((x) => `${x},${tq(x)}`).join('\n');
    expect(code(text, { torqueCol: 9 })).toBe('bad-options');
  });
  it('error messages are human sentences', () => {
    const r = importDyno('rpm\n2000\n3000\n4000\n5000');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message.length).toBeGreaterThan(30);
  });
  it('mixed rows (units row and a footer) are tolerated', () => {
    const text = 'rpm,torque,power\n1/min,Nm,kW\n' + RPMS.map((x) => `${x},${tq(x).toFixed(1)},${kw(x).toFixed(1)}`).join('\n') + '\nEnd of run';
    const r = ok(text);
    expect(r.curve.torqueNm[0]).toBeCloseTo(tq(2000), 0);
  });
});
