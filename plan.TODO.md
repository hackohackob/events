# Live Event Plan — Implementation Checklist

## [ ] Ready to Ship Checklist

- [ ] **Medic auth & live location**
  - [ ] Medic login (name + role selection on join)
  - [ ] Medic location sent every 3–5s, broadcast to all connected devices
  - [ ] Medics shown as dots on map (web + mobile)
  - [ ] "Last known location" recorded when medic goes offline + elapsed time shown
  - [ ] Medic "going to" status (incident pin or POI) shown on map as an arrow/line
- [ ] **Participant join & passive location**
  - [ ] Participant self-registration (name / bib / phone)
  - [ ] Participant location sent every 60s from mobile background
  - [ ] Location stored in DB (latest only, or sparse — not every ping)
  - [ ] Participant locations NOT broadcast to other devices
  - [ ] Last known location + "last seen X min ago" recorded per participant
- [ ] **Map rendering**
  - [ ] Only medics shown as live dots on map
  - [ ] Medic "going to" indicator on map
  - [ ] Participant data saved for future heatmap (not rendered as dots)
- [ ] **Location simulator app**
  - [ ] Mock multiple medics + participants with simulated movement
  - [ ] Sends real HTTP/WS requests to the server
  - [ ] Good UI/UX matching the rest of the product

---

## Current Activation Logic (as of now)

1. **Creating an event** — POST /events — stores it in memory as `status: "draft"`
2. **Activating an event** — PATCH /events/:id/activate — flips status to `"active"`
3. **Join code** — the event's `id` is the join code
4. **Mobile app joins** — POST /auth/join with `{ joinCode: eventId, name, bibNumber? }`
   - Returns a base64-encoded JWT-style token with `{ userId, eventId, role: "runner" }`
   - No expiry, no signature — just encoded for transport

**Still missing before prod:**
- Status check on join (only allow joining active events)
- Real JWT signing
- Persistent storage (Postgres)
- Human-friendly join code

---

## Phase 1 — Medic Auth & Live Location

### 1.1 Medic Login

Medics need a lightweight identity before they can be placed on the map. Two approaches:

**Option A — PIN-based (simpler):**
- Event organizer assigns each medic a PIN + name during event setup
- Medic opens mobile app → enters join code + PIN → authenticated as `role: "medic"`

**Option B — Name-pick (even simpler for MVP):**
- Event has a predefined medic list (names entered during event creation)
- On mobile, user picks "I am medic X" from a list
- No password — just identity claim within an event scope

→ **Start with Option B for MVP.** Move to PIN if abuse becomes a problem.

**Backend:**
- `POST /auth/join` already exists — extend to accept `role: "medic"` and validate against the event's medic roster
- Medic token: `{ userId, eventId, role: "medic", medicName }`

**Mobile (Expo):**
- Separate join screen for medics: shows event name + medic list
- After selection → token stored → location tracking starts

---

### 1.2 Medic Location — Real-time

Medics send location every 3–5 seconds via WebSocket.

**WS message (mobile → server):**
```json
{
  "type": "location_update",
  "token": "<medic JWT>",
  "lat": 42.6977,
  "lng": 23.3219,
  "accuracy": 5,
  "speed": 3.2,
  "heading": 180,
  "timestamp": "2026-05-22T09:34:22.000Z"
}
```

**Backend:**
- Decode token → confirm `role: "medic"`
- Store in Redis: `location:{eventId}:medic:{userId}` with TTL 30s
- **Publish to Redis pub/sub: `event:{eventId}:medics`** — broadcast to ALL connected devices (web + mobile)
- Write to Postgres `medic_locations` table (can be every update — medic count is small)

**Broadcast to all devices:**
```json
{
  "type": "medic_location",
  "eventId": "event-abc123",
  "userId": "medic_georgi",
  "name": "Georgi",
  "lat": 42.6977,
  "lng": 23.3219,
  "speed": 3.2,
  "heading": 180,
  "status": "available",           // or "going_to"
  "destination": null,             // { lat, lng, label } when "going_to"
  "timestamp": "2026-05-22T09:34:22.000Z"
}
```

---

### 1.3 Last Known Location (medics + participants)

When a device stops sending location (WS disconnect, app backgrounded, phone dies):

- Redis TTL expires → key is gone
- On TTL expiry (Redis keyspace notifications) OR on WS disconnect:
  - Write `last_known_location` to Postgres with `recorded_at` timestamp
  - Broadcast to web: `{ type: "medic_offline", userId, lastLat, lastLng, lastSeenAt }`

