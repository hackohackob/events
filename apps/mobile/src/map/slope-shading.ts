/**
 * Slope shading shared by the race-track lines and the extraction-path preview.
 *
 * The scheme is the one the tracks have always used: climbs darken towards the
 * map background, descents lighten towards white, and flat keeps the base
 * colour. Extracted here so the exit-point path reads with exactly the same
 * visual language instead of inventing a second one.
 */

/** Grade ratio (rise/run) treated as a full-strength climb or descent. */
const FULL_STRENGTH_GRADE = 0.16;

export function mixHexColor(baseHex: string, mixHex: string, ratio: number): string {
  const clampRatio = Math.max(0, Math.min(1, ratio));
  const base = baseHex.replace("#", "");
  const mix = mixHex.replace("#", "");
  const baseInt = Number.parseInt(base, 16);
  const mixInt = Number.parseInt(mix, 16);
  const baseR = (baseInt >> 16) & 0xff;
  const baseG = (baseInt >> 8) & 0xff;
  const baseB = baseInt & 0xff;
  const mixR = (mixInt >> 16) & 0xff;
  const mixG = (mixInt >> 8) & 0xff;
  const mixB = mixInt & 0xff;

  const red = Math.round(baseR + (mixR - baseR) * clampRatio);
  const green = Math.round(baseG + (mixG - baseG) * clampRatio);
  const blue = Math.round(baseB + (mixB - baseB) * clampRatio);
  return `rgb(${red}, ${green}, ${blue})`;
}

/** `normalizedSlope` in [-1, 1]: positive = climbing, negative = descending. */
export function slopeColor(baseColor: string, normalizedSlope: number): string {
  if (normalizedSlope > 0) {
    return mixHexColor(baseColor, "#141d2a", Math.min(0.45, normalizedSlope * 0.45));
  }
  if (normalizedSlope < 0) {
    return mixHexColor(baseColor, "#f1f4f9", Math.min(0.49, Math.abs(normalizedSlope) * 0.49));
  }
  return baseColor;
}

export function normalizedSlopeToGradeRatio(normalizedSlope: number): number {
  return normalizedSlope * FULL_STRENGTH_GRADE;
}

export function gradeRatioToNormalizedSlope(gradeRatio: number): number {
  return Math.max(-1, Math.min(1, gradeRatio / FULL_STRENGTH_GRADE));
}

export interface ShadedSegment {
  /** `[lng, lat]` pairs — MapLibre LineString order. */
  coordinates: Array<[number, number]>;
  color: string;
}

const EARTH_RADIUS_M = 6371000;

function metersBetween(a: [number, number], b: [number, number]): number {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Smooth a per-edge series with a small centred window, to stop SRTM noise
 *  from turning a steady climb into a barcode. */
function smooth(values: number[], window: number): number[] {
  if (values.length <= 2 || window <= 1) return values;
  const half = Math.floor(window / 2);
  return values.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -half; offset <= half; offset += 1) {
      const value = values[index + offset];
      if (value === undefined) continue;
      sum += value;
      count += 1;
    }
    return count > 0 ? sum / count : 0;
  });
}

/**
 * Split a polyline into slope-shaded runs using a per-vertex elevation series.
 *
 * Unlike the track version this works straight off raw elevations (the exit path
 * has no precomputed profile), so it derives the grade per edge, smooths it, and
 * merges neighbouring edges that land in the same shade bucket. Buckets keep the
 * layer count bounded — every distinct colour costs a MapLibre layer.
 */
export function buildElevationGradientSegments(
  geometry: Array<[number, number]>,
  elevations: number[] | undefined,
  baseColor: string,
  opts: { maxSegments?: number } = {},
): ShadedSegment[] {
  const maxSegments = opts.maxSegments ?? 22;
  if (geometry.length < 2) return [];
  if (!elevations || elevations.length !== geometry.length) {
    return [{ coordinates: geometry, color: baseColor }];
  }

  const edgeCount = geometry.length - 1;
  const grades: number[] = [];
  for (let i = 0; i < edgeCount; i += 1) {
    const run = metersBetween(geometry[i], geometry[i + 1]);
    // Sub-metre edges produce absurd grades; treat them as flat.
    grades.push(run > 1 ? (elevations[i + 1] - elevations[i]) / run : 0);
  }

  const smoothed = smooth(grades, 5);
  // Quantise to a handful of shades so consecutive edges coalesce.
  const shadeSteps = Math.max(3, Math.floor(maxSegments / 2));
  const bucketOf = (grade: number) =>
    Math.round(gradeRatioToNormalizedSlope(grade) * shadeSteps) / shadeSteps;

  const segments: ShadedSegment[] = [];
  let start = 0;
  let bucket = bucketOf(smoothed[0] ?? 0);

  for (let i = 1; i < edgeCount; i += 1) {
    const next = bucketOf(smoothed[i] ?? 0);
    if (next === bucket) continue;
    segments.push({ coordinates: geometry.slice(start, i + 1), color: slopeColor(baseColor, bucket) });
    start = i;
    bucket = next;
  }
  segments.push({ coordinates: geometry.slice(start), color: slopeColor(baseColor, bucket) });

  if (segments.length <= maxSegments) return segments;
  // Too fragmented (very noisy elevation): fall back to a flat line rather than
  // spending dozens of layers on visual noise.
  return [{ coordinates: geometry, color: baseColor }];
}
