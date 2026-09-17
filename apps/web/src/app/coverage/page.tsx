'use client'

import dynamic from 'next/dynamic'

/**
 * The fleet-wide signal coverage survey.
 *
 * `ssr: false` is load-bearing: MapLibre touches `window` at import time, so
 * this whole console has to stay out of the server render.
 */
const CoverageConsole = dynamic(() => import('@/components/coverage/CoverageConsole'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center" style={{ background: '#0a1a2e' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: 'rgba(34,197,94,0.3)', borderTopColor: '#22c55e' }}
        />
        <span className="text-sm" style={{ color: '#64748b' }}>Loading coverage survey…</span>
      </div>
    </div>
  ),
})

export default function CoveragePage() {
  return <CoverageConsole />
}
