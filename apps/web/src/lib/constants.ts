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
  { type: 'custom', label: 'Custom Point', color: '#94a3b8', bg: '#1e293b', category: 'other' },
]

/**
 * Glyphs selectable for a custom point of interest. The first is the default.
 * "Danger" (⚠️) marks a dangerous place, as requested for hazard marking.
 */
export const CUSTOM_POI_ICONS: { icon: string; label: string }[] = [
  { icon: '⚠️', label: 'Danger' },
  { icon: '⭐', label: 'Star' },
  { icon: '🚩', label: 'Flag' },
  { icon: '📍', label: 'Pin' },
  { icon: '🏁', label: 'Finish' },
  { icon: '⛺', label: 'Camp' },
  { icon: '📷', label: 'Viewpoint' },
  { icon: '🚧', label: 'Obstacle' },
  { icon: '☎️', label: 'Contact' },
  { icon: '🔦', label: 'Search point' },
  { icon: '🪨', label: 'Rockfall' },
  { icon: '💧', label: 'Water' },
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
  '#ef4444',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#84cc16',
  '#fb923c',
]

export const MAP_CENTER: [number, number] = [23.3219, 42.6977]
export const MAP_ZOOM = 12
