// Export formats: CSV, XLSX, KML and GeoJSON.

import { milepostDecimals, milepostPrefix, milepostMarkers, type PiResult, type PiRow } from './pi';
import { writeZip } from './zip';

type Cell = string | number | null;

/** Station/leg unit, then milepost unit (kilopost in metric). */
export const UNITS_CODE: Record<string, string> = { ft: 'FT/MI', usft: 'USFT/MI', m: 'M/KM' };

/** Export columns, in order. Same layout for CSV, Excel, GeoJSON and KMZ popups. */
export function tableColumns(result: PiResult): { key: string; header: string; get: (r: PiRow) => Cell }[] {
  const units = UNITS_CODE[result.settings.units];
  const mpHeader = milepostPrefix(result.settings.units) === 'KP' ? 'KILOPOST' : 'MILEPOST';
  const rd = (x: number | null, d: number) => (x === null ? null : Number(x.toFixed(d)));
  const abs = (x: number | null, d: number) => (x === null ? null : Number(Math.abs(x).toFixed(d)));
  return [
    { key: 'order', header: 'ORDER', get: (r) => r.index + 1 },
    { key: 'type', header: 'POINT_TYPE', get: (r) => r.kind },
    { key: 'pi', header: 'PI_NO', get: (r) => r.piNumber },
    { key: 'units', header: 'UNITS', get: () => units },
    { key: 'station', header: 'STATION', get: (r) => rd(r.station, 2) },
    { key: 'mp', header: mpHeader, get: (r) => rd(r.milepost, 3) },
    { key: 'legAhead', header: 'LEG_AHEAD', get: (r) => rd(r.legAhead, 2) },
    { key: 'azIn', header: 'AZIMUTH_IN', get: (r) => rd(r.azimuthIn, 4) },
    { key: 'azOut', header: 'AZIMUTH_OUT', get: (r) => rd(r.azimuthOut, 4) },
    { key: 'hDd', header: 'H_PI_DD', get: (r) => abs(r.hDeflection, 4) },
    { key: 'hDms', header: 'H_PI_DMS', get: (r) => r.hDms },
    { key: 'hDir', header: 'H_DIRECTION', get: (r) => r.hDirection },
    { key: 'fittingNo', header: 'FITTING_NO', get: (r) => r.bendNumber },
    { key: 'bendType', header: 'BEND_TYPE', get: (r) => r.bendClass ?? '' },
    { key: 'label', header: 'LABEL', get: (r) => r.label },
    { key: 'desc', header: 'DESCRIPTION', get: (r) => r.fullLabel },
    { key: 'lat', header: 'LATITUDE', get: (r) => rd(r.lat, 8) },
    { key: 'lon', header: 'LONGITUDE', get: (r) => rd(r.lon, 8) },
  ];
}

