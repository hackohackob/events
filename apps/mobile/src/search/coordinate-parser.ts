/**
 * Coordinate extraction from free text — supports every common way people
 * paste locations:
 *
 *   decimal:   42.6977, 23.3219   ·  N42.6977 E23.3219  ·  -33.9, 18.4
 *   DM:        42°41.861'N 23°19.315'E  ·  N42 41.861 E023 19.315
 *   DMS:       42°41'51.7"N 23°19'18.9"E  ·  42:41:51.7N, 23:19:18.9E
 *   geo/links: geo:42.69,23.32  ·  google maps "@42.6977,23.3219,15z"
 *   UTM:       35T 314980 4730009  ·  34T 0567890 4712345
 *
 * `extractCoordinates` scans arbitrarily long text and returns every distinct
 * coordinate pair found, in document order.
 */

export interface ParsedCoordinate {
  lat: number;
  lng: number;
  /** The matched source snippet (for display/debug). */
  raw: string;
  format: "decimal" | "dm" | "dms" | "utm" | "geo";
}

const DEG = "[°ºd:\\s]";
const MIN = "['′m:\\s]";
const SEC = '["″s]';

// 42°41'51.7"N or N42°41'51.7" — hemisphere letter before or after.
const DMS_RE = new RegExp(
  `([NSEW])?\\s*(\\d{1,3})${DEG}\\s*(\\d{1,2})${MIN}\\s*(\\d{1,2}(?:[.,]\\d+)?)${SEC}?\\s*([NSEW])?`,
  "gi",
);

// 42°41.861'N or N42 41.861 — degrees + decimal minutes.
const DM_RE = new RegExp(
  `([NSEW])?\\s*(\\d{1,3})${DEG}\\s*(\\d{1,2}[.,]\\d+)${MIN}?\\s*([NSEW])?`,
  "gi",
);

// Plain signed decimal degree, optionally wrapped in hemisphere letters.
// 3+ decimals required so prose numbers ("5.2 km at 3.41 pace") don't pair up
// into phantom coordinates when scanning long text.
const DECIMAL_RE = /([NSEW])?\s*([-+]?\d{1,3}\.\d{3,})\s*°?\s*([NSEW])?/gi;

// UTM: zone (1-60) + band letter + easting + northing.
const UTM_RE = /\b(\d{1,2})\s*([C-HJ-NP-X])\s+(\d{6,7})(?:[.,]\d+)?\s+(\d{6,8})(?:[.,]\d+)?\b/gi;

// geo: URIs and map-link "@lat,lng" fragments.
const GEO_URI_RE = /geo:([-+]?\d{1,3}(?:\.\d+)?),\s*([-+]?\d{1,3}(?:\.\d+)?)/gi;
const AT_LINK_RE = /@([-+]?\d{1,3}\.\d+),([-+]?\d{1,3}\.\d+)/g;

interface AxisValue {
  value: number;
  hemisphere?: string;
  index: number;
  length: number;
}

function num(text: string): number {
  return Number(text.replace(",", "."));
}

function applyHemisphere(value: number, hemisphere?: string): { value: number; axis?: "lat" | "lng" } {
  if (!hemisphere) return { value };
  const h = hemisphere.toUpperCase();
  if (h === "S") return { value: -Math.abs(value), axis: "lat" };
  if (h === "N") return { value: Math.abs(value), axis: "lat" };
  if (h === "W") return { value: -Math.abs(value), axis: "lng" };
  return { value: Math.abs(value), axis: "lng" };
}

function inLatRange(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) <= 90;
}
function inLngRange(v: number): boolean {
  return Number.isFinite(v) && Math.abs(v) <= 180;
}

/** Pair up consecutive axis values into lat/lng coordinates. */
function pairAxes(
  values: Array<AxisValue & { axis?: "lat" | "lng" }>,
  text: string,
  format: ParsedCoordinate["format"],
): ParsedCoordinate[] {
  const results: ParsedCoordinate[] = [];
  for (let i = 0; i + 1 < values.length; i += 1) {
    const a = values[i];
    const b = values[i + 1];
    // The two halves of one coordinate are close together in the text.
    if (b.index - (a.index + a.length) > 12) continue;
    let lat: number | undefined;
    let lng: number | undefined;
    if (a.axis === "lat" || b.axis === "lng") {
      lat = a.value;
      lng = b.value;
    } else if (a.axis === "lng" || b.axis === "lat") {
      lng = a.value;
      lat = b.value;
    } else {
      // No hemisphere info: assume lat,lng; swap when the first can't be a latitude.
      lat = a.value;
      lng = b.value;
      if (!inLatRange(lat) && inLatRange(lng)) [lat, lng] = [lng, lat];
    }
    if (lat === undefined || lng === undefined) continue;
    if (!inLatRange(lat) || !inLngRange(lng)) continue;
    // Reject degenerate 0,0-ish accidental matches from prose numbers.
    if (lat === 0 && lng === 0) continue;
    results.push({
      lat,
      lng,
      raw: text.slice(a.index, b.index + b.length).trim(),
      format,
    });
    i += 1; // consume both halves
  }
  return results;
}

