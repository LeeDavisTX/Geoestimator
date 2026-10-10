// File input: centerline routes, catalog spreadsheets, saved portfolios.

import { readRouteFile, type Vertex } from '../pi-engine';
import { readXlsxSheet, writeXlsx } from './xlsx';
import type { CatalogItem, GeomKind, Industry, LineStyle, Portfolio } from './types';
import { INDUSTRIES } from './types';

export interface RouteLoad {
  name: string;
  vertices: Vertex[];
  warnings: string[];
}

function dedupe(vertices: Vertex[]): Vertex[] {
  const out: Vertex[] = [];
  for (const v of vertices) {
    const l = out[out.length - 1];
    if (l && Math.abs(l.lat - v.lat) < 1e-9 && Math.abs(l.lon - v.lon) < 1e-9) continue;
    out.push(v);
  }
  return out;
}

/** GeoJSON: exactly one LineString (or a MultiLineString with one part). */
function readGeoJsonRoute(fileName: string, text: string): RouteLoad {
  let gj: any;
  try { gj = JSON.parse(text); } catch { throw new Error(`${fileName} is not valid GeoJSON.`); }
  const feats: { geom: any; props: any }[] = [];
  const visit = (o: any, props: any = {}) => {
    if (!o) return;
    if (o.type === 'FeatureCollection') o.features?.forEach((f: any) => visit(f));
    else if (o.type === 'Feature') visit(o.geometry, o.properties ?? {});
    else if (o.type === 'GeometryCollection') o.geometries?.forEach((g: any) => visit(g, props));
    else if (o.type === 'LineString' || o.type === 'MultiLineString') feats.push({ geom: o, props });
  };
  visit(gj);
  if (feats.length === 0) throw new Error(`No route line was found in ${fileName}. The file needs one LineString.`);
  if (feats.length > 1) throw new Error(`${fileName} contains ${feats.length} lines. Upload one route line per file.`);
  const { geom, props } = feats[0];
  let coords: number[][] = geom.coordinates;
  if (geom.type === 'MultiLineString') {
    if (geom.coordinates.length !== 1) {
      throw new Error(`The line in ${fileName} is made of ${geom.coordinates.length} separate pieces. Merge them into one continuous line and export again.`);
    }
    coords = geom.coordinates[0];
  }
  const vertices = dedupe(coords.filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1])).map(([lon, lat]) => ({ lat, lon })));
  if (vertices.length < 2) throw new Error(`The line in ${fileName} has fewer than two points.`);
  const name = props?.name ?? props?.NAME ?? props?.Name ?? fileName.replace(/\.[^.]+$/, '');
  return { name: String(name), vertices, warnings: [] };
}

export async function readRoute(file: File): Promise<RouteLoad> {
  const buf = await file.arrayBuffer();
  if (/\.(geo)?json$/i.test(file.name)) return readGeoJsonRoute(file.name, new TextDecoder().decode(buf));
  if (!/\.km[lz]$/i.test(file.name)) throw new Error(`${file.name}: upload a KML, KMZ or GeoJSON route line.`);
  const routes = await readRouteFile(file.name, buf);
  const r = routes[0];
  return { name: r.name ?? file.name.replace(/\.[^.]+$/, ''), vertices: r.vertices, warnings: r.warnings };
}

// ---------------------------------------------------------------- catalog spreadsheet

export const CATALOG_COLUMNS = ['Code', 'Industry', 'Category', 'Name', 'Geometry', 'Color', 'Size (px)', 'Line style', 'Description'];

