# Web UI Plan

## Goal

Build a modern web interface for event staff that provides the same operational functionality as the mobile app, plus full event administration.

The web UI should support:

- Staff login and authenticated sessions.
- Creating and managing events.
- Multi-day event schedules.
- Disciplines per day.
- GPX track uploads per discipline.
- Live operational map views.
- Runner search, incident handling, and paramedic coordination.
- A polished, fast, easy-to-use interface suitable for real event operations.

## Existing Project Context

The repository already contains:

- `apps/mobile`: React Native / Expo mobile app.
- `apps/backend`: NestJS API and Socket.IO realtime gateway.
- `packages/contracts`: shared TypeScript contracts.
- `infra/migrations`: Postgres/PostGIS schema migrations.
- `example-data`: GPX files currently used for demo tracks.

The current app already includes:

- Event join flow.
- Map view.
- GPX track rendering.
- Live location updates.
- Incident reporting.
- Incident queueing for offline mode.
- Runner search and medical staff workflows.
- Realtime communication through Socket.IO.

The web UI should reuse the same backend concepts and shared contracts instead of introducing a separate product model.

## Recommended Web Stack

Add a new workspace:

```text
apps/web
```

Recommended stack:

- React + TypeScript.
- Vite for the frontend build.
- MapLibre GL JS for the map.
- TanStack Query for server state.
- Zustand for small client-side UI state where needed.
- Shared API types from `packages/contracts`.
- Lucide icons for interface actions.

Vite is the best default unless server rendering, SEO, or edge middleware become requirements.

## Primary User Roles

### Staff Admin

Can:

- Log into the web UI.
- Create events.
- Edit event details.
- Add days, disciplines, tracks, locations, and staff.
- Publish or close events.

### Coordinator

Can:

- Access the live operations dashboard.
- See runners, paramedics, incidents, and tracks.
- Assign paramedics to incidents.
- Override incident responses.
- Search runners by name or bib number.

### Paramedic

Can:

- Use the live map.
- View incidents.
- Respond to incidents.
- Search runners.

### Spectator / Runner

The web UI does not need to prioritize these roles in the first version. The mobile app remains the primary interface for runners and spectators.

## Core Product Areas

### 1. Login

The current backend join flow creates a simple base64 session for event joining. The web UI needs real staff authentication.

Required screens:

- Login.
- Session loading state.
- Logged-out redirect.
- Optional later: forgot password or magic link.

Required backend work:

- Add staff account storage.
- Add password hashing or passwordless login.
- Issue JWT sessions.
- Add `/auth/login`.
- Add `/auth/me`.
- Add role-based guards for staff and coordinator routes.

### 2. Event Dashboard

The dashboard is the staff entry point after login.

It should show:

- Draft events.
- Upcoming events.
- Active events.
- Closed events.
- Event location.
- Date range.
- Number of disciplines.
- Number of participants.
- Number of staff members.
- Current incident count for active events.

Primary actions:

- Create new event.
- Open event.
- Continue draft.
- Open live operations for active event.

### 3. Create Event Flow

The event creation UX should be step-based but fast.

Steps:

1. Event basics:
   - Name.
   - Location.
   - Date range.
   - Timezone.

2. Event days:
   - One or multiple dates.
   - Optional labels such as "Day 1", "Race Day", or "Kids Race".
   - Start and end time per day.

3. Disciplines:
   - Add disciplines per day.
   - Examples: 10K, 21K, 42K, MTB, Triathlon, Swim, Kids Run.
   - Discipline start time.
   - Discipline color.
   - Discipline status.

4. Tracks:
   - Upload one or more GPX files per discipline.
   - Parse GPX.
   - Preview track on map.
   - Show distance, ascent, descent, and elevation range.
   - Validate missing or invalid GPX files.

5. Review:
   - Show event summary.
   - Show all days and disciplines.
   - Show map with all tracks.
   - Save as draft or publish.

### 4. Event Management

Each event should have a management area with tabs:

