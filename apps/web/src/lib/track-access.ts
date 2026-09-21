import { TRACK_ACCESS_TIERS, TRACK_ACCESS_TIER_META, type TrackAccessTier } from '@events/contracts'

/**
 * Colours for the access view: what can drive each stretch of course.
 *
 * Two families, which is the shape of the decision itself — can a vehicle with
 * a stretcher in it get there, or is this a job for two wheels and a rucksack:
 *
 *   BLUE  a car-sized vehicle reaches this, lightening as the road gets better
 *   WARM  only something small does, brightening as the going gets harder
 *
 * Within a family the ramp is one hue with a monotone lightness step, so the
 * order reads without the legend; between the families the hues are as far
 * apart as the palette goes, so the one boundary that changes a plan is never
 * in doubt. Both families were validated against the dark map surface for
 * colour-vision separation and contrast; the warm family spans amber to rose
 * rather than one hue on purpose — over satellite imagery a single warm hue in
 * four steps stops being four steps.
 *
 * `none` has no colour at all. A stretch with no mapped way keeps the neutral
 * course line underneath it, which says "we have nothing on this" far better
 * than inventing a shade for it.
 */
export const TRACK_ACCESS_COLORS: Record<TrackAccessTier, string | null> = {
  ambulance: '#93c5fd',
  car: '#3b82f6',
  'offroad-car': '#1d4ed8',
  atv: '#fde68a',
  'e-motorcycle': '#fbbf24',
  bike: '#f97316',
  foot: '#e11d48',
  none: null,
}

/** Legend order: everything gets there → nothing does. */
export const TRACK_ACCESS_LEGEND = TRACK_ACCESS_TIERS.map(tier => ({
  tier,
  color: TRACK_ACCESS_COLORS[tier],
  ...TRACK_ACCESS_TIER_META[tier],
}))
