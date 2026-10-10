import { useCallback, useMemo, useRef, useState } from 'react';
import type { Vertex } from '../pi-engine';
import { newPortfolio } from '../core/catalog';
import { computePortfolio } from '../core/calc';
import { exportBaseName, portfolioGeoJson, portfolioKml, portfolioXlsx } from '../core/exports';
import { parsePortfolio, PORTFOLIO_EXT, serializePortfolio } from '../core/io';
import type { LonLat } from '../core/geo';
import type { CatalogItem, GeomKind } from '../core/types';
import { fmt, LEN_SHORT } from '../core/units';
import type { MapController } from '../map/controller';
import MapPane from './MapPane';
import ContextLayers from './ContextLayers';
import SetupTab from './SetupTab';
import { EditTab, InputTab, TallyTab } from './TakeoffTab';
import TablesTab from './TablesTab';
import CatalogTab from './CatalogTab';
import { saveFile } from './save';
import { featureId, nowIso, usePortfolio } from './store';

type Tab = 'setup' | 'catalog' | 'input' | 'edit' | 'table' | 'takeoff';
const TABS: { id: Tab; label: string }[] = [
  { id: 'setup', label: 'Setup' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'input', label: 'Input' },
  { id: 'table', label: 'Table' },
  { id: 'edit', label: 'Edit' },
  { id: 'takeoff', label: 'Takeoff' },
];

const WIDTH_KEY = 'geoestimator.paneWidth';
const MIN_W = 320, MAX_W = 900;
function savedWidth(): number {
  try { const v = Number(localStorage.getItem(WIDTH_KEY)); if (v >= MIN_W && v <= MAX_W) return v; } catch { /* storage blocked */ }
  return 400;
}

export interface ClEdit {
  subId: string;
  verts: Vertex[];
  original: Vertex[];
}

