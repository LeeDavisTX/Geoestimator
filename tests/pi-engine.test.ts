import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inverse, turn, dms, stationText, parseStation, computePIs, DEFAULT_SETTINGS, parseKml,
  readRouteFile, toKml, toCsv, toXlsx, readZip, writeZip, milepostMarkers, milepostDecimals, tableColumns, type Vertex,
} from '../src/pi-engine/index';

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);
const dmsToDeg = (d: number, m: number, s: number) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);

// Ellipsoid radii of curvature (WGS84) at a latitude.
function radii(latDeg: number) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const s = Math.sin((latDeg * Math.PI) / 180);
  const w = 1 - e2 * s * s;
  return { M: (a * (1 - e2)) / w ** 1.5, N: a / Math.sqrt(w) };
}
// Move from a point by distance (m) along a bearing, local tangent plane; fine for short test legs.
function step(p: Vertex, bearingDeg: number, meters: number): Vertex {
  const { M, N } = radii(p.lat), b = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(b)) / M;
  const dLon = (meters * Math.sin(b)) / (N * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + (dLat * 180) / Math.PI, lon: p.lon + (dLon * 180) / Math.PI };
}
function routeFromBearings(bearings: number[], legMeters = 300): Vertex[] {
  const pts: Vertex[] = [{ lat: 30.9, lon: -99.3 }];
  for (const b of bearings) pts.push(step(pts[pts.length - 1], b, legMeters));
  return pts;
}

test('Vincenty inverse matches the published Flinders Peak – Buninyong example', () => {
  const r = inverse(dmsToDeg(-37, 57, 3.7203), dmsToDeg(144, 25, 29.5244), dmsToDeg(-37, 39, 10.1561), dmsToDeg(143, 55, 35.3839));
  near(r.s, 54972.271, 0.001, 'distance');
  near(r.azi1, dmsToDeg(306, 52, 5.37), 1 / 3600, 'forward azimuth');
  near(r.azi2, dmsToDeg(307, 10, 25.07), 1 / 3600, 'arrival azimuth');
});

test('turn() gives signed deflection, + right', () => {
  assert.equal(turn(90, 135), 45);
  assert.equal(turn(135, 90), -45);
  assert.equal(turn(350, 10), 20);
  assert.equal(turn(10, 350), -20);
  assert.equal(turn(315, 225), -90); // NW → SW is a LEFT turn (the Excel worksheet got this wrong)
  near(turn(12.45, 282.8), -89.65, 1e-9); // NE → NW is LEFT (also wrong in the Excel worksheet)
});

test('DMS never shows 60 seconds', () => {
  assert.equal(dms(12.99999), `13° 00' 00"`);
  assert.equal(dms(44.910941264), `44° 54' 39"`);
  assert.equal(dms(10.68691107306529, '%%d'), `10%%d 41' 13"`);
});

test('station text keeps two decimals and carries correctly', () => {
  assert.equal(stationText(85, 'ft'), '0+85.00');
  assert.equal(stationText(17629.9, 'ft'), '176+29.90');
  assert.equal(stationText(46406.6, 'ft'), '464+06.60');
  assert.equal(stationText(99.996, 'ft'), '1+00.00');
  assert.equal(stationText(12345.678, 'm'), '12+345.68');
  assert.equal(parseStation('204+74.58', 'ft'), 20474.58);
  assert.equal(parseStation('12+345.67', 'm'), 12345.67);
});

