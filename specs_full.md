# Paramedic Event App - Full Technical Specification

## 1. Purpose

Mobile-first application for coordinating paramedics and monitoring participants during endurance and outdoor events (running, marathons, triathlons, MTB, etc.).

Core value:
- Real-time situational awareness
- Faster incident response
- Clear paramedic coordination

---

## 2. Key Decisions (Locked)

- Event join: QR code + name + bib number input
- Runners join via QR and add their Name and Number
- Runner tracking: opt-in only
- Location tracking only for users who opt in
- Spectators: supported (read-only map view)
- Coordinator tools: mobile first, web later
- Product direction: app + web dashboard required long-term, but start with app only
- Incident visibility: medical staff only
- Data retention: location history stored (for now)
- Scale target: about 2000 participants per event
- Expected load: about 2000 participants on every event
- Navigation: no routing required (map only)
- Scope: international usage
- International availability: multiple languages required
- Map provider: Mapy (Mapy.cz API / SDK)
- Tech direction: TypeScript-first, cross-platform mobile

---

## 3. Tech Stack (Final)

### Mobile App

- React Native (Expo or bare) OR React Native CLI
- Language: TypeScript
- Map SDK: Mapy.cz SDK / Mapy API wrapper
- State: Zustand or Redux Toolkit
- Realtime: WebSockets or Firebase

Why:
- Single codebase for iOS + Android
- Strong TypeScript support
- Fast iteration

### Backend

- Node.js (NestJS preferred)
- TypeScript
- PostgreSQL + PostGIS
- Redis (live location cache)
- WebSockets (Socket.IO or native)

### Realtime Strategy

- Paramedics: high-frequency updates
- Runners: lower frequency updates
- Use pub/sub (Redis, Kafka optional)

---

## 4. Roles

### Runner

- Joins via QR
- Inputs name + bib number
- Shares location only if opted in
- Sees map + paramedics
- Reports incidents

### Paramedic

- Full map visibility
- Sees all paramedics with names
- Searches runners
- Responds to incidents

### Coordinator

- All paramedic permissions
- Assigns incidents
- Overrides responses

### Spectator

- View-only map
- No personal data

---

## 5. Main Screen (Map)

### Always Visible

- Tracks (multiple)
- User location
- Infrastructure points

### Layers

#### Runners
- Small anonymous dots
- No identity
- Clustered at low zoom

#### Paramedics
- Larger markers
- Vehicle icon
- Vehicle types:
  - Foot
  - Bicycle
  - E-bike
  - Electric motorcycle
  - ATV
  - SUV
  - Ambulance
- Visibility rules:
  - Runners see vehicle only
  - Paramedics/coordinators see name + vehicle

#### Incidents
- Visible only to paramedics/coordinators (medical staff only)
- Color-coded by severity/status

#### Infrastructure
- WC
- Wardrobes
- Checkpoints
- Aid stations
- Medical stations

---

## 6. Location System

### Update Frequency

| Role | Frequency |
| --- | --- |
| Paramedic | 3-10 sec |
| Runner | 5-15 sec |

### Stale Logic

| State | Time |
| --- | --- |
| Fresh | <120s |
| Warning | 120-300s |
| Stale | 300-600s |
| Very Stale | >600s |

Behavior:
- Marker becomes gray when stale/offline
- Tooltip: "Last updated X min ago"

---

## 7. Incident System

### Creation

Fields:
- Location (auto GPS)
- Type
- Description
- Severity (optional)
- Photo (optional)

### Flow

1. Incident created
2. All paramedics notified
3. Appears on map + list

### Actions

Paramedic:
- "I am going"
- "Arrived"
- "Need backup"
- "Resolved"

Coordinator:
- Assign paramedic
- Override assignments

### Visualization

- Incident marker
- Assigned responders count
- Optional line: paramedic -> incident

---

## 8. Runner Search (Paramedics Only)

Search by:
- Name
- Bib number

Result:
- Identity
- Last location
- Last update time

---

## 9. Data Model (Simplified)

### Event
- id
- name
- startTime
- endTime
- status

### User
- id
- name

### EventUser
- eventId
- userId
- role
- bibNumber
- vehicleType
- trackId

### Location
- userId
- lat
- lng
- timestamp

### Incident
- id
- eventId
- location
- type
- status

### Assignment
- incidentId
- paramedicId
- status

---

## 10. Performance Constraints

- 2000 runners requires marker clustering
- Use viewport-based loading
- Send minimal data to runners
- Use Redis for live positions

---

## 11. Offline Handling

- Cache map + tracks
- Queue location updates
- Queue incident reports
- Show stale indicators clearly

---

## 12. Security & Privacy

- Runners are anonymous to other runners
- Only paramedics/coordinators see identities
- Incidents visible only to medical staff
- Role-based access control
- Encrypted communication

---

## 13. MVP Scope

### Must Have

- QR join
- Name + bib number input
- Live map
- Tracks + points
- Runner dots
- Paramedic markers
- Incident reporting
- "I am going"
- Coordinator assignment
- Runner search
- Stale indicator

### Later

- Web dashboard
- Chat
- Smartwatch integration
- Navigation

---

## 14. Open Risks

- Mapy SDK limitations on mobile
- Battery drain from GPS
- Network reliability in remote areas
- Scaling realtime for 2000+ users

---

## 15. Success Metrics

- Time to first response
- Incident resolution time
- Percent of fresh locations
- App crash rate
- Battery usage


