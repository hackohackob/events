import type { POIConfig, VehicleConfig } from './types'

export const POI_CONFIGS: POIConfig[] = [
  { type: 'base-medical-camp', label: 'Base Medical Camp', color: '#ef4444', bg: '#7f1d1d', category: 'medical' },
  { type: 'second-medical-camp', label: 'Second Medical Camp', color: '#ef4444', bg: '#991b1b', category: 'medical' },
  { type: 'medical-point', label: 'Medical Point', color: '#ef4444', bg: '#b91c1c', category: 'medical' },
  { type: 'water-point', label: 'Water Point', color: '#3b82f6', bg: '#1e3a5f', category: 'other' },
  { type: 'wc', label: 'WC', color: '#8b5cf6', bg: '#3b1f7a', category: 'other' },
  { type: 'wardrobe', label: 'Wardrobe', color: '#f97316', bg: '#7c2d12', category: 'other' },
  { type: 'parking', label: 'Parking', color: '#f59e0b', bg: '#78350f', category: 'other' },
]

export const VEHICLE_CONFIGS: VehicleConfig[] = [
  { value: 'bike', label: 'Bike', icon: '🚲' },
  { value: 'e-bike', label: 'E-Bike', icon: '⚡🚲' },
  { value: 'e-motorcycle', label: 'E-Motorcycle', icon: '⚡🏍️' },
  { value: 'ambulance', label: 'Ambulance', icon: '🚑' },
  { value: 'offroad-ambulance', label: 'Offroad Ambulance', icon: '🚑' },
  { value: 'atv', label: 'ATV', icon: '🏎️' },
  { value: 'motorcycle', label: 'Motorcycle', icon: '🏍️' },
]

export const DISCIPLINE_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#14b8a6',
]

export const MAP_CENTER: [number, number] = [23.4865, 41.8437]
export const MAP_ZOOM = 12
