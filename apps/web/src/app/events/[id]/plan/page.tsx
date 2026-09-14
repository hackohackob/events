'use client'

import { use } from 'react'
import PlannerShell from '@/components/planner/PlannerShell'

/**
 * Deployment planning for an event: time the disciplines, watch the field move
 * along the courses, and post the medics against that clock.
 */
export default function EventPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="h-screen flex flex-col">
      <PlannerShell eventId={id} />
    </div>
  )
}
