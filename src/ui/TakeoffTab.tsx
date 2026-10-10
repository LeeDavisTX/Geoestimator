import { useEffect, useRef } from 'react';
import type { ItemTally, PortfolioCalc, SubCalc } from '../core/calc';
import { sliceRef } from '../core/geo';
import type { CatalogItem, GeomKind, Portfolio } from '../core/types';
import { fmt, LEN_SHORT, MP_PREFIX, PER_LONG, sta } from '../core/units';
import type { MapController } from '../map/controller';
import { nowIso, type Updater } from './store';

interface InputProps {
  p: Portfolio;
  calc: PortfolioCalc;
  update: Updater;
  mapRef: React.MutableRefObject<MapController | null>;
  drawOn: boolean;
  setDrawOn: (v: boolean) => void;
  setSelected: (id: string | null) => void;
  clEditing: boolean;
  goSetup: () => void;
}

const GEOM_LABEL: Record<GeomKind, string> = { Line: 'Lines', Point: 'Points', Polygon: 'Areas' };

/** Input tab: active sub-project and the item to draw. */
export function InputTab({ p, calc, update, mapRef, drawOn, setDrawOn, setSelected, clEditing, goSetup }: InputProps) {
  const active = p.subprojects.find((s) => s.id === p.activeSubId) ?? p.subprojects[0];
  const items = p.industry ? p.catalog.filter((c) => c.industry === p.industry) : [];

  const pick = (it: CatalogItem) => {
    if (p.activeCode === it.code && drawOn) { setDrawOn(false); return; }
    update((d) => { d.activeCode = it.code; });
    setSelected(null);
    setDrawOn(true);
  };

  if (!p.industry) {
    return (
      <div className="stack">
        <section className="card empty-state">
          <h2>Draw items</h2>
          <p>Select the portfolio industry in Setup first. It decides which items you can draw.</p>
          <div><button className="btn primary" onClick={goSetup}>Go to Setup</button></div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Active sub-project</h2>
        <div className="chips" role="radiogroup" aria-label="Active sub-project">
          {p.subprojects.map((s, i) => (
            <button
              key={s.id} role="radio" aria-checked={s.id === active?.id}
              className={`chip ${s.id === active?.id ? 'on' : ''}`} style={{ '--sub': s.color } as React.CSSProperties}
              onClick={() => {
                update((d) => { d.activeSubId = s.id; });
                const ref = calc.bySub.get(s.id)?.ref;
                if (ref) mapRef.current?.fitCenterline(ref.verts);
              }}
            >
              <span className="dot" />{i + 1}. {s.name}
            </button>
          ))}
        </div>
        {active && !active.centerline && (
          <p className="note">
            No centerline for {active.name}. Quantities still count, but stations need a route. <button className="link" onClick={goSetup}>Upload one in Setup</button>
          </p>
        )}
      </section>

      <section className="card">
        <div className="section-head tight">
          <h2>Draw item · {p.industry}</h2>
          {drawOn && <button className="btn small" onClick={() => setDrawOn(false)}>Stop drawing</button>}
        </div>
        {clEditing && <p className="note">Finish editing the centerline before drawing.</p>}
        {(['Line', 'Point', 'Polygon'] as GeomKind[]).map((g) => {
          const list = items.filter((c) => c.geometry === g);
          if (!list.length) return null;
          return (
            <div key={g} className="item-group">
              <div className="group-label">{GEOM_LABEL[g]}</div>
              <div className="item-list">
                {list.map((it) => {
                  const on = p.activeCode === it.code;
                  return (
                    <button
                      key={it.code} className={`item ${on ? 'on' : ''} ${on && drawOn ? 'drawing' : ''}`}
                      onClick={() => pick(it)} disabled={clEditing} title={it.description || it.name}
                    >
                      <Swatch item={it} />
                      <span className="item-code">{it.code}</span>
                      <span className="item-name">{it.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <p className="hint">Pick an item, then click on the map. The item stays selected for the next feature. Lines: click the last point or press Enter to finish. Esc stops drawing.</p>
      </section>
    </div>
  );
}

/** Edit tab: attributes and shape of the selected feature. */
export function EditTab({ p, calc, update, mapRef, selected, onDelete, goTable, onOpen }: {
  p: Portfolio; calc: PortfolioCalc; update: Updater; mapRef: React.MutableRefObject<MapController | null>;
  selected: string | null; onDelete: (id: string) => void; goTable: () => void; onOpen: (id: string) => void;
}) {
  const sel = selected ? p.features.find((f) => f.id === selected) : null;
  if (!sel) {
    return (
      <div className="stack">
        <section className="card empty-state">
          <h2>Edit feature</h2>
          <p>Select a feature on the map or in the Table tab to edit its item, sub-project, name, notes and shape.</p>
          <div><button className="btn" onClick={goTable}>Open Table</button></div>
        </section>
      </div>
    );
  }
  // Step through the selected feature's sub-project in station order, same as the Table.
  const order = p.features
    .filter((f) => f.subId === sel.subId)
    .sort((a, b) => (calc.features.get(a.id)?.beginSta ?? 1e15) - (calc.features.get(b.id)?.beginSta ?? 1e15) || a.id.localeCompare(b.id));
  const at = order.findIndex((f) => f.id === sel.id);
  const go = (i: number) => {
    const f = order[i];
    if (!f) return;
    onOpen(f.id);
    mapRef.current?.fitCoords(f.coords);
  };
  return (
    <div className="stack">
      <div className="stepper">
        <button className="btn small" onClick={goTable}>Back to table</button>
        <span className="muted small num">{at + 1} of {order.length} in {p.subprojects.find((s) => s.id === sel.subId)?.name}</span>
        <span className="btn-row">
          <button className="btn small" disabled={at <= 0} onClick={() => go(at - 1)} aria-label="Previous feature">‹ Prev</button>
          <button className="btn small" disabled={at >= order.length - 1} onClick={() => go(at + 1)} aria-label="Next feature">Next ›</button>
        </span>
      </div>
      <SelectedCard key={sel.id} p={p} calc={calc} update={update} mapRef={mapRef} id={sel.id} onDelete={onDelete} />
      <p className="hint">Double-click a feature on the map to edit its shape. Drag vertices, click a midpoint to add one, right-click to delete one. Esc finishes.</p>
    </div>
  );
}

/** Takeoff tab: live tally and portfolio totals. */
export function TallyTab({ p, calc, mapRef }: { p: Portfolio; calc: PortfolioCalc; mapRef: React.MutableRefObject<MapController | null> }) {
  return (
    <div className="stack">
      <Tally p={p} calc={calc} mapRef={mapRef} activeId={p.activeSubId} />
      <PortfolioTotals calc={calc} mapRef={mapRef} />
    </div>
  );
}

function PortfolioTotals({ calc, mapRef }: { calc: PortfolioCalc; mapRef: React.MutableRefObject<MapController | null> }) {
  const totals = new Map<string, ItemTally>();
  for (const s of calc.subs) for (const t of s.items) {
    const cur = totals.get(t.code);
    if (cur) { cur.qty += t.qty; cur.count += t.count; cur.ids = [...cur.ids, ...t.ids]; }
    else totals.set(t.code, { ...t, ids: [...t.ids] });
  }
  const rows = [...totals.values()];
  if (calc.subs.length < 2) return null;
  return (
    <section className="card">
      <h2>Portfolio totals</h2>
      {rows.length === 0 ? <p className="muted small empty">No features yet.</p> : (
        <table className="tally-table">
          <tbody>
            {rows.map((t) => (
              <tr key={t.code} onClick={() => mapRef.current?.flash(t.ids)} title="Show on map">
                <td className="t-sw">{t.item ? <Swatch item={t.item} /> : null}</td>
                <td className="t-code">{t.code}</td>
                <td className="t-name">{t.item?.name ?? 'Not in catalog'}</td>
                <td className="t-cnt num">{t.item?.geometry !== 'Point' ? `${t.count}×` : ''}</td>
                <td className="t-qty num">{fmt(t.qty, t.unit === 'EA' ? 0 : t.unit === 'AC' || t.unit === 'HA' ? 3 : 0)}</td>
                <td className="t-unit">{t.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Swatch({ item }: { item: CatalogItem }) {
  if (item.geometry === 'Point') return <span className="sw sw-pt" style={{ background: item.color }} />;
  if (item.geometry === 'Polygon') return <span className="sw sw-poly" style={{ borderColor: item.color, background: item.color + '55' }} />;
  return <span className={`sw sw-line ${item.style.toLowerCase()}`} style={{ '--c': item.color } as React.CSSProperties} />;
}

function SelectedCard({ p, calc, update, mapRef, id, onDelete }: { p: Portfolio; calc: PortfolioCalc; update: Updater; mapRef: React.MutableRefObject<MapController | null>; id: string; onDelete: (id: string) => void }) {
  const f = p.features.find((x) => x.id === id)!;
  const fc = calc.features.get(id);
  const it = calc.items.get(f.code);
  const sub = p.subprojects.find((s) => s.id === f.subId);
  const u = p.units;
  const mp = MP_PREFIX(u);
  const same = p.catalog.filter((c) => c.geometry === f.kind && c.industry === (p.industry ?? it?.industry ?? sub?.industry));
  const set = (fn: (x: typeof f) => void) => update((d) => { const x = d.features.find((y) => y.id === id); if (x) { fn(x); x.modified = nowIso(); } });

  return (
    <section className="card selected-card">
      <div className="section-head tight">
        <h2>{f.id}</h2>
        <button className="btn small" onClick={() => mapRef.current?.fitCoords(f.coords)}>Zoom</button>
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="sel-item">Item</label>
          <select id="sel-item" value={f.code} onChange={(e) => set((x) => { x.code = e.target.value; })}>
            {!it && <option value={f.code}>{f.code} (not in catalog)</option>}
            {same.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sel-sub">Sub-project</label>
          <select id="sel-sub" value={f.subId} onChange={(e) => set((x) => { x.subId = e.target.value; })}>
            {p.subprojects.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="sel-name">Name</label>
        <input id="sel-name" value={f.name} placeholder="e.g. HDD at creek crossing" onChange={(e) => set((x) => { x.name = e.target.value; })} />
      </div>
      {fc && (
        <dl className="kv">
          <dt>Quantity</dt><dd className="num">{fmt(fc.qty, fc.unit === 'EA' ? 0 : fc.unit === 'AC' || fc.unit === 'HA' ? 3 : 1)} {fc.unit}</dd>
          {fc.beginSta !== null && f.kind !== 'Point' && <><dt>Stations</dt><dd className="num">{sta(fc.beginSta, u)} to {sta(fc.endSta!, u)}</dd></>}
          {fc.beginMp !== null && f.kind !== 'Point' && <><dt>{mp}</dt><dd className="num">{fmt(fc.beginMp, 3)} to {fmt(fc.endMp!, 3)}</dd></>}
          {fc.station !== null && f.kind === 'Point' && <><dt>Station</dt><dd className="num">{sta(fc.station, u)} · {mp} {fmt(fc.mp!, 3)}</dd></>}
          {fc.offset !== null && <><dt>{f.kind === 'Point' ? 'Offset' : 'Max offset'}</dt><dd className="num">{fmt(fc.offset, 1)} {LEN_SHORT[u]} {fc.side}</dd></>}
          {fc.flag && <><dt>Flag</dt><dd><span className="pill warn">{fc.flag.toLowerCase()}</span></dd></>}
        </dl>
      )}
      <div className="field">
        <label htmlFor="sel-notes">Notes</label>
        <textarea id="sel-notes" rows={2} value={f.notes} onChange={(e) => set((x) => { x.notes = e.target.value; })} />
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => mapRef.current?.editFeature(id)}>Edit shape</button>
        <button className="btn danger" onClick={() => onDelete(id)}>Delete</button>
      </div>
    </section>
  );
}

function Tally({ p, calc, mapRef, activeId }: { p: Portfolio; calc: PortfolioCalc; mapRef: React.MutableRefObject<MapController | null>; activeId: string | null }) {
  // Remember previous quantities so changed rows can flash.
  const prev = useRef(new Map<string, number>());
  const changed = new Set<string>();
  for (const s of calc.subs) for (const t of s.items) {
    const k = `${s.sub.id}|${t.code}`;
    const old = prev.current.get(k);
    if (old === undefined ? prev.current.size > 0 : Math.abs(old - t.qty) > 1e-9) changed.add(k);
  }
  useEffect(() => {
    const m = new Map<string, number>();
    for (const s of calc.subs) for (const t of s.items) m.set(`${s.sub.id}|${t.code}`, t.qty);
    prev.current = m;
  });

  const ordered = [...calc.subs].sort((a, b) => (a.sub.id === activeId ? -1 : b.sub.id === activeId ? 1 : a.index - b.index));
  return (
    <section className="card tally">
      <h2>Live tally</h2>
      <p className="hint">Lines show the number of segments and total length, e.g. 3× bores totaling 640 ft.</p>
      {ordered.map((s) => <SubTally key={s.sub.id} s={s} p={p} mapRef={mapRef} changed={changed} active={s.sub.id === activeId} />)}
    </section>
  );
}

function SubTally({ s, p, mapRef, changed, active }: { s: SubCalc; p: Portfolio; mapRef: React.MutableRefObject<MapController | null>; changed: Set<string>; active: boolean }) {
  const u = p.units;
  return (
    <div className={`sub-tally ${active ? 'active' : ''}`} style={{ '--sub': s.sub.color } as React.CSSProperties}>
      <div className="sub-tally-head">
        <span className="dot" />
        <b>{s.index + 1}. {s.sub.name}</b>
        {s.ref && <span className="muted small num">{fmt(s.ref.length / PER_LONG(u), 2)} {u === 'm' ? 'km' : 'mi'} centerline</span>}
      </div>
      {s.items.length === 0 ? (
        <p className="muted small empty">No features yet.</p>
      ) : (
        <table className="tally-table">
          <tbody>
            {s.items.map((t) => {
              const k = `${s.sub.id}|${t.code}`;
              return (
                <tr key={k + (changed.has(k) ? '-' + t.qty : '')} className={changed.has(k) ? 'flash' : ''} onClick={() => mapRef.current?.flash(t.ids)} title="Show on map">
                  <td className="t-sw">{t.item ? <Swatch item={t.item} /> : null}</td>
                  <td className="t-code">{t.code}</td>
                  <td className="t-name">{t.item?.name ?? 'Not in catalog'}</td>
                  <td className="t-cnt num">{t.item?.geometry !== 'Point' ? `${t.count}×` : ''}</td>
                <td className="t-qty num">{fmt(t.qty, t.unit === 'EA' ? 0 : t.unit === 'AC' || t.unit === 'HA' ? 3 : 0)}</td>
                  <td className="t-unit">{t.unit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {s.flagged > 0 && <p className="small warn-text">{s.flagged} feature{s.flagged > 1 ? 's' : ''} flagged. See Table.</p>}
    </div>
  );
}
