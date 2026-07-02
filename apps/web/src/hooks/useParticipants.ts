import { useEffect, useState } from 'react'
import type { ParticipantLastLocation } from '@events/contracts'
import { getParticipants } from '@/api/participants'

/**
 * Poll the participant roster (one call) on an interval. Modeled on
 * useHeatmap — only runs while `enabled` (e.g. the Participants tab is open).
 */
export function useParticipants(eventId: string | null, enabled: boolean, intervalMs = 12_000) {
  const [participants, setParticipants] = useState<ParticipantLastLocation[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!eventId || !enabled) {
      setParticipants([])
      return
    }
    let alive = true
    setLoading(true)
    const tick = () =>
      getParticipants(eventId)
        .then((rows) => {
          if (!alive) return
          setParticipants(rows)
          setLoading(false)
        })
        .catch(() => {
          if (alive) setLoading(false)
        })
    tick()
    const id = setInterval(tick, intervalMs)
    // Refresh immediately when the tab regains focus instead of waiting out
    // the remainder of the poll interval.
    const onFocus = () => tick()
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [eventId, enabled, intervalMs])

  return { participants, loading }
}
