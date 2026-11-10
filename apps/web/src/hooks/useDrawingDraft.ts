'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SnapLineResponse, SnapProfile } from '@events/contracts'
import { snapLine } from '@/api/drawings'
import { lineLengthMeters, metersBetween, waypointsAlong, type LngLat } from '@/lib/drawing-geometry'

/**
 * The drawing being made on the dashboard map, before it is saved.
 *
 * A drawing is a set of PATHS (separate strokes); a path is a chain of SEGMENTS
 * that each start where the previous one ended. A segment is one gesture — a
 * freehand stroke, or the leg between two clicks — and it is the unit that is
 * snapped to roads, undone and redone.
 *
 * Snapping is asynchronous and must never make the tool feel laggy, so every
 * gesture lands on the map immediately as drawn and is swapped for the routed
 * line when the engine answers. Legs are snapped strictly one after another:
 * the next leg has to start where the previous one actually ended up, and that
 * is only known once it has resolved.
 */

export type DrawingTool = 'freehand' | 'points'
export type DrawingPhase = 'idle' | 'drawing' | 'details'

export interface DraftSegment {
  id: number
  kind: 'stroke' | 'leg'
  /** Geometry as currently shown — the gesture itself until a snap lands. */
  coords: LngLat[]
  /** What was actually drawn, kept so the snap can be (re)requested. */
  raw: LngLat[]
  /** Follow roads? Fixed when the gesture was made — the toggle is per stroke. */
  wantSnap: boolean
  profile: SnapProfile
  snapped: boolean
  pending: boolean
}

export interface DraftPath {
  id: number
  /** First point — on its own until the first segment exists (points tool). */
  start: LngLat
  segments: DraftSegment[]
  /** Ended: the next click starts a new path instead of extending this one. */
  closed: boolean
}

interface History {
  past: DraftPath[][]
  present: DraftPath[]
  future: DraftPath[][]
}

const EMPTY: History = { past: [], present: [], future: [] }
const PREFS_KEY = 'dashboard_drawing_prefs'

export function pathCoords(path: DraftPath): LngLat[] {
  if (path.segments.length === 0) return [path.start]
  const out: LngLat[] = []
  for (const segment of path.segments) {
    for (const point of segment.coords) {
      const last = out[out.length - 1]
      if (last && last[0] === point[0] && last[1] === point[1]) continue
      out.push(point)
    }
  }
  return out
}

function pathEnd(path: DraftPath): LngLat {
  const last = path.segments[path.segments.length - 1]
  return last ? last.coords[last.coords.length - 1] : path.start
}

const NOTICE: Record<NonNullable<SnapLineResponse['reason']>, string> = {
  no_road_nearby: 'No road or path near there — kept as drawn',
  no_route: 'Couldn’t follow a road through that — kept as drawn',
  engine_unavailable: 'Road snapping is unavailable right now — kept as drawn',
}

export interface DrawingDraft {
  phase: DrawingPhase
  tool: DrawingTool
  snap: boolean
  profile: SnapProfile
  paths: DraftPath[]
  /** Finished geometry: every path that is already a line. */
  lines: LngLat[][]
  distanceMeters: number
  /** A snap request is still out. */
  pending: boolean
  /** At least one stroke follows roads. */
  snappedAny: boolean
  isEmpty: boolean
  canUndo: boolean
  canRedo: boolean
  /** End of the line still being clicked out — the next click extends it. */
  openEnd: LngLat | null
  /** End of the most recent line, open or not — start there to pick it up again. */
  lastEnd: LngLat | null
  notice: { id: number; text: string } | null
  begin: () => void
  /** Leave drawing mode and drop everything. */
  reset: () => void
  setTool: (tool: DrawingTool) => void
  setSnap: (snap: boolean) => void
  setProfile: (profile: SnapProfile) => void
  addPoint: (point: LngLat) => void
  /** End the line being clicked out; the next click starts a new one. */
  endPath: () => void
  /** Pick the most recent line up again so clicks extend it. */
  reopenLast: () => void
  /** Add an already-smoothed freehand stroke. */
  addStroke: (coords: LngLat[], continuePrevious: boolean) => void
  undo: () => void
  redo: () => void
  clear: () => void
  /** Drawing → naming. */
  finish: () => void
  /** Naming → back to drawing. */
  resume: () => void
  dismissNotice: () => void
}

