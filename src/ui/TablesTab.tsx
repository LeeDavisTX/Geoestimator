import { useState } from 'react';
import type { PortfolioCalc } from '../core/calc';
import type { Portfolio } from '../core/types';
import { fmt, MP_PREFIX, sta } from '../core/units';
import type { MapController } from '../map/controller';

interface Props {
  p: Portfolio;
  calc: PortfolioCalc;
  mapRef: React.MutableRefObject<MapController | null>;
  onOpen: (id: string) => void;
  onDeleteMany: (ids: string[]) => void;
}

export default function TablesTab({ p, calc, mapRef, onOpen, onDeleteMany }: Props) {
  const [subId, setSubId] = useState(p.activeSubId ?? p.subprojects[0]?.id);
  const [view, setView] = useState<'features' | 'pi'>('features');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const sc = calc.bySub.get(subId ?? '') ?? calc.subs[0];
  if (!sc) return null;
  const u = p.units;
  const mp = MP_PREFIX(u);
  const pipeline = p.industry === 'Pipeline';

  const feats = p.features
    .filter((f) => f.subId === sc.sub.id)
    .map((f) => ({ f, c: calc.features.get(f.id)! }))
    .filter(({ c }) => c && (!flaggedOnly || c.flag))
    .sort((a, b) => (a.c.beginSta ?? 1e15) - (b.c.beginSta ?? 1e15) || a.f.id.localeCompare(b.f.id));

  const visibleIds = feats.map(({ f }) => f.id);
  const checkedVisible = visibleIds.filter((id) => checked.has(id));
  const flaggedIds = p.features.filter((f) => f.subId === sc.sub.id && calc.features.get(f.id)?.flag).map((f) => f.id);
  const toggle = (id: string) => setChecked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doDelete = (ids: string[]) => {
    onDeleteMany(ids);
    setChecked((cur) => { const n = new Set(cur); ids.forEach((i) => n.delete(i)); return n; });
    setConfirm(null);
  };

  return (
    <div className="stack">
      <section className="card">
        <div className="grid2">
          <div className="field">
            <label htmlFor="tbl-sub">Sub-project</label>
            <select id="tbl-sub" value={sc.sub.id} onChange={(e) => setSubId(e.target.value)}>
              {p.subprojects.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>)}
            </select>
          </div>
          <div className="field">
            <span className="label-like">Table</span>
            <div className="seg" role="radiogroup">
              <button role="radio" aria-checked={view === 'features'} className={view === 'features' ? 'on' : ''} onClick={() => setView('features')}>Features</button>
              <button role="radio" aria-checked={view === 'pi'} className={view === 'pi' ? 'on' : ''} onClick={() => setView('pi')}>PI table</button>
            </div>
          </div>
        </div>
        {view === 'features' && (
          <div className="table-tools">
            <label className="check"><input id="tbl-flag" type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged only</label>
            {confirm ? (
              <span className="confirm-inline">
                Delete {confirm.label}?
                <button className="btn danger small" onClick={() => doDelete(confirm.ids)}>Delete</button>
                <button className="btn small" onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            ) : (
              <span className="btn-row">
                <button className="btn small" disabled={!checkedVisible.length} onClick={() => setConfirm({ ids: checkedVisible, label: `${checkedVisible.length} selected feature${checkedVisible.length > 1 ? 's' : ''}` })}>
                  Delete selected{checkedVisible.length ? ` (${checkedVisible.length})` : ''}
                </button>
                <button className="btn small ghost" disabled={!flaggedIds.length} onClick={() => setConfirm({ ids: flaggedIds, label: `all ${flaggedIds.length} flagged feature${flaggedIds.length > 1 ? 's' : ''}` })}>
                  Delete all flagged
                </button>
              </span>
            )}
          </div>
        )}
      </section>

      {view === 'features' ? (
        <section className="card flush">
          {feats.length === 0 ? (
            <p className="muted small pad">{flaggedOnly ? 'No flagged features.' : 'No features in this sub-project yet.'}</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="cb">
                      <input
                        type="checkbox" aria-label="Select all"
                        checked={visibleIds.length > 0 && checkedVisible.length === visibleIds.length}
                        onChange={(e) => setChecked(e.target.checked ? new Set([...checked, ...visibleIds]) : new Set([...checked].filter((id) => !visibleIds.includes(id))))}
                      />
                    </th>
                    <th>ID</th><th>Item</th><th className="r">Qty</th><th>Begin</th><th>End</th><th className="r">Offset</th><th>Flag</th><th aria-label="Delete" /></tr>
                </thead>
                <tbody>
                  {feats.map(({ f, c }) => (
                    <tr key={f.id} className={checked.has(f.id) ? 'checked' : ''} onClick={() => { onOpen(f.id); mapRef.current?.fitCoords(f.coords); }} title="Open in Edit">
                      <td className="cb" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${f.id}`} checked={checked.has(f.id)} onChange={() => toggle(f.id)} />
                      </td>
                      <td className="mono">{f.id}</td>
                      <td title={f.name}>{f.code}{f.name ? <span className="muted"> · {f.name}</span> : null}</td>
                      <td className="r num">{fmt(c.qty, c.unit === 'EA' ? 0 : c.unit === 'AC' || c.unit === 'HA' ? 3 : 1)} <span className="muted">{c.unit}</span></td>
                      <td className="num">{c.beginSta === null ? '–' : sta(c.beginSta, u)}</td>
                      <td className="num">{c.endSta === null || f.kind === 'Point' ? '' : sta(c.endSta, u)}</td>
                      <td className="r num">{c.offset === null ? '' : `${fmt(c.offset)} ${c.side}`}</td>
                      <td>{c.flag && <span className="pill warn">{c.flag.toLowerCase()}</span>}</td>
                      <td className="del" onClick={(e) => e.stopPropagation()}>
                        <button className="icon-btn" title={`Delete ${f.id}`} aria-label={`Delete ${f.id}`} onClick={() => setConfirm({ ids: [f.id], label: f.id })}>
                          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4h10M6.5 4V2.5h3V4M5 4l.6 9h4.8L11 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="card flush">
          {!sc.pi ? (
            <p className="muted small pad">Upload a centerline in Setup to see PIs.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Point</th><th>Station</th><th className="r">{mp}</th><th>Deflection</th>{pipeline && <th>Class</th>}</tr>
                </thead>
                <tbody>
                  {sc.pi.rows.map((r) => (
                    <tr key={r.index} onClick={() => mapRef.current?.fitCoords([[r.lon, r.lat]])}>
                      <td>{r.kind === 'PI' ? `PI${r.piNumber ? ' ' + r.piNumber : ''}` : r.kind}</td>
                      <td className="num">{r.stationText}</td>
                      <td className="r num">{fmt(r.milepost, 3)}</td>
                      <td className="num">{r.hDms ? `${r.hDms} ${r.hDirection}` : ''}</td>
                      {pipeline && <td>{r.bendClass && <span className={`pill ${r.bendClass === 'FITTING' ? 'fit' : r.bendClass === 'FIELD BEND' ? 'fb' : 'fs'}`}>{r.bendClass.toLowerCase()}</span>}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
