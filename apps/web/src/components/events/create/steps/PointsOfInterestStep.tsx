'use client'

import { useState, useCallback } from 'react'
import { ChevronLeft, ChevronRight, Info } from 'lucide-react'
import MapWrapper from '@/components/map/MapWrapper'
import type { EventFormData, PointOfInterest, POIType } from '@/lib/types'
import { POI_CONFIGS, MAP_CENTER } from '@/lib/constants'

interface Props {
  data: EventFormData
  update: (p: Partial<EventFormData>) => void
  onNext: () => void
  onBack: () => void
}

const POI_ICON_SVG: Record<string, string> = {
  'base-medical-camp': '🏠',
  'second-medical-camp': '➕',
  'medical-point': '➕',
  'water-point': '💧',
  'wc': 'WC',
  'wardrobe': '👕',
  'parking': 'P',
}

export default function PointsOfInterestStep({ data, update, onNext, onBack }: Props) {
  const [selectedType, setSelectedType] = useState<POIType | null>(null)

  const handleMapClick = useCallback((coords: [number, number]) => {
    if (!selectedType) return
    const newPOI: PointOfInterest = {
      id: `poi-${Date.now()}`,
      type: selectedType,
      coordinates: coords,
    }
    update({ pois: [...data.pois, newPOI] })
  }, [selectedType, data.pois, update])

  const handlePOIMove = useCallback((id: string, coords: [number, number]) => {
    update({
      pois: data.pois.map(p => p.id === id ? { ...p, coordinates: coords } : p)
    })
  }, [data.pois, update])

  const removePOI = (id: string) => {
    update({ pois: data.pois.filter(p => p.id !== id) })
  }

  const poiCounts = POI_CONFIGS.reduce<Record<string, number>>((acc, config) => {
    acc[config.type] = data.pois.filter(p => p.type === config.type).length
    return acc
  }, {})

  const medicalPOIs = data.pois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'medical')
  const otherPOIs = data.pois.filter(p => POI_CONFIGS.find(c => c.type === p.type)?.category === 'other')

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div
        className="w-[320px] flex-shrink-0 flex flex-col h-full"
        style={{ borderRight: '1px solid rgba(148,163,184,0.08)', background: 'rgba(10,18,34,0.6)' }}
      >
        <div className="flex-1 overflow-y-auto p-5">
          <h2 className="text-base font-bold text-slate-100 mb-1">Points of Interest</h2>
          <p className="text-xs mb-5" style={{ color: '#64748b' }}>Add and place all medical and other important points on the map.</p>

          <div className="text-xs font-semibold mb-3" style={{ color: '#64748b' }}>ADD POINT</div>

          <div className="space-y-1.5">
            {POI_CONFIGS.map(config => (
              <button
                key={config.type}
                onClick={() => setSelectedType(t => t === config.type ? null : config.type as POIType)}
                className="w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left group"
                style={{
                  background: selectedType === config.type
                    ? `${config.color}15`
                    : 'rgba(255,255,255,0.03)',
                  border: selectedType === config.type
                    ? `1px solid ${config.color}50`
                    : '1px solid rgba(148,163,184,0.08)',
                }}
              >
                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                  style={{
                    background: config.bg,
                    color: config.color,
                    boxShadow: selectedType === config.type ? `0 0 12px ${config.color}40` : 'none',
                  }}
                >
                  {POI_ICON_SVG[config.type] || '•'}
                </div>
                {/* Label */}
                <span
                  className="flex-1 font-medium text-sm"
                  style={{ color: selectedType === config.type ? '#f1f5f9' : '#94a3b8' }}
                >
                  {config.label}
                </span>
                {/* Count dots */}
                <div className="flex gap-0.5">
                  {Array.from({ length: Math.min(poiCounts[config.type] || 0, 5) }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: config.color }}
                    />
                  ))}
                  {(poiCounts[config.type] || 0) > 5 && (
                    <span className="text-xs ml-0.5" style={{ color: config.color }}>+{(poiCounts[config.type] || 0) - 5}</span>
                  )}
                </div>
                <svg className="w-4 h-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
                </svg>
              </button>
            ))}
          </div>

          {/* Info tip */}
          {selectedType ? (
            <div
              className="flex items-start gap-2 mt-4 p-3 rounded-xl"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
              <div className="text-xs" style={{ color: '#94a3b8' }}>
                <span className="font-semibold text-slate-300">
                  {POI_CONFIGS.find(c => c.type === selectedType)?.label} selected.
                </span>{' '}
                Click on the map to place a point. You can drag points to adjust their location.
              </div>
            </div>
          ) : (
            <div
              className="flex items-start gap-2 mt-4 p-3 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)' }}
            >
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#64748b' }} />
              <div className="text-xs" style={{ color: '#64748b' }}>
                Select a point type above, then click on the map to place a point. You can drag points to adjust their location.
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="p-5 pt-0">
          <div className="flex gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(148,163,184,0.15)',
                color: '#94a3b8',
              }}
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={onNext}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                boxShadow: '0 4px 14px rgba(34,197,94,0.3)',
              }}
            >
              Next Step <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Right: Map + summary */}
      <div className="flex-1 flex flex-col h-full">
        <div className="flex-1 relative min-h-0">
          <MapWrapper
            center={MAP_CENTER}
            zoom={12}
            pois={data.pois}
            interactivePOI
            selectedPOIType={selectedType}
            onMapClick={handleMapClick}
            onPOIMove={handlePOIMove}
          />
        </div>

        {/* POI summary bar */}
        <div
          className="flex items-center gap-4 px-6 py-3 flex-shrink-0 overflow-x-auto"
          style={{
            background: 'rgba(10,18,34,0.95)',
            borderTop: '1px solid rgba(148,163,184,0.08)',
          }}
        >
          {POI_CONFIGS.map(config => {
            const count = poiCounts[config.type] || 0
            return (
              <div key={config.type} className="flex flex-col items-center gap-1 min-w-[60px]">
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold"
                  style={{ background: config.bg, color: config.color }}
                >
                  {POI_ICON_SVG[config.type]}
                </div>
                <div className="text-xs font-bold" style={{ color: count > 0 ? '#f1f5f9' : '#475569' }}>
                  {count}
                </div>
                <div className="text-[9px] text-center leading-tight" style={{ color: '#64748b' }}>
                  {config.label.replace(' Camp', '').replace('Medical ', '').trim()}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
