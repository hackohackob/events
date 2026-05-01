'use client'

import { useRef, useCallback, useState } from 'react'
import Map, { Marker, Source, Layer, NavigationControl } from 'react-map-gl/maplibre'
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { PointOfInterest, POIType } from '@/lib/types'
import { POI_CONFIGS } from '@/lib/constants'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

interface TrackLayer {
  id: string
  coordinates: [number, number][]
  color: string
}

interface MapClientProps {
  center: [number, number]
  zoom?: number
  pois?: PointOfInterest[]
  tracks?: TrackLayer[]
  interactivePOI?: boolean
  selectedPOIType?: POIType | null
  onMapClick?: (coords: [number, number]) => void
  onPOIMove?: (id: string, coords: [number, number]) => void
  showControls?: boolean
}

function getPOIIcon(type: POIType) {
  const config = POI_CONFIGS.find(p => p.type === type)
  if (!config) return { label: '?', color: '#64748b', bg: '#1e293b' }
  return config
}

function POIMarker({ poi, onMove }: { poi: PointOfInterest; onMove?: (id: string, coords: [number, number]) => void }) {
  const config = getPOIIcon(poi.type)
  const draggable = !!onMove

  const getIconContent = (type: POIType) => {
    switch (type) {
      case 'base-medical-camp': return '🏠'
      case 'second-medical-camp': return '+'
      case 'medical-point': return '+'
      case 'water-point': return '💧'
      case 'wc': return 'WC'
      case 'wardrobe': return '👕'
      case 'parking': return 'P'
      default: return '•'
    }
  }

  return (
    <Marker
      key={poi.id}
      longitude={poi.coordinates[0]}
      latitude={poi.coordinates[1]}
      draggable={draggable}
      onDragEnd={e => onMove?.(poi.id, [e.lngLat.lng, e.lngLat.lat])}
    >
      <div
        className="flex items-center justify-center rounded-full text-white font-bold text-xs cursor-pointer"
        style={{
          width: poi.type === 'base-medical-camp' ? 34 : 28,
          height: poi.type === 'base-medical-camp' ? 34 : 28,
          background: config.color,
          border: '2px solid rgba(255,255,255,0.9)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          fontSize: poi.type === 'wc' ? 8 : 11,
        }}
        title={poi.name || poi.type}
      >
        {getIconContent(poi.type)}
      </div>
    </Marker>
  )
}

export default function MapClient({
  center,
  zoom = 12,
  pois = [],
  tracks = [],
  interactivePOI = false,
  selectedPOIType,
  onMapClick,
  onPOIMove,
  showControls = true,
}: MapClientProps) {
  const mapRef = useRef<MapRef>(null)

  const handleClick = useCallback(
    (e: MapLayerMouseEvent) => {
      if (!interactivePOI || !selectedPOIType || !onMapClick) return
      onMapClick([e.lngLat.lng, e.lngLat.lat])
    },
    [interactivePOI, selectedPOIType, onMapClick]
  )

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: center[0], latitude: center[1], zoom }}
      mapStyle={MAP_STYLE}
      style={{ width: '100%', height: '100%' }}
      cursor={interactivePOI && selectedPOIType ? 'crosshair' : 'grab'}
      onClick={handleClick}
      attributionControl={false}
    >
      {showControls && (
        <NavigationControl position="bottom-right" showCompass showZoom visualizePitch={false} />
      )}

      {/* Track layers */}
      {tracks.map(track => (
        <Source
          key={track.id}
          id={`track-${track.id}`}
          type="geojson"
          data={{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: track.coordinates,
            },
          }}
        >
          <Layer
            id={`track-line-${track.id}`}
            type="line"
            paint={{
              'line-color': track.color,
              'line-width': 3,
              'line-opacity': 0.9,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </Source>
      ))}

      {/* POI markers */}
      {pois.map(poi => (
        <POIMarker key={poi.id} poi={poi} onMove={onPOIMove} />
      ))}
    </Map>
  )
}
