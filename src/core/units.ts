import { PER_METER, stationText, type LinearUnit } from '../pi-engine';

export { stationText };

export const UNIT_OPTIONS: { value: LinearUnit; label: string }[] = [
  { value: 'ft', label: 'Feet / miles' },
  { value: 'usft', label: 'US survey feet / miles' },
  { value: 'm', label: 'Meters / kilometers' },
];

/** Quantity unit codes written into exports. */
export const LEN_CODE: Record<LinearUnit, string> = { ft: 'FT', usft: 'USFT', m: 'M' };
export const LEN_SHORT: Record<LinearUnit, string> = { ft: 'ft', usft: 'US ft', m: 'm' };
export const LONG_CODE = (u: LinearUnit) => (u === 'm' ? 'KM' : 'MI');
export const LONG_SHORT = (u: LinearUnit) => (u === 'm' ? 'km' : 'mi');
export const PER_LONG = (u: LinearUnit) => (u === 'm' ? 1000 : 5280);
export const MP_PREFIX = (u: LinearUnit) => (u === 'm' ? 'KP' : 'MP');
export const AREA_CODE = (u: LinearUnit) => (u === 'm' ? 'HA' : 'AC');
export const M2_PER_AREA = (u: LinearUnit) => (u === 'm' ? 10000 : 4046.8564224);
export const SMALL_AREA_CODE = (u: LinearUnit) => (u === 'm' ? 'M2' : 'SF');

export const lenFromM = (m: number, u: LinearUnit) => m * PER_METER[u];
export const areaFromM2 = (m2: number, u: LinearUnit) => m2 / M2_PER_AREA(u);
export const smallAreaFromM2 = (m2: number, u: LinearUnit) => (u === 'm' ? m2 : m2 / (0.3048 * 0.3048));
export const offsetLimit = (limitFt: number, u: LinearUnit) => limitFt * 0.3048 * PER_METER[u];

const nf = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const NF = [nf(0), nf(1), nf(2), nf(3)];
export const fmt = (x: number, d = 0) => NF[d].format(x);

/** "12,345 ft (2.34 mi)" style text for a length in portfolio units. */
export function lengthText(len: number, u: LinearUnit): string {
  return `${fmt(len)} ${LEN_SHORT[u]} · ${fmt(len / PER_LONG(u), 2)} ${LONG_SHORT(u)}`;
}

export const sta = (x: number, u: LinearUnit) => stationText(x, u, u === 'm' ? 1 : 0);
export const staExact = (x: number, u: LinearUnit) => stationText(x, u, 2);
