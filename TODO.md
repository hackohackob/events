# TODO

- [ ] status change should be in menu
- [ ]  debug screens should be in the menu 
- [ ] when medic is in rest, the badge should become blue 
- [ ] sometimes the badges on the app show only the first letter (I've seen it only on people with duplicating first letter - Atanas Atanasov (AA) and Alex Riviera (AR) and Asen Petrov (AP) )
- [ ] closed incidents shouldnt be red on map
- [ ] app didnt receive broadcast
- [ ] web broadcast should have X and stack when multiple come
- [ ] Dashboard mobile view
- [ ] Offline map - its not working (MappLibre Native error - Unable to parse resourceUrl {version:9, sources: {offline-base: {type:raster}}})
- [ ] I want to have better, amazingly good looking buttons for tp right layer menu, home location, north side up and put the map download there
- [ ] status change button should be like the navigation ones, but on the left and appear as dot (green, purple, yellow) and when clicked will show more info 
- [ ] when incident is changed/removed (the app does not show it )
- [ ] sometimes when the view becomes too long to be displayed in the drag-up-bottom-drawer, it hides the bottom part beneath the lower navigation 

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

## Feature Ideas (Backlog)

### 🗺️ Maps & Navigation

- [ ] **Forest Navigation (Mapy.cz/GPX)** — Research: use Mapy.cz API or build a snap-to-track algorithm to route medics along the official GPX trail line
- [ ] **Weather Radar Overlay** — Real-time weather radar and hourly local forecasts pinned to the map
- [x] **Elevation Gradient Coding** — Color-code track lines (e.g. bright red) to warn medics of incoming brutal climbs
- [ ] **Reverse Route Navigation** — Route medics backward against race flow with alerts on upcoming runner density

### 🚑 Incidents & Field Logistics

- [ ] **Dynamic ETA Matrix** — Show coordinator a list of closest medics ranked by travel type (foot vs. bike) and arrival time
- [ ] **~Quick-Macro Audio Notes** — Compress quick voice logs and auto-upload them the instant minimal signal returns
- [ ] **Timestamp Photo Watermark** — Burn exact GPS coordinates and time directly onto image pixels to counter network lag delays
- [ ] **Auto-Collapse Resolved Cases** — Instantly wipe closed incidents off the active map into a side archive
- [ ] **~Extraction Point Snapping** — Map 4x4/ambulance access points and route field medics to the nearest vehicle pickup zone
- [ ] **~"Find My Team" Compass** — Minimalist directional needle showing straight-line distance to cases when maps lose context in dense woods

### 📡 Comms, Battery & Telemetry

- [ ] **Battery Saver Mode** — Throttle background tracking intervals and disable heavy map graphics when battery drops
- [ ] **Network Traffic Prioritization** — Force app to block images/chat and use 100% of weak bandwidth strictly for text GPS strings
- [ ] **Push-to-Talk (PTT)** — Digital walkie-talkie audio channels built into the app over cellular/Wi-Fi
- [ ] **Group call (channel)** — Coordinator can create a group call channel and medics can join it and talk to each other
- [ ] **Geofenced Alerts** — Coordinator draws a circle on the map to blast mass notifications only to medics inside that zone
- [ ] **~Expected Ping Timer** — Dashboard countdown clock flagging exactly how long a medic has been in a dead zone

### 🩺 Participant Medical Data

- [ ] **Medical ID Profile** — Participant-inputted records covering allergies, blood type, and emergency contacts
- [ ] **Pre-Event Check Integration** — Nice to have: digitally log morning medical clearances/vitals directly into the app

## Existing App

- [ ] Mobile: notificvation is dismissable 
- [ ] Mobile: notification for incident
- [ ] Mobile: fetch incidents
- [ ] Mobile: report better incident 
- [X] On multiday events - pick day
- [X] On multiple distances - choose a distance
- [X] Injury - show Xkm from nearest medic (Petar)
- [ ] Language toggle - BG/EN
- [X] Add phone number field when registering in the app
- [ ] Add unconscious state/action
- [ ] Add image support
