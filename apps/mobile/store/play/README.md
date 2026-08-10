# Google Play store assets — Extreme Medics

Source of truth for what gets uploaded to the Play Console listing
(`com.academyfirstaid.extrememedics`).

Upload at: Play Console ▸ Grow users ▸ Store presence ▸ Store listings ▸
Default store listing.

## Phone screenshots — `screenshots-phone/`

Captured 2026-08-10 from a 1080×2316 device. Play accepts 2–8 per form factor;
all 8 slots here are JPEG, 1080×2316, well inside the 320–3840 px limits.

The numbering is the upload order — Play shows them in that order, and the
first two are what most people actually see, so the two "why this app exists"
screens lead.

| # | File | Shows |
|---|------|-------|
| 1 | `01-live-map.jpg` | Live map: race track, medics, aid stations, open incident |
| 2 | `02-closest-medic.jpg` | Closest medic — 3 fastest by travel time, routed per vehicle, one-tap assign |
| 3 | `03-closest-asphalt.jpg` | Closest asphalt — evacuation exit points ranked by time on foot/bike |
| 4 | `04-track-studio.jpg` | Track Studio — elevation profile, distances, waypoints |
| 5 | `05-hospitals.jpg` | Hospitals — nearest first, 24/7 and ER flags |
| 6 | `06-team-chat.jpg` | Team chat — voice messages with transcription, incident events |
| 7 | `07-offline-map.jpg` | Offline map packs for the event area |

## Still missing

- **Feature graphic** — 1024×500 PNG/JPEG, no alpha. Required before the
  listing can be submitted. See `feature-graphic-prompt.md`.
- **App icon** — 512×512 PNG. Use `apps/mobile/assets/icon-android.png`, which
  is already exactly 512×512.

## Notes

- Screenshots must not contain a device frame, and must not be misleading —
  everything above is the real UI.
- The event in the captures is named "Test Event". If you re-shoot, a realistic
  event name reads better on the store page.
