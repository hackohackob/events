'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ChevronRight, CheckCircle, Eye } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import StepIndicator from './StepIndicator'
import EventInfoStep from './steps/EventInfoStep'
import DisciplinesTracksStep from './steps/DisciplinesTracksStep'
import PointsOfInterestStep from './steps/PointsOfInterestStep'
import TeamAssignmentStep from './steps/TeamAssignmentStep'
import ReviewPublishStep from './steps/ReviewPublishStep'
import type { EventFormData } from '@/lib/types'
import { useCreateEvent } from '@/hooks/useEvents'

const today = new Date()
today.setHours(0, 0, 0, 0)

const INITIAL_DATA: EventFormData = {
  title: '',
  description: '',
  imageUrl: null,
  dates: [today],
  location: null,
  days: [{ id: 'day-1', date: today, disciplines: [], pois: [], assignments: [] }],
}

const variants = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
}

export default function CreateEventWizard() {
  const [step, setStep] = useState(1)
  const [dir, setDir] = useState(1)
  const [data, setData] = useState<EventFormData>(INITIAL_DATA)
  const [published, setPublished] = useState(false)
  const createEvent = useCreateEvent()

  const update = useCallback((patch: Partial<EventFormData>) => {
    setData(prev => ({ ...prev, ...patch }))
  }, [])

  const goNext = () => {
    setDir(1)
    setStep(s => Math.min(s + 1, 5))
  }
  const goPrev = () => {
    setDir(-1)
    setStep(s => Math.max(s - 1, 1))
  }
  const goToStep = (n: number) => {
    setDir(n > step ? 1 : -1)
    setStep(n)
  }

  const handlePublish = async () => {
    await createEvent.mutateAsync(data)
    setPublished(true)
  }

  if (published) {
    return <PublishedScreen data={data} />
  }

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      {/* Top header */}
      <div
        className="flex items-center justify-between px-8 py-4 flex-shrink-0"
        style={{
          borderBottom: '1px solid rgba(148,163,184,0.08)',
          background: 'rgba(10,20,36,0.9)',
          backdropFilter: 'blur(12px)',
          zIndex: 10,
          position: 'sticky',
          top: 0,
        }}
      >
        <div className="flex items-center gap-3">
          <Link href="/events" className="text-sm transition-colors" style={{ color: '#64748b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#94a3b8')}
            onMouseLeave={e => (e.currentTarget.style.color = '#64748b')}
          >
            Events
          </Link>
          <ChevronRight className="w-4 h-4 text-slate-600" />
          <span className="text-sm font-semibold text-slate-200">Create New Event</span>
          <span
            className="text-xs font-semibold px-2.5 py-1 rounded-full ml-1"
            style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
          >
            Draft
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(148,163,184,0.15)',
              color: '#94a3b8',
            }}
          >
            <span className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              Preview Event
            </span>
          </button>
          <button
            onClick={step === 5 ? handlePublish : goNext}
            disabled={createEvent.isLoading}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
            }}
          >
            {createEvent.isLoading ? 'Publishing...' : step === 5 ? 'Publish Event' : 'Next Step'}
          </button>
        </div>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} onStepClick={goToStep} />

      {/* Step content */}
      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence custom={dir} mode="wait">
          <motion.div
            key={step}
            custom={dir}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="absolute inset-0"
          >
            {step === 1 && <EventInfoStep data={data} update={update} onNext={goNext} />}
            {step === 2 && <DisciplinesTracksStep data={data} update={update} onNext={goNext} onBack={goPrev} />}
            {step === 3 && <PointsOfInterestStep data={data} update={update} onNext={goNext} onBack={goPrev} />}
            {step === 4 && <TeamAssignmentStep data={data} update={update} onNext={goNext} onBack={goPrev} />}
            {step === 5 && <ReviewPublishStep data={data} onPublish={handlePublish} onBack={goPrev} publishing={createEvent.isLoading} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function PublishedScreen({ data }: { data: EventFormData }) {
  const totalTracks = data.days.reduce((sum, d) => sum + d.disciplines.length, 0)
  const allPOIs = data.days.flatMap(d => d.pois)
  const allAssignments = data.days.flatMap(d => d.assignments)
  const medicalPOIs = allPOIs.filter(p => ['base-medical-camp', 'second-medical-camp', 'medical-point'].includes(p.type)).length

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <motion.div
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="max-w-lg w-full rounded-3xl p-10 text-center"
        style={{
          background: 'rgba(20,33,61,0.9)',
          border: '1px solid rgba(34,197,94,0.2)',
          boxShadow: '0 0 60px rgba(34,197,94,0.1)',
        }}
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.1 }}
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            boxShadow: '0 0 40px rgba(34,197,94,0.4)',
          }}
        >
          <CheckCircle className="w-10 h-10 text-white" strokeWidth={2.5} />
        </motion.div>

        <h2 className="text-2xl font-bold text-white mb-1">Event Published!</h2>
        <p className="text-slate-400 mb-8">{data.title} is now live.</p>

        <div
          className="grid grid-cols-2 gap-3 mb-8 text-left"
          style={{ borderTop: '1px solid rgba(148,163,184,0.1)', paddingTop: '24px' }}
        >
          {[
            { label: 'Event Dates', value: data.dates.length > 0 ? data.dates.map(d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(' – ') + ', ' + data.dates[0].getFullYear() : '—', icon: '📅' },
            { label: 'Location', value: data.location?.name || '—', icon: '📍' },
            { label: 'Disciplines', value: `${totalTracks}`, icon: '🏃' },
            { label: 'Points of Interest', value: `${allPOIs.length}`, icon: '📍' },
            { label: 'Assigned Medics', value: `${allAssignments.length}`, icon: '👥' },
            { label: 'Medical Points', value: `${medicalPOIs}`, icon: '🏥' },
          ].map(({ label, value, icon }) => (
            <div key={label} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div className="text-xs mb-1" style={{ color: '#64748b' }}>{icon} {label}</div>
              <div className="font-semibold text-slate-200 text-sm">{value}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Link
            href="/events"
            className="w-full py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-95 text-center block"
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
            }}
          >
            Go to Events
          </Link>
          <Link
            href="/events"
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all text-center block"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(148,163,184,0.15)',
              color: '#94a3b8',
            }}
          >
            Back to Events
          </Link>
        </div>
      </motion.div>
    </div>
  )
}
