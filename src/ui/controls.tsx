import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useStore } from './store';
import { conv, decimalsForStep, type Quantity } from './units';

export type HintLevel = 'ok' | 'warn' | 'bad';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  q?: Quantity;
  /** Unit label override (for non-convertible units like °, rpm, :1). */
  unit?: string;
  hint?: ReactNode;
  hintLevel?: HintLevel;
  title?: string;
  testId?: string;
}

/** Custom-styled range slider + numeric input. Values are SI; display is unit-converted. */
export function Slider({ label, value, min, max, step, onChange, q = 'none', unit, hint, hintLevel, title, testId }: SliderProps) {
  const units = useStore((s) => s.units);
  const c = conv(q, units);
  const decimals = Math.max(0, decimalsForStep(step) + c.extraDecimals);
  const display = c.to(value).toFixed(decimals);
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const pct = ((value - min) / (max - min || 1)) * 100;
  const commit = (txt: string) => {
    const n = parseFloat(txt);
    setDraft(null);
    if (!Number.isFinite(n)) return;
    const si = c.from(n);
    const snapped = Math.round(si / step) * step;
    onChange(+Math.min(max, Math.max(min, snapped)).toFixed(6));
  };
  return (
    <div className={`ctl slider ${hintLevel ? `hint-${hintLevel}` : ''}`} title={title} data-testid={testId}>
      <div className="ctl-row">
        <label htmlFor={id} className="ctl-label">
          {label}
        </label>
        <div className="num">
          <input
            className="num-input"
            inputMode="decimal"
            value={draft ?? display}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setDraft(null);
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const k = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
                onChange(+Math.min(max, Math.max(min, value + k * step)).toFixed(6));
              }
            }}
            aria-label={`${label} value`}
          />
          <span className="num-unit">{unit ?? c.label}</span>
        </div>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--pct' as string]: `${Math.min(100, Math.max(0, pct))}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <div className={`ctl-hint ${hintLevel ?? ''}`}>{hint}</div>}
    </div>
  );
}

interface SegProps<T extends string | number> {
  label?: string;
  value: T;
  options: { value: T; label: string; title?: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  testId?: string;
}

export function Segmented<T extends string | number>({ label, value, options, onChange, size = 'md', testId }: SegProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  const idx = options.findIndex((o) => o.value === value);
  useEffect(() => {
    const el = ref.current?.children[idx + 1] as HTMLElement | undefined;
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [idx, options.length]);
  return (
    <div className={`ctl seg-wrap ${size}`} data-testid={testId}>
      {label && <div className="ctl-label">{label}</div>}
      <div className="seg" ref={ref} role="radiogroup" aria-label={label}>
        <span
          className="seg-ind"
          style={ind ? { transform: `translateX(${ind.left}px)`, width: ind.width } : { opacity: 0 }}
        />
        {options.map((o) => (
          <button
            key={String(o.value)}
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'on' : ''}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, value, onChange, desc }: { label: string; value: boolean; onChange: (b: boolean) => void; desc?: string }) {
  return (
    <button className={`ctl toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span className="toggle-text">
        <span className="ctl-label">{label}</span>
        {desc && <span className="toggle-desc">{desc}</span>}
      </span>
      <span className="switch">
        <span className="knob" />
      </span>
    </button>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="ctl select">
      <span className="ctl-label">{label}</span>
      <span className="select-box">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </span>
    </label>
  );
}

export function Derived({ items }: { items: { label: string; value: string; unit?: string; level?: HintLevel }[] }) {
  return (
    <div className="derived">
      {items.map((it) => (
        <div key={it.label} className={`derived-item ${it.level ?? ''}`}>
          <span className="derived-label">{it.label}</span>
          <span className="derived-value">
            {it.value}
            {it.unit && <small>{it.unit}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="cfg-section">
      <header className="cfg-section-h">
        <h3>{title}</h3>
        {aside}
      </header>
      <div className="cfg-section-body">{children}</div>
    </section>
  );
}
