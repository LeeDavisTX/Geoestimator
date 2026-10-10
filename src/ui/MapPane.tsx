import { useEffect, useMemo, useRef } from 'react';
import { milepostMarkers, type Vertex } from '../pi-engine';
import type { PortfolioCalc } from '../core/calc';
import type { LonLat } from '../core/geo';
import type { CatalogItem, GeomKind, Portfolio } from '../core/types';
import { MapController, type CenterlineView, type FeatureView } from '../map/controller';

export interface MapActions {
  onCreate(kind: GeomKind, coords: LonLat[]): void;
  onFeatureGeometry(id: string, coords: LonLat[]): void;
  onSelect(id: string | null): void;
  onCenterlineDraft(subId: string, verts: Vertex[]): void;
  onDrawState(active: boolean): void;
  onDeleteSelected(): void;
}

interface Props {
  p: Portfolio;
  calc: PortfolioCalc;
  clEdit: { subId: string; verts: Vertex[] } | null;
  selected: string | null;
  drawItem: CatalogItem | null;
  showPI: boolean;
  showMP: boolean;
  actions: MapActions;
  controllerRef: React.MutableRefObject<MapController | null>;
}

export default function MapPane({ p, calc, clEdit, selected, drawItem, showPI, showMP, actions, controllerRef }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!el.current || controllerRef.current) return;
    const c = new MapController(el.current, {
      onCreate: (k, co) => actionsRef.current.onCreate(k, co),
      onFeatureGeometry: (id, co) => actionsRef.current.onFeatureGeometry(id, co),
      onSelect: (id) => actionsRef.current.onSelect(id),
      onCenterlineDraft: (id, v) => actionsRef.current.onCenterlineDraft(id, v),
      onDrawState: (a) => actionsRef.current.onDrawState(a),
      onDeleteSelected: () => actionsRef.current.onDeleteSelected(),
    });
    controllerRef.current = c;
    const ro = new ResizeObserver(() => c.invalidate());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [controllerRef]);

  useEffect(() => {
    controllerRef.current?.setUnits(p.units);
  }, [p.units, controllerRef]);

  const clViews: CenterlineView[] = useMemo(
    () =>
      calc.subs
        .filter((s) => s.ref)
        .map((s) => ({
          subId: s.sub.id,
          color: s.sub.color,
          name: s.sub.name,
          verts: s.ref!.verts,
          pi: s.pi,
          pipeline: s.sub.industry === 'Pipeline',
          editing: clEdit?.subId === s.sub.id,
        })),
    [calc, clEdit?.subId],
  );

  useEffect(() => {
    controllerRef.current?.renderCenterlines(clViews, {
      showPI, showMP, mpInterval: p.mpInterval,
      mpMarkers: (pi) => milepostMarkers(pi, p.mpInterval),
    });
  }, [clViews, showPI, showMP, p.mpInterval, controllerRef]);

  const featViews: FeatureView[] = useMemo(() => {
    const subName = new Map(p.subprojects.map((s) => [s.id, s.name]));
    return p.features.map((f) => {
      const it = calc.items.get(f.code);
      const fc = calc.features.get(f.id);
      return {
        id: f.id,
        kind: f.kind,
        coords: f.coords,
        color: it?.color ?? '#868E96',
        size: it?.size ?? 3,
        style: it?.style ?? 'Solid',
        label: `<b>${esc(f.code)}</b> ${esc(it?.name ?? '')}${f.name ? ' · ' + esc(f.name) : ''}<br><span class="tt-sub">${esc(subName.get(f.subId) ?? '')} · ${f.id}${fc?.flag ? ' · ' + fc.flag : ''}</span>`,
      };
    });
  }, [p.features, p.subprojects, calc]);

  useEffect(() => {
    controllerRef.current?.syncFeatures(featViews);
  }, [featViews, controllerRef]);

  // First load: frame the existing work.
  useEffect(() => {
    const verts = calc.subs.flatMap((s) => s.ref?.verts ?? []);
    controllerRef.current?.fitInitial(verts, p.features.flatMap((f) => f.coords));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controllerRef.current?.setSelected(selected);
  }, [selected, controllerRef]);

  // Restart drawing only when the item itself changes, not on every portfolio update.
  const drawKey = drawItem ? `${drawItem.code}|${drawItem.geometry}|${drawItem.color}|${drawItem.name}` : '';
  useEffect(() => {
    const c = controllerRef.current;
    if (!c) return;
    if (drawItem) c.startDraw(drawItem.geometry, drawItem.color, `${drawItem.code} · ${drawItem.name}`);
    else c.stopDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawKey, controllerRef]);

  return <div className="map" ref={el} aria-label="Map" />;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