export default function App() {
  const { p, setP, update, saveState } = usePortfolio();
  const [tab, setTab] = useState<Tab>(() => (p.industry && p.subprojects.some((s) => s.centerline) ? 'input' : 'setup'));
  const [sideW, setSideW] = useState(savedWidth);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawOn, setDrawOn] = useState(false);
  const [clEdit, setClEdit] = useState<ClEdit | null>(null);
  const [showPI, setShowPI] = useState(true);
  const [showMP, setShowMP] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const mapRef = useRef<MapController | null>(null);
  const openInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const calc = useMemo(() => computePortfolio(p, clEdit ? { [clEdit.subId]: clEdit.verts } : {}), [p, clEdit]);

  const activeSub = p.subprojects.find((s) => s.id === p.activeSubId) ?? p.subprojects[0] ?? null;
  const activeItem = p.catalog.find((c) => c.code === p.activeCode && c.industry === p.industry) ?? null;
  // Drawing a centerline uses the same draw tool with a stand-in item in the sub-project's color.
  const [clDraw, setClDraw] = useState<string | null>(null);
  const clDrawSub = clDraw ? p.subprojects.find((s) => s.id === clDraw) ?? null : null;
  const drawItem: CatalogItem | null = clDrawSub
    ? { code: 'CENTERLINE', industry: p.industry ?? 'Pipeline', category: '', name: clDrawSub.name, geometry: 'Line', color: clDrawSub.color, size: 4, style: 'Solid', method: false, description: '' }
    : drawOn && activeItem && !clEdit ? activeItem : null;
  const startClDraw = (subId: string) => {
    setSelected(null);
    setDrawOn(false);
    setClDraw(subId);
  };

  // ------------------------------------------------------------ map events
  const actions = {
    onCreate: (kind: GeomKind, coords: LonLat[]) => {
      if (clDrawSub) {
        const verts = coords.map(([lon, lat]) => ({ lat, lon }));
        const n = p.features.filter((f) => f.subId === clDrawSub.id).length;
        update((d) => {
          const s = d.subprojects.find((x) => x.id === clDrawSub.id);
          if (s) { s.centerline = verts; s.centerlineName = `${s.name} (drawn)`; s.centerlineFile = ''; }
          d.activeSubId = clDrawSub.id;
        });
        setClDraw(null);
        setDrawOn(false);
        notify(`Centerline drawn for ${clDrawSub.name}: ${verts.length} vertices.${n ? ` ${n} features re-stationed.` : ''} Use Edit route to adjust it.`);
        return;
      }
      if (!activeSub || !activeItem || activeItem.geometry !== kind) return;
      update((d) => {
        const id = featureId(d.nextFeatureNo++);
        const t = nowIso();
        d.features.push({ id, subId: activeSub.id, code: activeItem.code, kind, coords, name: '', notes: '', created: t, modified: t });
      });
    },
    onFeatureGeometry: (id: string, coords: LonLat[]) =>
      update((d) => {
        const f = d.features.find((x) => x.id === id);
        if (f) { f.coords = coords; f.modified = nowIso(); }
      }),
    onSelect: (id: string | null) => openFeature(id),
    onCenterlineDraft: (subId: string, verts: Vertex[]) => setClEdit((cur) => (cur && cur.subId === subId ? { ...cur, verts } : cur)),
    onDrawState: (active: boolean) => {
      setDrawOn(active);
      if (!active) setClDraw(null);
    },
    onDeleteSelected: () => {
      if (selected) deleteFeature(selected);
    },
  };

  /** Select a feature; open the Edit tab unless the user is drawing. */
  const openFeature = (id: string | null) => {
    setSelected(id);
    if (!id) return;
    const f = p.features.find((x) => x.id === id);
    if (f && f.subId !== p.activeSubId) update((d) => { d.activeSubId = f.subId; });
    if (!drawOn) setTab('edit');
  };

  const deleteFeatures = (ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    update((d) => { d.features = d.features.filter((f) => !set.has(f.id)); });
    if (selected && set.has(selected)) setSelected(null);
    notify(ids.length === 1 ? `Deleted ${ids[0]}.` : `Deleted ${ids.length} features.`);
  };
  const deleteFeature = (id: string) => deleteFeatures([id]);

  // ------------------------------------------------------------ resizable side pane
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => setSideW(Math.min(MAX_W, Math.max(MIN_W, ev.clientX)));
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSideW((w) => { try { localStorage.setItem(WIDTH_KEY, String(w)); } catch { /* ignore */ } return w; });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const nudgeResize = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0;
    if (!d) return;
    e.preventDefault();
    setSideW((w) => { const n = Math.min(MAX_W, Math.max(MIN_W, w + d)); try { localStorage.setItem(WIDTH_KEY, String(n)); } catch { /* ignore */ } return n; });
  };

  // ------------------------------------------------------------ centerline editing
  const startClEdit = (subId: string) => {
    const sub = p.subprojects.find((s) => s.id === subId);
    if (!sub?.centerline) return;
    setDrawOn(false);
    setSelected(null);
    setClEdit({ subId, verts: sub.centerline, original: sub.centerline });
    mapRef.current?.startCenterlineEdit(subId, sub.centerline, sub.color);
    mapRef.current?.fitCenterline(sub.centerline);
  };
  const acceptClEdit = () => {
    if (!clEdit) return;
    const { subId, verts } = clEdit;
    update((d) => {
      const s = d.subprojects.find((x) => x.id === subId);
      if (s) s.centerline = verts;
    });
    mapRef.current?.stopEdit();
    setClEdit(null);
    notify('Centerline updated. Stations and quantities recalculated.');
  };
  const revertClEdit = () => {
    mapRef.current?.stopEdit();
    setClEdit(null);
  };

  // ------------------------------------------------------------ file menu
  const base = exportBaseName(p);
  const doSave = async () => {
    const msg = await saveFile(`${base}${PORTFOLIO_EXT}`, serializePortfolio(p), 'application/json');
    notify(msg ?? `Saved ${base}${PORTFOLIO_EXT}.`);
  };
  const doOpen = async (file: File) => {
    try {
      const next = parsePortfolio(await file.text());
      setClEdit(null); mapRef.current?.stopEdit();
      setSelected(null); setDrawOn(false);
      setP(next);
      const verts = next.subprojects.flatMap((s) => s.centerline ?? []);
      if (verts.length) mapRef.current?.fitCenterline(verts);
      notify(`Opened ${next.name}.`);
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const doNew = () => {
    setClEdit(null); mapRef.current?.stopEdit();
    setSelected(null); setDrawOn(false);
    setP(newPortfolio());
    setTab('setup');
    setConfirmNew(false);
  };
  const doExport = async (kind: 'xlsx' | 'kml' | 'geojson') => {
    let msg: string | null = null;
    if (kind === 'xlsx') msg = await saveFile(`${base}_takeoff.xlsx`, portfolioXlsx(p, calc), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    if (kind === 'kml') msg = await saveFile(`${base}.kml`, portfolioKml(p, calc), 'application/vnd.google-earth.kml+xml');
    if (kind === 'geojson') msg = await saveFile(`${base}.geojson`, portfolioGeoJson(p, calc), 'application/geo+json');
    if (msg) notify(msg);
  };

  const editSub = clEdit ? calc.bySub.get(clEdit.subId) : null;
  const editFeatures = clEdit ? p.features.filter((f) => f.subId === clEdit.subId).length : 0;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">GeoEstimator</span>
          <span className="brand-sep" aria-hidden="true">/</span>
          <span className="brand-portfolio" title={p.name}>{p.number ? `${p.number} · ` : ''}{p.name}</span>
          <span className={`save-state ${saveState}`}>{saveState === 'saved' ? 'Saved in browser' : 'Browser storage blocked: use Save'}</span>
        </div>
        <div className="actions">
          {confirmNew ? (
            <span className="confirm">
              Start a new portfolio? Unsaved work in this browser is replaced.
              <button className="btn danger" onClick={doNew}>Start new</button>
              <button className="btn" onClick={() => setConfirmNew(false)}>Keep working</button>
            </span>
          ) : (
            <>
              <button className="btn ghost" onClick={() => setConfirmNew(true)}>New</button>
              <button className="btn ghost" onClick={() => openInput.current?.click()}>Open</button>
              <button className="btn ghost" onClick={doSave}>Save</button>
              <span className="divider" aria-hidden="true" />
              <span className="export-label">Export</span>
              <button className="btn primary" onClick={() => doExport('xlsx')}>Excel</button>
              <button className="btn primary" onClick={() => doExport('kml')}>KML</button>
              <button className="btn primary" onClick={() => doExport('geojson')}>GeoJSON</button>
            </>
          )}
          <input
            ref={openInput} type="file" accept=".json,application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doOpen(f); e.target.value = ''; }}
          />
        </div>
      </header>

      <div className={`body ${dragging ? 'resizing' : ''}`} style={{ '--side-w': `${sideW}px` } as React.CSSProperties}>
        <aside className="side">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="side-scroll">
            {tab === 'setup' && (
              <SetupTab
                p={p} calc={calc} update={update} notify={notify} mapRef={mapRef} clEdit={clEdit} onEditCenterline={startClEdit}
                clDraw={clDraw} onDrawCenterline={startClDraw} onCancelDraw={() => { setClDraw(null); setDrawOn(false); }}
              />
            )}
            {tab === 'catalog' && <CatalogTab p={p} update={update} notify={notify} goSetup={() => setTab('setup')} />}
            {tab === 'input' && (
              <InputTab
                p={p} calc={calc} update={update} mapRef={mapRef} drawOn={drawOn} setDrawOn={setDrawOn}
                setSelected={setSelected} clEditing={!!clEdit} goSetup={() => setTab('setup')}
              />
            )}
            {tab === 'edit' && (
              <EditTab p={p} calc={calc} update={update} mapRef={mapRef} selected={selected} onDelete={deleteFeature} goTable={() => setTab('table')} onOpen={openFeature} />
            )}
            {tab === 'table' && <TablesTab p={p} calc={calc} mapRef={mapRef} onOpen={openFeature} onDeleteMany={deleteFeatures} />}
            {tab === 'takeoff' && <TallyTab p={p} calc={calc} mapRef={mapRef} />}
          </div>
        </aside>
        <div
          className={`splitter ${dragging ? 'dragging' : ''}`} role="separator" aria-orientation="vertical"
          aria-label="Resize panel" aria-valuenow={sideW} aria-valuemin={MIN_W} aria-valuemax={MAX_W} tabIndex={0}
          onPointerDown={startResize} onKeyDown={nudgeResize} onDoubleClick={() => { setSideW(400); try { localStorage.setItem(WIDTH_KEY, '400'); } catch { /* ignore */ } }}
          title="Drag to resize · double-click to reset"
        />

        <main className="map-wrap">
          <MapPane
            p={p} calc={calc} clEdit={clEdit} selected={selected} drawItem={drawItem}
            showPI={showPI} showMP={showMP} actions={actions} controllerRef={mapRef}
          />
          <ContextLayers mapRef={mapRef} />
          <div className="map-toggles">
            <label><input id="show-mp" type="checkbox" checked={showMP} onChange={(e) => setShowMP(e.target.checked)} /> Mileposts</label>
            <label><input id="show-pi" type="checkbox" checked={showPI} onChange={(e) => setShowPI(e.target.checked)} /> PIs</label>
          </div>
          {clEdit && editSub && (
            <div className="cl-banner" role="status">
              <div>
                <b>Editing {editSub.sub.name} centerline.</b> Drag a vertex to move it, click a midpoint to add one, right-click a vertex to delete it.
                <div className="cl-banner-stats">
                  {editSub.ref ? `${fmt(editSub.ref.length)} ${LEN_SHORT[p.units]}` : ''} · {editSub.pi ? editSub.pi.rows.filter((r) => r.kind === 'PI').length : 0} PIs
                  {editFeatures > 0 && <span className="warn-inline"> · {editFeatures} features will re-station when you accept</span>}
                </div>
              </div>
              <div className="cl-banner-actions">
                <button className="btn primary" onClick={acceptClEdit}>Accept</button>
                <button className="btn" onClick={revertClEdit}>Revert</button>
              </div>
            </div>
          )}
          {toast && <div className="toast" role="status">{toast}</div>}
        </main>
      </div>
    </div>
  );
}
