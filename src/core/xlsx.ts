// Minimal multi-sheet XLSX writer and reader, no dependencies (uses the PI engine's zip).

import { readZip, writeZip } from '../pi-engine';

export type Cell = string | number | boolean | null | undefined;

export interface SheetSpec {
  name: string;
  header: string[];
  rows: Cell[][];
  widths?: number[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i: number): string {
  let s = '';
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetXml(s: SheetSpec): string {
  const row = (cells: Cell[], r: number, bold = false) =>
    `<row r="${r}">` +
    cells
      .map((v, c) => {
        const ref = `${colName(c)}${r}`;
        const st = bold ? ' s="1"' : '';
        if (v === null || v === undefined || v === '') return `<c r="${ref}"${st}/>`;
        if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}"${st}/>`;
        if (typeof v === 'boolean') return `<c r="${ref}" t="inlineStr"${st}><is><t>${v ? 'Y' : 'N'}</t></is></c>`;
        return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
      })
      .join('') +
    '</row>';
  const widths = s.widths ?? s.header.map((h) => Math.max(10, h.length + 2));
  const last = `${colName(Math.max(0, s.header.length - 1))}${s.rows.length + 1}`;
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    '<sheetData>' +
    row(s.header, 1, true) +
    s.rows.map((r, i) => row(r, i + 2)).join('') +
    '</sheetData>' +
    (s.rows.length ? `<autoFilter ref="A1:${last}"/>` : '') +
    '</worksheet>'
  );
}

export function writeXlsx(sheets: SheetSpec[]): Uint8Array {
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
        sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
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
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return writeZip(files);
}

const unxml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');

const textOf = (frag: string) => [...frag.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unxml(m[1])).join('');

/**
 * Read one sheet as a grid of strings. Picks the sheet named `prefer` if present, else the first.
 * Handles shared strings (what Excel writes on save) and inline strings (what we write).
 */
export async function readXlsxSheet(data: ArrayBuffer | Uint8Array, prefer?: string): Promise<{ sheet: string; rows: string[][] }> {
  const entries = await readZip(data);
  const get = (name: string) => {
    const e = entries.find((x) => x.name.replace(/^\//, '').toLowerCase() === name.toLowerCase());
    return e ? new TextDecoder().decode(e.data) : null;
  };
  const wb = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  if (!wb || !rels) throw new Error('This is not an Excel workbook (.xlsx).');
  const sheets = [...wb.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)].map((m) => ({
    name: unxml(m[0].match(/name="([^"]*)"/)?.[1] ?? ''),
    rid: m[0].match(/r:id="([^"]*)"/)?.[1] ?? m[0].match(/\bid="([^"]*)"/)?.[1] ?? '',
  }));
  if (!sheets.length) throw new Error('The workbook has no sheets.');
  const pick = sheets.find((s) => prefer && s.name.toLowerCase() === prefer.toLowerCase()) ?? sheets[0];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${pick.rid}"`));
  let target = rel?.match(/Target="([^"]*)"/)?.[1] ?? 'worksheets/sheet1.xml';
  target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const sheetXmlText = get(target);
  if (!sheetXmlText) throw new Error(`Could not read sheet "${pick.name}".`);

  const sstXml = get('xl/sharedStrings.xml');
  const sst = sstXml ? [...sstXml.matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1])) : [];

  const rows: string[][] = [];
  for (const rm of sheetXmlText.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/g)) {
    const rNum = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1);
    const row: string[] = [];
    for (const cm of rm[2].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const ci = ref ? colIndex(ref) : row.length;
      const t = attrs.match(/\bt="([^"]*)"/)?.[1];
      const v = body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
      let val = '';
      if (t === 's') val = sst[Number(v)] ?? '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else val = v !== undefined ? unxml(v) : '';
      row[ci] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows[rNum - 1] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return { sheet: pick.name, rows };
}
