// WGS84 ellipsoid geodesics (Vincenty inverse). Accurate to well under 1 mm
// for the leg lengths found on pipeline centerlines.

const A = 6378137.0;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const RAD = Math.PI / 180;

export interface InverseResult {
  /** Ellipsoidal distance in meters. */
  s: number;
  /** Forward azimuth at point 1, degrees clockwise from true north [0, 360). */
  azi1: number;
  /** Forward azimuth at point 2 (direction of travel on arrival), degrees [0, 360). */
  azi2: number;
}

const norm360 = (d: number) => ((d % 360) + 360) % 360;

export function inverse(lat1: number, lon1: number, lat2: number, lon2: number): InverseResult {
  if (lat1 === lat2 && lon1 === lon2) return { s: 0, azi1: NaN, azi2: NaN };

  const L = (lon2 - lon1) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * RAD));
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * RAD));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let lambda = L;
  let sinLambda = 0, cosLambda = 0, sinSigma = 0, cosSigma = 0, sigma = 0;
  let cosSqAlpha = 0, cos2SigmaM = 0;
  let converged = false;

  for (let i = 0; i < 200; i++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);
    const t1 = cosU2 * sinLambda;
    const t2 = cosU1 * sinU2 - sinU1 * cosU2 * cosLambda;
    sinSigma = Math.sqrt(t1 * t1 + t2 * t2);
    if (sinSigma === 0) return { s: 0, azi1: NaN, azi2: NaN };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    const prev = lambda;
    lambda =
      L +
      (1 - C) * F * sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-12) {
      converged = true;
      break;
    }
  }

  if (!converged) return sphericalInverse(lat1, lon1, lat2, lon2);

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    bigB * sinSigma *
    (cos2SigmaM +
      (bigB / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (bigB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const s = B * bigA * (sigma - deltaSigma);

  const azi1 = Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) / RAD;
  const azi2 = Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda) / RAD;
  return { s, azi1: norm360(azi1), azi2: norm360(azi2) };
}

/** Fallback for the (practically unreachable) non-converging case. */
function sphericalInverse(lat1: number, lon1: number, lat2: number, lon2: number): InverseResult {
  const R = 6371008.8;
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const s =
    2 * R * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2));
  const azi1 = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD;
  const back = Math.atan2(-Math.sin(dl) * Math.cos(p1), Math.cos(p2) * Math.sin(p1) - Math.sin(p2) * Math.cos(p1) * Math.cos(dl)) / RAD;
  return { s, azi1: norm360(azi1), azi2: norm360(back + 180) };
}

/** Signed difference b − a folded into (−180, 180]. Positive = clockwise (right). */
export function turn(a: number, b: number): number {
  const d = (((b - a + 540) % 360) + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}
