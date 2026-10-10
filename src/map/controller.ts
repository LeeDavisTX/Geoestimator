// Imperative Leaflet layer manager. React owns the data; this class owns the map.
// Drawing and vertex editing are built in (no plugin), so the only map dependency is Leaflet.

import type { PiResult, Vertex } from '../pi-engine';
import type { GeomKind, LineStyle } from '../core/types';
import { pathLengthM, polygonAreaM2, type LonLat } from '../core/geo';
import { CONTEXT_LAYERS, makeContextLayer } from './context';
import { areaFromM2, AREA_CODE, fmt, lenFromM, LEN_SHORT, MP_PREFIX, sta } from '../core/units';
import type { LinearUnit } from '../pi-engine';

declare const L: any;

export interface MapCallbacks {
  onCreate(kind: GeomKind, coords: LonLat[]): void;
  onFeatureGeometry(id: string, coords: LonLat[]): void;
  onSelect(id: string | null): void;
  onCenterlineDraft(subId: string, verts: Vertex[]): void;
  onDrawState(active: boolean): void;
  onDeleteSelected(): void;
}

export interface FeatureView {
  id: string;
  kind: GeomKind;
  coords: LonLat[];
  color: string;
  size: number;
  style: LineStyle;
  label: string;
}

export interface CenterlineView {
  subId: string;
  color: string;
  name: string;
  verts: Vertex[];
  pi: PiResult | null;
  pipeline: boolean;
  /** Being edited: the editable copy is drawn by the editor, not here. */
  editing: boolean;
}

const DASH: Record<LineStyle, string | undefined> = { Solid: undefined, Dashed: '10 7', Dotted: '2 7' };
const PI_COLOR = { FITTING: '#FF6B35', 'FIELD BEND': '#4DABF7', 'FREE STRESS': '#ADB5BD' } as const;
const ll = (c: LonLat) => L.latLng(c[1], c[0]);
const toLonLat = (p: any): LonLat => [Number(p.lng.toFixed(9)), Number(p.lat.toFixed(9))];
const sig = (f: FeatureView) => `${f.kind}|${f.color}|${f.size}|${f.style}|${f.label}|${f.coords.length}|${f.coords.map((c) => c.join(',')).join(';')}`;

interface Editor {
  kind: GeomKind | 'Centerline';
  id: string;
  layer: any;
  handles: any[];
  mids: any[];
  ghost?: any;
}

export class MapController {
  map: any;
  private cb: MapCallbacks;
  private units: LinearUnit = 'ft';
  private scale: any;
  private clGroup: any;
  private mpGroup: any;
  private panes!: { cl: string; halo: string; feat: string; flash: string; edit: string; draw: string };
  private mpData: { prefix: string; dec: number; interval: number; sets: { mp: number; lat: number; lon: number }[][] } | null = null;
  private featGroup: any;
  private haloGroup: any;
  private flashGroup: any;
  private editGroup: any;
  private drawGroup: any;
  private feats = new Map<string, { layer: any; sig: string; view: FeatureView }>();
  private selected: string | null = null;
  private flashTimer: number | undefined;
  private hint: HTMLDivElement;
  private draw: { kind: GeomKind; color: string; label: string; pts: any[]; cursor: any | null } | null = null;
  private editor: Editor | null = null;
  private fittedOnce = false;

