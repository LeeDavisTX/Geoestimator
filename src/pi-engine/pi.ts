// Core PI calculation: stations, mileposts, horizontal deflections, bend type,
// PI and fitting numbering, and labels.

import { inverse, turn } from './geodesic';
import { dms, stationText, PER_METER, type LinearUnit } from './format';
import type { Vertex } from './kml';

export type BendClass = 'FREE STRESS' | 'FIELD BEND' | 'FITTING';
/** Every interior vertex is a PI; the ends are BEGIN and END. */
export type RowKind = 'BEGIN' | 'PI' | 'END';

export interface PiSettings {
  units: LinearUnit;
  /** Station at the first vertex, in `units`. */
  startStation: number;
  /** Milepost (or KP when units = m) at the first vertex. */
  startMilepost: number;
  /** Below this angle the bend is free stress (elastic): still a PI, but it gets no PI number. */
  freeStressDeg: number;
  /** At or above this angle the bend needs a factory fitting instead of a field bend. */
  fieldBendDeg: number;
}

export const DEFAULT_SETTINGS: PiSettings = {
  units: 'ft',
  startStation: 0,
  startMilepost: 0,
  freeStressDeg: 1,
  fieldBendDeg: 18,
};

export interface PiRow {
  index: number;
  kind: RowKind;
  /** Numbers field bends and fittings only (free-stress PIs have none). */
  piNumber: number | null;
  /** Numbers fittings only (exported as FITTING_NO). */
  bendNumber: number | null;
  lat: number;
  lon: number;
  station: number;
  stationText: string;
  milepost: number;
  legBack: number | null;
  legAhead: number | null;
  azimuthIn: number | null;
  azimuthOut: number | null;
  /** Signed horizontal deflection, + = right. */
  hDeflection: number | null;
  hDirection: 'LT' | 'RT' | '';
  hDms: string;
  hClass: BendClass | null;
  /** Same as hClass. */
  bendClass: BendClass | null;
  /** e.g. P.I. < 45° 04' 20" LT. (the PI number is in its own column) */
  label: string;
  /** Label with station, e.g. P.I. < 45° 04' 20" LT. @ STA. 204+74.58 */
  fullLabel: string;
}

export interface PiResult {
  rows: PiRow[];
  length: number;
  endStation: number;
  endMilepost: number;
  counts: Record<BendClass, number>;
  settings: PiSettings;
}

export function classify(angle: number, s: PiSettings): BendClass {
  const a = Math.abs(angle);
  if (a < s.freeStressDeg) return 'FREE STRESS';
  if (a < s.fieldBendDeg) return 'FIELD BEND';
  return 'FITTING';
}

export const milepostPrefix = (u: LinearUnit) => (u === 'm' ? 'KP' : 'MP');

export function computePIs(vertices: Vertex[], settings: PiSettings): PiResult {
  const s = settings;
  const k = PER_METER[s.units];
  const perMile = s.units === 'm' ? 1000 : 5280;
  const n = vertices.length;
  if (n < 2) throw new Error('A route needs at least two vertices.');

  const legs: { len: number; azi1: number; azi2: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = vertices[i], b = vertices[i + 1];
    const g = inverse(a.lat, a.lon, b.lat, b.lon);
    legs.push({ len: g.s * k, azi1: g.azi1, azi2: g.azi2 });
  }

  const rows: PiRow[] = [];
  const counts: Record<BendClass, number> = { 'FREE STRESS': 0, 'FIELD BEND': 0, FITTING: 0 };
  let station = s.startStation;
  let piNo = 0, bendNo = 0;
  const mpOf = (st: number) => s.startMilepost + (st - s.startStation) / perMile;

  for (let i = 0; i < n; i++) {
    if (i > 0) station += legs[i - 1].len;
    const back = i > 0 ? legs[i - 1] : null;
    const ahead = i < n - 1 ? legs[i] : null;
    const isEnd = i === 0 || i === n - 1;

    let hDef: number | null = null;

    if (back && ahead) {
      hDef = turn(back.azi2, ahead.azi1);
    }

    const hClass = hDef === null ? null : classify(hDef, s);
    const bendClass = hClass;

    const kind: RowKind = i === 0 ? 'BEGIN' : i === n - 1 ? 'END' : 'PI';
    const piNumber = !isEnd && bendClass && bendClass !== 'FREE STRESS' ? ++piNo : null;
    const bendNumber = !isEnd && bendClass === 'FITTING' ? ++bendNo : null;
    if (bendClass) counts[bendClass]++;

    const stText = stationText(station, s.units);
    const hDirection = hDef === null ? '' : hDef < 0 ? 'LT' : 'RT';
    const hDms = hDef === null ? '' : dms(hDef);

    let label = '', fullLabel = '';
    if (kind === 'BEGIN') {
      label = 'BEGIN';
      fullLabel = `BEGIN @ STA. ${stText}`;
    } else if (kind === 'END') {
      label = 'END';
      fullLabel = `END @ STA. ${stText}`;
    } else {
      label = `P.I. < ${hDms} ${hDirection}.`;
      fullLabel = `${label} @ STA. ${stText}`;
    }

    rows.push({
      index: i,
      kind,
      piNumber,
      bendNumber,
      lat: vertices[i].lat,
      lon: vertices[i].lon,
      station,
      stationText: stText,
      milepost: mpOf(station),
      legBack: back ? back.len : null,
      legAhead: ahead ? ahead.len : null,
      azimuthIn: back ? back.azi2 : null,
      azimuthOut: ahead ? ahead.azi1 : null,
      hDeflection: hDef,
      hDirection,
      hDms,
      hClass,
      bendClass,
      label,
      fullLabel,
    });
  }

  return {
    rows,
    length: station - s.startStation,
    endStation: station,
    endMilepost: mpOf(station),
    counts,
    settings: s,
  };
}

/** Points at every whole `interval` of milepost (MP 1, 2, 3 ... or MP 0.5, 1.0 ...). */
export function milepostMarkers(result: PiResult, interval: number): { mp: number; lat: number; lon: number; station: number }[] {
  const out: { mp: number; lat: number; lon: number; station: number }[] = [];
  if (!(interval > 0)) return out;
  const rows = result.rows;
  const first = rows[0].milepost, last = rows[rows.length - 1].milepost;
  const eps = 1e-9;
  // Step by index, not by repeated addition, so 0.1 intervals don't drift.
  const k0 = Math.ceil((first - eps) / interval);
  let i = 0;
  for (let k = k0; out.length < 100000; k++) {
    const target = k * interval;
    if (target > last + eps) break;
    while (i < rows.length - 2 && rows[i + 1].milepost < target) i++;
    const a = rows[i], b = rows[i + 1];
    const span = b.milepost - a.milepost;
    const t = span > 0 ? Math.min(1, Math.max(0, (target - a.milepost) / span)) : 0;
    out.push({
      mp: Math.round(target * 1e6) / 1e6,
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
      station: a.station + (b.station - a.station) * t,
    });
  }
  return out;
}

/** Decimal places to show for a milepost interval: 1 → 0, 0.5 → 1, 0.25 → 2. */
export function milepostDecimals(interval: number): number {
  const s = String(interval);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(3, s.length - dot - 1);
}
