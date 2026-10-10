import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKml, inverse, type Vertex } from '../src/pi-engine/index';
import { newPortfolio, seedCatalog } from '../src/core/catalog';
import { computePortfolio } from '../src/core/calc';
import { buildRef, pathLengthM, pointAt, polygonAreaM2, project } from '../src/core/geo';
import { catalogFromXlsx, catalogToXlsx, parsePortfolio, serializePortfolio } from '../src/core/io';
import { portfolioGeoJson, portfolioKml, portfolioXlsx } from '../src/core/exports';
import { readXlsxSheet } from '../src/core/xlsx';
import type { Portfolio, TakeoffFeature } from '../src/core/types';

const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);
const sample = parseKml(readFileSync(new URL('../samples/RoutePI_SampleRoute.kml', import.meta.url), 'utf8'))[0].vertices;

function feature(id: string, subId: string, code: string, kind: TakeoffFeature['kind'], coords: [number, number][]): TakeoffFeature {
  return { id, subId, code, kind, coords, name: '', notes: '', created: '', modified: '' };
}

function samplePortfolio(): Portfolio {
  const p = newPortfolio();
  const sp = p.subprojects[0];
  sp.centerline = sample;
  sp.centerlineName = 'Sample';
  return p;
}

/** Copy of the centerline between two stations, as [lon, lat]. */
function slice(from: number, to: number): [number, number][] {
  const ref = buildRef(sample, 'ft');
  const pts: Vertex[] = [pointAt(ref, from)];
  for (let i = 0; i < sample.length; i++) if (ref.cum[i] > from && ref.cum[i] < to) pts.push(sample[i]);
  pts.push(pointAt(ref, to));
  return pts.map((v) => [v.lon, v.lat]);
}

test('sample route: length and PI counts match the Route PI Tool', () => {
  const calc = computePortfolio(samplePortfolio());
  const s = calc.subs[0];
  near(s.ref!.length, 147811.8, 0.5, 'length ft');
  assert.deepEqual(s.pi!.counts, { 'FREE STRESS': 3, 'FIELD BEND': 43, FITTING: 65 });
});

test('projection returns station, offset and side', () => {
  const ref = buildRef(sample, 'ft');
  const at = pointAt(ref, 10000);
  const pr = project(ref, at.lat, at.lon);
  near(pr.station, 10000, 0.5, 'on-line station');
  near(pr.offset, 0, 0.5, 'on-line offset');
  // First leg runs due west; a point 100 ft north of it is on the right.
  const a = sample[0];
  const north = { lat: a.lat + 100 * 0.3048 / 110900, lon: a.lon - 0.0005 };
  const pn = project(ref, north.lat, north.lon);
  assert.equal(pn.side, 'RT');
  near(pn.offset, 100, 2, 'offset');
});

test('line quantity is geodesic length; stations bracket the line', () => {
  const p = samplePortfolio();
  const sp = p.subprojects[0];
  p.features.push(feature('F-0001', sp.id, 'PL-HDD', 'Line', slice(5000, 7000)));
  const calc = computePortfolio(p);
  const fc = calc.features.get('F-0001')!;
  near(fc.beginSta!, 5000, 0.5);
  near(fc.endSta!, 7000, 0.5);
  near(fc.qty, 2000, 1, 'HDD length');
  assert.equal(fc.unit, 'FT');
  assert.equal(fc.flag, '');
});

test('coverage finds gaps and overlaps beyond tolerance', () => {
  const p = samplePortfolio();
  for (const c of p.catalog) if (['PL-OC', 'PL-HDD', 'PL-BORE'].includes(c.code)) c.method = true;
  const sp = p.subprojects[0];
  const L = buildRef(sample, 'ft').length;
  p.features.push(feature('F-1', sp.id, 'PL-OC', 'Line', slice(0, 50000)));
  p.features.push(feature('F-2', sp.id, 'PL-HDD', 'Line', slice(49995, 52000))); // 5 ft overlap: within tolerance
  p.features.push(feature('F-3', sp.id, 'PL-OC', 'Line', slice(53000, L)));      // 1000 ft gap
  p.features.push(feature('F-4', sp.id, 'PL-BORE', 'Line', slice(60000, 60200))); // 200 ft overlap
  const cov = computePortfolio(p).subs[0].coverage!;
  assert.equal(cov.gaps.length, 1);
  near(cov.gaps[0].from, 52000, 0.5);
  near(cov.gaps[0].to, 53000, 0.5);
  near(cov.unassigned, 1000, 1);
  assert.equal(cov.overlaps.length, 1);
  near(cov.overlap, 205, 1);
});

