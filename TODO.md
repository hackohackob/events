# TODO

## Web UI Implementation

- [x] Create `apps/web` workspace with React, TypeScript, and Vite
- [x] Add staff login and protected app shell
- [x] Build award-level staff event dashboard UX
- [x] Add event creation flow for name, dates, location, days, disciplines, and GPX tracks
- [x] Copy mobile/root env vars into the web app with Vite aliases
- [x] Implement real MapLibre map in the web UI using Mapy/OSM tiles
- [ ] Code-split MapLibre from the initial web bundle
- [ ] Add event management screens for overview, schedule, tracks, participants, staff, infrastructure, and settings
- [x] Add live operations map with tracks, incidents, paramedics, runner search, and layer controls
- [ ] Add backend staff authentication and role-based guards
- [ ] Add backend event CRUD backed by Postgres
- [ ] Add database tables for staff accounts, event staff, event days, disciplines, and discipline tracks
- [ ] Add GPX upload, parsing, metrics, and PostGIS storage
- [ ] Expand shared contracts for web event administration
- [ ] Verify web build, backend build, and mobile compatibility

## Existing App

- [ ] On multiday events - pick day
- [ ] On multiple distances - choose a distance
- [ ] Injury - show Xkm from nearest medic (Petar)
- [ ] Language toggle - BG/EN
- [ ] Add phone number field when registering in the app
- [ ] Add unconscious state/action
- [ ] Add image support