**Map behavior:**
- Medic dot grays out with a "last seen X min ago" label
- Dot stays on map (doesn't disappear) so dispatcher can see last known position

---

### 1.4 Medic "Going To" Status

Medic (or dispatcher on web) can assign a destination:

**WS message (web → server):**
```json
{
  "type": "medic_assign",
  "medicId": "medic_georgi",
  "destination": { "lat": 42.700, "lng": 23.325, "label": "Incident #4" }
}
```

**Server:**
- Updates Redis record: `status: "going_to"`, `destination: { ... }`
- Broadcasts updated medic state to all devices

**Map rendering:**
- Arrow or dashed line from medic dot to destination pin
- Different dot color when status is `"going_to"`
- Destination pin labeled with incident or POI name

---

## Phase 2 — Participant Join & Passive Location

### 2.1 Participant Self-Registration

No login, just identity. On mobile:
- Enter event join code
- Enter name + bib number + phone (optional)
- Gets token with `role: "runner"`

No Expo account, no email needed.

---

### 2.2 Participant Location — Passive, 1/min

Participants send location **once per minute** from mobile background.

**Why 1/min:**
- 500 participants × 1 update/min ≈ 8 updates/sec — trivially low load
- Background location at high frequency drains battery; 1/min is the sweet spot
- We only need "roughly where they are" for safety, not real-time tracking

**Mobile:**
- Use `expo-location` background task with 60s interval
- Send via HTTP POST (not WS — no persistent connection needed for 1/min):
  ```
  POST /events/:id/location
  Authorization: Bearer <token>
  { lat, lng, accuracy, timestamp }
  ```

**Backend:**
- Validate token → confirm `role: "runner"`
- **Upsert** in Postgres `participant_last_location` table (one row per participant, overwrite on each update)
- Also write a sparse history row to `participant_locations` — **but only if > 1 min since last row** (enforced at insert time, not application layer)
- Do NOT publish to Redis pub/sub — participant locations are NOT broadcast

**Storage math:**
- 1 row/min per participant × 500 participants × 6h event = 180,000 rows — very manageable
- If we want to reduce further: only write history if position moved > 50m

---

### 2.3 Participant Data — Not on Map (yet)

- Participant dots are **not rendered** on the live map
- Their `last_known_location` is saved for:
  - Safety: dispatcher can look up "where is bib #142?"
  - Incident correlation: auto-attach nearest participant locations to an incident report
  - Post-event heatmap (future feature)
  - Emergency SMS with last known location (future feature)

---

## Phase 3 — Map Rendering Updates

### What the map shows:

| Layer | Source | Update rate |
|---|---|---|
| Medic dots | WS broadcast | 3–5s |
| Medic "going to" lines | WS broadcast | on change |
| Incident pins | WS broadcast | on create/update |
| POIs (medical, water, etc.) | REST on load | static |
| Participant dots | **not shown** | — |

### Medic dot states:
- Green: online, available
- Orange: online, "going_to" (shows destination line)
- Gray: offline, last known position shown with "X min ago" label

---

## Phase 4 — Location Simulator App

A standalone web app (Next.js or plain React) for testing without real devices.

### Features:

**Participant simulation:**
- Add N mock participants (bulk: "add 50 runners")
- Each gets a random name + bib number
- Movement pattern: linear along a route, random walk, stationary
- Sends `POST /events/:id/location` every 60s (or faster for testing)

**Medic simulation:**
- Add mock medics by name
- Manually drag medic pin on a mini-map to set position
- Or: auto-walk along a route
- Sends WS `location_update` every 3s

**Controls:**
- Start / pause all simulations
- Speed multiplier (1×, 5×, 10×)
- Event selector (which event to simulate against)
- Live log of requests sent + server responses

**UI/UX:**
- Dark theme matching the main map
- Split: left = controls panel, right = mini-map showing simulated positions
- Color-coded: medics in green, participants in blue
- "Incident" button — simulate an SOS from a random participant

**Tech:**
- Standalone app in `apps/simulator/`
- Uses the same API client as the web app
- MapLibre for the mini-map

---

## Backend Work Needed

- [ ] `LocationsModule` WS handler: decode token, validate role, route to medic or participant path
- [ ] Medic path: Redis store + pub/sub publish + Postgres write
- [ ] Participant path: HTTP POST handler, upsert `participant_last_location`, sparse history insert
- [ ] Redis bridge in `RealtimeGateway`: subscribe to `event:{eventId}:medics`, broadcast to all rooms
- [ ] Postgres schema: `medic_locations`, `participant_last_location`, `participant_locations` tables + migration
- [ ] Keyspace notification / disconnect handler: write `last_known_location`, broadcast `medic_offline`
- [ ] Medic assign endpoint: `POST /events/:id/medics/:medicId/assign`
- [ ] `GET /events/:id/participants` — list participants with last known location + last seen time
- [ ] `GET /events/:id/medics` — list medics with current status

## Frontend (Web) Work Needed

- [ ] WS connection in event detail page (subscribe on mount)
- [ ] Medic location state: `Map<medicId, MedicLocation>` in a ref
- [ ] MapLibre medic layer: colored dots + "going to" lines
- [ ] Medic offline state: gray dot + "last seen X min ago"
- [ ] Medic assignment UI: click medic → assign to incident/POI
- [ ] Participant panel: list with last known location + last seen (no map dots)

## Mobile Work Needed

- [ ] Medic join screen: event code + pick from medic list
- [ ] Background location task: `expo-location` every 60s for participants
- [ ] WS location_update for medics every 3–5s
- [ ] Show medic dots on participant's own map (received from WS broadcast)
- [ ] "Going to" indicator visible on medic's own map

## Simulator App

- [ ] `apps/simulator/` scaffolded (React + Vite or Next.js)
- [ ] Mock participant manager: bulk add, movement simulation, POST location every N seconds
- [ ] Mock medic manager: add by name, drag-to-position on mini-map, WS location stream
- [ ] MapLibre mini-map: show simulated medic + participant positions
- [ ] Start/pause/speed controls
- [ ] Live request log panel
- [ ] "SOS" button to trigger test incident

---

## Priorities

1. **Medic auth** — medic list in event, join screen on mobile
2. **Medic WS location → Redis → broadcast** — core live map
3. **Map: medic dots + offline state** — the thing dispatchers watch
4. **Participant HTTP location upsert** — passive, no broadcast
5. **Medic "going to" assignment** — dispatcher tool
6. **Simulator app** — needed for testing without many devices
7. **Participant panel** (web) — lookup by bib/name
8. **Historical tracks + replay** — post-event, lowest priority
