import { useEffect, useMemo, useRef, useState } from 'react';
import * as PresetsModule from '../sim/presets';
import type { EngineConfig } from '../sim/types';
import { DEFAULT_CONFIG } from '../sim/defaults';
import { MAX_SNAPSHOTS, shareUrl, useStore } from './store';
import { Segmented } from './controls';
import { Icon } from './icons';
import { engineCode } from './format';
import { fmt, type Units } from './units';
import { SNAP_COLORS } from './charts/common';
import { setAudioEnabled } from './audio';
import { buildSheet } from './buildSheet';

const PRESETS: EngineConfig[] = PresetsModule.PRESETS;
const PRESET_GROUPS = (PresetsModule as Record<string, unknown>).PRESET_GROUPS as Record<string, string[]> | undefined;

function groupedPresets(): [string, EngineConfig[]][] {
  if (!PRESET_GROUPS) return [['Presets', PRESETS]];
  const used = new Set<string>();
  const out: [string, EngineConfig[]][] = [];
  for (const [g, names] of Object.entries(PRESET_GROUPS)) {
    const list = names.map((n) => PRESETS.find((p) => p.name === n)).filter((p): p is EngineConfig => !!p);
    list.forEach((p) => used.add(p.name));
    if (list.length) out.push([g, list]);
  }
  const rest = PRESETS.filter((p) => !used.has(p.name));
  if (rest.length) out.push(['Other', rest]);
  return out;
}

function dispL(c: EngineConfig) {
  return ((Math.PI / 4) * (c.boreMm / 10) ** 2 * (c.strokeMm / 10) * c.cylinders) / 1000;
}

function PresetPicker() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const name = useStore((s) => s.config.name);
  const loadConfig = useStore((s) => s.loadConfig);
  const ref = useRef<HTMLDivElement>(null);
  const groups = useMemo(groupedPresets, []);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const ql = q.trim().toLowerCase();
  const filtered = groups
    .map(([g, list]) => [g, list.filter((p) => !ql || p.name.toLowerCase().includes(ql) || g.toLowerCase().includes(ql))] as const)
    .filter(([, l]) => l.length);
  return (
    <div className="preset" ref={ref}>
      <button className={`preset-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} data-testid="preset-button" aria-haspopup="listbox" aria-expanded={open}>
        <span className="preset-k">Preset</span>
        <span className="preset-name">{name}</span>
        <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden>
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        <div className="preset-pop" role="listbox" data-testid="preset-list">
          <input className="preset-search" autoFocus placeholder={`Search ${PRESETS.length} engines…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="preset-scroll">
            {filtered.map(([g, list]) => (
              <div key={g} className="preset-group">
                <div className="preset-g">{g}</div>
                {list.map((p) => (
                  <button
                    key={p.name}
                    role="option"
                    aria-selected={p.name === name}
                    className={`preset-item ${p.name === name ? 'on' : ''}`}
                    onClick={() => {
                      loadConfig(p);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="preset-item-n">{p.name}</span>
                    <span className="preset-item-s">
                      {fmt(dispL(p), 1)}L {engineCode(p)} · {p.induction === 'na' ? 'NA' : p.induction === 'turbo' ? 'Turbo' : 'SC'}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {filtered.length === 0 && <div className="preset-empty">No engines match “{q}”</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function SnapshotControls() {
  const snapshots = useStore((s) => s.snapshots);
  const add = useStore((s) => s.addSnapshot);
  const remove = useStore((s) => s.removeSnapshot);
  const rename = useStore((s) => s.renameSnapshot);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="snaps">
      {snapshots.map((s) => (
        <span key={s.id} className="snap-chip" style={{ ['--c' as string]: SNAP_COLORS[s.slot] }} data-testid="snapshot-chip">
          <i />
          {editing === s.id ? (
            <input
              autoFocus
              defaultValue={s.name}
              onBlur={(e) => {
                rename(s.id, e.target.value.trim() || s.name);
                setEditing(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <span className="snap-name" onDoubleClick={() => setEditing(s.id)} title="Double-click to rename">
              {s.name}
            </span>
          )}
          <button onClick={() => remove(s.id)} aria-label={`Remove ${s.name}`}>
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      <button className="btn ghost" onClick={() => add()} title={snapshots.length >= MAX_SNAPSHOTS ? 'Replaces the oldest snapshot' : 'Save current curve for comparison'} data-testid="snapshot-btn">
        <Icon name="camera" />
        Snapshot
        <span className="count">
          {snapshots.length}/{MAX_SNAPSHOTS}
        </span>
      </button>
    </div>
  );
}

export function Header() {
  const units = useStore((s) => s.units);
  const setUnits = useStore((s) => s.setUnits);
  const muted = useStore((s) => s.muted);
  const setMuted = useStore((s) => s.setMuted);
  const config = useStore((s) => s.config);
  const loadConfig = useStore((s) => s.loadConfig);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };
  const share = async () => {
    const url = shareUrl(config);
    history.replaceState(null, '', url);
    flash((await copy(url)) ? 'Share link copied' : 'Share link is in the address bar');
  };
  const copySheet = async () => {
    const text = buildSheet(useStore.getState().result, shareUrl(config));
    (window as unknown as { __efLastSheet?: string }).__efLastSheet = text;
    flash((await copy(text)) ? 'Build sheet copied to clipboard' : 'Clipboard unavailable');
  };
  return (
    <header className="topbar">
      <div className="brand">
        <svg className="logo" viewBox="0 0 32 32" width="26" height="26" aria-hidden>
          <path d="M16 3l11 6.5v13L16 29 5 22.5v-13z" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 12h10M11 16h7M11 20h10" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="wordmark">
          ENGINE<b>FORGE</b>
        </span>
      </div>
      <div className="divider" />
      <PresetPicker />
      <div className="spacer" />
      <SnapshotControls />
      <div className="divider" />
      <Segmented<Units>
        size="sm"
        value={units}
        onChange={setUnits}
        options={[
          { value: 'metric', label: 'Metric' },
          { value: 'imperial', label: 'Imperial' },
        ]}
        testId="units"
      />
      <button
        className={`icon-btn ${muted ? '' : 'live'}`}
        onClick={() => {
          setMuted(!muted);
          setAudioEnabled(muted);
        }}
        title={muted ? 'Enable engine sound' : 'Mute engine sound'}
        aria-label={muted ? 'Enable engine sound' : 'Mute engine sound'}
        data-testid="audio-toggle"
      >
        <Icon name={muted ? 'mute' : 'speaker'} />
      </button>
      <button className="icon-btn" onClick={copySheet} title="Copy build sheet (spec + peak numbers)" aria-label="Copy build sheet" data-testid="sheet-btn">
        <Icon name="sheet" />
      </button>
      <button className="icon-btn" onClick={share} title="Copy share link" aria-label="Copy share link" data-testid="share-btn">
        <Icon name={toast === 'Share link copied' ? 'check' : 'link'} />
      </button>
      <button className="icon-btn" onClick={() => loadConfig(DEFAULT_CONFIG)} title="Reset to default engine" aria-label="Reset">
        <Icon name="reset" />
      </button>
      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={13} /> {toast}
        </div>
      )}
    </header>
  );
}
