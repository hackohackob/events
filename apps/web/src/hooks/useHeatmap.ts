import { useEffect, useState } from 'react'
import { getHeatmap, type HeatmapPoint } from '@/api/medics'

/**
 * Poll the aggregated runner heatmap snapshot (one call) instead of consuming a
 * WS event per participant. Refreshes every `intervalMs`. Shared shape is also
 * what the medic app can use.
 */
export function useHeatmap(eventId: string | null, enabled: boolean, intervalMs = 12_000) {
  const [points, setPoints] = useState<HeatmapPoint[]>([])
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!eventId || !enabled) {
      setPoints([])
      setCount(0)
      return
    }
    let alive = true
    const tick = () =>
      getHeatmap(eventId)
        .then((snap) => {
          if (!alive) return
          setPoints(snap.points)
          setCount(snap.count)
        })
        .catch(() => {/* non-critical */})
    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [eventId, enabled, intervalMs])

  return { points, count }
}
