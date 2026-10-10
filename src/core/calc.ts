// Derives everything shown in the tally, tables and exports from the portfolio.
// Pure function of the portfolio (plus any centerline being edited), so it is easy to test.

import { computePIs, type PiResult, type Vertex } from '../pi-engine';
import { buildRef, pathLengthM, polygonAreaM2, polygonCentroid, project, type LinearRef, type LonLat } from './geo';
import type { CatalogItem, Portfolio, SubProject, TakeoffFeature } from './types';
import { AREA_CODE, areaFromM2, LEN_CODE, lenFromM, offsetLimit, PER_LONG } from './units';

/** Gaps and overlaps shorter than this (feet) are treated as drawing tolerance, not flagged. */
export const COVERAGE_TOL_FT = 10;

export type Flag = '' | 'OFF CENTERLINE' | 'NO CENTERLINE' | 'UNKNOWN ITEM' | 'OTHER INDUSTRY';

export interface FeatureCalc {
  id: string;
  qty: number;
  unit: string;
  /** Line length or polygon perimeter is not needed for POC; area kept in m² for exports. */
  areaM2: number;
  beginSta: number | null;
  endSta: number | null;
  beginMp: number | null;
  endMp: number | null;
  /** Points: station of the point. Polygons: station of the centroid. */
  station: number | null;
  mp: number | null;
  /** Points: offset of the point. Lines/polygons: largest vertex offset. */
  offset: number | null;
  side: 'LT' | 'RT' | '';
  lat: number;
  lon: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  flag: Flag;
}

export interface ItemTally {
  code: string;
  item: CatalogItem | undefined;
  qty: number;
  unit: string;
  count: number;
  ids: string[];
}

export interface Coverage {
  clLength: number;
  covered: number;
  overlap: number;
  pct: number;
  gaps: { from: number; to: number }[];
  overlaps: { from: number; to: number }[];
  unassigned: number;
}

export interface SubCalc {
  sub: SubProject;
  index: number;
  ref: LinearRef | null;
  pi: PiResult | null;
  error: string | null;
  items: ItemTally[];
  coverage: Coverage | null;
  featureCount: number;
  flagged: number;
}

export interface PortfolioCalc {
  subs: SubCalc[];
  bySub: Map<string, SubCalc>;
  features: Map<string, FeatureCalc>;
  items: Map<string, CatalogItem>;
}

export function featureCalc(f: TakeoffFeature, item: CatalogItem | undefined, ref: LinearRef | null, p: Portfolio): FeatureCalc {
  const u = p.units;
  const perLong = PER_LONG(u);
  const limit = offsetLimit(p.offsetLimitFt, u);
  const c = f.coords as LonLat[];
  const first = c[0], last = c[c.length - 1];
  let qty = 0, unit = 'EA', areaM2 = 0;
  let lat = first[1], lon = first[0];

  if (f.kind === 'Line') {
    qty = lenFromM(pathLengthM(c), u);
    unit = LEN_CODE[u];
  } else if (f.kind === 'Polygon') {
    areaM2 = polygonAreaM2(c);
    qty = areaFromM2(areaM2, u);
    unit = AREA_CODE(u);
    [lon, lat] = polygonCentroid(c);
  } else {
    qty = 1;
  }

  const out: FeatureCalc = {
    id: f.id, qty, unit, areaM2,
    beginSta: null, endSta: null, beginMp: null, endMp: null, station: null, mp: null, offset: null, side: '',
    lat, lon, startLat: first[1], startLon: first[0], endLat: last[1], endLon: last[0],
    flag: !item ? 'UNKNOWN ITEM' : p.industry && item.industry !== p.industry ? 'OTHER INDUSTRY' : '',
  };
  if (!ref) {
    if (!out.flag) out.flag = 'NO CENTERLINE';
    return out;
  }

  if (f.kind === 'Point') {
    const pr = project(ref, lat, lon);
    out.station = pr.station; out.offset = pr.offset; out.side = pr.side;
    out.beginSta = out.endSta = pr.station;
  } else {
    const prs = c.map(([x, y]) => project(ref, y, x));
    out.beginSta = Math.min(...prs.map((r) => r.station));
    out.endSta = Math.max(...prs.map((r) => r.station));
    out.offset = Math.max(...prs.map((r) => r.offset));
    if (f.kind === 'Polygon') {
      const pc = project(ref, lat, lon);
      out.station = pc.station;
      out.side = pc.side;
    }
  }
  out.beginMp = out.beginSta! / perLong;
  out.endMp = out.endSta! / perLong;
  if (out.station !== null) out.mp = out.station / perLong;
  if (!out.flag && out.offset !== null && out.offset > limit) out.flag = 'OFF CENTERLINE';
  return out;
}