export function useDrawingDraft(): DrawingDraft {
  const [phase, setPhase] = useState<DrawingPhase>('idle')
  const [tool, setToolState] = useState<DrawingTool>('freehand')
  const [snap, setSnapState] = useState(false)
  const [profile, setProfileState] = useState<SnapProfile>('foot')
  const [history, setHistory] = useState<History>(EMPTY)
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null)

  // Async snap results read and write the newest history, not the one captured
  // when the request went out.
  const historyRef = useRef<History>(EMPTY)
  const commit = useCallback((next: History) => {
    historyRef.current = next
    setHistory(next)
  }, [])

  const idRef = useRef(1)
  const nextId = () => idRef.current++
  /** Bumped on reset so answers to an abandoned drawing are ignored. */
  const sessionRef = useRef(0)
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  // Remember the last tool/snap choice — a coordinator who traces forest roads
  // all morning should not have to switch snapping back on for every drawing.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as
        | { tool?: DrawingTool; snap?: boolean; profile?: SnapProfile }
        | null
      if (saved?.tool === 'freehand' || saved?.tool === 'points') setToolState(saved.tool)
      if (typeof saved?.snap === 'boolean') setSnapState(saved.snap)
      if (saved?.profile === 'foot' || saved?.profile === 'rescue_4x4' || saved?.profile === 'car') setProfileState(saved.profile)
    } catch {/* first run / private mode */}
  }, [])
  const prefsRef = useRef({ tool, snap, profile })
  prefsRef.current = { tool, snap, profile }
  const savePrefs = useCallback((patch: Partial<{ tool: DrawingTool; snap: boolean; profile: SnapProfile }>) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefsRef.current, ...patch }))
    } catch {/* non-critical */}
  }, [])

  const say = useCallback((text: string) => setNotice({ id: Date.now(), text }), [])

  /** A new undo step. */
  const push = useCallback((present: DraftPath[]) => {
    const h = historyRef.current
    commit({ past: [...h.past, h.present], present, future: [] })
  }, [commit])

  /** Rewrite one segment wherever it lives — including undo/redo snapshots. */
  const rewriteSegment = useCallback((segmentId: number, apply: (path: DraftPath, index: number) => DraftPath) => {
    const inSnapshot = (paths: DraftPath[]): DraftPath[] => {
      let changed = false
      const next = paths.map(path => {
        const index = path.segments.findIndex(s => s.id === segmentId)
        if (index === -1) return path
        changed = true
        return apply(path, index)
      })
      return changed ? next : paths
    }
    const h = historyRef.current
    commit({ past: h.past.map(inSnapshot), present: inSnapshot(h.present), future: h.future.map(inSnapshot) })
  }, [commit])

  const enqueueSnap = useCallback((segmentId: number) => {
    const session = sessionRef.current
    queueRef.current = queueRef.current.then(async () => {
      if (session !== sessionRef.current) return
      // Read the segment as it is NOW: its predecessor has resolved by this
      // point, so its end is where this leg really starts.
      let found: { path: DraftPath; index: number } | null = null
      for (const path of historyRef.current.present) {
        const index = path.segments.findIndex(s => s.id === segmentId)
        if (index !== -1) found = { path, index }
      }
      // Undone while waiting — leave it pending; redo asks again.
      if (!found) return
      const segment = found.path.segments[found.index]
      if (!segment.pending) return
      const from = found.index > 0 ? pathEnd({ ...found.path, segments: found.path.segments.slice(0, found.index) }) : null

      const drawn = segment.kind === 'leg'
        ? [from ?? segment.raw[0], segment.raw[segment.raw.length - 1]]
        : from && metersBetween(from, segment.raw[0]) > 1 ? [from, ...segment.raw] : segment.raw
      const result = await snapLine(segment.kind === 'leg' ? drawn : waypointsAlong(drawn), segment.profile)
      if (session !== sessionRef.current) return

      rewriteSegment(segmentId, (path, index) => {
        const segments = path.segments.slice()
        const current = segments[index]
        const previousEnd = index > 0 ? pathEnd({ ...path, segments: segments.slice(0, index) }) : null
        let coords: LngLat[] = result.snapped ? result.coordinates : drawn
        // Keep the chain continuous: a routed line begins on the network, which
        // may be a few metres from where the previous segment left off.
        if (previousEnd && metersBetween(previousEnd, coords[0]) > 1) coords = [previousEnd, ...coords]
        segments[index] = { ...current, coords, snapped: result.snapped, pending: false }
        // A following straight leg was drawn from the raw click; move its start
        // to where this one actually ended so there is no kink between them.
        const following = segments[index + 1]
        if (following && !following.pending && !following.snapped && following.kind === 'leg') {
          segments[index + 1] = { ...following, coords: [coords[coords.length - 1], ...following.coords.slice(1)] }
        }
        return { ...path, start: index === 0 ? coords[0] : path.start, segments }
      })
      if (!result.snapped && result.reason) say(NOTICE[result.reason])
    }).catch(() => {/* a failed snap leaves the stroke as drawn */})
  }, [rewriteSegment, say])

  const begin = useCallback(() => {
    sessionRef.current += 1
    queueRef.current = Promise.resolve()
    commit(EMPTY)
    setNotice(null)
    setPhase('drawing')
  }, [commit])

  const reset = useCallback(() => {
    sessionRef.current += 1
    queueRef.current = Promise.resolve()
    commit(EMPTY)
    setNotice(null)
    setPhase('idle')
  }, [commit])

  const closeLast = (paths: DraftPath[]): DraftPath[] => {
    const last = paths[paths.length - 1]
    if (!last || last.closed) return paths
    // A lone click that never became a line is not worth keeping.
    if (last.segments.length === 0) return paths.slice(0, -1)
    return [...paths.slice(0, -1), { ...last, closed: true }]
  }

  const addPoint = useCallback((point: LngLat) => {
    const { snap: wantSnap, profile: currentProfile } = prefsRef.current
    const paths = historyRef.current.present
    const last = paths[paths.length - 1]
    if (!last || last.closed) {
      push([...paths, { id: nextId(), start: point, segments: [], closed: false }])
      return
    }
    const from = pathEnd(last)
    if (metersBetween(from, point) < 0.5) return
    const segment: DraftSegment = {
      id: nextId(),
      kind: 'leg',
      coords: [from, point],
      raw: [from, point],
      wantSnap,
      profile: currentProfile,
      snapped: false,
      pending: wantSnap,
    }
    push([...paths.slice(0, -1), { ...last, segments: [...last.segments, segment] }])
    if (wantSnap) enqueueSnap(segment.id)
  }, [push, enqueueSnap])

  const endPath = useCallback(() => {
    const paths = historyRef.current.present
    const closed = closeLast(paths)
    if (closed !== paths) push(closed)
  }, [push])

  const reopenLast = useCallback(() => {
    const paths = historyRef.current.present
    const last = paths[paths.length - 1]
    if (!last || !last.closed) return
    push([...paths.slice(0, -1), { ...last, closed: false }])
  }, [push])

  const addStroke = useCallback((coords: LngLat[], continuePrevious: boolean) => {
    if (coords.length < 2) return
    const { snap: wantSnap, profile: currentProfile } = prefsRef.current
    const paths = historyRef.current.present
    const last = paths[paths.length - 1]
    const segment: DraftSegment = {
      id: nextId(),
      kind: 'stroke',
      coords,
      raw: coords,
      wantSnap,
      profile: currentProfile,
      snapped: false,
      pending: wantSnap,
    }
    if (continuePrevious && last) {
      // Picked up from the end of the previous line: one continuous path.
      const joined = { ...segment, coords: [pathEnd(last), ...coords] }
      push([...paths.slice(0, -1), { ...last, closed: true, segments: [...last.segments, joined] }])
    } else {
      push([...closeLast(paths), { id: nextId(), start: coords[0], segments: [segment], closed: true }])
    }
    if (wantSnap) enqueueSnap(segment.id)
  }, [push, enqueueSnap])

  const undo = useCallback(() => {
    const h = historyRef.current
    if (h.past.length === 0) return
    commit({ past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] })
  }, [commit])

  const redo = useCallback(() => {
    const h = historyRef.current
    if (h.future.length === 0) return
    const present = h.future[0]
    commit({ past: [...h.past, h.present], present, future: h.future.slice(1) })
    // Anything undone before its snap landed is still waiting for one.
    for (const path of present) for (const segment of path.segments) if (segment.pending) enqueueSnap(segment.id)
  }, [commit, enqueueSnap])

  const clear = useCallback(() => {
    if (historyRef.current.present.length > 0) push([])
  }, [push])

  const finish = useCallback(() => {
    const paths = historyRef.current.present
    const closed = closeLast(paths)
    if (closed.every(p => p.segments.length === 0)) return
    if (closed !== paths) push(closed)
    setPhase('details')
  }, [push])

  const resume = useCallback(() => setPhase('drawing'), [])

  const setTool = useCallback((next: DrawingTool) => {
    setToolState(next)
    savePrefs({ tool: next })
  }, [savePrefs])
  const setSnap = useCallback((next: boolean) => {
    setSnapState(next)
    savePrefs({ snap: next })
  }, [savePrefs])
  const setProfile = useCallback((next: SnapProfile) => {
    setProfileState(next)
    savePrefs({ profile: next })
  }, [savePrefs])
  const dismissNotice = useCallback(() => setNotice(null), [])

  const derived = useMemo(() => {
    const paths = history.present
    const lines = paths.map(pathCoords).filter(line => line.length >= 2)
    const last = paths[paths.length - 1]
    return {
      lines,
      distanceMeters: lines.reduce((sum, line) => sum + lineLengthMeters(line), 0),
      pending: paths.some(p => p.segments.some(s => s.pending)),
      snappedAny: paths.some(p => p.segments.some(s => s.snapped)),
      isEmpty: paths.length === 0,
      openEnd: last && !last.closed ? pathEnd(last) : null,
      lastEnd: last ? pathEnd(last) : null,
    }
  }, [history.present])

  return useMemo(() => ({
    phase,
    tool,
    snap,
    profile,
    paths: history.present,
    ...derived,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    notice,
    begin,
    reset,
    setTool,
    setSnap,
    setProfile,
    addPoint,
    endPath,
    reopenLast,
    addStroke,
    undo,
    redo,
    clear,
    finish,
    resume,
    dismissNotice,
  }), [
    phase, tool, snap, profile, history, derived, notice,
    begin, reset, setTool, setSnap, setProfile, addPoint, endPath, reopenLast, addStroke, undo, redo, clear, finish, resume, dismissNotice,
  ])
}
