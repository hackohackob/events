export type VehicleType =
  | 'bike'
  | 'e-bike'
  | 'e-motorcycle'
  | 'ambulance'
  | 'offroad-ambulance'
  | 'atv'
  | 'motorcycle'

export type POIType =
  | 'base-medical-camp'
  | 'ambulance'
  | 'medical-point'
  | 'water-point'
  | 'wc'
  | 'wardrobe'
  | 'parking'
  | 'mrs'
  | 'custom'

export type DisciplineType = 'trail-run' | 'mtb' | 'marathon' | 'run' | 'bike' | 'swim'

export interface User {
  id: string
  name: string
  email: string
  role: 'paramedic' | 'emt' | 'coordinator' | 'doctor' | 'admin'
  unit: string
  avatar?: string
  phone?: string
  status: 'active' | 'inactive'
  joined: string
}

export interface PointOfInterest {
  id: string
  type: POIType
  coordinates: [number, number]
  name?: string
  /** Optional short free-text note about the point. */
  description?: string
  /** Custom glyph (emoji) overriding the type's default icon — used by custom points. */
  icon?: string
}

export interface Discipline {
  id: string
  name: string
  type: DisciplineType
  distance: number
  elevation: number
  color: string
  gpxFile?: string
  gpxUrl?: string
  gpxUploaded: boolean
  gpxCoordinates?: [number, number][]
  /** Real elevation profile parsed from the GPX (distance km → elevation m). */
  elevationProfile?: { distance: number; elevation: number }[]
}

export interface EventDay {
  id: string
  date: Date
  disciplines: Discipline[]
  pois: PointOfInterest[]
  assignments: MedicAssignment[]
}

export interface MedicAssignment {
  userId: string
  /** Location / Position: camp name, 'Mobile', or custom value */
  position?: string
  vehicle?: VehicleType
  description?: string
}

export interface EventFormData {
  eventKey: string
  title: string
  description: string
  imageUrl: string | null
  /** Command Center phone number. Powers the runner PWA's "Call Race Command"
   *  button and SOS SMS fallback — both are hidden there when this is blank. */
  commandPhone: string
  dates: Date[]
  location: { name: string; coordinates: [number, number] } | null
  /** Daily window ("HH:mm", Europe/Sofia) outside which medic locations are
   *  visible only to coordinators. Null = always visible. */
  activeHours: { start: string; end: string } | null
  days: EventDay[]
}

export interface EventSummary {
  id: string
  title: string
  status: 'draft' | 'active' | 'closed'
  dates: Date[]
  location: string
  disciplines: number
  medics: number
  image?: string
}

export interface POIConfig {
  type: POIType
  label: string
  color: string
  bg: string
  category: 'medical' | 'other'
}

export interface VehicleConfig {
  value: VehicleType
  label: string
  icon: string
}
