/**
 * "Calibrate to your engine": import a measured dyno curve, fit the uncertain
 * parameters of the current build so the simulation matches it, and apply or
 * revert the result. The measured curve is overlaid on the dyno chart.
 */
import { useRef, useState } from 'react';
import { PARAM_DEFS, STANDARD_NOTES, formatParam, type DynoImportOk, type FitOk, type ParamReport } from '../calibrate';
import { findPreset } from '../sim/presets';
import { Section, Segmented, Select } from './controls';
import { useCalib } from './calibrateStore';
import { useStore } from './store';
import { fmt } from './units';

const SAMPLES = [
  { file: 'ls3_crank_lbft_hp.csv', label: 'GM LS3, crank, lb-ft + hp (CSV)', preset: 'GM LS3 6.2 — Corvette C6' },
  { file: 'b58_340i_crank_nm_kw_semicolon.csv', label: 'BMW B58 340i, crank, Nm + kW (; and decimal commas)', preset: 'BMW B58 3.0T — 340i (F30)' },
  { file: 'ls7_wheel_synthetic.tsv', label: 'GM LS7, synthetic wheel dyno (TSV)', preset: 'GM LS7 7.0 — Corvette Z06 (C6)' },
];

const LOSS_PRESETS = [
  { label: 'RWD manual 15 %', v: 15 },
  { label: 'RWD auto 18 %', v: 18 },
  { label: 'AWD 22 %', v: 22 },
];

