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
  dates: Date[]
  location: { name: string; coordinates: [number, number] } | null
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
