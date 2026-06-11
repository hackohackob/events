# GraphHopper routing engine

Self-hosted, offline OSM routing that powers the navigation feature. The API
(`/api/routing/route`) proxies this service so the mobile client never talks to
GraphHopper directly.

Runs the `israelhikingmap/graphhopper` image (GraphHopper 12) defined as the
`graphhopper` service in the repo-root `docker-compose.yml`. Verified working
with [config.yml](config.yml).

## Profiles

All four app profiles are defined natively in `config.yml`, reusing GraphHopper's
built-in custom models:

| App profile  | Based on            | Notes                                            |
| ------------ | ------------------- | ------------------------------------------------ |
| `foot`       | `foot.json`         | Hiking / on-foot responders                      |
| `mtb`        | `mtb.json`          | Mountain bike (uses `mtb_rating`, elevation)     |
| `car`        | `car.json`          | Roads / sealed access                            |
| `rescue_4x4` | inline (`car4wd`+)  | 4x4: allows grade4/5 tracks, blocks private/foot |

Routing runs in **flexible mode** (no CH/LM prep) — fast import, low memory, and
fast enough at event scale. The backend always sends `ch.disable=true`, and with
`GRAPHHOPPER_NATIVE_RESCUE=true` it requests the `rescue_4x4` profile directly.

## Run it

```bash
# 1. Put an OSM extract for your region at data/region-latest.osm.pbf (once).
mkdir -p apps/backend/graphhopper/data
curl -L -o apps/backend/graphhopper/data/region-latest.osm.pbf \
  https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf

# 2. Start it (postgres + redis + graphhopper). First boot imports the graph
#    (a few minutes for a country; downloads SRTM elevation tiles). Later boots
#    reuse data/graph-cache and start in seconds.
npm run infra
npm run routing:logs        # watch the import / boot

# 3. It serves http://localhost:8989 — the backend's default GRAPHHOPPER_URL.
```

`npm run dev` runs `infra` first, so the engine comes up with the rest of the stack.

To re-import after swapping the `.pbf`, delete the cache: `rm -rf apps/backend/graphhopper/data/graph-cache`.

## API env vars

| Var                         | Default                 | Purpose                                   |
| --------------------------- | ----------------------- | ----------------------------------------- |
| `GRAPHHOPPER_URL`           | `http://localhost:8989` | Base URL of the GraphHopper instance      |
| `GRAPHHOPPER_NATIVE_RESCUE` | `false` (dev: `true`)   | Use the native `rescue_4x4` profile       |
| `GRAPHHOPPER_API_KEY`       | _(none)_                | Sent as `?key=` (for the hosted GH API)   |

`data/` (the extract, built graph, elevation tiles) is git-ignored.