export function CalibrateTab() {
  const calibration = useStore((s) => s.calibration);
  const imported = useCalib((s) => s.imported);
  const fit = useCalib((s) => s.fit);
  const status = useCalib((s) => s.status);
  return (
    <div className="cal" data-testid="calibrate-panel">
      <p className="cal-intro">
        Import a measured dyno curve. The fit adjusts a few uncertain parameters of this build, each within a stated physical range, so the model matches it.
        It reports how well, and says so when it cannot.
      </p>
      <DataSection />
      {imported && imported.ok && <InterpretSection imp={imported} />}
      {imported && imported.ok && <FitSection imp={imported} />}
      {status === 'done' && fit && <ResultSection fit={fit} />}
      {calibration && status !== 'done' && <AppliedSection />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function DataSection() {
  const load = useCalib((s) => s.load);
  const clear = useCalib((s) => s.clearData);
  const imported = useCalib((s) => s.imported);
  const name = useCalib((s) => s.sourceName);
  const configName = useStore((s) => s.config.name);
  const loadConfig = useStore((s) => s.loadConfig);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const [drag, setDrag] = useState(false);
  const [sample, setSample] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = (f: File) => {
    f.text().then((t) => load(f.name, t));
  };
  const loadSample = async (file: string) => {
    setSample(file);
    if (!file) return;
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${file}`);
      if (!res.ok) throw new Error(String(res.status));
      load(file, await res.text());
    } catch {
      load(file, '');
    }
  };
  const smp = SAMPLES.find((s) => s.file === sample);

  return (
    <Section title="Measured data">
      <div
        className={`cal-drop ${drag ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) readFile(f);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,.dat,text/csv,text/plain,text/tab-separated-values"
          hidden
          data-testid="calibrate-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
            e.target.value = '';
          }}
        />
        <button className="btn" onClick={() => fileRef.current?.click()} data-testid="calibrate-choose">
          Choose CSV / TSV
        </button>
        <button className="btn ghost" onClick={() => setPasting((p) => !p)} data-testid="calibrate-paste-toggle" aria-expanded={pasting}>
          Paste
        </button>
        <span className="cal-drop-hint">or drop a file here</span>
      </div>
      {pasting && (
        <div className="cal-paste">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={'rpm, torque (lb-ft), power (hp)\n2500, 310, 148\n3000, 330, 188\n…'}
            spellCheck={false}
            data-testid="calibrate-paste"
          />
          <button
            className="btn primary"
            disabled={!paste.trim()}
            onClick={() => {
              load('pasted data', paste);
              setPasting(false);
            }}
            data-testid="calibrate-paste-use"
          >
            Use pasted data
          </button>
        </div>
      )}
      <Select
        label="Or try a sample"
        value={sample}
        options={[{ value: '', label: 'Choose a sample…' }, ...SAMPLES.map((s) => ({ value: s.file, label: s.label }))]}
        onChange={loadSample}
      />
      {smp && configName !== smp.preset && findPreset(smp.preset) && (
        <button
          className="cal-link"
          onClick={() => {
            const p = findPreset(smp.preset);
            if (p) loadConfig(p);
          }}
          data-testid="calibrate-load-sample-engine"
        >
          This sample is for {smp.preset}. Load that engine
        </button>
      )}
      {imported && !imported.ok && (
        <div className="cal-msg bad" role="alert" data-testid="calibrate-error">
          <b>Could not read {name || 'the data'}.</b> {imported.error.message}
        </div>
      )}
      {imported && imported.ok && (
        <div className="cal-file" data-testid="calibrate-summary">
          <div>
            <b className="ellipsis">{name}</b>
            <span>
              {imported.curve.raw.length} points, {fmt(imported.curve.raw[0].rpm)} to {fmt(imported.curve.raw[imported.curve.raw.length - 1].rpm)} rpm. Peak{' '}
              {fmt(Math.max(...imported.curve.torqueNm))} N·m, {fmt(Math.max(...imported.curve.powerKw))} kW (crank).
            </span>
          </div>
          <button className="icon-btn sm" onClick={clear} title="Remove measured data" aria-label="Remove measured data">
            ×
          </button>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

function InterpretSection({ imp }: { imp: DynoImportOk }) {
  const setOpts = useCalib((s) => s.setOpts);
  const o = imp.options;
  return (
    <Section title="How to read it">
      <Segmented
        label="Measured at"
        value={o.basis}
        size="sm"
        testId="calibrate-basis"
        options={[
          { value: 'crank', label: 'Crank / engine' },
          { value: 'wheel', label: 'Wheels' },
        ]}
        onChange={(basis) => setOpts({ basis })}
      />
      {o.basis === 'wheel' && (
        <div className="ctl cal-loss" data-testid="calibrate-loss">
          <div className="ctl-row">
            <label className="ctl-label" htmlFor="cal-loss">
              Drivetrain loss
            </label>
            <div className="num">
              <input
                id="cal-loss"
                className="num-input"
                inputMode="decimal"
                key={o.drivetrainLossPct}
                defaultValue={o.drivetrainLossPct}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value.replace(',', '.'));
                  if (Number.isFinite(v)) setOpts({ drivetrainLossPct: v });
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Drivetrain loss percent"
              />
              <span className="num-unit">%</span>
            </div>
          </div>
          <div className="cal-chips">
            {LOSS_PRESETS.map((p) => (
              <button key={p.v} className={`cal-chip ${o.drivetrainLossPct === p.v ? 'on' : ''}`} onClick={() => setOpts({ drivetrainLossPct: p.v })}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="ctl-hint">Crank = wheel / (1 - loss). Typical: 12 to 15 % RWD manual, 15 to 20 % automatic, 20 to 25 % AWD.</div>
        </div>
      )}
      <Select
        label="Correction standard"
        value={o.standard}
        options={[
          { value: 'sae-j1349', label: 'SAE J1349 (model basis)' },
          { value: 'din-70020', label: 'DIN 70020 / ECE (reads higher)' },
          { value: 'unknown', label: 'Unknown / uncorrected' },
        ]}
        onChange={(standard) => setOpts({ standard })}
      />
      <div className="ctl-hint" data-testid="calibrate-standard-note">
        {STANDARD_NOTES[o.standard]}
      </div>
      <div className="cal-two">
        {o.torqueCol !== null && (
          <Select
            label="Torque unit"
            value={o.torqueUnit}
            options={[
              { value: 'Nm', label: 'N·m' },
              { value: 'lbft', label: 'lb-ft' },
            ]}
            onChange={(torqueUnit) => setOpts({ torqueUnit })}
          />
        )}
        {o.powerCol !== null && (
          <Select
            label="Power unit"
            value={o.powerUnit}
            options={[
              { value: 'kW', label: 'kW' },
              { value: 'hp', label: 'hp' },
              { value: 'PS', label: 'PS' },
            ]}
            onChange={(powerUnit) => setOpts({ powerUnit })}
          />
        )}
      </div>
      <Select
        label="Smoothing"
        value={o.smoothing}
        options={[
          { value: 'auto', label: `Auto (${imp.curve.smoothingSigmaRpm ? `${Math.round(imp.curve.smoothingSigmaRpm)} rpm` : 'none needed'})` },
          { value: 'none', label: 'None (interpolate)' },
          { value: 'light', label: 'Light (75 rpm)' },
          { value: 'medium', label: 'Medium (150 rpm)' },
          { value: 'heavy', label: 'Heavy (250 rpm)' },
        ]}
        onChange={(smoothing) => setOpts({ smoothing })}
      />
      {imp.warnings.map((w, i) => (
        <div className="cal-msg warn" key={`w${i}`} data-testid="calibrate-import-warning">
          {w}
        </div>
      ))}
      <details className="cal-notes">
        <summary>What was detected ({imp.notes.length})</summary>
        <ul>
          {imp.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </details>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

function FitSection({ imp }: { imp: DynoImportOk }) {
  const status = useCalib((s) => s.status);
  const progress = useCalib((s) => s.progress);
  const error = useCalib((s) => s.error);
  const runFit = useCalib((s) => s.runFit);
  const cancel = useCalib((s) => s.cancelFit);
  const calibration = useStore((s) => s.calibration);
  const induction = useStore((s) => s.config.induction);
  const ids = induction === 'na' ? (['veScale', 'fricScale', 'runnerScale', 'camShiftDeg'] as const) : (['veScale', 'fricScale', 'runnerScale', 'camShiftDeg', 'boostScale', 'torqueCap'] as const);
  const running = status === 'running';
  return (
    <Section title="Fit">
      <details className="cal-notes">
        <summary>What gets fitted ({ids.length} parameters, bounded)</summary>
        <ul className="cal-params-doc">
          {ids.map((id) => (
            <li key={id}>
              <b>{PARAM_DEFS[id].label}</b> {PARAM_DEFS[id].min} to {PARAM_DEFS[id].max}
              <br />
              <span>{PARAM_DEFS[id].range}</span>
            </li>
          ))}
        </ul>
      </details>
      {!running ? (
        <button className="btn primary cal-go" onClick={runFit} disabled={!!calibration || !imp.curve.rpm.length} data-testid="calibrate-fit" title={calibration ? 'Revert the current calibration before fitting again' : 'Fit to the measured curve'}>
          Fit to measured curve
        </button>
      ) : (
        <div className="cal-run" data-testid="calibrate-progress">
          <div className="cal-bar">
            <i style={{ width: `${Math.round(progress.frac * 100)}%` }} />
          </div>
          <div className="cal-run-row">
            <span>
              Fitting… {Math.round(progress.frac * 100)} %, best RMS {progress.bestRmsPct.toFixed(1)} %
            </span>
            <button className="btn ghost" onClick={cancel} data-testid="calibrate-cancel">
              Cancel
            </button>
          </div>
        </div>
      )}
      {calibration && <div className="ctl-hint">This build is already calibrated. Revert it below to fit again.</div>}
      {error && (
        <div className="cal-msg bad" role="alert" data-testid="calibrate-fit-error">
          {error}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------

/** Signed one-decimal percent, never "-0.0". */
const signed = (v: number) => (Math.abs(v) < 0.05 ? '0.0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);

function RmsBlock({ fit }: { fit: FitOk }) {
  const cls = fit.verdict === 'good' ? 'ok' : fit.verdict === 'fair' ? 'warn' : 'bad';
  const label = fit.verdict === 'good' ? 'Good fit' : fit.verdict === 'fair' ? 'Fair fit' : 'Poor fit';
  return (
    <div className="cal-rms" data-testid="calibrate-rms">
      <div className="cal-rms-row">
        <div>
          <span className="cal-k">RMS torque error</span>
          <span className="cal-big">
            <span className="cal-from">{fit.rmsBeforePct.toFixed(1)} %</span>
            <span className="cal-arrow">→</span>
            <b className={cls} data-testid="calibrate-rms-after">
              {fit.rmsAfterPct.toFixed(1)} %
            </b>
          </span>
        </div>
        <span className={`cal-verdict ${cls}`} data-testid="calibrate-verdict">
          {label}
        </span>
      </div>
      <div className="cal-sub">
        Over {fmt(fit.overlap.loRpm)} to {fmt(fit.overlap.hiRpm)} rpm ({fit.overlap.n} points). Mean error {signed(fit.biasBeforePct)} % → {signed(fit.biasAfterPct)} %.
      </div>
    </div>
  );
}

function ParamRow({ p }: { p: ParamReport }) {
  const pos = ((p.value - p.min) / (p.max - p.min)) * 100;
  const nom = ((p.nominal - p.min) / (p.max - p.min)) * 100;
  const inactiveCap = p.id === 'torqueCap' && p.value >= 0.995;
  return (
    <div className={`cal-prow ${p.atBound ? 'bound' : ''}`} data-testid={`calibrate-param-${p.id}`} title={`${PARAM_DEFS[p.id].what}\n\nRange: ${PARAM_DEFS[p.id].range}`}>
      <div className="cal-prow-top">
        <span className="cal-pname">{p.label}</span>
        <span className="cal-pval mono">{formatParam(p.id, p.value)}</span>
      </div>
      <div className="cal-range" aria-hidden>
        <i className="nom" style={{ left: `${nom}%` }} />
        <i className="dot" style={{ left: `${Math.min(100, Math.max(0, pos))}%` }} />
      </div>
      <div className="cal-prow-bot">
        <span>
          {p.min} to {p.max}
        </span>
        {p.atBound && (
          <span className="cal-flag bad" data-testid={`calibrate-bound-${p.id}`}>
            AT {p.atBound === 'low' ? 'LOWER' : 'UPPER'} BOUND
          </span>
        )}
        {!p.atBound && p.poorlyDetermined && <span className="cal-flag warn">poorly determined</span>}
        {!p.atBound && !p.poorlyDetermined && p.weak && <span className="cal-flag">not constrained by data</span>}
        {!p.atBound && !p.weak && !p.poorlyDetermined && p.sigma > 0 && !inactiveCap && (
          <span className="cal-sig">± {p.sigma.toFixed(p.id === 'camShiftDeg' ? 1 : 3)}</span>
        )}
        {inactiveCap && <span className="cal-sig">no limit needed</span>}
      </div>
    </div>
  );
}

function ResultSection({ fit }: { fit: FitOk }) {
  const apply = useCalib((s) => s.applyFit);
  const discard = useCalib((s) => s.discardFit);
  const pk = fit.peaks;
  return (
    <Section title="Result">
      <RmsBlock fit={fit} />
      {fit.verdict === 'poor' && (
        <div className="cal-msg bad strong" role="alert" data-testid="calibrate-poor-banner">
          <b>Still {fit.rmsAfterPct.toFixed(1)} % off, above the 5 % level.</b> The model with bounded physical parameters cannot reproduce this curve. Treat the fitted
          values as unreliable and check the data (units, wheel vs crank, standard).
        </div>
      )}
      {fit.warnings
        .filter((w) => w.code !== 'poor-fit')
        .map((w) => (
          <div className={`cal-msg ${w.severity === 'info' ? '' : 'warn'}`} key={w.code} data-testid={`calibrate-warning-${w.code}`}>
            {w.message}
          </div>
        ))}
      <div className="cal-params">
        {fit.params.map((p) => (
          <ParamRow key={p.id} p={p} />
        ))}
      </div>
      <div className="cal-peaks">
        <table>
          <thead>
            <tr>
              <th />
              <th>Measured</th>
              <th>Before</th>
              <th>After</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Peak torque N·m</td>
              <td>{fmt(pk.measured.torqueNm)}</td>
              <td>{fmt(pk.before.torqueNm)}</td>
              <td>{fmt(pk.after.torqueNm)}</td>
            </tr>
            <tr>
              <td>at rpm</td>
              <td>{fmt(pk.measured.torqueRpm)}</td>
              <td>{fmt(pk.before.torqueRpm)}</td>
              <td>{fmt(pk.after.torqueRpm)}</td>
            </tr>
            <tr>
              <td>Peak power kW</td>
              <td>{fmt(pk.measured.powerKw)}</td>
              <td>{fmt(pk.before.powerKw)}</td>
              <td>{fmt(pk.after.powerKw)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="ctl-hint">
        The fitted model is only validated inside the measured rpm range of this one build. Outside it, and for other builds, it is the uncalibrated model's accuracy again.
      </div>
      <div className="cal-actions">
        <button className="btn primary" onClick={apply} data-testid="calibrate-apply">
          Apply to build
        </button>
        <button className="btn ghost" onClick={discard} data-testid="calibrate-discard">
          Discard
        </button>
      </div>
    </Section>
  );
}

function AppliedSection() {
  const cal = useStore((s) => s.calibration);
  const revert = useStore((s) => s.revertCalibration);
  if (!cal) return null;
  const cls = cal.verdict === 'good' ? 'ok' : cal.verdict === 'fair' ? 'warn' : 'bad';
  return (
    <Section title="Applied calibration">
      <div className="cal-applied" data-testid="calibrate-applied">
        <div className="cal-rms-row">
          <div>
            <span className="cal-k">Calibrated to {cal.sourceName}</span>
            <span className="cal-big">
              <span className="cal-from">{cal.rmsBeforePct.toFixed(1)} %</span>
              <span className="cal-arrow">→</span>
              <b className={cls}>{cal.rmsAfterPct.toFixed(1)} %</b>
            </span>
          </div>
          <span className={`cal-verdict ${cls}`}>{cal.verdict === 'poor' ? 'Poor fit' : cal.verdict === 'fair' ? 'Fair fit' : 'Good fit'}</span>
        </div>
        {cal.verdict === 'poor' && <div className="cal-msg bad">The fit stayed above 5 % RMS; the fitted values are not reliable.</div>}
        {cal.atBound.length > 0 && <div className="cal-msg warn">At bound: {cal.atBound.map((id) => PARAM_DEFS[id].label).join(', ')}.</div>}
        <ul className="cal-applied-list">
          {(Object.keys(cal.values) as (keyof typeof PARAM_DEFS)[]).map((id) => (
            <li key={id}>
              <span>{PARAM_DEFS[id].label}</span>
              <b className="mono">{formatParam(id, cal.values[id] as number)}</b>
            </li>
          ))}
        </ul>
        <button className="btn" onClick={revert} data-testid="calibrate-revert">
          Revert calibration
        </button>
      </div>
    </Section>
  );
}
