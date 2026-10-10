// KML / KMZ reader. Finds the Placemarks that contain line geometry; the upload
// must contain exactly one single-part line (see validateSingleLine).

import { inverse } from './geodesic';
import { readZip } from './zip';

export interface Vertex {
  lat: number;
  lon: number;
}

export interface RouteInput {
  id: string;
  /** The Placemark's <name>, or null when the file has none. Attributes are not read. */
  name: string | null;
  /** The Placemark's <description> as plain text (HTML stripped), or null. */
  description: string | null;
  vertices: Vertex[];
  partCount: number;
  warnings: string[];
}

const M_TO_FT = 1 / 0.3048;

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .trim();

/** KML descriptions may contain HTML; keep the readable text. */
function htmlToText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const tag = (name: string) => `(?:[\\w-]+:)?${name}`;

function firstTag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${tag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag(name)}>`));
  return m ? decodeXml(m[1]) : null;
}

function allTags(xml: string, name: string): string[] {
  const re = new RegExp(`<${tag(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag(name)}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

function parseCoordinates(text: string): Vertex[] {
  const out: Vertex[] = [];
  // Some tools write "lon, lat, alt" with spaces after the commas; close those up first.
  for (const tuple of text.trim().replace(/\s*,\s*/g, ',').split(/\s+/)) {
    if (!tuple) continue;
    const [lon, lat] = tuple.split(',').map(Number);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push({ lon, lat });
  }
  return out;
}

const dist = (a: Vertex, b: Vertex) => inverse(a.lat, a.lon, b.lat, b.lon).s;
const fmtFt = (m: number) => `${(m * M_TO_FT).toLocaleString('en-US', { maximumFractionDigits: 1 })} ft`;

/** Join line parts end-to-start, reversing parts where that closes the gap. */
export function joinParts(parts: Vertex[][], tolMeters = 0.5): { vertices: Vertex[]; warnings: string[] } {
  const warnings: string[] = [];
  const clean = parts.filter((p) => p.length >= 2);
  if (clean.length === 0) return { vertices: [], warnings };
  let line = [...clean[0]];
  for (let k = 1; k < clean.length; k++) {
    let next = [...clean[k]];
    const endCur = line[line.length - 1];
    const options: { d: number; revCur: boolean; revNext: boolean }[] = [
      { d: dist(endCur, next[0]), revCur: false, revNext: false },
      { d: dist(endCur, next[next.length - 1]), revCur: false, revNext: true },
    ];
    if (k === 1) {
      options.push(
        { d: dist(line[0], next[0]), revCur: true, revNext: false },
        { d: dist(line[0], next[next.length - 1]), revCur: true, revNext: true },
      );
    }
    options.sort((a, b) => a.d - b.d);
    const best = options[0];
    if (best.revCur) {
      line.reverse();
      warnings.push('Part 1 was reversed so the line parts connect end to end.');
    }
    if (best.revNext) {
      next.reverse();
      warnings.push(`Part ${k + 1} was reversed so it connects to part ${k}.`);
    }
    if (best.d <= tolMeters) {
      next = next.slice(1); // shared junction vertex
    } else {
      warnings.push(
        `Gap of ${fmtFt(best.d)} between line parts ${k} and ${k + 1}. They were joined with a straight leg; check the drawing.`,
      );
    }
    line = line.concat(next);
  }
  return { vertices: line, warnings };
}

function dropDuplicates(v: Vertex[], warnings: string[]): Vertex[] {
  const out: Vertex[] = [];
  let dropped = 0;
  for (const p of v) {
    const last = out[out.length - 1];
    if (last && dist(last, p) < 0.003) { dropped++; continue; }
    out.push(p);
  }
  if (dropped) warnings.push(`${dropped} duplicate vertex${dropped > 1 ? 'es were' : ' was'} removed.`);
  return out;
}

export function parseKml(text: string): RouteInput[] {
  const routes: RouteInput[] = [];
  const placemarks = allTags(text, 'Placemark');
  placemarks.forEach((pm, i) => {
    const lineBlocks = allTags(pm, 'LineString');
    if (lineBlocks.length === 0) return;
    const parts = lineBlocks.map((ls) => parseCoordinates(firstTag(ls, 'coordinates') ?? ''));
    const { vertices: joined, warnings } = joinParts(parts);
    const vertices = dropDuplicates(joined, warnings);
    if (vertices.length < 2) return;
    const name = firstTag(pm, 'name') || null;
    const description = htmlToText(firstTag(pm, 'description') ?? '') || null;
    if (lineBlocks.length > 1) warnings.unshift(`${lineBlocks.length} line parts were joined into one centerline.`);
    routes.push({
      id: `pm${i}`,
      name,
      description,
      vertices,
      partCount: lineBlocks.length,
      warnings,
    });
  });
  return routes;
}

/** Accepts .kml text or .kmz bytes. */
export async function readRouteFile(fileName: string, data: ArrayBuffer): Promise<RouteInput[]> {
  const bytes = new Uint8Array(data);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let text: string;
  if (isZip) {
    const entries = await readZip(bytes);
    const kml = entries.find((e) => /(^|\/)doc\.kml$/i.test(e.name)) ?? entries.find((e) => /\.kml$/i.test(e.name));
    if (!kml) throw new Error(`${fileName} does not contain a .kml file.`);
    text = new TextDecoder().decode(kml.data);
  } else {
    text = new TextDecoder().decode(bytes);
  }
  if (!/<kml[\s>]/i.test(text) && !/<Placemark/i.test(text)) {
    throw new Error(`${fileName} is not a KML file. Upload the route line as a KML or KMZ file.`);
  }
  const routes = parseKml(text);
  validateSingleLine(fileName, routes);
  return routes;
}

/**
 * The tool works on exactly one continuous route line per file. Points, polygons and
 * other non-line features are ignored; more than one line, or a multi-part line, is an error.
 */
export function validateSingleLine(fileName: string, routes: RouteInput[]): void {
  if (routes.length === 0) {
    throw new Error(`No route line was found in ${fileName}. Export a file that contains the route as a line (not points or a polygon).`);
  }
  if (routes.length > 1) {
    throw new Error(
      `${fileName} contains ${routes.length} lines. Upload one route line per file: export just the one route line (select that feature only), or split the file.`,
    );
  }
  const r = routes[0];
  if (r.partCount > 1) {
    throw new Error(
      `The line in ${fileName} is made of ${r.partCount} separate pieces (multi-part geometry). Upload a single continuous line: merge the pieces into a single-part line (Dissolve / Merge / Multipart to Singlepart in your GIS) or redraw it as one path, then export again.`,
    );
  }
}
