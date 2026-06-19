import type { POIConfig, VehicleConfig } from './types'

export const POI_CONFIGS: POIConfig[] = [
  { type: 'base-medical-camp', label: 'Base Medical Camp', color: '#ef4444', bg: '#7f1d1d', category: 'medical' },
  { type: 'ambulance', label: 'Ambulance', color: '#ef4444', bg: '#991b1b', category: 'medical' },
  { type: 'medical-point', label: 'Medical Point', color: '#ef4444', bg: '#b91c1c', category: 'medical' },
  { type: 'water-point', label: 'Water Point', color: '#3b82f6', bg: '#1e3a5f', category: 'other' },
  { type: 'wc', label: 'WC', color: '#8b5cf6', bg: '#3b1f7a', category: 'other' },
  { type: 'wardrobe', label: 'Wardrobe', color: '#f97316', bg: '#7c2d12', category: 'other' },
  { type: 'parking', label: 'Parking', color: '#f59e0b', bg: '#78350f', category: 'other' },
  { type: 'mrs', label: 'Mountain Rescue', color: '#0ea5e9', bg: '#0c4a6e', category: 'medical' },
  { type: 'food-point', label: 'Food Point', color: '#22c55e', bg: '#14532d', category: 'other' },
  { type: 'danger', label: 'Danger', color: '#f43f5e', bg: '#7f1d1d', category: 'other' },
  { type: 'road-crossing', label: 'Road Crossing', color: '#f59e0b', bg: '#78350f', category: 'other' },
  { type: 'mechanical', label: 'Mechanical', color: '#64748b', bg: '#1e293b', category: 'other' },
  { type: 'marshal', label: 'Marshal', color: '#3b82f6', bg: '#1e3a5f', category: 'other' },
  { type: 'checkpoint', label: 'Checkpoint', color: '#a855f7', bg: '#3b1f7a', category: 'other' },
  { type: 'finish', label: 'Finish', color: '#10b981', bg: '#064e3b', category: 'other' },
  { type: 'shelter', label: 'Shelter', color: '#0ea5e9', bg: '#0c4a6e', category: 'other' },
  { type: 'custom', label: 'Custom Point', color: '#94a3b8', bg: '#1e293b', category: 'other' },
]

// Selectable glyphs for a custom point of interest now live in
// `@/lib/poi-icons` as CUSTOM_POI_ICON_OPTIONS (keyed vector icons).

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
  '#ef4444',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#84cc16',
  '#fb923c',
]

export const MAP_CENTER: [number, number] = [23.3219, 42.6977]
export const MAP_ZOOM = 12