test('points count, polygons give area in acres, far features are flagged', () => {
  const p = samplePortfolio();
  const sp = p.subprojects[0];
  const v = sample[20];
  p.features.push(feature('P1', sp.id, 'PL-ELB', 'Point', [[sample[5].lon, sample[5].lat]]));
  p.features.push(feature('P2', sp.id, 'PL-ELB', 'Point', [[sample[6].lon, sample[6].lat]]));
  p.features.push(feature('P3', sp.id, 'PL-MLV', 'Point', [[v.lon + 0.01, v.lat]])); // ~3,000 ft east
  // ~208.7 ft square = 1 acre
  const dLat = 208.71 * 0.3048 / 110860, dLon = 208.71 * 0.3048 / (111320 * Math.cos(v.lat * Math.PI / 180));
  p.features.push(feature('A1', sp.id, 'PL-SITE', 'Polygon', [[v.lon, v.lat], [v.lon + dLon, v.lat], [v.lon + dLon, v.lat + dLat], [v.lon, v.lat + dLat]]));
  const calc = computePortfolio(p);
  const elb = calc.subs[0].items.find((t) => t.code === 'PL-ELB')!;
  assert.equal(elb.qty, 2);
  assert.equal(elb.unit, 'EA');
  near(calc.features.get('A1')!.qty, 1, 0.01, 'acres');
  assert.equal(calc.features.get('P3')!.flag, 'OFF CENTERLINE');
});

test('polygon area and path length agree with Vincenty for small shapes', () => {
  const ring: [number, number][] = [[-99, 31], [-98.99, 31], [-98.99, 31.01], [-99, 31.01]];
  const w = inverse(31, -99, 31, -98.99).s, hgt = inverse(31, -99, 31.01, -99).s;
  near(polygonAreaM2(ring) / (w * hgt), 1, 0.003, 'area ratio');
  near(pathLengthM([[-99, 31], [-98.99, 31]]), w, 1e-6);
});

test('metric portfolio reports meters and hectares', () => {
  const p = samplePortfolio();
  p.units = 'm';
  const calc = computePortfolio(p);
  near(calc.subs[0].ref!.length, 147811.8 * 0.3048, 0.2);
});

test('catalog survives an Excel round trip', async () => {
  const cat = seedCatalog();
  const bytes = catalogToXlsx(cat);
  const { items, errors } = await catalogFromXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.deepEqual(errors, []);
  assert.deepEqual(items, cat);
});

test('exports build and carry stations', async () => {
  const p = samplePortfolio();
  const sp = p.subprojects[0];
  p.features.push(feature('F-0001', sp.id, 'PL-HDD', 'Line', slice(5000, 7000)));
  const calc = computePortfolio(p);
  const xl = portfolioXlsx(p, calc);
  const detail = await readXlsxSheet(xl, 'Feature Detail');
  const hdr = detail.rows[0];
  assert.equal(detail.rows[1][hdr.indexOf('BEGIN_STA_TEXT')], '50+00.00');
  const summary = await readXlsxSheet(xl, 'Quantity Summary');
  assert.equal(summary.rows[1][summary.rows[0].indexOf('ITEM_CODE')], 'PL-HDD');
  const kml = portfolioKml(p, calc);
  assert.match(kml, /<Folder><name>PL-HDD/);
  const gj = JSON.parse(portfolioGeoJson(p, calc));
  assert.ok(gj.features.some((f: any) => f.properties.FEATURE_TYPE === 'TAKEOFF' && f.properties.ITEM_CODE === 'PL-HDD'));
  assert.deepEqual(parsePortfolio(serializePortfolio(p)), p);
});

test('one industry per portfolio: other-industry items are flagged; old files migrate', () => {
  const p = samplePortfolio();
  p.industry = 'Pipeline';
  const sp = p.subprojects[0];
  p.features.push(feature('X1', sp.id, 'PW-POLE', 'Point', [[sample[3].lon, sample[3].lat]]));
  p.features.push(feature('X2', sp.id, 'PL-ELB', 'Point', [[sample[4].lon, sample[4].lat]]));
  const calc = computePortfolio(p);
  assert.equal(calc.features.get('X1')!.flag, 'OTHER INDUSTRY');
  assert.equal(calc.features.get('X2')!.flag, '');
  const old: any = JSON.parse(serializePortfolio(p));
  delete old.industry;
  old.subprojects[0].industry = 'Water';
  assert.equal(parsePortfolio(JSON.stringify(old)).industry, 'Water');
});

test('tally carries count and total length for line items', () => {
  const p = samplePortfolio();
  const sp = p.subprojects[0];
  p.features.push(feature('B1', sp.id, 'PL-BORE', 'Line', slice(1000, 1200)));
  p.features.push(feature('B2', sp.id, 'PL-BORE', 'Line', slice(3000, 3150)));
  p.features.push(feature('B3', sp.id, 'PL-BORE', 'Line', slice(9000, 9290)));
  const t = computePortfolio(p).subs[0].items.find((x) => x.code === 'PL-BORE')!;
  assert.equal(t.count, 3);
  near(t.qty, 640, 1, 'total bore length');
});