  constructor(el: HTMLElement, cb: MapCallbacks) {
    this.cb = cb;
    this.map = L.map(el, { preferCanvas: false, zoomControl: true, boxZoom: true }).setView([31.0, -99.0], 6);
    const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    const esri = (svc: string, opts: object = {}) =>
      L.tileLayer(ESRI + svc + '/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery &copy; Esri', ...opts });
    // Context overlays sit above the basemap and below the road/place labels.
    this.map.createPane('ctxPane');
    this.map.getPane('ctxPane').style.zIndex = 300;
    this.map.createPane('refPane');
    this.map.getPane('refPane').style.zIndex = 350;
    this.map.getPane('refPane').style.pointerEvents = 'none';
    const imageryLabels = L.layerGroup([
      esri('World_Imagery'),
      esri('Reference/World_Transportation', { pane: 'refPane', attribution: '' }),
      esri('Reference/World_Boundaries_and_Places', { pane: 'refPane', attribution: '' }),
    ]).addTo(this.map);
    L.control
      .layers(
        {
          'Imagery + labels': imageryLabels,
          Imagery: esri('World_Imagery'),
          Topo: esri('World_Topo_Map', { attribution: '&copy; Esri' }),
          Streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }),
        },
        null,
        { position: 'topright' },
      )
      .addTo(this.map);
    this.setUnits('ft');

    // Draw order: centerline < selection halo < takeoff features < flash < editor < draft. Vector layers use SVG so clicks pass through panes to the layer underneath.
    const pane = (name: string, z: number) => { this.map.createPane(name); this.map.getPane(name).style.zIndex = String(z); return name; };
    this.panes = { cl: pane('clPane', 380), halo: pane('haloPane', 390), feat: pane('featPane', 400), flash: pane('flashPane', 410), edit: pane('editPane', 420), draw: pane('drawPane', 430) };
    this.clGroup = L.layerGroup().addTo(this.map);
    this.mpGroup = L.layerGroup().addTo(this.map);
    this.haloGroup = L.layerGroup().addTo(this.map);
    this.featGroup = L.layerGroup().addTo(this.map);
    this.flashGroup = L.layerGroup().addTo(this.map);
    this.editGroup = L.layerGroup().addTo(this.map);
    this.drawGroup = L.layerGroup().addTo(this.map);
    this.map.on('zoomend', () => this.renderMileposts());

    this.hint = document.createElement('div');
    this.hint.className = 'map-hint';
    this.hint.hidden = true;
    el.appendChild(this.hint);

    this.map.on('click', (e: any) => this.onMapClick(e));
    this.map.on('mousemove', (e: any) => this.onMove(e));
    document.addEventListener('keydown', (e: KeyboardEvent) => this.onKey(e));
  }

  private ctx = new Map<string, any>();

  /** Show or hide a context overlay. Status text (loading, counts, errors) goes to onStatus. */
  setContext(id: string, on: boolean, onStatus: (id: string, msg: string) => void) {
    let lyr = this.ctx.get(id);
    if (on) {
      if (!lyr) {
        const def = CONTEXT_LAYERS.find((d) => d.id === id);
        if (!def) return;
        lyr = makeContextLayer(def, 'ctxPane', onStatus);
        this.ctx.set(id, lyr);
      }
      if (!this.map.hasLayer(lyr)) lyr.addTo(this.map);
    } else if (lyr && this.map.hasLayer(lyr)) {
      this.map.removeLayer(lyr);
    }
  }

  setUnits(u: LinearUnit) {
    this.units = u;
    if (this.scale) this.scale.remove();
    this.scale = L.control.scale({ imperial: u !== 'm', metric: u === 'm', position: 'bottomleft' }).addTo(this.map);
  }

  // ---------------------------------------------------------------- centerlines

  renderCenterlines(list: CenterlineView[], opts: { showPI: boolean; showMP: boolean; mpInterval: number; mpMarkers: (pi: PiResult) => { mp: number; lat: number; lon: number }[] }) {
    this.clGroup.clearLayers();
    const prefix = MP_PREFIX(this.units);
    const dec = opts.mpInterval < 1 ? (opts.mpInterval < 0.1 ? 2 : 1) : 0;
    const mpSets: { mp: number; lat: number; lon: number }[][] = [];
    const pn = this.panes.cl;
    for (const cl of list) {
      if (!cl.editing) {
        // Dark casing under the colored line keeps it readable on imagery.
        L.polyline(cl.verts.map((v) => [v.lat, v.lon]), { pane: pn, color: '#0b1220', weight: 7, opacity: 0.55, interactive: false }).addTo(this.clGroup);
        L.polyline(cl.verts.map((v) => [v.lat, v.lon]), { pane: pn, color: cl.color, weight: 3.5, opacity: 1, interactive: false }).addTo(this.clGroup);
      }
      if (!cl.pi) continue;
      if (opts.showMP) mpSets.push(opts.mpMarkers(cl.pi));
      if (opts.showPI) {
        for (const r of cl.pi.rows) {
          if (r.kind !== 'PI') continue;
          const color = cl.pipeline && r.bendClass ? PI_COLOR[r.bendClass] : '#FFFFFF';
          const big = cl.pipeline && r.bendClass === 'FITTING';
          L.circleMarker([r.lat, r.lon], { pane: pn, radius: big ? 5 : 4, color: '#0b1220', weight: 1.5, fillColor: color, fillOpacity: 1, bubblingMouseEvents: false })
            .bindTooltip(
              `<b>${cl.name}</b><br>PI${r.piNumber ? ' ' + r.piNumber : ''} · ${r.hDms} ${r.hDirection}${cl.pipeline && r.bendClass ? ' · ' + r.bendClass.toLowerCase() : ''}<br>STA ${r.stationText} · ${prefix} ${r.milepost.toFixed(3)}`,
              { direction: 'top', offset: [0, -4] },
            )
            .on('click', (e: any) => { if (this.draw) { L.DomEvent.stop(e); this.addDrawPoint(e.latlng); } })
            .addTo(this.clGroup);
        }
      }
    }
    this.mpData = { prefix, dec, interval: opts.mpInterval, sets: mpSets };
    this.renderMileposts();
  }

  /** Milepost labels, thinned so they stay at least ~56 px apart at the current zoom. */
  private renderMileposts() {
    this.mpGroup.clearLayers();
    const d = this.mpData;
    if (!d) return;
    for (const set of d.sets) {
      if (!set.length) continue;
      let step = 1;
      if (set.length > 1) {
        const a = this.map.latLngToLayerPoint([set[0].lat, set[0].lon]);
        const b = this.map.latLngToLayerPoint([set[1].lat, set[1].lon]);
        const px = Math.max(1, a.distanceTo(b));
        const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500];
        step = nice.find((n) => n * px >= 56) ?? 1000;
      }
      set.forEach((m, i) => {
        const k = Math.round(m.mp / d.interval);
        if (k % step !== 0 && i !== 0) return;
        L.marker([m.lat, m.lon], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({ className: 'mp-label', html: `<span>${d.prefix} ${m.mp.toFixed(d.dec)}</span>`, iconSize: [0, 0] }),
        }).addTo(this.mpGroup);
      });
    }
  }

  fitCenterline(verts: Vertex[]) {
    if (verts.length) this.map.fitBounds(L.latLngBounds(verts.map((v) => [v.lat, v.lon])), { padding: [40, 40] });
  }

  fitCoords(coords: LonLat[], maxZoom = 18) {
    if (!coords.length) return;
    if (coords.length === 1) this.map.setView(ll(coords[0]), Math.max(this.map.getZoom(), 16));
    else this.map.fitBounds(L.latLngBounds(coords.map(ll)), { padding: [60, 60], maxZoom });
  }

  /** First load: fit to whatever exists. */
  fitInitial(verts: Vertex[], coords: LonLat[]) {
    if (this.fittedOnce) return;
    const all = [...verts.map((v) => [v.lat, v.lon]), ...coords.map((c) => [c[1], c[0]])];
    if (!all.length) return;
    this.fittedOnce = true;
    this.map.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 16 });
  }

  // ---------------------------------------------------------------- takeoff features

  private styleFor(f: FeatureView) {
    const pane = this.panes.feat;
    if (f.kind === 'Point') return { pane, radius: Math.max(3, f.size / 2), color: '#0b1220', weight: 1.5, fillColor: f.color, fillOpacity: 1 };
    if (f.kind === 'Polygon') return { pane, color: f.color, weight: Math.max(1.5, f.size), dashArray: DASH[f.style], fillColor: f.color, fillOpacity: 0.25 };
    return { pane, color: f.color, weight: f.size, dashArray: DASH[f.style], opacity: 1, lineCap: f.style === 'Dotted' ? 'round' : 'butt' };
  }

  private makeLayer(f: FeatureView) {
    const style = this.styleFor(f);
    const layer =
      f.kind === 'Point' ? L.circleMarker(ll(f.coords[0]), style)
      : f.kind === 'Polygon' ? L.polygon(f.coords.map(ll), style)
      : L.polyline(f.coords.map(ll), style);
    layer.bindTooltip(f.label, { sticky: true, direction: 'top' });
    layer.on('click', (e: any) => {
      L.DomEvent.stop(e);
      if (this.draw) { this.addDrawPoint(e.latlng); return; }
      if (this.editor?.kind === 'Centerline') return;
      this.cb.onSelect(f.id);
    });
    layer.on('dblclick', (e: any) => {
      if (this.draw) return;
      L.DomEvent.stop(e);
      this.cb.onSelect(f.id);
      this.editFeature(f.id);
    });
    return layer;
  }

  syncFeatures(list: FeatureView[]) {
    const keep = new Set<string>();
    for (const f of list) {
      keep.add(f.id);
      const s = sig(f);
      const cur = this.feats.get(f.id);
      if (cur && cur.sig === s) continue;
      if (cur && this.editor?.id === f.id) {
        // Geometry came from the editor itself; keep the live layer and handles.
        cur.layer.setStyle(this.styleFor(f));
        cur.sig = s; cur.view = f;
        cur.layer.setTooltipContent(f.label);
        continue;
      }
      if (cur) this.featGroup.removeLayer(cur.layer);
      const layer = this.makeLayer(f).addTo(this.featGroup);
      this.feats.set(f.id, { layer, sig: s, view: f });
    }
    for (const [id, cur] of this.feats) {
      if (!keep.has(id)) {
        this.featGroup.removeLayer(cur.layer);
        this.feats.delete(id);
        if (this.editor?.id === id) this.stopEdit();
      }
    }
    this.renderHalo();
  }

  setSelected(id: string | null) {
    if (this.selected === id) return;
    if (this.editor && this.editor.kind !== 'Centerline' && this.editor.id !== id) this.stopEdit();
    this.selected = id;
    this.renderHalo();
  }

  private haloFor(f: FeatureView, color: string, extra: number, pane = this.panes.halo) {
    if (f.kind === 'Point') return L.circleMarker(ll(f.coords[0]), { pane, radius: Math.max(3, f.size / 2) + extra / 2 + 2, color, weight: 3, fill: false, interactive: false });
    if (f.kind === 'Polygon') return L.polygon(f.coords.map(ll), { pane, color, weight: f.size + extra, fill: false, opacity: 0.9, interactive: false });
    return L.polyline(f.coords.map(ll), { pane, color, weight: f.size + extra, opacity: 0.9, interactive: false });
  }

  private renderHalo() {
    this.haloGroup.clearLayers();
    const cur = this.selected ? this.feats.get(this.selected) : null;
    if (cur) this.haloFor(cur.view, '#FFE066', 8).addTo(this.haloGroup);
  }

  flash(ids: string[], fit = true) {
    this.flashGroup.clearLayers();
    window.clearTimeout(this.flashTimer);
    const coords: LonLat[] = [];
    for (const id of ids) {
      const cur = this.feats.get(id);
      if (!cur) continue;
      this.haloFor(cur.view, '#FFFFFF', 10, this.panes.flash).addTo(this.flashGroup);
      coords.push(...cur.view.coords);
    }
    if (fit && coords.length) this.fitCoords(coords, 17);
    this.flashTimer = window.setTimeout(() => this.flashGroup.clearLayers(), 2200);
  }

  /** Temporarily outline centerline segments (coverage gaps). */
  flashSegments(segs: Vertex[][], color = '#FF2D55') {
    this.flashGroup.clearLayers();
    window.clearTimeout(this.flashTimer);
    const all: any[] = [];
    for (const s of segs) {
      const pts = s.map((v) => [v.lat, v.lon]);
      all.push(...pts);
      L.polyline(pts, { pane: this.panes.flash, color, weight: 9, opacity: 0.85, dashArray: '2 10', lineCap: 'round', interactive: false }).addTo(this.flashGroup);
    }
    if (all.length) this.map.fitBounds(L.latLngBounds(all), { padding: [80, 80], maxZoom: 17 });
    this.flashTimer = window.setTimeout(() => this.flashGroup.clearLayers(), 3500);
  }

  // ---------------------------------------------------------------- drawing

  startDraw(kind: GeomKind, color: string, label: string) {
    this.stopEdit();
    this.clearDraft();
    this.draw = { kind, color, label, pts: [], cursor: null };
    this.map.doubleClickZoom.disable();
    this.map.getContainer().classList.add('drawing');
    this.map.getContainer().focus({ preventScroll: true });
    this.updateHint();
    this.cb.onDrawState(true);
  }

  stopDraw() {
    if (!this.draw) return;
    this.draw = null;
    this.clearDraft();
    this.map.doubleClickZoom.enable();
    this.map.getContainer().classList.remove('drawing');
    this.hint.hidden = true;
    this.cb.onDrawState(false);
  }

  get drawing() {
    return this.draw !== null;
  }

  private clearDraft() {
    this.drawGroup.clearLayers();
  }

  private onMapClick(e: any) {
    if (this.draw) { this.addDrawPoint(e.latlng); return; }
    if (this.editor && this.editor.kind !== 'Centerline') this.stopEdit();
    this.cb.onSelect(null);
  }

  private addDrawPoint(latlng: any) {
    const d = this.draw!;
    if (d.kind === 'Point') {
      this.cb.onCreate('Point', [toLonLat(latlng)]);
      return;
    }
    const px = (p: any) => this.map.latLngToContainerPoint(p);
    // Clicking the last point (or double-clicking) finishes a line; clicking the first point closes a polygon.
    if (d.pts.length) {
      const last = d.pts[d.pts.length - 1];
      if (px(last).distanceTo(px(latlng)) < 9) { this.finishDraw(); return; }
      if (d.kind === 'Polygon' && d.pts.length >= 3 && px(d.pts[0]).distanceTo(px(latlng)) < 10) { this.finishDraw(); return; }
    }
    d.pts.push(latlng);
    this.renderDraft();
  }

  private finishDraw() {
    const d = this.draw;
    if (!d) return;
    const need = d.kind === 'Polygon' ? 3 : 2;
    if (d.pts.length >= need) this.cb.onCreate(d.kind, d.pts.map(toLonLat));
    d.pts = [];
    this.renderDraft();
  }

  private renderDraft() {
    const d = this.draw;
    this.drawGroup.clearLayers();
    if (!d) return;
    const pts = d.pts;
    if (pts.length) {
      const opts = { pane: this.panes.draw, color: d.color, weight: 3, opacity: 0.95, interactive: false };
      if (d.kind === 'Polygon' && pts.length >= 2) L.polygon(pts, { ...opts, fillOpacity: 0.2 }).addTo(this.drawGroup);
      else L.polyline(pts, opts).addTo(this.drawGroup);
      if (d.cursor) {
        const guide = d.kind === 'Polygon' && pts.length >= 2 ? [pts[pts.length - 1], d.cursor, pts[0]] : [pts[pts.length - 1], d.cursor];
        L.polyline(guide, { pane: this.panes.draw, color: d.color, weight: 2, dashArray: '6 6', opacity: 0.9, interactive: false }).addTo(this.drawGroup);
      }
      pts.forEach((p, i) =>
        L.circleMarker(p, { pane: this.panes.draw, radius: i === pts.length - 1 || (d.kind === 'Polygon' && i === 0) ? 5 : 3.5, color: '#0b1220', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1, interactive: false }).addTo(this.drawGroup),
      );
    }
    this.updateHint();
  }

  private onMove(e: any) {
    if (!this.draw) return;
    this.draw.cursor = e.latlng;
    if (this.draw.pts.length) this.renderDraft();
  }

  private updateHint() {
    const d = this.draw;
    if (!d) { this.hint.hidden = true; return; }
    const u = this.units;
    let measure = '';
    let help = '';
    if (d.kind === 'Point') {
      help = 'Click to place. Esc to stop.';
    } else {
      const pts = d.cursor ? [...d.pts, d.cursor] : d.pts;
      const c = pts.map(toLonLat);
      if (d.kind === 'Line' && c.length >= 2) measure = `${fmt(lenFromM(pathLengthM(c), u))} ${LEN_SHORT[u]}`;
      if (d.kind === 'Polygon' && c.length >= 3) measure = `${fmt(areaFromM2(polygonAreaM2(c), u), 3)} ${AREA_CODE(u).toLowerCase()}`;
      help = d.pts.length === 0
        ? 'Click to start.'
        : d.kind === 'Line'
          ? 'Click the last point or press Enter to finish · Backspace undo · Esc cancel'
          : 'Click the first point or press Enter to close · Backspace undo · Esc cancel';
    }
    this.hint.innerHTML = `<span class="hint-item" style="--c:${d.color}">${escapeHtml(d.label)}</span>${measure ? `<b class="hint-measure">${measure}</b>` : ''}<span class="hint-help">${help}</span>`;
    this.hint.hidden = false;
  }

  private onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    if (this.draw) {
      if (e.key === 'Enter') { e.preventDefault(); this.finishDraw(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (this.draw.pts.length) { this.draw.pts = []; this.renderDraft(); } else this.stopDraw(); }
      else if (e.key === 'Backspace') { e.preventDefault(); this.draw.pts.pop(); this.renderDraft(); }
      return;
    }
    if (e.key === 'Escape' && this.editor && this.editor.kind !== 'Centerline') { this.stopEdit(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected && !this.editor) { e.preventDefault(); this.cb.onDeleteSelected(); }
  }

  // ---------------------------------------------------------------- vertex editing

  get editingId() {
    return this.editor?.id ?? null;
  }

  editFeature(id: string) {
    const cur = this.feats.get(id);
    if (!cur) return;
    this.stopDraw();
    this.stopEdit();
    this.editor = { kind: cur.view.kind, id, layer: cur.layer, handles: [], mids: [] };
    this.buildHandles();
  }

  startCenterlineEdit(subId: string, verts: Vertex[], color: string) {
    this.stopDraw();
    this.stopEdit();
    const latlngs = verts.map((v) => [v.lat, v.lon]);
    const ghost = L.polyline(latlngs, { pane: this.panes.edit, color: '#ffffff', weight: 3, opacity: 0.6, dashArray: '4 8', interactive: false }).addTo(this.editGroup);
    const layer = L.polyline(latlngs, { pane: this.panes.edit, color, weight: 4, opacity: 1, interactive: false }).addTo(this.editGroup);
    this.editor = { kind: 'Centerline', id: subId, layer, handles: [], mids: [], ghost };
    this.buildHandles();
  }

  stopEdit() {
    if (!this.editor) return;
    for (const h of [...this.editor.handles, ...this.editor.mids]) this.editGroup.removeLayer(h);
    if (this.editor.kind === 'Centerline') this.editGroup.clearLayers();
    this.editor = null;
  }

  private editLatLngs(): any[] {
    const ed = this.editor!;
    if (ed.kind === 'Point') return [ed.layer.getLatLng()];
    const l = ed.layer.getLatLngs();
    return ed.kind === 'Polygon' ? l[0] : l;
  }

  private setEditLatLngs(pts: any[]) {
    const ed = this.editor!;
    if (ed.kind === 'Point') ed.layer.setLatLng(pts[0]);
    else ed.layer.setLatLngs(ed.kind === 'Polygon' ? [pts] : pts);
  }

  private commitEdit() {
    const ed = this.editor;
    if (!ed) return;
    const pts = this.editLatLngs();
    if (ed.kind === 'Centerline') this.cb.onCenterlineDraft(ed.id, pts.map((p: any) => ({ lat: Number(p.lat.toFixed(9)), lon: Number(p.lng.toFixed(9)) })));
    else this.cb.onFeatureGeometry(ed.id, pts.map(toLonLat));
  }

  private buildHandles() {
    const ed = this.editor!;
    for (const h of [...ed.handles, ...ed.mids]) this.editGroup.removeLayer(h);
    ed.handles = []; ed.mids = [];
    const pts = this.editLatLngs();
    const min = ed.kind === 'Polygon' ? 3 : ed.kind === 'Point' ? 1 : 2;
    const closed = ed.kind === 'Polygon';
    const vxIcon = L.divIcon({ className: 'vx', iconSize: [12, 12] });
    const midIcon = L.divIcon({ className: 'vx-mid', iconSize: [10, 10] });

    pts.forEach((p: any, i: number) => {
      const h = L.marker(p, { draggable: true, icon: vxIcon, keyboard: false, zIndexOffset: 1000 }).addTo(this.editGroup);
      h.on('drag', (e: any) => {
        const cur = this.editLatLngs().slice();
        cur[i] = e.target.getLatLng();
        this.setEditLatLngs(cur);
        this.placeMids();
      });
      h.on('dragend', () => this.commitEdit());
      h.on('contextmenu', (e: any) => {
        L.DomEvent.stop(e);
        const cur = this.editLatLngs().slice();
        if (cur.length <= min) return;
        cur.splice(i, 1);
        this.setEditLatLngs(cur);
        this.buildHandles();
        this.commitEdit();
      });
      ed.handles.push(h);
    });
    if (ed.kind === 'Point') return;

    const n = pts.length;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const m = L.marker(mid(pts[i], pts[(i + 1) % n]), { draggable: true, icon: midIcon, keyboard: false, zIndexOffset: 900 }).addTo(this.editGroup);
      const insert = (at: any) => {
        const cur = this.editLatLngs().slice();
        cur.splice(i + 1, 0, at);
        this.setEditLatLngs(cur);
        this.buildHandles();
        this.commitEdit();
      };
      m.on('click', (e: any) => { L.DomEvent.stop(e); insert(m.getLatLng()); });
      m.on('dragend', () => insert(m.getLatLng()));
      ed.mids.push(m);
    }
  }

  private placeMids() {
    const ed = this.editor!;
    const pts = this.editLatLngs();
    const n = pts.length;
    ed.mids.forEach((m, i) => m.setLatLng(mid(pts[i], pts[(i + 1) % n])));
  }

  /** Station readout for a point near the edited centerline is handled by React; this is a helper for labels. */
  stationLabel(x: number) {
    return sta(x, this.units);
  }

  invalidate() {
    this.map.invalidateSize();
  }
}

function mid(a: any, b: any) {
  return L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
