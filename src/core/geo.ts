// Measurement and linear referencing on the WGS84 ellipsoid.

import { inverse, PER_METER, type LinearUnit, type Vertex } from '../pi-engine';

const RAD = Math.PI / 180;
/** Authalic (equal-area) sphere radius for WGS84, meters. */
const R_AUTHALIC = 6371007.181;
/** Mean radius used for local tangent-plane math inside one leg. */
const R_MEAN = 6371008.8;

export type LonLat = [number, number];

export const toVertex = ([lon, lat]: LonLat): Vertex => ({ lat, lon });

/** Geodesic length of a path in meters. */
export function pathLengthM(coords: LonLat[]): number {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i];
    s += inverse(a[1], a[0], b[1], b[0]).s;
  }
  return s;
}

/** Geodesic polygon area in m² (open or closed ring), spherical excess on the authalic sphere. */
export function polygonAreaM2(ring: LonLat[]): number {
  const n = ring.length;
  if (n < 3) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % n];
    total += (lon2 - lon1) * RAD * (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
  }
  return Math.abs((total * R_AUTHALIC * R_AUTHALIC) / 2);
}

/** Area-weighted centroid in lon/lat (planar; fine at project scale). */
export function polygonCentroid(ring: LonLat[]): LonLat {
  let a = 0, cx = 0, cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-15) {
    const sx = ring.reduce((s, p) => s + p[0], 0), sy = ring.reduce((s, p) => s + p[1], 0);
    return [sx / n, sy / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// ---------------------------------------------------------------- linear referencing

export interface LinearRef {
  verts: Vertex[];
  /** Station at each vertex, in portfolio units (start = 0). */
  cum: number[];
  /** Leg lengths in portfolio units. */
  legs: number[];
  length: number;
  k: number;
}

export function buildRef(verts: Vertex[], units: LinearUnit): LinearRef {
  const k = PER_METER[units];
  const cum = [0];
  const legs: number[] = [];
  for (let i = 1; i < verts.length; i++) {
    const a = verts[i - 1], b = verts[i];
    const len = inverse(a.lat, a.lon, b.lat, b.lon).s * k;
    legs.push(len);
    cum.push(cum[i - 1] + len);
  }
  return { verts, cum, legs, length: cum[cum.length - 1], k };
}

export interface Projection {
  /** Station along the centerline, portfolio units. */
  station: number;
  /** Perpendicular distance to the centerline, portfolio units. */
  offset: number;
  side: 'LT' | 'RT' | '';
  /** Closest point on the centerline. */
  at: Vertex;
}

/** Closest point on the centerline. Works leg by leg in a local tangent plane. */
export function project(ref: LinearRef, lat: number, lon: number): Projection {
  let best = { d2: Infinity, i: 0, t: 0, cross: 0 };
  const v = ref.verts;
  for (let i = 0; i < v.length - 1; i++) {
    const a = v[i], b = v[i + 1];
    const c = Math.cos(a.lat * RAD) * R_MEAN * RAD;
    const yk = R_MEAN * RAD;
    const bx = (b.lon - a.lon) * c, by = (b.lat - a.lat) * yk;
    const px = (lon - a.lon) * c, py = (lat - a.lat) * yk;
    const l2 = bx * bx + by * by;
    const t = l2 > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / l2)) : 0;
    const dx = px - t * bx, dy = py - t * by;
    const d2 = dx * dx + dy * dy;
    if (d2 < best.d2) best = { d2, i, t, cross: bx * py - by * px };
  }
  const a = v[best.i], b = v[best.i + 1] ?? a;
  const at = { lat: a.lat + (b.lat - a.lat) * best.t, lon: a.lon + (b.lon - a.lon) * best.t };
  const station = ref.cum[best.i] + best.t * (ref.legs[best.i] ?? 0);
  const offset = inverse(lat, lon, at.lat, at.lon).s * ref.k;
  // Positive cross product = point is left of the direction of stationing.
  const side = offset < 1e-6 ? '' : best.cross > 0 ? 'LT' : 'RT';
  return { station, offset, side, at };
}

/** Point at a given station (linear within the leg). */
export function pointAt(ref: LinearRef, station: number): Vertex {
  const s = Math.min(ref.length, Math.max(0, station));
  let i = 0;
  while (i < ref.legs.length - 1 && ref.cum[i + 1] < s) i++;
  const t = ref.legs[i] > 0 ? (s - ref.cum[i]) / ref.legs[i] : 0;
  const a = ref.verts[i], b = ref.verts[i + 1] ?? a;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** Vertices of the centerline between two stations (for highlighting gaps). */
export function sliceRef(ref: LinearRef, from: number, to: number): Vertex[] {
  const out: Vertex[] = [pointAt(ref, from)];
  for (let i = 0; i < ref.verts.length; i++) if (ref.cum[i] > from && ref.cum[i] < to) out.push(ref.verts[i]);
  out.push(pointAt(ref, to));
  return out;
}