function coverage(ref: LinearRef, ranges: [number, number][], tol: number): Coverage {
  const L = ref.length;
  const clipped = ranges
    .map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(L, Math.max(a, b))] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  const overlaps: { from: number; to: number }[] = [];
  let total = 0;
  for (const [a, b] of clipped) {
    total += b - a;
    const m = merged[merged.length - 1];
    if (m && a <= m[1]) {
      if (Math.min(b, m[1]) - a > tol) overlaps.push({ from: a, to: Math.min(b, m[1]) });
      m[1] = Math.max(m[1], b);
    } else merged.push([a, b]);
  }
  const covered = merged.reduce((s, [a, b]) => s + (b - a), 0);
  const gaps: { from: number; to: number }[] = [];
  let cursor = 0;
  for (const [a, b] of merged) {
    if (a - cursor > tol) gaps.push({ from: cursor, to: a });
    cursor = Math.max(cursor, b);
  }
  if (L - cursor > tol) gaps.push({ from: cursor, to: L });
  return {
    clLength: L,
    covered,
    overlap: total - covered,
    pct: L > 0 ? covered / L : 0,
    gaps,
    overlaps,
    unassigned: L - covered,
  };
}

/**
 * @param drafts centerlines being edited (subId → vertices) that should replace the saved ones.
 */
export function computePortfolio(p: Portfolio, drafts: Record<string, Vertex[]> = {}): PortfolioCalc {
  const items = new Map(p.catalog.map((c) => [c.code, c]));
  const features = new Map<string, FeatureCalc>();
  const subs: SubCalc[] = [];
  const tol = offsetLimit(COVERAGE_TOL_FT, p.units);

  p.subprojects.forEach((sub, index) => {
    const verts = drafts[sub.id] ?? sub.centerline;
    let ref: LinearRef | null = null;
    let pi: PiResult | null = null;
    let error: string | null = null;
    if (verts && verts.length >= 2) {
      try {
        ref = buildRef(verts, p.units);
        pi = computePIs(verts, {
          units: p.units, startStation: 0, startMilepost: 0,
          freeStressDeg: sub.freeStressDeg, fieldBendDeg: sub.fieldBendDeg,
        });
      } catch (e) {
        error = (e as Error).message;
        ref = null; pi = null;
      }
    }

    const tallies = new Map<string, ItemTally>();
    const methodRanges: [number, number][] = [];
    let featureCount = 0, flagged = 0;
    for (const f of p.features) {
      if (f.subId !== sub.id) continue;
      featureCount++;
      const item = items.get(f.code);
      const fc = featureCalc(f, item, ref, p);
      features.set(f.id, fc);
      if (fc.flag && fc.flag !== 'NO CENTERLINE') flagged++;
      let t = tallies.get(f.code);
      if (!t) tallies.set(f.code, (t = { code: f.code, item, qty: 0, unit: fc.unit, count: 0, ids: [] }));
      t.qty += fc.qty; t.count++; t.ids.push(f.id);
      if (item?.method && f.kind === 'Line' && fc.beginSta !== null && fc.flag !== 'OFF CENTERLINE') {
        methodRanges.push([fc.beginSta, fc.endSta!]);
      }
    }
    // Catalog order, unknown codes last.
    const order = new Map(p.catalog.map((c, i) => [c.code, i]));
    const list = [...tallies.values()].sort((a, b) => (order.get(a.code) ?? 1e9) - (order.get(b.code) ?? 1e9) || a.code.localeCompare(b.code));

    subs.push({
      sub, index, ref, pi, error,
      items: list,
      coverage: ref ? coverage(ref, methodRanges, tol) : null,
      featureCount, flagged,
    });
  });

  return { subs, bySub: new Map(subs.map((s) => [s.sub.id, s])), features, items };
}
