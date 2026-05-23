/**
 * Generates a JPEG snapshot of a MapLibre map containing the given tracks and POIs.
 * Uses an offscreen DOM container so it never flashes on screen.
 *
 * Returns a data URL (image/jpeg) or null if generation fails or there is nothing
 * to render (no tracks AND no POIs with real coordinates).
 */

import type { PointOfInterest } from './types'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'
const SNAPSHOT_W = 1200
const SNAPSHOT_H = 630
const TIMEOUT_MS = 12_000

export interface SnapshotTrack {
  coordinates: [number, number][]
  color: string
}

export async function generateMapSnapshot(
  tracks: SnapshotTrack[],
  pois: PointOfInterest[],
): Promise<string | null> {
  // Filter to tracks that actually have geometry
  const realTracks = tracks.filter(t => t.coordinates.length >= 2)

  // Collect all coordinates to compute bounds
  const allCoords: [number, number][] = [
    ...realTracks.flatMap(t => t.coordinates),
    ...pois.map(p => p.coordinates as [number, number]),
  ]

  if (allCoords.length === 0) return null

  const lngs = allCoords.map(c => c[0])
  const lats = allCoords.map(c => c[1])
  const west = Math.min(...lngs)
  const east = Math.max(...lngs)
  const south = Math.min(...lats)
  const north = Math.max(...lats)

  // If everything is a single point with no spread, can't make a meaningful snapshot
  if (west === east && south === north && realTracks.length === 0) return null

  try {
    // Dynamic import so this module is never parsed on the server
    const maplibregl = (await import('maplibre-gl')).default

    // Create an offscreen container
    const container = document.createElement('div')
    container.style.cssText = [
      `position:fixed`,
      `left:-${SNAPSHOT_W + 100}px`,
      `top:0`,
      `width:${SNAPSHOT_W}px`,
      `height:${SNAPSHOT_H}px`,
      `visibility:hidden`,
      `pointer-events:none`,
    ].join(';')
    document.body.appendChild(container)

    return await new Promise<string | null>((resolve) => {
      let settled = false

      const finish = (result: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { map.remove() } catch { /* ignore */ }
        try { container.remove() } catch { /* ignore */ }
        resolve(result)
      }

      const timer = setTimeout(() => finish(null), TIMEOUT_MS)

      const map = new maplibregl.Map({
        container,
        style: MAP_STYLE,
        // Provide a reasonable default center while tiles load; fitBounds overrides it
        center: [(west + east) / 2, (south + north) / 2],
        zoom: 10,
        preserveDrawingBuffer: true, // required for toDataURL()
        attributionControl: false,
        fadeDuration: 0,
        antialias: true,
      })

      map.on('error', () => finish(null))

      map.on('load', () => {
        // Fit to the data bounds with padding
        const padding = 64
        map.fitBounds([[west, south], [east, north]], {
          padding,
          duration: 0, // instant (no animation)
          maxZoom: 15,
        })

        // Add track line layers
        realTracks.forEach((track, i) => {
          const id = `snap-track-${i}`
          map.addSource(id, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: track.coordinates },
            },
          })
          map.addLayer({
            id: `${id}-line`,
            type: 'line',
            source: id,
            paint: {
              'line-color': track.color,
              'line-width': 4,
              'line-opacity': 0.92,
            },
            layout: { 'line-cap': 'round', 'line-join': 'round' },
          })
        })

        // Wait for all tiles to finish rendering
        const onIdle = () => {
          map.off('idle', onIdle)
          try {
            const dataUrl = map.getCanvas().toDataURL('image/jpeg', 0.88)
            finish(dataUrl)
          } catch {
            finish(null)
          }
        }

        map.on('idle', onIdle)
      })
    })
  } catch {
    return null
  }
}
