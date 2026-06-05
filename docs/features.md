# Features

Concise reference of the capabilities currently shipped in the Paramedic Event App. For planned/backlog ideas see [`TODO.md`](../TODO.md).

## 🗺️ Maps & Navigation

- **Offline Map & Track Cache** — Pre-downloads terrain, routes, and elevation profiles so the app works in zero-signal areas.

## 🚑 Incidents & Field Logistics

- **Incident Reporting** — Log signals with status, in-incident chat, photos, and exact GPS location.
- **Offline Reporting Cache** — Saves incident location locally when offline and auto-sends it once the connection returns.
- **Incident Claiming** — Locks an incident on every other screen the moment a medic taps "Going to Point", preventing double-dispatch.
- **Nearest-Medic Distance** — On an injury, shows distance (Xkm) from the nearest medic.

## 📡 Comms, Battery & Telemetry

- **Battery & Signal Telemetry** — Live transmission of each medic's phone battery level and signal strength to base.
- **Location Freshness Shading** — Colors medic icons green/yellow/gray based on how old their last GPS ping is.
- **Background Location Tracking** — Persistent foreground service keeps reporting location with an HTTP fallback when sockets drop.
- **Broadcast Messaging** — Coordinator can broadcast messages to medics.

## 🎫 Events & Participants

- **Event Creation** — Create events with name, dates, location, days, disciplines, and GPX tracks.
- **Multi-Day Events** — Pick the active day on multi-day events.
- **Multiple Distances** — Choose a distance/discipline when an event has several.
- **Phone Number Registration** — Captures a participant phone number at app registration.
- **Live Operations Map** — Web dashboard with tracks, incidents, paramedics, runner search, and layer controls.

## Architecture

- `apps/backend` — NestJS API + Socket.IO realtime gateway
- `apps/mobile` — React Native (Expo) client
- `apps/web` — React + TypeScript + Vite staff dashboard
- `packages/contracts` — shared TypeScript contracts
- `infra/migrations` — Postgres/PostGIS SQL migrations