export function catalogToXlsx(catalog: CatalogItem[]): Uint8Array {
  return writeXlsx([
    {
      name: 'Catalog',
      header: CATALOG_COLUMNS,
      rows: catalog.map((c) => [c.code, c.industry, c.category, c.name, c.geometry, c.color, c.size, c.style, c.description]),
      widths: [12, 11, 16, 34, 10, 10, 10, 11, 50],
    },
    {
      name: 'Read Me',
      header: ['Column', 'Allowed values'],
      rows: [
        ['Code', 'Unique item code with an industry prefix, e.g. PL-HDD. This is the key the cost tool uses.'],
        ['Industry', INDUSTRIES.join(', ')],
        ['Geometry', 'Line, Point or Polygon'],
        ['Color', 'Hex color, e.g. #E8590C'],
        ['Size (px)', 'Line width or point diameter in pixels, 1-30'],
        ['Line style', 'Solid, Dashed or Dotted'],
        ['Upload', 'Edit the Catalog sheet, save as .xlsx, then use Upload Excel in the Catalog tab. Items already used on the map are kept.'],
      ],
      widths: [20, 100],
    },
  ]);
}

const pickEnum = <T extends string>(v: string, opts: readonly T[]): T | null =>
  opts.find((o) => o.toLowerCase() === v.trim().toLowerCase()) ?? null;

export async function catalogFromXlsx(data: ArrayBuffer): Promise<{ items: CatalogItem[]; errors: string[] }> {
  const { rows } = await readXlsxSheet(data, 'Catalog');
  const errors: string[] = [];
  const hdr = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => hdr.findIndex((h) => h.startsWith(name.toLowerCase()));
  const idx = {
    code: col('code'), industry: col('industry'), category: col('category'), name: col('name'),
    geometry: col('geometry'), color: col('color'), size: col('size'), style: col('line style'),
    method: -1, description: col('description'),
  };
  for (const k of ['code', 'industry', 'name', 'geometry'] as const) {
    if (idx[k] < 0) errors.push(`Missing column "${k}". Download the catalog to get the expected layout.`);
  }
  if (errors.length) return { items: [], errors };
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const cell = (k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? '').trim() : '');
    const code = cell('code').toUpperCase();
    if (!code && !cell('name')) return;
    if (!code) { errors.push(`Row ${line}: code is empty.`); return; }
    if (seen.has(code)) { errors.push(`Row ${line}: code ${code} is used twice.`); return; }
    const industry = pickEnum<Industry>(cell('industry'), INDUSTRIES);
    if (!industry) { errors.push(`Row ${line} (${code}): industry must be one of ${INDUSTRIES.join(', ')}.`); return; }
    const geometry = pickEnum<GeomKind>(cell('geometry'), ['Line', 'Point', 'Polygon']);
    if (!geometry) { errors.push(`Row ${line} (${code}): geometry must be Line, Point or Polygon.`); return; }
    let color = cell('color');
    if (!/^#?[0-9a-f]{6}$/i.test(color)) color = '#868E96';
    if (!color.startsWith('#')) color = '#' + color;
    const size = Math.min(30, Math.max(1, Number(cell('size')) || (geometry === 'Point' ? 8 : 3)));
    const style = pickEnum<LineStyle>(cell('style'), ['Solid', 'Dashed', 'Dotted']) ?? 'Solid';
    const method = false;
    seen.add(code);
    items.push({ code, industry, category: cell('category'), name: cell('name') || code, geometry, color: color.toUpperCase(), size, style, method, description: cell('description') });
  });
  if (!items.length && !errors.length) errors.push('No catalog rows were found.');
  return { items, errors };
}

// ---------------------------------------------------------------- saved portfolio

export const PORTFOLIO_EXT = '.geoest.json';

export function serializePortfolio(p: Portfolio): string {
  return JSON.stringify({ app: 'GeoEstimator', ...p }, null, 1);
}

export function parsePortfolio(text: string): Portfolio {
  let o: any;
  try { o = JSON.parse(text); } catch { throw new Error('This file is not a GeoEstimator portfolio.'); }
  if (!o || o.version !== 1 || !Array.isArray(o.subprojects) || !Array.isArray(o.catalog) || !Array.isArray(o.features)) {
    throw new Error('This file is not a GeoEstimator portfolio.');
  }
  delete o.app;
  // Files saved before industry moved to the portfolio: adopt the first sub-project's industry.
  if (!('industry' in o)) o.industry = o.subprojects[0]?.industry ?? null;
  if (o.industry) for (const s of o.subprojects) s.industry = o.industry;
  return o as Portfolio;
}
