import { useEffect, useState } from 'react';
import { CONTEXT_LAYERS } from '../map/context';
import type { MapController } from '../map/controller';

const KEY = 'geoestimator.contextLayers';

function loadOn(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Map overlay panel for public reference layers (wetlands, hydro, protected lands, transmission). */
export default function ContextLayers({ mapRef }: { mapRef: React.MutableRefObject<MapController | null> }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<string[]>(loadOn);
  const [status, setStatus] = useState<Record<string, string>>({});

  useEffect(() => {
    const c = mapRef.current;
    if (!c) return;
    const report = (id: string, msg: string) => setStatus((s) => (s[id] === msg ? s : { ...s, [id]: msg }));
    for (const d of CONTEXT_LAYERS) c.setContext(d.id, on.includes(d.id), report);
    try { localStorage.setItem(KEY, JSON.stringify(on)); } catch { /* storage blocked */ }
  }, [on, mapRef]);

  const toggle = (id: string) => setOn((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className={`ctx ${open ? 'open' : ''}`}>
      <button className="ctx-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        Context layers{on.length ? ` (${on.length})` : ''}
      </button>
      {open && (
        <div className="ctx-panel">
          {CONTEXT_LAYERS.map((d) => (
            <label key={d.id} className="ctx-row">
              <input id={`ctx-${d.id}`} type="checkbox" checked={on.includes(d.id)} onChange={() => toggle(d.id)} />
              <span className="ctx-sw" style={{ background: d.swatch }} />
              <span className="ctx-text">
                <b>{d.label}</b>
                <span>{d.source}</span>
                {on.includes(d.id) && status[d.id] && <span className="ctx-status">{status[d.id]}</span>}
              </span>
            </label>
          ))}
          <p className="ctx-note">Reference only. Layers come straight from public agency services and load when visible.</p>
        </div>
      )}
    </div>
  );
}