- Overview.
- Days and disciplines.
- Tracks.
- Participants.
- Staff.
- Infrastructure.
- Settings.

Overview should show:

- Event status.
- Date range.
- Join code / QR code.
- Participant count.
- Staff count.
- Disciplines.
- Operational readiness checklist.

Days and disciplines should allow:

- Adding days.
- Editing day times.
- Adding disciplines.
- Reordering disciplines.
- Assigning colors.
- Uploading or replacing GPX tracks.

Tracks should allow:

- Map preview.
- Track visibility toggles.
- GPX upload.
- GPX replacement.
- Track metadata review.

Participants should allow:

- Search by name.
- Search by bib number.
- Filter by role.
- Filter by discipline.
- View last known location for staff roles.

Staff should allow:

- Invite staff.
- Assign role.
- Remove staff from event.
- See who has coordinator access.

Infrastructure should allow:

- Add aid stations.
- Add medical stations.
- Add checkpoints.
- Add WC points.
- Add wardrobe points.
- Place points on map.

Settings should allow:

- Edit event name.
- Edit location.
- Edit event status.
- Manage join code.
- Close event.

### 5. Live Operations

This is the most important operational web screen.

It should be map-first and optimized for laptop, tablet, and control-room display usage.

Visible layers:

- Tracks.
- Runners.
- Paramedics.
- Incidents.
- Infrastructure.
- Heatmap or clustering for dense participant views.

Core features:

- Live paramedic positions.
- Runner dots with privacy rules.
- Incident markers.
- Runner search.
- Incident list.
- Incident detail drawer.
- Assignment controls.
- Freshness indicators for stale locations.
- Track toggles by discipline.
- Staff-only personal data visibility.

The layout should avoid excessive decoration. It should feel like an elegant command center: dense, calm, readable, and fast.

## Data Model Changes

The current schema has:

- `events`
- `users`
- `event_users`
- `tracks`
- `infrastructure_points`
- `incidents`
- `incident_assignments`
- `incident_actions`

Recommended additions:

### `staff_accounts`

Stores web staff login identities.

Fields:

- `id`
- `email`
- `password_hash`
- `name`
- `global_role`
- `created_at`
- `updated_at`

### `event_staff`

Connects staff accounts to events.

Fields:

- `event_id`
- `staff_id`
- `role`
- `created_at`

### `event_days`

Represents one calendar day within an event.

Fields:

- `id`
- `event_id`
- `date`
- `label`
- `starts_at`
- `ends_at`
- `created_at`

### `disciplines`

Represents a race category or discipline for a specific event day.

Fields:

- `id`
- `event_id`
- `event_day_id`
- `name`
- `starts_at`
- `ends_at`
- `color`
- `status`
- `created_at`

### `discipline_tracks`

Stores GPX-derived track data for a discipline.

Fields:

- `id`
- `discipline_id`
- `name`
- `gpx_file_url`
- `geometry`
- `distance_meters`
- `ascent_meters`
- `descent_meters`
- `min_elevation_meters`
- `max_elevation_meters`
- `created_at`

The existing `tracks` table can either be migrated into `discipline_tracks` or extended with a `discipline_id`.

## Backend API Plan

### Auth

```text
POST /auth/login
POST /auth/logout
GET /auth/me
```

### Events

```text
GET /events
POST /events
GET /events/:eventId
PATCH /events/:eventId
POST /events/:eventId/publish
POST /events/:eventId/close
```

### Event Days

```text
GET /events/:eventId/days
POST /events/:eventId/days
PATCH /events/:eventId/days/:dayId
DELETE /events/:eventId/days/:dayId
```

### Disciplines

```text
GET /events/:eventId/disciplines
POST /events/:eventId/disciplines
PATCH /events/:eventId/disciplines/:disciplineId
DELETE /events/:eventId/disciplines/:disciplineId
```

### Tracks

```text
GET /events/:eventId/tracks
POST /events/:eventId/disciplines/:disciplineId/tracks
PATCH /events/:eventId/tracks/:trackId
DELETE /events/:eventId/tracks/:trackId
```

