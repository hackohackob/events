import { BadGatewayException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { DbService } from "../infra/db.service";
import { EventsService } from "../events/events.service";

/**
 * Place search: online geocoding (Photon/Komoot proxy — towns, villages,
 * rivers, localities/местности, peaks, …) plus a per-event offline pack of
 * every named place within 10 km of the event's tracks (built once via
 * Overpass and cached in Postgres; clients download and store it for offline
 * + prioritised autocomplete).
 */

export type PlaceCategory =
  | "settlement"
  | "locality"
  | "area"
  | "street"
  | "peak"
  | "pass"
  | "river"
  | "lake"
  | "spring"
  | "waterfall"
  | "cave"
  | "hut"
  | "viewpoint"
  | "other";

export interface PlaceResult {
  id: string;
  name: string;
  category: PlaceCategory;
  lat: number;
  lng: number;
  /** Region / municipality context when the geocoder provides it. */
  region?: string;
  /** Raw OSM value (village, peak, river…) for finer labels. */
  osmValue?: string;
}

const PHOTON_URL = process.env.PHOTON_URL ?? "https://photon.komoot.io";
const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

/**
 * Node's `fetch` sends no User-Agent at all, and overpass-api.de answers a
 * header-less request with `406 Not Acceptable` (an HTML error page, not JSON) —
 * which surfaced to the app as a 502 on every offline place pack. The OSM usage
 * policy wants an identifying agent on these calls anyway.
 */
const OSM_USER_AGENT = "extreme-medics-events/1.0 (+https://events.academyfirstaid.com)";

/**
 * Search is scoped to Bulgaria: the geocoder gets this as a hard bbox and the
 * results are re-checked on our side (country code + bbox), because a bbox is
 * only a bias on some Photon builds. `[minLon, minLat, maxLon, maxLat]`.
 */
const BG_BBOX = { minLng: 22.33, minLat: 41.22, maxLng: 28.62, maxLat: 44.23 };
const BG_COUNTRY_CODES = new Set(["bg"]);

function insideBulgaria(lat: number, lng: number): boolean {
  return lat >= BG_BBOX.minLat && lat <= BG_BBOX.maxLat && lng >= BG_BBOX.minLng && lng <= BG_BBOX.maxLng;
}

/** Offline pack radius around the tracks (NOT around the viewer). */
const PACK_RADIUS_M = 10_000;
/** Regenerate a cached pack after this long. */
const PACK_TTL_MS = 7 * 24 * 3600_000;
/** Track polyline sample spacing for the Overpass corridor. */
const SAMPLE_SPACING_M = 1_500;
/** Hard cap on corridor points per track (Overpass query size). */
const MAX_POINTS_PER_TRACK = 60;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Map OSM tags to our display category. */
function categorize(tags: Record<string, string>): PlaceCategory {
  const place = tags.place;
  if (place) {
    if (place === "locality") return "locality";
    return "settlement";
  }
  if (tags.natural === "peak" || tags.natural === "saddle") return "peak";
  if (tags.mountain_pass === "yes") return "pass";
  if (tags.waterway) return "river";
  if (tags.natural === "water" || tags.water) return "lake";
  if (tags.natural === "spring" || tags.natural === "hot_spring") return "spring";
  if (tags.waterway === "waterfall" || tags.natural === "waterfall") return "waterfall";
  if (tags.natural === "cave_entrance") return "cave";
  if (tags.tourism === "alpine_hut" || tags.tourism === "wilderness_hut") return "hut";
  if (tags.tourism === "viewpoint") return "viewpoint";
  return "other";
}

/** Settlement-ish `place` values; the rest of `place` is an area or a locality. */
const SETTLEMENT_PLACES = new Set([
  "city", "town", "village", "hamlet", "suburb", "quarter", "neighbourhood", "borough", "isolated_dwelling",
]);
const AREA_PLACES = new Set(["region", "state", "county", "municipality", "province", "district", "island"]);
/** Natural features that describe an area rather than a point (местности). */
const AREA_NATURAL = new Set([
  "wood", "forest", "scrub", "heath", "grassland", "ridge", "valley", "massif", "mountain_range", "bay", "plateau",
]);

/** Photon osm_key/osm_value → our category. */
function categorizePhoton(osmKey?: string, osmValue?: string): PlaceCategory {
  if (osmKey === "place") {
    if (osmValue && SETTLEMENT_PLACES.has(osmValue)) return "settlement";
    if (osmValue && AREA_PLACES.has(osmValue)) return "area";
    return "locality";
  }
  if (osmKey === "natural") {
    if (osmValue === "peak" || osmValue === "saddle") return "peak";
    if (osmValue === "water" || osmValue === "lake") return "lake";
    if (osmValue === "spring" || osmValue === "hot_spring") return "spring";
    if (osmValue === "cave_entrance") return "cave";
    if (osmValue === "waterfall") return "waterfall";
    if (osmValue && AREA_NATURAL.has(osmValue)) return "area";
    return "area";
  }
  if (osmKey === "waterway") return osmValue === "waterfall" ? "waterfall" : "river";
  if (osmKey === "mountain_pass") return "pass";
  if (osmKey === "landuse" || osmKey === "boundary" || osmKey === "leisure") return "area";
  if (osmKey === "highway") return "street";
  if (osmKey === "tourism") {
    if (osmValue === "alpine_hut" || osmValue === "wilderness_hut" || osmValue === "chalet") return "hut";
    if (osmValue === "viewpoint") return "viewpoint";
  }
  return "other";
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

@Injectable()
export class PlacesService implements OnModuleInit {
  private readonly logger = new Logger(PlacesService.name);

  constructor(
    private readonly db: DbService,
    private readonly eventsService: EventsService,
  ) {}

  async onModuleInit() {
    await this.db
      .query(
        `CREATE TABLE IF NOT EXISTS event_places (
           event_id     TEXT PRIMARY KEY,
           places       JSONB NOT NULL,
           generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      )
      .catch((err) => this.logger.warn(`event_places create skipped: ${String(err)}`));
  }

  // ─── Online geocoding (Photon proxy) ───────────────────────────────────────

  /** Free-text place search inside Bulgaria, biased to the event area when lat/lng given. */
  async searchOnline(query: string, lat?: number, lng?: number): Promise<PlaceResult[]> {
    const params = new URLSearchParams({ q: query, limit: "15", lang: "default" });
    params.set("bbox", `${BG_BBOX.minLng},${BG_BBOX.minLat},${BG_BBOX.maxLng},${BG_BBOX.maxLat}`);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      params.set("lat", String(lat));
      params.set("lon", String(lng));
    }
    let response: Response;
    try {
      response = await fetch(`${PHOTON_URL}/api/?${params.toString()}`, {
        headers: { "user-agent": OSM_USER_AGENT },
      });
    } catch (err) {
      this.logger.warn(`photon unreachable: ${String(err)}`);
      throw new BadGatewayException("Place search is unavailable.");
    }
    if (!response.ok) {
      throw new BadGatewayException(`Place search failed (${response.status}).`);
    }
    const parsed = (await response.json()) as {
      features?: Array<{
        geometry?: { coordinates?: [number, number] };
        properties?: Record<string, unknown>;
      }>;
    };
    const results: PlaceResult[] = [];
    for (const feature of parsed.features ?? []) {
      const coords = feature.geometry?.coordinates;
      const props = feature.properties ?? {};
      const name = typeof props.name === "string" ? props.name : undefined;
      if (!coords || !name) continue;
      // Bulgaria only — bbox is advisory on some Photon builds, so re-check.
      const countryCode = typeof props.countrycode === "string" ? props.countrycode.toLowerCase() : undefined;
      if (countryCode && !BG_COUNTRY_CODES.has(countryCode)) continue;
      if (!insideBulgaria(coords[1], coords[0])) continue;
      const osmKey = typeof props.osm_key === "string" ? props.osm_key : undefined;
      const osmValue = typeof props.osm_value === "string" ? props.osm_value : undefined;
      const region = [props.county, props.state]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .join(", ");
      results.push({
        id: `photon-${String(props.osm_type ?? "")}${String(props.osm_id ?? results.length)}`,
        name,
        category: categorizePhoton(osmKey, osmValue),
        lat: coords[1],
        lng: coords[0],
        region: region || undefined,
        osmValue,
      });
    }
    // Over-fetched (limit 15) so the Bulgaria filter still leaves a full list.
    return results.slice(0, 10);
  }

  // ─── Offline event pack (Overpass, cached) ─────────────────────────────────

  /** The offline place pack for an event — built on first request, then cached. */
  async eventPlaces(eventId: string): Promise<{ generatedAt: string; places: PlaceResult[] }> {
    const { rows } = await this.db.query<{ places: PlaceResult[]; generated_at: string }>(
      `SELECT places, generated_at FROM event_places WHERE event_id = $1`,
      [eventId],
    );
    const cached = rows[0];
    if (cached && Date.now() - new Date(cached.generated_at).getTime() < PACK_TTL_MS) {
      return { generatedAt: cached.generated_at, places: cached.places };
    }

    try {
      const places = await this.buildEventPack(eventId);
      const now = new Date().toISOString();
      await this.db.query(
        `INSERT INTO event_places (event_id, places, generated_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO UPDATE SET places = EXCLUDED.places, generated_at = EXCLUDED.generated_at`,
        [eventId, JSON.stringify(places), now],
      );
      return { generatedAt: now, places };
    } catch (err) {
      // Stale cache beats an error — the pack is a convenience layer.
      if (cached) {
        this.logger.warn(`event places refresh failed, serving stale: ${String(err)}`);
        return { generatedAt: cached.generated_at, places: cached.places };
      }
      throw err;
    }
  }

  private async buildEventPack(eventId: string): Promise<PlaceResult[]> {
    const tracks = await this.eventsService.listTracksForEvent(eventId);
    const corridors = tracks
      .map((t) => samplePolyline(t.points, SAMPLE_SPACING_M, MAX_POINTS_PER_TRACK))
      .filter((line) => line.length >= 2);
    if (corridors.length === 0) return [];

    const query = buildOverpassQuery(corridors, PACK_RADIUS_M);
    let response: Response;
    try {
      response = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": OSM_USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
      });
    } catch (err) {
      throw new BadGatewayException(`Overpass unreachable: ${String(err)}`);
    }
    if (!response.ok) {
      // Overpass reports query and quota problems in the body, not the status —
      // carry a slice of it so the next failure is diagnosable from the log.
      const detail = await response.text().catch(() => "");
      this.logger.warn(`overpass ${response.status}: ${detail.slice(0, 300).replace(/\s+/g, " ")}`);
      throw new BadGatewayException(`Overpass error ${response.status}`);
    }
    const parsed = (await response.json()) as { elements?: OverpassElement[] };

    const places: PlaceResult[] = [];
    for (const el of parsed.elements ?? []) {
      const tags = el.tags ?? {};
      const name = tags.name || tags["name:bg"] || tags["name:en"];
      if (!name) continue;
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (lat === undefined || lng === undefined) continue;
      places.push({
        id: `osm-${el.type}-${el.id}`,
        name,
        category: categorize(tags),
        lat,
        lng,
        osmValue: tags.place ?? tags.natural ?? tags.waterway ?? tags.tourism,
      });
    }

    // Dedupe: same name + category within ~500 m (e.g. a river matched by
    // several way segments) collapses to one entry.
    const unique: PlaceResult[] = [];
    for (const place of places) {
      const dupe = unique.some(
        (u) =>
          u.name === place.name &&
          u.category === place.category &&
          haversineMeters(u.lat, u.lng, place.lat, place.lng) < 500,
      );
      if (!dupe) unique.push(place);
    }
    this.logger.log(`event ${eventId}: built offline place pack — ${unique.length} place(s)`);
    return unique;
  }
}

/** Thin a track down to ~evenly spaced corridor points for the Overpass query. */
function samplePolyline(
  points: Array<{ lat: number; lng: number }>,
  spacingM: number,
  maxPoints: number,
): Array<{ lat: number; lng: number }> {
  if (points.length === 0) return [];
  const sampled: Array<{ lat: number; lng: number }> = [points[0]];
  let sinceLast = 0;
  for (let i = 1; i < points.length; i++) {
    sinceLast += haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    if (sinceLast >= spacingM) {
      sampled.push(points[i]);
      sinceLast = 0;
    }
  }
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  if (sampled.length <= maxPoints) return sampled;
  const step = (sampled.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => sampled[Math.round(i * step)]);
}

/** Named places / natural features / waterways within `radius` of the corridors. */
function buildOverpassQuery(corridors: Array<Array<{ lat: number; lng: number }>>, radius: number): string {
  const selectors = [
    `node[place~"^(city|town|village|hamlet|locality|isolated_dwelling|suburb|quarter|farm)$"][name]`,
    `node[natural~"^(peak|saddle|spring|hot_spring|cave_entrance|waterfall)$"][name]`,
    `node[mountain_pass=yes][name]`,
    `node[tourism~"^(alpine_hut|wilderness_hut|viewpoint)$"][name]`,
    `way[waterway~"^(river|stream|canal)$"][name]`,
    `way[natural=water][name]`,
  ];
  const clauses: string[] = [];
  for (const line of corridors) {
    const poly = line.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(",");
    for (const selector of selectors) {
      clauses.push(`${selector}(around:${radius},${poly});`);
    }
  }
  return `[out:json][timeout:90];(${clauses.join("")});out center 4000;`;
}
