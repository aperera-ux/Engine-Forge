/**
 * Garage: three saved custom engines that persist in this browser (localStorage).
 * Load one back into the editor, overwrite it with the current engine, rename or clear it.
 * Cmd/Ctrl+S saves: back into the slot the engine came from, else the first empty slot,
 * else opens the garage to pick a slot to overwrite.
 */
import { useEffect, useRef, useState } from 'react';
import { GARAGE_SLOTS, useStore, type SavedEngine } from './store';
import { Icon } from './icons';
import { engineCode } from './format';
import { fmt, show } from './units';

const sameConfig = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** Two-step button: first click arms it (3 s), second click acts. */
function ConfirmButton({ label, confirm, onConfirm, testId, danger }: { label: string; confirm: string; onConfirm: () => void; testId?: string; danger?: boolean }) {
  const [armed, setArmed] = useState(false);
  const t = useRef(0);
  useEffect(() => () => window.clearTimeout(t.current), []);
  return (
    <button
      className={`gar-act ${armed ? 'armed' : ''} ${danger ? 'danger' : ''}`}
      data-testid={testId}
      onClick={() => {
        if (armed) {
          window.clearTimeout(t.current);
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          t.current = window.setTimeout(() => setArmed(false), 3000);
        }
      }}
      title={armed ? 'Click again to confirm' : label}
    >
      {armed ? confirm : label}
    </button>
  );
}

function SlotCard({ i, e, onDone, flash }: { i: number; e: SavedEngine | null; onDone: () => void; flash: (m: string) => void }) {
  const config = useStore((s) => s.config);
  const units = useStore((s) => s.units);
  const save = useStore((s) => s.saveToGarage);
  const load = useStore((s) => s.loadFromGarage);
  const rename = useStore((s) => s.renameGarageSlot);
  const clear = useStore((s) => s.clearGarageSlot);
  const [editing, setEditing] = useState(false);

  if (!e) {
    return (
      <div className="gar-slot empty" data-testid={`garage-slot-${i}`}>
        <span className="gar-num">{i + 1}</span>
        <div className="gar-body">
          <div className="gar-empty-t">Empty slot</div>
        </div>
        <button
          className="gar-act primary"
          data-testid={`garage-save-${i}`}
          onClick={() => {
            save(i);
            flash(`Saved to garage slot ${i + 1}`);
          }}
        >
          Save current engine
        </button>
      </div>
    );
  }

  const isLoaded = config.name === e.name;
  const modified = isLoaded && !sameConfig({ ...config, name: '' }, { ...e.config, name: '' });
  const [pw, pu] = show((e.peakHp * 745.7) / 1000, 'power', units);
  const [tq, tu] = show(e.peakTorqueNm, 'torque', units);
  const ind = e.config.induction === 'na' ? 'NA' : e.config.induction === 'turbo' ? 'Turbo' : 'SC';
  return (
    <div className={`gar-slot ${isLoaded ? 'on' : ''}`} data-testid={`garage-slot-${i}`}>
      <span className="gar-num">{i + 1}</span>
      <div className="gar-body">
        {editing ? (
          <input
            className="gar-rename"
            autoFocus
            defaultValue={e.name}
            maxLength={60}
            onBlur={(ev) => {
              rename(i, ev.target.value);
              setEditing(false);
            }}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
              if (ev.key === 'Escape') setEditing(false);
              ev.stopPropagation();
            }}
          />
        ) : (
          <button className="gar-name" onClick={() => setEditing(true)} title="Rename">
            {e.name}
            {isLoaded && <span className={`gar-badge ${modified ? 'mod' : ''}`}>{modified ? 'edited' : 'loaded'}</span>}
          </button>
        )}
        <div className="gar-spec">
          {fmt(e.displacementL, 1)} L {engineCode(e.config)} · {ind} · {pw} {pu} · {tq} {tu}
        </div>
        <div className="gar-when">Saved {when(e.savedAt)}</div>
      </div>
      <div className="gar-acts">
        <button
          className="gar-act primary"
          data-testid={`garage-load-${i}`}
          onClick={() => {
            load(i);
            flash(`Loaded “${e.name}”`);
            onDone();
          }}
        >
          Load
        </button>
        <ConfirmButton
          label="Overwrite"
          confirm="Replace?"
          testId={`garage-overwrite-${i}`}
          onConfirm={() => {
            save(i, isLoaded ? e.name : undefined);
            flash(`Saved to garage slot ${i + 1}`);
          }}
        />
        <ConfirmButton label="Clear" confirm="Delete?" danger testId={`garage-clear-${i}`} onConfirm={() => clear(i)} />
      </div>
    </div>
  );
}

export function Garage({ flash }: { flash: (m: string) => void }) {
  const garage = useStore((s) => s.garage);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const used = garage.filter(Boolean).length;

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

  // Cmd/Ctrl+S: quick save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      const st = useStore.getState();
      const same = st.garage.findIndex((g) => g?.name === st.config.name);
      const empty = st.garage.findIndex((g) => !g);
      const slot = same >= 0 ? same : empty;
      if (slot >= 0) {
        st.saveToGarage(slot);
        flash(`Saved to garage slot ${slot + 1}`);
      } else {
        setNote('Garage is full — overwrite a slot to save this engine.');
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flash]);

  return (
    <div className="garage" ref={ref}>
      <button
        className={`btn ghost ${open ? 'open' : ''}`}
        onClick={() => {
          setNote(null);
          setOpen(!open);
        }}
        title="Saved custom engines (⌘S to save)"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="garage-btn"
      >
        <Icon name="garage" />
        Garage
        <span className="count">
          {used}/{GARAGE_SLOTS}
        </span>
      </button>
      {open && (
        <div className="gar-pop" role="dialog" aria-label="Garage" data-testid="garage-pop">
          <div className="gar-head">
            <span>My engines</span>
            <span className="gar-hint">Saved in this browser · ⌘S quick-save</span>
          </div>
          {note && <div className="gar-note">{note}</div>}
          {garage.map((e, i) => (
            <SlotCard key={i} i={i} e={e} flash={flash} onDone={() => setOpen(false)} />
          ))}
        </div>
      )}
    </div>
  );
}