const csvCell = (v: Cell) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(result: PiResult, rows: PiRow[] = result.rows): string {
  const cols = tableColumns(result);
  const lines = [cols.map((c) => c.header).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(c.get(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function sheetXml(header: string[], body: Cell[][], widths: number[]): string {
  const rowXml = (cells: Cell[], r: number, bold = false) =>
    `<row r="${r}">` +
    cells
      .map((v, c) => {
        const ref = `${colName(c)}${r}`;
        const st = bold ? ' s="1"' : '';
        if (v === null || v === '') return `<c r="${ref}"${st}/>`;
        if (typeof v === 'number') return `<c r="${ref}"${st}><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
      })
      .join('') +
    '</row>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    '<sheetData>' +
    rowXml(header, 1, true) +
    body.map((r, i) => rowXml(r, i + 2)).join('') +
    '</sheetData>' +
    `<autoFilter ref="A1:${colName(header.length - 1)}${body.length + 1}"/>` +
    '</worksheet>'
  );
}

/** One-sheet workbook with every point (BEGIN, PIs, END). */
export function toXlsx(result: PiResult): Uint8Array {
  const cols = tableColumns(result);
  const header = cols.map((c) => c.header);
  const widths = cols.map((c) => (c.key === 'desc' ? 48 : c.key === 'label' ? 28 : Math.max(10, c.header.length + 2)));
  const all = result.rows.map((r) => cols.map((c) => c.get(r)));
  const sheets = [{ name: 'PI Table', xml: sheetXml(header, all, widths) }];
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'xl/styles.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml })),
  ];
  return writeZip(files);
}

// Standard Google-hosted KML icons (shown by Google Earth and most GIS). Colors are aabbggrr and tint the icon.
const ICON = {
  circle: 'http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png',
  triangle: 'http://maps.google.com/mapfiles/kml/shapes/triangle.png',
  pushpin: 'http://maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png',
};

interface KmlStyle {
  icon: string;
  color: string;
  scale: number;
  labelScale: number;
  labelColor?: string;
  /** Pushpins anchor at the pin tip rather than the icon center. */
  hotSpot?: string;
}

const KML_STYLE: Record<string, KmlStyle> = {
  fitting: { icon: ICON.triangle, color: 'ffffffff', scale: 1.0, labelScale: 0.8, labelColor: 'ffffffff' },
  fieldbend: { icon: ICON.circle, color: 'ff1aa6f2', scale: 0.85, labelScale: 0.7 },
  free: { icon: ICON.circle, color: 'ffb4b4b4', scale: 0.55, labelScale: 0.6 },
  mp: {
    icon: ICON.pushpin, color: 'ffffffff', scale: 1.0, labelScale: 0.8, labelColor: 'ff00ffff',
    hotSpot: '<hotSpot x="20" y="2" xunits="pixels" yunits="pixels"/>',
  },
  end: { icon: ICON.circle, color: 'ff50b400', scale: 1.0, labelScale: 0.9 },
};

function styleXml(id: string, st: KmlStyle): string {
  return (
    `<Style id="${id}"><IconStyle><color>${st.color}</color><scale>${st.scale}</scale>` +
    `<Icon><href>${st.icon}</href></Icon>${st.hotSpot ?? ''}</IconStyle>` +
    `<LabelStyle>${st.labelColor ? `<color>${st.labelColor}</color>` : ''}<scale>${st.labelScale}</scale></LabelStyle></Style>`
  );
}

function descriptionTable(r: PiRow, result: PiResult): string {
  const rows = tableColumns(result)
    .map((c) => [c.header, c.get(r)] as const)
    .filter(([, v]) => v !== null && v !== '');
  return (
    '<![CDATA[<table style="font-family:Arial;font-size:12px">' +
    rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${html(String(v))}</td></tr>`).join('') +
    '</table>]]>'
  );
}

/** Escape text placed inside the popup's HTML table (labels contain "<"). */
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/]]>/g, ']] >');

export interface KmlExportOptions {
  milepostInterval: number;
}

export function toKml(result: PiResult, routeName: string, opts: KmlExportOptions, description?: string | null): string {
  const mpx = milepostPrefix(result.settings.units);
  const coords = result.rows.map((r) => `${r.lon.toFixed(9)},${r.lat.toFixed(9)},0`).join(' ');
  const pt = (r: PiRow, name: string, style: string, visible = true) =>
    `<Placemark><name>${xml(name)}</name><visibility>${visible ? 1 : 0}</visibility><styleUrl>#${style}</styleUrl>` +
    `<description>${descriptionTable(r, result)}</description>` +
    `<Point><altitudeMode>clampToGround</altitudeMode><coordinates>${r.lon.toFixed(9)},${r.lat.toFixed(9)},0</coordinates></Point></Placemark>`;

  // Placemark name = the LABEL column, e.g. P.I. < 30° 21' 07" RT. (no PI number)
  const shortName = (r: PiRow) => r.label;

  const fittings = result.rows.filter((r) => r.kind === 'PI' && r.bendClass === 'FITTING');
  const fieldBends = result.rows.filter((r) => r.kind === 'PI' && r.bendClass === 'FIELD BEND');
  const free = result.rows.filter((r) => r.kind === 'PI' && r.bendClass === 'FREE STRESS');
  const ends = result.rows.filter((r) => r.kind === 'BEGIN' || r.kind === 'END');
  const mps = milepostMarkers(result, opts.milepostInterval);
  const dec = milepostDecimals(opts.milepostInterval);

  const folder = (name: string, body: string, open = false) =>
    `<Folder><name>${xml(name)}</name><open>${open ? 1 : 0}</open>${body}</Folder>`;

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
    `<name>${xml(routeName)} PIs</name><open>1</open>` +
    (description ? `<description>${xml(description)}</description>` : '') +
    Object.entries(KML_STYLE).map(([id, st]) => styleXml(id, st)).join('') +
    '<Style id="route"><LineStyle><color>ff0000ff</color><width>3</width></LineStyle></Style>' +
    `<Placemark><name>${xml(routeName)}</name>${description ? `<description>${xml(description)}</description>` : ''}<styleUrl>#route</styleUrl><LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${coords}</coordinates></LineString></Placemark>` +
    folder('Begin / End', ends.map((r) => pt(r, `${r.kind} ${r.stationText}`, 'end')).join('')) +
    folder(`Fittings (${fittings.length})`, fittings.map((r) => pt(r, shortName(r), 'fitting')).join('')) +
    folder(`Field bends (${fieldBends.length})`, fieldBends.map((r) => pt(r, shortName(r), 'fieldbend')).join('')) +
    (free.length ? folder(`Free stress (${free.length})`, free.map((r) => pt(r, shortName(r), 'free')).join('')) : '') +
    (mps.length
      ? folder(
          `${mpx === 'KP' ? 'Kiloposts' : 'Mileposts'} (${mps.length})`,
          mps
            .map(
              (m) =>
                `<Placemark><name>${mpx} ${m.mp.toFixed(dec)}</name><styleUrl>#mp</styleUrl>` +
                `<Point><altitudeMode>clampToGround</altitudeMode><coordinates>${m.lon.toFixed(9)},${m.lat.toFixed(9)},0</coordinates></Point></Placemark>`,
            )
            .join(''),
        )
      : '') +
    '</Document></kml>\n'
  );
}

