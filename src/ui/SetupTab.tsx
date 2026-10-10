import { useRef, useState } from 'react';
import type { PortfolioCalc } from '../core/calc';
import { newSubProject, PICK_LISTS } from '../core/catalog';
import { readRoute } from '../core/io';
import { INDUSTRIES, MAX_SUBPROJECTS, type Industry, type Portfolio, type SubProject } from '../core/types';
import { fmt, lengthText, MP_PREFIX, UNIT_OPTIONS } from '../core/units';
import type { LinearUnit } from '../pi-engine';
import type { MapController } from '../map/controller';
import type { Updater } from './store';
import type { ClEdit } from './App';

interface Props {
  p: Portfolio;
  calc: PortfolioCalc;
  update: Updater;
  notify: (m: string) => void;
  mapRef: React.MutableRefObject<MapController | null>;
  clEdit: ClEdit | null;
  onEditCenterline: (subId: string) => void;
  clDraw: string | null;
  onDrawCenterline: (subId: string) => void;
  onCancelDraw: () => void;
}

export default function SetupTab({ p, calc, update, notify, mapRef, clEdit, onEditCenterline, clDraw, onDrawCenterline, onCancelDraw }: Props) {
  const [open, setOpen] = useState<string | null>(p.activeSubId);

  const addSub = () => {
    if (p.subprojects.length >= MAX_SUBPROJECTS) return;
    const last = p.subprojects[p.subprojects.length - 1];
    const sp = newSubProject(p.subprojects.length, p.industry ?? last?.industry ?? 'Pipeline');
    update((d) => { d.subprojects.push(sp); d.activeSubId = sp.id; });
    setOpen(sp.id);
  };

  return (
    <div className="stack">
      <section className="card">
        <h2>Portfolio</h2>
        <div className="grid2">
          <Field label="Name" id="pf-name">
            <input id="pf-name" value={p.name} onChange={(e) => update((d) => { d.name = e.target.value; })} />
          </Field>
          <Field label="Number" id="pf-number">
            <input id="pf-number" value={p.number} placeholder="e.g. 123ABC" onChange={(e) => update((d) => { d.number = e.target.value; })} />
          </Field>
        </div>
        <Field
          label="Industry" id="pf-ind"
          hint={p.features.length ? `Locked: ${p.features.length} feature${p.features.length === 1 ? ' uses' : 's use'} this industry's items. Delete them to change industry.` : 'One industry per portfolio. Sets the item catalog for every sub-project.'}
        >
          <select
            id="pf-ind" value={p.industry ?? ''} disabled={p.features.length > 0}
            onChange={(e) => {
              const ind = e.target.value as Industry;
              update((d) => { d.industry = ind; for (const s of d.subprojects) s.industry = ind; d.activeCode = null; });
            }}
          >
            {!p.industry && <option value="">Select industry…</option>}
            {INDUSTRIES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Units" id="pf-units" hint="Stations, lengths and areas for the whole portfolio.">
          <select id="pf-units" value={p.units} onChange={(e) => update((d) => { d.units = e.target.value as LinearUnit; })}>
            {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label={`${MP_PREFIX(p.units)} marker interval`} id="pf-mp">
            <select id="pf-mp" value={p.mpInterval} onChange={(e) => update((d) => { d.mpInterval = Number(e.target.value); })}>
              {[0.1, 0.25, 0.5, 1, 5].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Off-centerline flag (ft)" id="pf-off">
            <input
              id="pf-off" type="number" min={1} value={p.offsetLimitFt}
              onChange={(e) => { const v = Number(e.target.value); if (v > 0) update((d) => { d.offsetLimitFt = v; }); }}
            />
          </Field>
        </div>
      </section>

      <div className="section-head">
        <h2>Sub-projects <span className="count">{p.subprojects.length}/{MAX_SUBPROJECTS}</span></h2>
        <button className="btn" onClick={addSub} disabled={p.subprojects.length >= MAX_SUBPROJECTS}>Add sub-project</button>
      </div>
      <p className="muted small">Each sub-project gets one centerline. Upload routes one at a time; stationing starts at 0 at the first vertex.</p>

      {p.subprojects.map((s, i) => (
        <SubCard
          key={s.id} sub={s} index={i} p={p} calc={calc} update={update} notify={notify} mapRef={mapRef}
          open={open === s.id} onToggle={() => setOpen(open === s.id ? null : s.id)}
          editing={clEdit?.subId === s.id} anyEditing={!!clEdit || !!clDraw} onEditCenterline={onEditCenterline}
          drawing={clDraw === s.id} onDrawCenterline={onDrawCenterline} onCancelDraw={onCancelDraw}
        />
      ))}
    </div>
  );
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

interface SubProps {
  sub: SubProject;
  index: number;
  p: Portfolio;
  calc: PortfolioCalc;
  update: Updater;
  notify: (m: string) => void;
  mapRef: React.MutableRefObject<MapController | null>;
  open: boolean;
  onToggle: () => void;
  editing: boolean;
  anyEditing: boolean;
  onEditCenterline: (subId: string) => void;
  drawing: boolean;
  onDrawCenterline: (subId: string) => void;
  onCancelDraw: () => void;
}

function SubCard({ sub, index, p, calc, update, notify, mapRef, open, onToggle, editing, anyEditing, onEditCenterline, drawing, onDrawCenterline, onCancelDraw }: SubProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'remove' | null>(null);
  const [over, setOver] = useState(false);
  const sc = calc.bySub.get(sub.id);
  const featureCount = p.features.filter((f) => f.subId === sub.id).length;
  const lists = p.industry ? PICK_LISTS[p.industry] : { commodity: [], size: [], material: [], sizeLabel: 'Size' };
  const set = (fn: (s: SubProject) => void) =>
    update((d) => { const s = d.subprojects.find((x) => x.id === sub.id); if (s) fn(s); });
  const fid = (k: string) => `sp-${sub.id}-${k}`;

  const load = async (file: File) => {
    setError(null);
    try {
      const r = await readRoute(file);
      set((s) => { s.centerline = r.vertices; s.centerlineName = r.name; s.centerlineFile = file.name; });
      update((d) => { d.activeSubId = sub.id; });
      mapRef.current?.fitCenterline(r.vertices);
      notify(`Loaded ${r.name}: ${r.vertices.length} vertices.${r.warnings.length ? ' ' + r.warnings.join(' ') : ''}${featureCount ? ` ${featureCount} features re-stationed.` : ''}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pi = sc?.pi;
  const piCount = pi ? pi.rows.filter((r) => r.kind === 'PI').length : 0;

  return (
    <section className={`card sub ${open ? 'open' : ''}`} style={{ '--sub': sub.color } as React.CSSProperties}>
      <button className="sub-head" onClick={onToggle} aria-expanded={open}>
        <span className="sub-swatch" />
        <span className="sub-no">{index + 1}</span>
        <span className="sub-title">
          <b>{sub.name || `Sub-project ${index + 1}`}</b>
          <span className="muted small">
            {[sub.size, sub.material].filter(Boolean).join(' · ') || 'Specs not set'}
            {sc?.ref ? ` · ${fmt(sc.ref.length / (p.units === 'm' ? 1000 : 5280), 2)} ${p.units === 'm' ? 'km' : 'mi'}` : ' · no centerline'}
          </span>
        </span>
        <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="sub-body">
          <div className="grid2">
            <Field label="Name" id={fid('name')}><input id={fid('name')} value={sub.name} onChange={(e) => set((s) => { s.name = e.target.value; })} /></Field>
            <Field label="Number" id={fid('num')}><input id={fid('num')} value={sub.number} onChange={(e) => set((s) => { s.number = e.target.value; })} /></Field>
          </div>
          <div className="grid2">
            <Field label="Commodity" id={fid('com')}>
              <input id={fid('com')} list={fid('com-l')} value={sub.commodity} onChange={(e) => set((s) => { s.commodity = e.target.value; })} />
              <datalist id={fid('com-l')}>{lists.commodity.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
            <Field label={lists.sizeLabel} id={fid('size')}>
              <input id={fid('size')} list={fid('size-l')} value={sub.size} placeholder={lists.size.length ? `e.g. ${lists.size[Math.min(6, lists.size.length - 1)]}` : ''} onChange={(e) => set((s) => { s.size = e.target.value; })} />
              <datalist id={fid('size-l')}>{lists.size.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
          </div>
          <div className="grid2">
            <Field label="Material" id={fid('mat')}>
              <input id={fid('mat')} list={fid('mat-l')} value={sub.material} onChange={(e) => set((s) => { s.material = e.target.value; })} />
              <datalist id={fid('mat-l')}>{lists.material.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
            <Field label="Map color" id={fid('color')}>
              <input id={fid('color')} type="color" value={sub.color} onChange={(e) => set((s) => { s.color = e.target.value.toUpperCase(); })} />
            </Field>
          </div>
          <Field label="Scope description" id={fid('scope')}>
            <textarea id={fid('scope')} rows={2} value={sub.scope} onChange={(e) => set((s) => { s.scope = e.target.value; })} />
          </Field>
          <Field label="Location / region" id={fid('loc')}>
            <input id={fid('loc')} value={sub.location} placeholder="e.g. Mason County, TX" onChange={(e) => set((s) => { s.location = e.target.value; })} />
          </Field>
          <Field label="Terrain" id={fid('ter')}>
            <textarea id={fid('ter')} rows={2} value={sub.terrain} placeholder="e.g. limestone outcrop, two creek crossings, rolling pasture" onChange={(e) => set((s) => { s.terrain = e.target.value; })} />
          </Field>
          <div className="grid2">
            <Field label="Cost basis year" id={fid('yr')}><input id={fid('yr')} value={sub.costYear} onChange={(e) => set((s) => { s.costYear = e.target.value; })} /></Field>
          </div>

          <div className="cl-box">
            <h3>Centerline</h3>
            {drawing ? (
              <div className="draw-note">
                <div>
                  <b>Drawing centerline on the map.</b> Click from the start of the route to the end; stationing runs in the order you click.
                  Click the last point or press Enter to finish · Backspace removes the last point · Esc cancels.
                </div>
                <div><button className="btn" onClick={onCancelDraw}>Cancel</button></div>
              </div>
            ) : sub.centerline && sc?.ref ? (
              <>
                <div className="cl-stats">
                  <div><span className="label">Route</span><b title={sub.centerlineFile}>{sub.centerlineName || sub.centerlineFile}</b></div>
                  <div><span className="label">Length</span><b className="num">{lengthText(sc.ref.length, p.units)}</b></div>
                  <div><span className="label">PIs</span><b className="num">{piCount}</b></div>
                </div>
                {p.industry === 'Pipeline' && pi && (
                  <div className="bend-box">
                    <div className="bend-counts">
                      <span className="pill fit">{pi.counts.FITTING} fitting</span>
                      <span className="pill fb">{pi.counts['FIELD BEND']} field bend</span>
                      <span className="pill fs">{pi.counts['FREE STRESS']} free stress</span>
                    </div>
                    <div className="grid2">
                      <Field label="Free stress below (°)" id={fid('fs')}>
                        <input id={fid('fs')} type="number" min={0} step={0.5} value={sub.freeStressDeg}
                          onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v < sub.fieldBendDeg) set((s) => { s.freeStressDeg = v; }); }} />
                      </Field>
                      <Field label="Fitting at or above (°)" id={fid('fb')}>
                        <input id={fid('fb')} type="number" min={0} step={0.5} value={sub.fieldBendDeg}
                          onChange={(e) => { const v = Number(e.target.value); if (v > sub.freeStressDeg) set((s) => { s.fieldBendDeg = v; }); }} />
                      </Field>
                    </div>
                    <p className="hint">Reference only. Place elbows and fittings yourself in Input.</p>
                  </div>
                )}
                <div className="btn-row">
                  <button className="btn" onClick={() => mapRef.current?.fitCenterline(sub.centerline!)}>Zoom to route</button>
                  <button
                    className="btn" disabled={anyEditing}
                    onClick={() => { set((s) => { s.centerline = [...s.centerline!].reverse(); }); notify(`${sub.name}: stationing now runs from the other end.`); }}
                  >
                    Reverse direction
                  </button>
                  <button className="btn" disabled={anyEditing} onClick={() => onEditCenterline(sub.id)}>{editing ? 'Editing…' : 'Edit route'}</button>
                  <button className="btn" disabled={anyEditing} onClick={() => fileInput.current?.click()}>Replace with file</button>
                  <button className="btn" disabled={anyEditing} onClick={() => onDrawCenterline(sub.id)}>Redraw</button>
                  {confirm === 'remove' ? (
                    <span className="confirm-inline">
                      Remove route?
                      <button className="btn danger" onClick={() => { set((s) => { s.centerline = null; s.centerlineName = ''; s.centerlineFile = ''; }); setConfirm(null); }}>Remove</button>
                      <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button className="btn ghost" disabled={anyEditing} onClick={() => setConfirm('remove')}>Remove</button>
                  )}
                </div>
              </>
            ) : (
              <div className="cl-start">
              <div
                className={`drop ${over ? 'over' : ''}`}
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) load(f); }}
                role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
              >
                <b>Upload centerline</b>
                <span>KML, KMZ or GeoJSON · one continuous line per file</span>
              </div>
              <div className="or">or</div>
              <button className="btn" disabled={anyEditing} onClick={() => onDrawCenterline(sub.id)}>Draw on map</button>
              </div>
            )}
            {error && <div className="error">{error}</div>}
            <input
              ref={fileInput} type="file" hidden accept=".kml,.kmz,.geojson,.json"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ''; }}
            />
          </div>

          <div className="sub-foot">
            <span className="muted small">{featureCount} feature{featureCount === 1 ? '' : 's'}</span>
            {confirm === 'delete' ? (
              <span className="confirm-inline">
                Delete this sub-project{featureCount ? ` and its ${featureCount} features` : ''}?
                <button
                  className="btn danger"
                  onClick={() => {
                    update((d) => {
                      d.subprojects = d.subprojects.filter((x) => x.id !== sub.id);
                      d.features = d.features.filter((f) => f.subId !== sub.id);
                      if (d.activeSubId === sub.id) d.activeSubId = d.subprojects[0]?.id ?? null;
                    });
                    setConfirm(null);
                  }}
                >
                  Delete
                </button>
                <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            ) : (
              <button className="btn ghost danger-text" disabled={p.subprojects.length <= 1 || editing} onClick={() => setConfirm('delete')}>Delete sub-project</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