### Live Operations

```text
GET /events/:eventId/live
GET /events/:eventId/incidents
GET /events/:eventId/users
GET /events/:eventId/runner-search
```

Existing realtime Socket.IO events should be reused for locations and incidents.

## GPX Processing Plan

Backend responsibilities:

- Accept GPX upload.
- Parse GPX safely.
- Extract coordinates.
- Extract elevation when present.
- Store original file metadata.
- Store track geometry in PostGIS.
- Calculate distance.
- Calculate ascent and descent.
- Return simplified coordinates for rendering.

Web responsibilities:

- Drag-and-drop upload.
- Upload progress.
- Inline validation.
- Map preview after parsing.
- Track summary:
  - Distance.
  - Ascent.
  - Descent.
  - Elevation range.
- Clear error states for invalid files.

## UX And Design Direction

The design should be operationally beautiful, not decorative.

Principles:

- Map-first for live operations.
- Fast forms for staff workflows.
- Clear status and validation.
- Minimal modal usage.
- Strong keyboard and mouse ergonomics.
- Obvious save states.
- Clear empty states.
- Responsive layouts for desktop and tablet.
- Professional visual hierarchy.

Visual details:

- Use discipline color swatches.
- Use icons for actions.
- Use compact tables for operational data.
- Use split panes for map plus details.
- Use drawers for incident and participant details.
- Use clear severity colors for incidents.
- Use freshness indicators for stale locations.
- Keep card radius at 8px or less.

Avoid:

- Marketing-style hero pages.
- Decorative gradients that reduce readability.
- Overly large cards in operational screens.
- Text-heavy onboarding screens.
- Hidden critical actions.

## Suggested Build Phases

### Phase 1: Web App Shell

- Create `apps/web`.
- Add routing.
- Add app layout.
- Add API client.
- Add auth state.
- Add protected routes.
- Add base design system components.

### Phase 2: Staff Auth

- Add staff account schema.
- Add login endpoint.
- Add JWT sessions.
- Add `/auth/me`.
- Add backend guards.
- Build login page.

### Phase 3: Event CRUD

- Add database-backed event service.
- Build event dashboard.
- Build create-event flow.
- Build event detail overview.

### Phase 4: Days And Disciplines

- Add `event_days`.
- Add `disciplines`.
- Build day editor.
- Build discipline editor.
- Add validation for date and time conflicts.

### Phase 5: GPX Tracks

- Add GPX upload endpoint.
- Parse and store tracks.
- Build drag-and-drop upload.
- Build map preview.
- Show track metrics.

### Phase 6: Live Operations

- Build live event map.
- Add layer controls.
- Add incident list and detail drawer.
- Add runner search.
- Add assignment controls.
- Connect realtime updates.

### Phase 7: Polish And Hardening

- Add loading skeletons.
- Add error boundaries.
- Add empty states.
- Add permission-specific UI states.
- Add accessibility checks.
- Add responsive QA.
- Add build and lint validation.

## MVP Scope

The first useful web version should include:

- Staff login.
- Event list.
- Event creation.
- Multi-day setup.
- Discipline management.
- GPX upload per discipline.
- Track preview on map.
- Event overview page.
- Live map with tracks, paramedics, incidents, and runner search.

Later versions can add:

- Staff invitation emails.
- QR code management.
- Infrastructure point editing.
- Advanced analytics.
- Incident reports.
- Export tools.
- Multi-language admin UI.

## Acceptance Criteria

The web UI is ready for first internal use when:

- A staff member can log in.
- A staff member can create an event.
- An event can have one or more dates.
- Each date can have one or more disciplines.
- Each discipline can have at least one GPX track.
- Uploaded GPX files render correctly on the map.
- Event data is persisted in Postgres.
- Active events can be opened in a live map view.
- Live view shows tracks, paramedics, incidents, and runner search.
- Non-authorized users cannot access staff-only routes.
- Existing mobile app behavior is not broken.

