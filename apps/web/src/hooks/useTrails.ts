import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MedicTrail } from '@events/contracts'
import { getTrailBundle, listTrails, type TrailSummary, type TrailWindow } from '@/api/trails'

/**
 * Location history for the replay view.
 *
 * Two requests with very different costs, so they're paced separately: the
 * summary (who has breadcrumbs at all) is cheap and refreshes slowly, while
 * the bundle is only fetched for medics the coordinator actually selected.
 * Nothing is requested until `enabled` — opening the Replay tab is what starts
 * the traffic.
 */
export function useTrails(
  eventId: string | null,
  enabled: boolean,
  window: TrailWindow,
  /** null means "everyone in this window" — the default, and the only value
   *  that cannot go stale when the window's roster changes. */
  selection: string[] | null,
) {
  const [summaries, setSummaries] = useState<TrailSummary[]>([])
  const [trails, setTrails] = useState<MedicTrail[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * Who is actually requested. Resolved HERE, against this hook's own
   * summaries, so it can never be computed from a previous window's roster —
   * which is what a "seed the selection once per window" effect kept doing.
   */
  const selectedIds = useMemo(() => {
    const all = summaries.map((s) => s.medicId)
    if (selection === null) return all
    const available = new Set(all)
    return selection.filter((id) => available.has(id))
  }, [selection, summaries])

  // Refetching on every keystroke of a selection change would be wasteful, so
  // the effect keys off the joined ids rather than the array identity.
  const selectionKey = selectedIds.slice().sort().join(',')

  /**
   * Ticket guard, same as the bundle fetch below. Switching from the archive to
   * a short rolling window fires two requests; the archive's is the slower one,
   * so without this it resolved LAST and put its four medics back over the
   * three the 6h window actually has.
   */
  const summaryTicket = useRef(0)

  const fetchSummaries = useCallback(
    (ticket: number) => {
      if (!eventId) return
      listTrails(eventId, window)
        .then((rows) => {
          if (ticket === summaryTicket.current) setSummaries(rows)
        })
        .catch((err) => {
          if (ticket === summaryTicket.current) setError(readError(err))
        })
    },
    [eventId, window],
  )

  useEffect(() => {
    if (!eventId || !enabled) {
      summaryTicket.current += 1
      setSummaries([])
      return
    }
    // Drop the previous window's list before fetching the new one. Keeping it
    // meant "select everyone in this window" ran against the OLD roster.
    const ticket = ++summaryTicket.current
    setSummaries([])
    fetchSummaries(ticket)
    const id = setInterval(() => fetchSummaries(summaryTicket.current), 60_000)
    return () => clearInterval(id)
  }, [eventId, enabled, fetchSummaries])

  const refreshSummaries = useCallback(
    () => fetchSummaries(summaryTicket.current),
    [fetchSummaries],
  )

  // Guards against an earlier, slower response overwriting a newer one when the
  // selection changes twice in quick succession.
  const requestId = useRef(0)

  useEffect(() => {
    if (!eventId || !enabled || selectionKey === '') {
      setTrails([])
      setLoading(false)
      return
    }
    const ticket = ++requestId.current
    setLoading(true)
    setError(null)

    let alive = true
    const tick = () =>
      getTrailBundle(eventId, selectionKey.split(','), window)
        .then((bundle) => {
          if (!alive || ticket !== requestId.current) return
          setTrails(bundle.trails)
          setLoading(false)
        })
        .catch((err) => {
          if (!alive || ticket !== requestId.current) return
          setError(readError(err))
          setLoading(false)
        })

    tick()
    // Slow poll so an open replay keeps growing with the live event without
    // fighting the 20s server-side cache.
    const id = setInterval(tick, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [eventId, enabled, window, selectionKey])

  return { summaries, selectedIds, trails, loading, error, refreshSummaries }
}

function readError(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 403) return 'Only coordinators can view location history.'
  return 'Could not load location history.'
}
