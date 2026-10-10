export type LinearUnit = 'ft' | 'usft' | 'm';

/** Multiply meters by this to get the unit. */
export const PER_METER: Record<LinearUnit, number> = {
  ft: 1 / 0.3048,
  usft: 3937 / 1200,
  m: 1,
};

export const UNIT_LABEL: Record<LinearUnit, string> = {
  ft: 'ft',
  usft: 'US ft',
  m: 'm',
};

/** Degrees → D° MM' SS" with seconds rounded first, so 60" never appears. */
export function dms(deg: number, degSymbol = '°'): string {
  const total = Math.round(Math.abs(deg) * 3600);
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${d}${degSymbol} ${String(m).padStart(2, '0')}' ${String(s).padStart(2, '0')}"`;
}

/**
 * Pipeline station text. Feet: 1+00 per 100 ft (e.g. 204+74.58).
 * Meters: 1+000 per km (e.g. 12+345.67).
 */
export function stationText(value: number, unit: LinearUnit, decimals = 2): string {
  const per = unit === 'm' ? 1000 : 100;
  const width = unit === 'm' ? 3 : 2;
  const scale = 10 ** decimals;
  const sign = value < 0 ? '-' : '';
  const scaled = Math.round(Math.abs(value) * scale);
  const whole = Math.floor(scaled / (per * scale));
  const rem = (scaled - whole * per * scale) / scale;
  const remText = rem.toFixed(decimals).padStart(width + (decimals ? decimals + 1 : 0), '0');
  return `${sign}${whole}+${remText}`;
}

/** Parse "204+74.58" or a plain number. Returns NaN on failure. */
export function parseStation(text: string, unit: LinearUnit): number {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return NaN;
  const m = t.match(/^(-?)(\d+)\+(\d+(?:\.\d+)?)$/);
  if (m) {
    const sign = m[1] ? -1 : 1;
    const per = unit === 'm' ? 1000 : 100;
    return sign * (Number(m[2]) * per + Number(m[3]));
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
