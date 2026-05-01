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
  | 'second-medical-camp'
  | 'medical-point'
  | 'water-point'
  | 'wc'
  | 'wardrobe'
  | 'parking'

export type DisciplineType = 'trail-run' | 'mtb' | 'marathon' | 'fun-run' | 'bike' | 'swim'

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
  gpxUploaded: boolean
}

export interface EventDay {
  id: string
  date: Date
  disciplines: Discipline[]
}

export interface MedicAssignment {
  userId: string
  camp?: string
  vehicle?: VehicleType
}

export interface EventFormData {
  title: string
  description: string
  imageUrl: string | null
  dates: Date[]
  location: { name: string; coordinates: [number, number] } | null
  days: EventDay[]
  pois: PointOfInterest[]
  assignments: MedicAssignment[]
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