test('horizontal PI angles, directions and classes on a synthetic route', () => {
  // East, then SE (45 RT), then S (45 RT), then SW... then back to NW (turn 90 RT), then SW (90 LT)
  const v = routeFromBearings([90, 135, 180, 180.5, 270, 180]);
  const res = computePIs(v, DEFAULT_SETTINGS);
  const pis = res.rows.slice(1, -1);
  near(pis[0].hDeflection!, 45, 0.01); assert.equal(pis[0].hDirection, 'RT'); assert.equal(pis[0].bendClass, 'FITTING');
  near(pis[1].hDeflection!, 45, 0.01);
  near(pis[2].hDeflection!, 0.5, 0.01); assert.equal(pis[2].bendClass, 'FREE STRESS'); assert.equal(pis[2].piNumber, null);
  near(pis[3].hDeflection!, 89.5, 0.01);
  near(pis[4].hDeflection!, -90, 0.01); assert.equal(pis[4].hDirection, 'LT');
  assert.deepEqual(res.rows.map((r) => r.kind), ['BEGIN', 'PI', 'PI', 'PI', 'PI', 'PI', 'END'], 'every interior vertex is a PI');
  assert.deepEqual(res.rows.map((r) => r.piNumber), [null, 1, 2, null, 3, 4, null], 'free stress gets no PI number');
  assert.deepEqual(res.rows.map((r) => r.bendNumber), [null, 1, 2, null, 3, 4, null], 'all four numbered PIs here are fittings');
  assert.equal(res.rows[res.rows.length - 1].piNumber, null, 'end point is never a PI');
  assert.equal(pis[3].piNumber, 3, 'PI numbers skip free stress vertices');
  assert.match(pis[0].fullLabel, /^P\.I\. < 4[45]° \d\d' \d\d" RT\. @ STA\. 9\+84\.25$/);
});

test('field bend cutoff: 18° and up is a fitting', () => {
  const v = routeFromBearings([0, 18.01, 18.01 + 17.99]);
  const res = computePIs(v, DEFAULT_SETTINGS);
  assert.equal(res.rows[1].bendClass, 'FITTING');
  assert.equal(res.rows[2].bendClass, 'FIELD BEND');
});

test('export columns match the agreed layout', async () => {
  const { tableColumns } = await import('../src/pi-engine/index');
  const res = computePIs(routeFromBearings([90, 135]), DEFAULT_SETTINGS);
  assert.deepEqual(tableColumns(res).map((c) => c.header), [
    'ORDER', 'POINT_TYPE', 'PI_NO', 'UNITS', 'STATION', 'MILEPOST', 'LEG_AHEAD', 'AZIMUTH_IN', 'AZIMUTH_OUT',
    'H_PI_DD', 'H_PI_DMS', 'H_DIRECTION', 'FITTING_NO', 'BEND_TYPE', 'LABEL', 'DESCRIPTION', 'LATITUDE', 'LONGITUDE',
  ]);
  const row = Object.fromEntries(tableColumns(res).map((c) => [c.header, c.get(res.rows[1])]));
  assert.equal(row.UNITS, 'FT/MI');
  const { UNITS_CODE } = await import('../src/pi-engine/index');
  assert.deepEqual(UNITS_CODE, { ft: 'FT/MI', usft: 'USFT/MI', m: 'M/KM' });
  assert.equal(typeof row.STATION, 'number');
  assert.equal(row.H_DIRECTION, 'RT');
});

test('mileposts every mile', () => {
  const v = routeFromBearings([90, 90, 90, 90], 1000); // ~2.49 mi
  const res = computePIs(v, { ...DEFAULT_SETTINGS, startMilepost: 10 });
  const mps = milepostMarkers(res, 1);
  assert.deepEqual(mps.map((m) => m.mp), [10, 11, 12]);
  near(mps[1].station, 5280, 0.01);
});

const stairKml = readFileSync(new URL('./fixtures/StairRoute.kml', import.meta.url), 'utf8');

test('StairRoute.kml: parts joined', () => {
  const [route] = parseKml(stairKml);
  assert.equal(route.partCount, 3);
  assert.equal(route.vertices.length, 211);
  assert.equal(route.name, null, 'only <name> is used; attributes are ignored');
  const res = computePIs(route.vertices, DEFAULT_SETTINGS);
  near(res.length / 5280, 31.1, 0.1, 'length in miles');
});

test('geodesic deflections agree with a planar calculation on StairRoute', () => {
  const [route] = parseKml(stairKml);
  const res = computePIs(route.vertices, DEFAULT_SETTINGS);
  const { M, N } = radii(30.8);
  const lat0 = (30.8 * Math.PI) / 180;
  const xy = route.vertices.map((v) => [v.lon * N * Math.cos(lat0), v.lat * M]);
  const az = (a: number[], b: number[]) => ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
  let worst = 0;
  for (let i = 1; i < xy.length - 1; i++) {
    const planar = turn(az(xy[i - 1], xy[i]), az(xy[i], xy[i + 1]));
    worst = Math.max(worst, Math.abs(planar - res.rows[i].hDeflection!));
  }
  assert.ok(worst < 0.1, `worst difference ${worst}°`);
});

test('KML and KMZ round trip, CSV and XLSX build', async () => {
  const [route] = parseKml(stairKml);
  const res = computePIs(route.vertices, DEFAULT_SETTINGS);
  const kml = toKml(res, 'StairRoute', { milepostInterval: 1 });
  const bytes = new TextEncoder().encode(kml);
  const back = await readRouteFile('out.kml', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(back[0].vertices.length, 211, 'exported KML re-imports as one line; its points are ignored');
  const kmz = writeZip([{ name: 'doc.kml', data: kml }]);
  const back2 = await readRouteFile('out.kmz', kmz.buffer.slice(kmz.byteOffset, kmz.byteOffset + kmz.byteLength) as ArrayBuffer);
  assert.equal(back2[0].vertices.length, 211, 'KMZ upload works too');
  const csv = toCsv(res);
  assert.equal(csv.trim().split('\r\n').length, 212);
  const entries = await readZip(toXlsx(res));
  assert.ok(entries.some((e) => e.name === 'xl/worksheets/sheet1.xml'));
  assert.ok(!entries.some((e) => e.name === 'xl/worksheets/sheet2.xml'), 'one sheet');
});

test('review fixes: milepost decimals, no drift, escaped popups, spaced coordinates, hex entities', () => {
  assert.equal(milepostDecimals(1), 0);
  assert.equal(milepostDecimals(0.5), 1);
  assert.equal(milepostDecimals(0.25), 2);
  assert.equal(milepostDecimals(0.1), 1);
  const res = computePIs(routeFromBearings([90, 90, 90, 90, 90, 90, 90, 90, 90, 90], 1000), DEFAULT_SETTINGS);
  const mps = milepostMarkers(res, 0.1).map((m) => m.mp);
  assert.ok(mps.every((m) => Math.abs(m * 10 - Math.round(m * 10)) < 1e-9), 'every 0.1 MP lands on a tenth');
  assert.equal(mps.length, Math.floor(res.endMilepost * 10 + 1e-9) + 1);
  const kml = toKml(res, 'R', { milepostInterval: 0.25 });
  assert.match(kml, /<name>MP 0\.25<\/name>/, '0.25 mi markers show two decimals');
  assert.ok(!/<td>P\.I\. </.test(kml), 'popup labels are HTML-escaped');
  assert.match(kml, /<td>P\.I\. &lt; /);
  const [r] = parseKml(`<kml><Placemark><name>Line&#x20;A &#38; B</name><LineString><coordinates>-99.1, 30.1, 0  -99.2, 30.1, 0</coordinates></LineString></Placemark></kml>`);
  assert.equal(r.name, 'Line A & B');
  assert.equal(r.vertices.length, 2, 'spaces after commas are tolerated');
});

test('FITTING_NO numbers fittings only; free stress is a PI without a PI number', () => {
  // 30° RT (fitting), 5° RT (field bend), 0.5° RT (free stress), 40° LT (fitting)
  const res = computePIs(routeFromBearings([90, 120, 125, 125.5, 85.5]), DEFAULT_SETTINGS);
  const rows = res.rows;
  assert.deepEqual(rows.map((r) => r.kind), ['BEGIN', 'PI', 'PI', 'PI', 'PI', 'END']);
  assert.deepEqual(rows.map((r) => r.bendClass), [null, 'FITTING', 'FIELD BEND', 'FREE STRESS', 'FITTING', null]);
  assert.deepEqual(rows.map((r) => r.piNumber), [null, 1, 2, null, 3, null]);
  assert.deepEqual(rows.map((r) => r.bendNumber), [null, 1, null, null, 2, null]);
  const cols = tableColumns(res);
  const csvRow = (i: number) => Object.fromEntries(cols.map((c) => [c.header, c.get(rows[i])]));
  assert.equal(csvRow(4).FITTING_NO, 2);
  assert.equal(csvRow(4).BEND_TYPE, 'FITTING');
  assert.equal(csvRow(3).POINT_TYPE, 'PI');
  assert.equal(csvRow(3).PI_NO, null);
  assert.equal(csvRow(0).ORDER, 1);
  const kml = toKml(res, 'R', { milepostInterval: 1 });
  assert.match(kml, /<Folder><name>Free stress \(1\)<\/name>/);
  assert.match(kml, /<name>P\.I\. &lt; 0° \d\d' \d\d&quot; RT\.<\/name><visibility>1<\/visibility><styleUrl>#free<\/styleUrl>/, 'free stress is visible and labeled');
  assert.match(kml, /<name>P\.I\. &lt; (29|30)° \d\d' \d\d&quot; RT\.<\/name><visibility>1<\/visibility><styleUrl>#fitting<\/styleUrl>/, 'KML names use LABEL');
  assert.ok(!/<name>PI \d/.test(kml), 'no PI numbers in KML names');
});

test('classify boundaries', async () => {
  const { classify } = await import('../src/pi-engine/index');
  assert.equal(classify(18, DEFAULT_SETTINGS), 'FITTING');
  assert.equal(classify(-17.999, DEFAULT_SETTINGS), 'FIELD BEND');
  assert.equal(classify(1, DEFAULT_SETTINGS), 'FIELD BEND');
  assert.equal(classify(0.999, DEFAULT_SETTINGS), 'FREE STRESS');
});

test('RoutePI_SampleRoute.kml (app sample): name, geometry, bend counts', async () => {
  const text = readFileSync(new URL('../samples/RoutePI_SampleRoute.kml', import.meta.url), 'utf8');
  const bytes = new TextEncoder().encode(text);
  const [sample] = await readRouteFile('RoutePI_SampleRoute.kml', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.equal(sample.name, 'RoutePI_SampleRoute');
  assert.equal(sample.description, null);
  assert.equal(sample.partCount, 1);
  assert.equal(sample.vertices.length, 113);
  assert.deepEqual(sample.warnings, []);
  const res = computePIs(sample.vertices, DEFAULT_SETTINGS);
  assert.equal(res.rows[0].kind, 'BEGIN');
  assert.equal(res.rows[112].kind, 'END');
  near(res.length / 5280, 27.99, 0.01, 'length in miles');
  assert.deepEqual(res.counts, { 'FREE STRESS': 3, 'FIELD BEND': 43, FITTING: 65 });
});

test('HTML in a description is reduced to text', () => {
  const [r] = parseKml(`<kml><Placemark><name>A</name><description><![CDATA[<b>Line 1</b><br/>Owner &amp; Co]]></description>
    <LineString><coordinates>-99.1,30.1 -99.2,30.1</coordinates></LineString></Placemark></kml>`);
  assert.equal(r.description, 'Line 1\nOwner & Co');
});

test('Placemark <name> is used when present', () => {
  const kml = `<kml><Document><Placemark><name>Untitled Path</name><LineString><tessellate>1</tessellate>
    <coordinates>-99.1,30.1,0 -99.2,30.1,0 -99.2,30.2,0</coordinates></LineString></Placemark></Document></kml>`;
  const [r] = parseKml(kml);
  assert.equal(r.name, 'Untitled Path');
  assert.equal(r.vertices.length, 3);
});

test('KML export is clamped to ground and carries name/description', async () => {
  const { toKml } = await import('../src/pi-engine/index');
  const res = computePIs(routeFromBearings([90, 135, 90]), DEFAULT_SETTINGS);
  const kml = toKml(res, 'My Line', { milepostInterval: 1 }, 'Proposed 8" lateral');
  assert.match(kml, /<LineString><tessellate>1<\/tessellate><altitudeMode>clampToGround<\/altitudeMode>/);
  const points = kml.match(/<Point>/g)!.length;
  assert.equal(kml.match(/<Point><altitudeMode>clampToGround<\/altitudeMode>/g)!.length, points);
  assert.ok(!/absolute|relativeToGround/.test(kml));
  assert.match(kml, /<name>My Line PIs<\/name>/);
  assert.match(kml, /<description>Proposed 8&quot; lateral<\/description>/);
});

test('uploads must be a single, single-part line', async () => {
  const enc = (t: string) => { const b = new TextEncoder().encode(t); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
  // Multi-part geometry is rejected.
  await assert.rejects(readRouteFile('StairRoute.kml', enc(stairKml)), /3 separate pieces \(multi-part geometry\)/);
  // Two line placemarks are rejected.
  const two = `<kml><Document>
    <Placemark><name>A</name><LineString><coordinates>-99.1,30.1 -99.2,30.1</coordinates></LineString></Placemark>
    <Placemark><name>B</name><LineString><coordinates>-99.3,30.1 -99.4,30.1</coordinates></LineString></Placemark>
  </Document></kml>`;
  await assert.rejects(readRouteFile('two.kml', enc(two)), /contains 2 lines/);
  // No line at all is rejected.
  await assert.rejects(readRouteFile('pins.kml', enc('<kml><Placemark><Point><coordinates>-99,30</coordinates></Point></Placemark></kml>')), /No route line/);
  // One line plus pins and a polygon is accepted; the extras are ignored.
  const withPins = `<kml><Document>
    <Placemark><name>Pin</name><Point><coordinates>-99.0,30.0</coordinates></Point></Placemark>
    <Placemark><name>Area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-99,30 -99.1,30 -99.1,30.1 -99,30</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Route</name><LineString><coordinates>-99.1,30.1 -99.2,30.1 -99.2,30.2</coordinates></LineString></Placemark>
  </Document></kml>`;
  const ok = await readRouteFile('pins.kml', enc(withPins));
  assert.equal(ok.length, 1);
  assert.equal(ok[0].name, 'Route');
  // A single LineString wrapped in MultiGeometry is still one part, so it is accepted.
  const wrapped = `<kml><Placemark><MultiGeometry><LineString><coordinates>-99.1,30.1 -99.2,30.1</coordinates></LineString></MultiGeometry></Placemark></kml>`;
  assert.equal((await readRouteFile('w.kml', enc(wrapped))).length, 1);
});

test('KML symbology: yellow pushpin MPs, white triangle fittings', async () => {
  const { toKml } = await import('../src/pi-engine/index');
  const res = computePIs(routeFromBearings([90, 135, 140, 140, 140, 140, 140, 140, 140, 140], 500), DEFAULT_SETTINGS);
  const kml = toKml(res, 'R', { milepostInterval: 1 });
  assert.match(kml, /<Style id="mp"><IconStyle><color>ffffffff<\/color><scale>1<\/scale><Icon><href>http:\/\/maps\.google\.com\/mapfiles\/kml\/pushpin\/ylw-pushpin\.png<\/href><\/Icon><hotSpot/);
  assert.match(kml, /<Style id="fitting"><IconStyle><color>ffffffff<\/color><scale>1<\/scale><Icon><href>http:\/\/maps\.google\.com\/mapfiles\/kml\/shapes\/triangle\.png/);
  assert.match(kml, /<Style id="fieldbend"><IconStyle><color>ff1aa6f2<\/color>.*placemark_circle/);
  assert.match(kml, /<styleUrl>#fitting<\/styleUrl>/);
  assert.match(kml, /<styleUrl>#mp<\/styleUrl>/);
});
