'use client'

import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const STEPS = [
  { n: 1, title: 'Event Info', sub: 'Basic details' },
  { n: 2, title: 'Disciplines & Tracks', sub: 'Days and tracks' },
  { n: 3, title: 'Points of Interest', sub: 'Medical, water, WC...' },
  { n: 4, title: 'Team Assignment', sub: 'Medics and vehicles' },
  { n: 5, title: 'Review & Publish', sub: 'Summary & publish' },
]

export default function StepIndicator({ current }: { current: number }) {
  return (
    <div
      className="flex items-center px-8 py-0"
      style={{
        borderBottom: '1px solid rgba(148,163,184,0.08)',
        background: 'rgba(10,20,36,0.8)',
      }}
    >
      {STEPS.map((step, i) => {
        const done = current > step.n
        const active = current === step.n
        return (
          <div key={step.n} className="flex items-center">
            <div
              className="flex items-center gap-3 py-4 px-2 relative cursor-default select-none"
              style={active ? {
                borderBottom: '2px solid #22c55e',
                marginBottom: '-1px',
              } : {}}
            >
              {/* Circle */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all"
                style={
                  done
                    ? { background: '#22c55e', color: 'white' }
                    : active
                    ? { background: '#22c55e', color: 'white', boxShadow: '0 0 12px rgba(34,197,94,0.5)' }
                    : {
                        background: 'transparent',
                        color: '#64748b',
                        border: '1.5px solid rgba(148,163,184,0.2)',
                      }
                }
              >
                {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : step.n}
              </div>

              {/* Text */}
              <div className="hidden sm:block">
                <div
                  className="text-sm font-semibold leading-tight"
                  style={{ color: active ? '#f1f5f9' : done ? '#94a3b8' : '#64748b' }}
                >
                  {step.title}
                </div>
                <div className="text-xs mt-0.5" style={{ color: active ? '#94a3b8' : '#475569' }}>
                  {step.sub}
                </div>
              </div>
            </div>

            {/* Connector */}
            {i < STEPS.length - 1 && (
              <div
                className="w-6 h-px mx-1"
                style={{
                  background: done ? 'rgba(34,197,94,0.4)' : 'rgba(148,163,184,0.12)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