export function toGeoJson(result: PiResult, routeName: string, milepostInterval: number, description?: string | null): string {
  const cols = tableColumns(result);
  const features: object[] = [
    {
      type: 'Feature',
      properties: { NAME: routeName, DESCRIPTION: description ?? '', LENGTH: Number(result.length.toFixed(2)), UNITS: result.settings.units },
      geometry: { type: 'LineString', coordinates: result.rows.map((r) => [r.lon, r.lat]) },
    },
    ...result.rows.map((r) => ({
      type: 'Feature',
      properties: Object.fromEntries(cols.map((c) => [c.header, c.get(r)])),
      geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
    })),
    ...milepostMarkers(result, milepostInterval).map((m) => ({
      type: 'Feature',
      properties: { POINT_TYPE: 'MILEPOST', UNITS: UNITS_CODE[result.settings.units], STATION: Number(m.station.toFixed(2)), MILEPOST: m.mp },
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
    })),
  ];
  return JSON.stringify({ type: 'FeatureCollection', name: routeName, features }, null, 1);
}

export function milepostCsv(result: PiResult, interval: number): string {
  const mpx = milepostPrefix(result.settings.units);
  const lines = [`${mpx === 'KP' ? 'KILOPOST' : 'MILEPOST'},UNITS,STATION,LATITUDE,LONGITUDE`];
  const dec = milepostDecimals(interval);
  for (const m of milepostMarkers(result, interval)) {
    lines.push(`${m.mp.toFixed(dec)},${UNITS_CODE[result.settings.units]},${m.station.toFixed(2)},${m.lat.toFixed(8)},${m.lon.toFixed(8)}`);
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
