#!/usr/bin/env node
/**
 * One-time import of Bulgarian hospitals from OpenStreetMap (Overpass API).
 *
 * Writes apps/backend/data/hospitals.bg.json — committed to the repo and
 * bulk-inserted by HospitalsService.seedIfEmpty() on first boot with an empty
 * hospitals table. Re-run manually to refresh the seed (existing rows are
 * never overwritten: inserts use ON CONFLICT (osm_id) DO NOTHING).
 *
 * Usage: node scripts/import-hospitals-osm.mjs
 */
import { writeFile, mkdir } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const OUT_FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "backend", "data", "hospitals.bg.json");

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const QUERY = `
[out:json][timeout:120];
area["ISO3166-1"="BG"][admin_level=2]->.bg;
(
  node["amenity"="hospital"](area.bg);
  way["amenity"="hospital"](area.bg);
  relation["amenity"="hospital"](area.bg);
);
out center tags;
`;

async function fetchOverpass() {
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`Querying ${endpoint} (attempt ${attempt})…`);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // Overpass mirrors reject requests without an identifying UA (406)
            "User-Agent": "events-app-hospitals-import/1.0 (medical events platform seed script)",
          },
          body: `data=${encodeURIComponent(QUERY)}`,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        console.warn(`  failed: ${err.message ?? err}`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
  }
  throw lastErr;
}

/** Split OSM phone tags ("+359 2 915 4411;+359 2 915 4200") into a list. */
function parsePhones(tags) {
  const raw = tags.phone ?? tags["contact:phone"] ?? tags["phone:mobile"] ?? "";
  return raw
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Best-effort mapping of OSM healthcare:speciality values to our capability codes. */
function parseCapabilities(tags) {
  const caps = new Set();
  if (tags.emergency === "yes") caps.add("er");
  const spec = (tags["healthcare:speciality"] ?? "").toLowerCase();
  const map = {
    emergency: "er",
    traumatology: "trauma",
    trauma: "trauma",
    intensive: "icu",
    cardiology: "cardiology",
    paediatrics: "pediatric",
    pediatrics: "pediatric",
    neurology: "neurology",
    orthopaedics: "orthopedics",
    orthopedics: "orthopedics",
    surgery: "surgery",
    radiology: "xray",
    burn: "burn",
  };
  for (const [key, cap] of Object.entries(map)) {
    if (spec.includes(key)) caps.add(cap);
  }
  return [...caps];
}

function buildAddress(tags) {
  const parts = [];
  if (tags["addr:street"]) {
    parts.push(tags["addr:housenumber"] ? `${tags["addr:street"]} ${tags["addr:housenumber"]}` : tags["addr:street"]);
  }
  return parts.join(", ") || undefined;
}

function toSeed(el) {
  const tags = el.tags ?? {};
  const name = tags["name:en"] ?? tags.name ?? tags["name:bg"];
  if (!name) return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const hoursText = tags.opening_hours;
  return {
    osmId: `${el.type}/${el.id}`,
    name,
    nameBg: tags["name:bg"] ?? (tags.name !== name ? tags.name : undefined),
    address: buildAddress(tags),
    city: tags["addr:city"] ?? undefined,
    lat,
    lng,
    phones: parsePhones(tags),
    emergency24h: hoursText === "24/7" || tags.emergency === "yes",
    hoursText: hoursText ?? undefined,
    capabilities: parseCapabilities(tags),
  };
}

const data = await fetchOverpass();
const seed = (data.elements ?? [])
  .map(toSeed)
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name));

// Drop undefined keys so the committed JSON stays compact
const clean = seed.map((h) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)));

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(clean, null, 2) + "\n", "utf8");
console.log(`Wrote ${clean.length} hospitals to ${OUT_FILE}`);
