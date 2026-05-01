'use client'

import dynamic from 'next/dynamic'
import type { ComponentProps } from 'react'
import type MapClient from './MapClient'

const MapClientDynamic = dynamic(() => import('./MapClient'), {
  ssr: false,
  loading: () => (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: '#0a1a2e' }}
    >
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'rgba(34,197,94,0.3)', borderTopColor: '#22c55e' }}
        />
        <span className="text-sm" style={{ color: '#64748b' }}>Loading map...</span>
      </div>
    </div>
  ),
})

export default function MapWrapper(props: ComponentProps<typeof MapClient>) {
  return <MapClientDynamic {...props} />
}