function scanAngles(
  text: string,
  re: RegExp,
  toDegrees: (m: RegExpExecArray) => number,
  format: ParsedCoordinate["format"],
): ParsedCoordinate[] {
  const axes: Array<AxisValue & { axis?: "lat" | "lng" }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const hemisphere = m[1] ?? m[m.length - 1];
    const degrees = toDegrees(m);
    if (!Number.isFinite(degrees)) continue;
    const { value, axis } = applyHemisphere(degrees, hemisphere ?? undefined);
    axes.push({ value, axis, index: m.index, length: m[0].length, hemisphere });
  }
  return pairAxes(axes, text, format);
}

/** UTM → WGS84 (sufficient accuracy for search/navigation). */
function utmToLatLng(zone: number, band: string, easting: number, northing: number): { lat: number; lng: number } | null {
  if (zone < 1 || zone > 60) return null;
  const southern = band.toUpperCase() < "N";
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const x = easting - 500000;
  const y = southern ? northing - 10000000 : northing;

  const m = y / k0;
  const mu = m / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);

  const ep2 = e2 / (1 - e2);
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const t1 = Math.tan(phi1) ** 2;
  const n1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2);
  const r1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5;
  const d = x / (n1 * k0);

  const lat =
    phi1 -
    ((n1 * Math.tan(phi1)) / r1) *
      ((d * d) / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lng =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) /
    Math.cos(phi1);

  const latDeg = (lat * 180) / Math.PI;
  const lngDeg = (lng * 180) / Math.PI + (zone - 1) * 6 - 180 + 3;
  if (!inLatRange(latDeg) || !inLngRange(lngDeg)) return null;
  return { lat: latDeg, lng: lngDeg };
}

/** Every coordinate pair found anywhere in `text`, document order, deduped. */
export function extractCoordinates(text: string): ParsedCoordinate[] {
  if (!text || text.trim().length < 3) return [];
  const found: ParsedCoordinate[] = [];

  // geo: URIs / @lat,lng map links first — unambiguous.
  for (const re of [GEO_URI_RE, AT_LINK_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const lat = num(m[1]);
      const lng = num(m[2]);
      if (inLatRange(lat) && inLngRange(lng)) {
        found.push({ lat, lng, raw: m[0], format: "geo" });
      }
    }
  }

  // UTM.
  UTM_RE.lastIndex = 0;
  let um: RegExpExecArray | null;
  while ((um = UTM_RE.exec(text)) !== null) {
    const converted = utmToLatLng(Number(um[1]), um[2], Number(um[3]), Number(um[4]));
    if (converted) found.push({ ...converted, raw: um[0], format: "utm" });
  }

  // DMS → DM → decimal, masking matched spans so a DMS pair isn't re-read as
  // loose decimals.
  let working = text;
  const mask = (results: ParsedCoordinate[]) => {
    for (const r of results) {
      working = working.replace(r.raw, " ".repeat(r.raw.length));
    }
  };

  const dms = scanAngles(
    working,
    DMS_RE,
    (m) => num(m[2]) + num(m[3]) / 60 + num(m[4]) / 3600,
    "dms",
  );
  mask(dms);
  found.push(...dms);

  const dm = scanAngles(working, DM_RE, (m) => num(m[2]) + num(m[3]) / 60, "dm");
  mask(dm);
  found.push(...dm);

  const decimal = scanAngles(working, DECIMAL_RE, (m) => num(m[2]), "decimal");
  found.push(...decimal);

  // Dedupe near-identical results (same point matched by multiple passes).
  const unique: ParsedCoordinate[] = [];
  for (const c of found) {
    const dupe = unique.some(
      (u) => Math.abs(u.lat - c.lat) < 0.0004 && Math.abs(u.lng - c.lng) < 0.0004,
    );
    if (!dupe) unique.push(c);
  }
  return unique.slice(0, 20);
}

/** Pretty "42.69770, 23.32190" for display. */
export function formatCoordinate(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
