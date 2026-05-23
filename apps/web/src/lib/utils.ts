import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatShortDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function getDayOfWeek(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function computeTrackBounds(
  tracks: Array<{ coordinates: [number, number][] }>
): { center: [number, number]; bounds: [[number, number], [number, number]] } | null {
  const allCoords = tracks.flatMap(t => t.coordinates)
  if (allCoords.length === 0) return null
  const lngs = allCoords.map(c => c[0])
  const lats = allCoords.map(c => c[1])
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  return {
    center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    bounds: [[minLng, minLat], [maxLng, maxLat]],
  }
}
