import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import {
  Play, Square, Plus, Trash2, Users, Shield,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import {
  createMedic, createParticipant, stepEntity,
  type SimEntity, type MedicStatus, type RouteMode,
} from './simulation'
import {
  setApiBase, connectMedicSocket, disconnectMedicSocket, disconnectAllSockets,
  joinAsParticipant, joinAsMedic, sendMedicLocation,
  sendParticipantLocation, fetchMedicRoster, addMedicToRoster,
  createIncident, fetchTracks, fetchIncidents,
  assignMedicDestination, setMedicStatus, respondToIncident,
  sendIncidentMessage, createIncidentAsMedic,
  type LogEntry, type Track, type SimIncident,
} from './api'
import { MedicControlPanel, type MapMode } from './MedicControlPanel'

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const CENTER: [number, number] = [23.3219, 42.6977]
const MAX_LOG = 120

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogEntry(entry: Omit<LogEntry, 'id' | 'ts'>): LogEntry {
  return {
    ...entry,
    id: Math.random().toString(36).slice(2),
    ts: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  }
}

function logColor(type: LogEntry['type']) {
  switch (type) {
    case 'success': return '#22c55e'
    case 'error': return '#f87171'
    case 'ws': return '#60a5fa'
    default: return '#64748b'
  }
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())

  const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  const [apiUrl, setApiUrl] = useState(viteEnv.VITE_API_URL ?? 'http://localhost:8500')
  const [eventId, setEventId] = useState(viteEnv.VITE_EVENT_ID ?? 'event-demo')
  const [running, setRunning] = useState(false)
  const [speedMultiplier, setSpeedMultiplier] = useState(1)
  const [entities, setEntities] = useState<SimEntity[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [tab, setTab] = useState<'medics' | 'participants' | 'settings'>('medics')
  const [bulkCount, setBulkCount] = useState(5)
  const [showLog, setShowLog] = useState(true)
  const [medicRoster, setMedicRoster] = useState<{ id: string; name: string }[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lat: number; lng: number } | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  // 'random' means random walk; otherwise it's a track id
  const [medicRouteId, setMedicRouteId] = useState<string>('random')
  const [participantRouteId, setParticipantRouteId] = useState<string>('random')
  const [participantSpeed, setParticipantSpeed] = useState<number>(3)

  // ── Per-medic control ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapMode, setMapMode] = useState<MapMode>(null)
  const [incidents, setIncidents] = useState<SimIncident[]>([])
  const [medicCtx, setMedicCtx] = useState<{ x: number; y: number; id: string } | null>(null)

  const entitiesRef = useRef<SimEntity[]>([])
  const mapModeRef = useRef<MapMode>(null)
  const selectedIdRef = useRef<string | null>(null)
  const onMapModeClickRef = useRef<((lat: number, lng: number) => void) | null>(null)
  const selectMedicRef = useRef<((id: string | null) => void) | null>(null)
  const openMedicCtxRef = useRef<((x: number, y: number, id: string) => void) | null>(null)
  const runningRef = useRef(false)
  mapModeRef.current = mapMode
  selectedIdRef.current = selectedId
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const medicSendRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const participantSendRef = useRef<ReturnType<typeof setInterval> | null>(null)

  entitiesRef.current = entities
  runningRef.current = running

  const log = useCallback((entry: Omit<LogEntry, 'id' | 'ts'>) => {
    setLogs(prev => [makeLogEntry(entry), ...prev].slice(0, MAX_LOG))
  }, [])

  // ─── Fetch tracks whenever eventId changes ───────────────────────────────────

  useEffect(() => {
    setApiBase(apiUrl)
    fetchTracks(eventId)
      .then(t => {
        setTracks(t)
        if (t.length > 0) log({ type: 'info', message: `Loaded ${t.length} track(s)` })
      })
      .catch(() => {
        // Silently ignore — backend may not have tracks configured yet
        setTracks([])
      })
  }, [eventId, apiUrl, log])

  // ─── Map init ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: CENTER,
      zoom: 13,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    mapRef.current = map

    map.on('contextmenu', (e) => {
      e.originalEvent.preventDefault()
      const rect = mapContainerRef.current!.getBoundingClientRect()
      setCtxMenu({
        x: e.originalEvent.clientX - rect.left,
        y: e.originalEvent.clientY - rect.top,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      })
    })

    map.on('click', (e) => {
      setCtxMenu(null)
      setMedicCtx(null)
      onMapModeClickRef.current?.(e.lngLat.lat, e.lngLat.lng)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ─── Sync markers to map ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!mapRef.current) return
    const map = mapRef.current
    const current = new Set(entities.map(e => e.id))

    // Remove stale markers
    for (const [id, marker] of markersRef.current) {
      if (!current.has(id)) {
        marker.remove()
        markersRef.current.delete(id)
      }
    }

    // Add / update markers
    for (const entity of entities) {
      let marker = markersRef.current.get(entity.id)
      if (!marker) {
        const el = document.createElement('div')
        el.style.cssText = `
          width: 30px; height: 30px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 10px; font-weight: 800; color: #fff;
          box-shadow: 0 2px 10px rgba(0,0,0,0.5);
          cursor: pointer; transition: box-shadow 0.2s, border 0.2s, opacity 0.2s;
        `
        el.style.background = entity.color
        el.title = entity.name
        el.textContent = entity.name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')

        if (entity.role === 'medic') {
          const id = entity.id
          el.addEventListener('click', (ev) => { ev.stopPropagation(); selectMedicRef.current?.(id) })
          el.addEventListener('contextmenu', (ev) => {
            ev.preventDefault(); ev.stopPropagation()
            const rect = mapContainerRef.current!.getBoundingClientRect()
            openMedicCtxRef.current?.(ev.clientX - rect.left, ev.clientY - rect.top, id)
          })
        }

        marker = new maplibregl.Marker({ element: el })
          .setLngLat([entity.lng, entity.lat])
          .addTo(map)
        markersRef.current.set(entity.id, marker)
      } else {
        marker.setLngLat([entity.lng, entity.lat])
      }

      // Reflect live state in the marker visuals.
      const el = marker.getElement() as HTMLElement
      const selected = entity.id === selectedId
      const borderColor =
        selected ? '#ffffff'
        : entity.offline ? '#475569'
        : entity.paused ? '#f59e0b'
        : entity.status === 'going_to' ? '#f59e0b'
        : entity.status === 'rest' ? '#a78bfa'
        : 'rgba(255,255,255,0.85)'
      el.style.border = `${selected ? 3 : 2.5}px solid ${borderColor}`
      el.style.borderStyle = entity.offline ? 'dashed' : 'solid'
      el.style.opacity = entity.joined && !entity.offline ? '1' : '0.45'
      el.style.boxShadow = selected
        ? `0 0 0 4px ${entity.color}55, 0 2px 12px rgba(0,0,0,0.6)`
        : '0 2px 10px rgba(0,0,0,0.5)'
      el.style.zIndex = selected ? '10' : '1'
    }
  }, [entities, selectedId])

  // ─── Movement tick ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!running) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      return
    }
    tickRef.current = setInterval(() => {
      setEntities(prev => prev.map(e => stepEntity(e, 1, speedMultiplier)))
    }, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [running, speedMultiplier])

  // ─── Medic WS send (every 2s in simulator, vs 25s on real device) ───────────

  useEffect(() => {
    if (!running) {
      if (medicSendRef.current) { clearInterval(medicSendRef.current); medicSendRef.current = null }
      return
    }
    medicSendRef.current = setInterval(() => {
      const medics = entitiesRef.current.filter(e => e.role === 'medic' && e.joined)
      for (const m of medics) sendMedicLocation(m, eventId, log)
    }, 2_000)
    return () => { if (medicSendRef.current) clearInterval(medicSendRef.current) }
  }, [running, log])

  // ─── Participant HTTP send (every 10s in simulator, vs 60s on real device) ──

  useEffect(() => {
    if (!running) {
      if (participantSendRef.current) { clearInterval(participantSendRef.current); participantSendRef.current = null }
      return
    }
    participantSendRef.current = setInterval(() => {
      const participants = entitiesRef.current.filter(e => e.role === 'participant' && e.joined)
      for (const p of participants) void sendParticipantLocation(eventId, p, log)
    }, 10_000)
    return () => { if (participantSendRef.current) clearInterval(participantSendRef.current) }
  }, [running, eventId, log])

  // ─── Actions ─────────────────────────────────────────────────────────────────

  // ─── Route helpers ────────────────────────────────────────────────────────────

  /**
   * Given a track and the number of entities already assigned to that route,
   * pick a starting waypoint index spread evenly so entities don't pile up.
   */
  function routeStartIndex(points: Array<{ lat: number; lng: number }>, existingCount: number): number {
    if (points.length <= 1) return 0
    return existingCount % (points.length - 1)
  }

  const applyApiUrl = useCallback(() => {
    setApiBase(apiUrl)
    log({ type: 'info', message: `API base set to ${apiUrl}` })
  }, [apiUrl, log])

  const loadRoster = useCallback(async () => {
    setApiBase(apiUrl)
    try {
      const roster = await fetchMedicRoster(eventId)
      setMedicRoster(roster)
      log({ type: 'success', message: `Loaded ${roster.length} medic(s) from roster` })
    } catch (err) {
      log({ type: 'error', message: `Roster load failed: ${(err as Error).message}` })
    }
  }, [apiUrl, eventId, log])

  const addMedics = useCallback(async (count: number) => {
    setApiBase(apiUrl)
    const current = entitiesRef.current.filter(e => e.role === 'medic').length
    const newMedics: SimEntity[] = []

    const selectedTrack = medicRouteId !== 'random'
      ? tracks.find(t => t.id === medicRouteId) ?? null
      : null

    for (let i = 0; i < count; i++) {
      let entity = createMedic(current + i)

      // Apply route if one is selected
      if (selectedTrack && selectedTrack.points.length >= 2) {
        const existingOnRoute = entitiesRef.current.filter(
          e => e.routePoints === selectedTrack.points || (e.routePoints && e.routePoints[0]?.lat === selectedTrack.points[0]?.lat)
        ).length + i
        const startIdx = routeStartIndex(selectedTrack.points, existingOnRoute)
        const startPt = selectedTrack.points[startIdx]
        entity = {
          ...entity,
          lat: startPt.lat,
          lng: startPt.lng,
          routePoints: selectedTrack.points,
          routeIndex: startIdx,
          routeLoop: true,
          routeVariance: 20,
        }
      }

      // Register in roster and get a real medicId
      try {
        const rosterEntry = await addMedicToRoster(eventId, entity.name)
        const token = await joinAsMedic(eventId, entity, rosterEntry.id, log)
        if (token) {
          connectMedicSocket(entity.id, eventId, token, log)
          newMedics.push({ ...entity, token, medicId: rosterEntry.id, joined: true })
        } else {
          newMedics.push({ ...entity, medicId: rosterEntry.id })
        }
      } catch (err) {
        log({ type: 'error', message: `Could not add medic to roster: ${(err as Error).message}` })
        newMedics.push(entity)
      }
    }

    setEntities(prev => [...prev, ...newMedics])
    log({ type: 'info', message: `Added ${count} medic${count > 1 ? 's' : ''}` })
  }, [apiUrl, eventId, log, medicRouteId, tracks])

  const addParticipants = useCallback(async (count: number) => {
    setApiBase(apiUrl)
    const current = entitiesRef.current.filter(e => e.role === 'participant').length
    const newParticipants: SimEntity[] = []

    const selectedTrack = participantRouteId !== 'random'
      ? tracks.find(t => t.id === participantRouteId) ?? null
      : null

    for (let i = 0; i < count; i++) {
      let entity = createParticipant(current + i)
      // Apply speed from the speed dropdown
      entity = { ...entity, speed: participantSpeed }

      // Apply route if one is selected
      if (selectedTrack && selectedTrack.points.length >= 2) {
        const existingOnRoute = entitiesRef.current.filter(
          e => e.routePoints && e.routePoints[0]?.lat === selectedTrack.points[0]?.lat
        ).length + i
        const startIdx = routeStartIndex(selectedTrack.points, existingOnRoute)
        const startPt = selectedTrack.points[startIdx]
        entity = {
          ...entity,
          lat: startPt.lat,
          lng: startPt.lng,
          routePoints: selectedTrack.points,
          routeIndex: startIdx,
          routeLoop: true,
          routeVariance: 2,
        }
      }

      const token = await joinAsParticipant(eventId, entity, log)
      newParticipants.push(token ? { ...entity, token, joined: true } : entity)
    }

    setEntities(prev => [...prev, ...newParticipants])
    log({ type: 'info', message: `Added ${count} participant${count > 1 ? 's' : ''}` })
  }, [apiUrl, eventId, log, participantRouteId, participantSpeed, tracks])

  const removeEntity = useCallback((id: string) => {
    disconnectMedicSocket(id)
    setEntities(prev => prev.filter(e => e.id !== id))
  }, [])

  const clearAll = useCallback(() => {
    setEntities([])
    disconnectAllSockets()
    log({ type: 'info', message: 'All entities removed, WS disconnected' })
  }, [log])

  const startStop = useCallback(() => {
    if (!running) {
      setApiBase(apiUrl)
      // Send first location immediately on start
      setTimeout(() => {
        const medics = entitiesRef.current.filter(e => e.role === 'medic' && e.joined)
        for (const m of medics) sendMedicLocation(m, eventId, log)
        const parts = entitiesRef.current.filter(e => e.role === 'participant' && e.joined)
        for (const p of parts) void sendParticipantLocation(eventId, p, log)
      }, 500)
    }
    setRunning(r => !r)
  }, [running, apiUrl, eventId, log])

  // ─── Context menu actions ─────────────────────────────────────────────────────

  const ctxAddMedic = useCallback(async (lat: number, lng: number) => {
    setCtxMenu(null)
    setApiBase(apiUrl)
    const idx = entitiesRef.current.filter(e => e.role === 'medic').length
    const entity = { ...createMedic(idx), lat, lng }
    try {
      const rosterEntry = await addMedicToRoster(eventId, entity.name)
      const token = await joinAsMedic(eventId, entity, rosterEntry.id, log)
      if (token) {
        connectMedicSocket(entity.id, eventId, token, log)
        setEntities(prev => [...prev, { ...entity, token, medicId: rosterEntry.id, joined: true }])
      } else {
        setEntities(prev => [...prev, { ...entity, medicId: rosterEntry.id }])
      }
    } catch (err) {
      log({ type: 'error', message: `Could not add medic: ${(err as Error).message}` })
      setEntities(prev => [...prev, entity])
    }
  }, [apiUrl, eventId, log])

  const ctxAddParticipant = useCallback(async (lat: number, lng: number) => {
    setCtxMenu(null)
    setApiBase(apiUrl)
    const idx = entitiesRef.current.filter(e => e.role === 'participant').length
    const entity = { ...createParticipant(idx), lat, lng }
    const token = await joinAsParticipant(eventId, entity, log)
    setEntities(prev => [...prev, token ? { ...entity, token, joined: true } : entity])
  }, [apiUrl, eventId, log])

  const ctxAddIncident = useCallback(async (lat: number, lng: number) => {
    setCtxMenu(null)
    setApiBase(apiUrl)
    const anyJoined = entitiesRef.current.find(e => e.joined && e.token)
    const token = anyJoined?.token ?? 'dev-token'
    try {
      await createIncident(eventId, token, lat, lng, log)
    } catch (err) {
      log({ type: 'error', message: `Incident failed: ${(err as Error).message}` })
    }
  }, [apiUrl, eventId, log])

  // ─── Per-medic control handlers ───────────────────────────────────────────────

  const patchEntity = useCallback((id: string, patch: Partial<SimEntity>) => {
    setEntities(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const getEntity = useCallback((id: string) => entitiesRef.current.find(e => e.id === id), [])

  const selectMedic = useCallback((id: string | null) => {
    setSelectedId(id)
    setMapMode(null)
    if (id) {
      const e = entitiesRef.current.find(x => x.id === id)
      if (e) mapRef.current?.flyTo({ center: [e.lng, e.lat], zoom: Math.max(mapRef.current.getZoom(), 14), duration: 600 })
    }
  }, [])

  const refreshIncidents = useCallback(async () => {
    setApiBase(apiUrl)
    try {
      const list = await fetchIncidents(eventId)
      setIncidents(list.filter(i => i.status !== 'closed' && i.status !== 'archived'))
    } catch (err) {
      log({ type: 'error', message: `Incidents load failed: ${(err as Error).message}` })
    }
  }, [apiUrl, eventId, log])

  const setMedicStatusFn = useCallback((id: string, status: MedicStatus) => {
    const e = getEntity(id); if (!e) return
    patchEntity(id, { status })
    void setMedicStatus(eventId, e, status, log)
  }, [eventId, getEntity, log, patchEntity])

  const sendMedicHere = useCallback((id: string, lat: number, lng: number, label = 'map point') => {
    const e = getEntity(id); if (!e) return
    patchEntity(id, {
      routePoints: [{ lat: e.lat, lng: e.lng }, { lat, lng }],
      routeIndex: 0, routeMode: 'once', routeDir: 1, routeLabel: label,
      status: 'going_to', paused: false,
    })
    void assignMedicDestination(eventId, e, { lat, lng, label }, log)
    void setMedicStatus(eventId, e, 'going_to', log)
  }, [eventId, getEntity, log, patchEntity])

  const addWaypoint = useCallback((id: string, lat: number, lng: number) => {
    const e = getEntity(id); if (!e) return
    const existing = e.routePoints && e.routePoints.length >= 1 ? e.routePoints : [{ lat: e.lat, lng: e.lng }]
    patchEntity(id, {
      routePoints: [...existing, { lat, lng }],
      routeIndex: e.routePoints ? e.routeIndex ?? 0 : 0,
      routeMode: e.routeMode === 'loop' || e.routeMode === 'pingpong' ? e.routeMode : 'once',
      routeDir: 1, routeLabel: 'waypoint queue', paused: false,
    })
    log({ type: 'info', message: `[M] ${e.name} waypoint added (${existing.length})` })
  }, [getEntity, log, patchEntity])

  const clearMedicRoute = useCallback((id: string) => {
    const e = getEntity(id); if (!e) return
    patchEntity(id, { routePoints: undefined, routeIndex: undefined, routeLabel: undefined, routeMode: undefined, assignedIncidentId: undefined, status: 'available' })
    void assignMedicDestination(eventId, e, null, log)
    void setMedicStatus(eventId, e, 'available', log)
  }, [eventId, getEntity, log, patchEntity])

  const followTrack = useCallback((id: string, trackId: string, mode: RouteMode, dir: 1 | -1) => {
    const e = getEntity(id); if (!e) return
    const track = tracks.find(t => t.id === trackId)
    if (!track || track.points.length < 2) return
    const startPt = dir > 0 ? track.points[0] : track.points[track.points.length - 1]
    patchEntity(id, {
      lat: startPt.lat, lng: startPt.lng,
      routePoints: track.points, routeIndex: dir > 0 ? 0 : track.points.length - 1,
      routeMode: mode, routeDir: dir, routeLabel: track.label, routeVariance: 8,
      status: 'going_to', paused: false,
    })
    log({ type: 'info', message: `[M] ${e.name} following ${track.label} (${mode})` })
  }, [getEntity, log, patchEntity, tracks])

  const sendToIncident = useCallback((id: string, incident: SimIncident) => {
    const e = getEntity(id); if (!e) return
    const label = incident.name ?? 'incident'
    patchEntity(id, {
      routePoints: [{ lat: e.lat, lng: e.lng }, { lat: incident.lat, lng: incident.lng }],
      routeIndex: 0, routeMode: 'once', routeDir: 1, routeLabel: label,
      status: 'going_to', assignedIncidentId: incident.id, paused: false,
    })
    void assignMedicDestination(eventId, e, { lat: incident.lat, lng: incident.lng, label }, log)
    void respondToIncident(eventId, incident.id, e, log)
    void setMedicStatus(eventId, e, 'going_to', log)
  }, [eventId, getEntity, log, patchEntity])

  const reportIncident = useCallback(async (id: string, at?: { lat: number; lng: number }, details?: { type?: string; severity?: string; description?: string }) => {
    const e = getEntity(id); if (!e) return
    const lat = at?.lat ?? e.lat
    const lng = at?.lng ?? e.lng
    const incId = await createIncidentAsMedic(eventId, e, lat, lng, details ?? {}, log)
    if (incId) {
      patchEntity(id, { assignedIncidentId: incId })
      void refreshIncidents()
    }
  }, [eventId, getEntity, log, patchEntity, refreshIncidents])

  const sendChat = useCallback((id: string, text: string) => {
    const e = getEntity(id); if (!e || !e.assignedIncidentId || !text.trim()) return
    void sendIncidentMessage(eventId, e.assignedIncidentId, e, text.trim(), log)
  }, [eventId, getEntity, log])

  // Map-mode click: send-here / add-waypoint / report-incident for the active medic.
  onMapModeClickRef.current = (lat: number, lng: number) => {
    const mode = mapModeRef.current
    if (!mode) return
    if (mode.kind === 'sendHere') sendMedicHere(mode.id, lat, lng)
    else if (mode.kind === 'addWaypoint') { addWaypoint(mode.id, lat, lng); return /* keep mode for multi-add */ }
    else if (mode.kind === 'report') void reportIncident(mode.id, { lat, lng })
    setMapMode(null)
  }
  selectMedicRef.current = selectMedic
  openMedicCtxRef.current = (x: number, y: number, id: string) => setMedicCtx({ x, y, id })

  // Refresh the incident list when a medic is selected (for the "send to incident" picker).
  useEffect(() => {
    if (selectedId) void refreshIncidents()
  }, [selectedId, refreshIncidents])

  const selectedEntity = entities.find(e => e.id === selectedId && e.role === 'medic') ?? null

  // ─── Counts ──────────────────────────────────────────────────────────────────

  const medicCount = entities.filter(e => e.role === 'medic').length
  const participantCount = entities.filter(e => e.role === 'participant').length
  const joinedCount = entities.filter(e => e.joined).length

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#030d1f', overflow: 'hidden' }}>

      {/* ── Left panel ── */}
      <div style={{
        width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderRight: '1px solid rgba(148,163,184,0.1)',
        background: 'rgba(5,15,30,0.95)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <img src="/logo.png" alt="Logo" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#e2e8f0' }}>Simulator</div>
              <div style={{ fontSize: 11, color: '#475569' }}>Event testing tool</div>
            </div>
          </div>

          {/* Status row */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <StatChip label="Medics" value={medicCount} color="#22c55e" />
            <StatChip label="Runners" value={participantCount} color="#3b82f6" />
            <StatChip label="Joined" value={joinedCount} color="#8b5cf6" />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
          {(['medics', 'participants', 'settings'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px 0', fontSize: 11, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: tab === t ? '#e2e8f0' : '#475569',
              borderBottom: tab === t ? '2px solid #22c55e' : '2px solid transparent',
              transition: 'color 0.15s',
            }}>
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {tab === 'medics' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <AddPanel
                label="Add Medics"
                icon={<Shield size={14} />}
                color="#22c55e"
                count={bulkCount}
                setCount={setBulkCount}
                onAdd={() => addMedics(bulkCount)}
                onAddOne={() => addMedics(1)}
              >
                <RouteDropdown
                  tracks={tracks}
                  value={medicRouteId}
                  onChange={setMedicRouteId}
                />
              </AddPanel>
              <EntityList
                entities={entities.filter(e => e.role === 'medic')}
                onRemove={removeEntity}
                accentColor="#22c55e"
                onSelect={selectMedic}
                selectedId={selectedId}
              />
            </div>
          )}

          {tab === 'participants' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <AddPanel
                label="Add Participants"
                icon={<Users size={14} />}
                color="#3b82f6"
                count={bulkCount}
                setCount={setBulkCount}
                onAdd={() => addParticipants(bulkCount)}
                onAddOne={() => addParticipants(1)}
              >
                <RouteDropdown
                  tracks={tracks}
                  value={participantRouteId}
                  onChange={setParticipantRouteId}
                />
                <SpeedDropdown value={participantSpeed} onChange={setParticipantSpeed} />
              </AddPanel>
              <EntityList
                entities={entities.filter(e => e.role === 'participant')}
                onRemove={removeEntity}
                accentColor="#3b82f6"
              />
            </div>
          )}

          {tab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <SettingsGroup label="Server">
                <LabeledInput label="API URL" value={apiUrl} onChange={setApiUrl} />
                <LabeledInput label="Event ID" value={eventId} onChange={setEventId} />
                <SButton onClick={applyApiUrl} color="#3b82f6">Apply & reconnect</SButton>
              </SettingsGroup>
              <SettingsGroup label="Simulation">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>Speed multiplier</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[1, 3, 5, 10].map(x => (
                      <button key={x} onClick={() => setSpeedMultiplier(x)} style={{
                        width: 36, height: 28, borderRadius: 7, border: 'none', cursor: 'pointer',
                        fontSize: 11, fontWeight: 700,
                        background: speedMultiplier === x ? '#22c55e' : 'rgba(255,255,255,0.06)',
                        color: speedMultiplier === x ? '#0f2513' : '#64748b',
                      }}>
                        {x}×
                      </button>
                    ))}
                  </div>
                </div>
              </SettingsGroup>
              <SettingsGroup label="Danger zone">
                <SButton onClick={clearAll} color="#ef4444">Clear all entities</SButton>
              </SettingsGroup>
            </div>
          )}
        </div>

        {/* Start/stop */}
        <div style={{ padding: 16, borderTop: '1px solid rgba(148,163,184,0.08)' }}>
          <button
            onClick={startStop}
            style={{
              width: '100%', height: 48, borderRadius: 14, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontSize: 14, fontWeight: 800,
              background: running
                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                : 'linear-gradient(135deg, #22c55e, #16a34a)',
              color: running ? '#fff' : '#0f2513',
              boxShadow: running
                ? '0 4px 14px rgba(239,68,68,0.35)'
                : '0 4px 14px rgba(34,197,94,0.35)',
              transition: 'all 0.2s',
            }}
          >
            {running ? <Square size={16} /> : <Play size={16} />}
            {running ? 'Stop simulation' : 'Start simulation'}
          </button>
        </div>
      </div>

      {/* ── Map ── */}
      <div style={{ flex: 1, position: 'relative' }} onContextMenu={e => e.preventDefault()}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

        {/* Speed badge */}
        {running && (
          <div style={{
            position: 'absolute', top: 16, left: 16,
            background: 'rgba(10,18,34,0.92)', backdropFilter: 'blur(12px)',
            borderRadius: 12, border: '1px solid rgba(34,197,94,0.25)',
            padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>
              Running {speedMultiplier}×
            </span>
          </div>
        )}

        {/* Entity count overlay */}
        <div style={{
          position: 'absolute', top: 16, right: 56,
          background: 'rgba(10,18,34,0.92)', backdropFilter: 'blur(12px)',
          borderRadius: 12, border: '1px solid rgba(148,163,184,0.12)',
          padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <CountBadge value={medicCount} label="medics" color="#22c55e" />
          <div style={{ width: 1, height: 16, background: 'rgba(148,163,184,0.15)' }} />
          <CountBadge value={participantCount} label="runners" color="#3b82f6" />
        </div>

        {/* Context menu */}
        {ctxMenu && (
          <div
            style={{
              position: 'absolute',
              top: ctxMenu.y,
              left: ctxMenu.x,
              zIndex: 100,
              background: 'rgba(8,18,36,0.97)',
              border: '1px solid rgba(148,163,184,0.18)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
              overflow: 'hidden',
              minWidth: 200,
            }}
          >
            <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid rgba(148,163,184,0.08)' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Add at location
              </span>
            </div>
            {([
              { label: 'Add Medic here', color: '#22c55e', action: () => ctxAddMedic(ctxMenu.lat, ctxMenu.lng) },
              { label: 'Add Participant here', color: '#3b82f6', action: () => ctxAddParticipant(ctxMenu.lat, ctxMenu.lng) },
              { label: 'Add Incident here', color: '#ef4444', action: () => ctxAddIncident(ctxMenu.lat, ctxMenu.lng) },
            ] as const).map(item => (
              <button
                key={item.label}
                onClick={item.action}
                style={{
                  display: 'block', width: '100%', padding: '10px 16px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontSize: 13, fontWeight: 700, color: item.color,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${item.color}14` }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {/* Map-mode banner */}
        {mapMode && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 65,
            background: 'rgba(245,158,11,0.95)', color: '#1a1206', borderRadius: 999,
            padding: '9px 18px', fontSize: 12.5, fontWeight: 800, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            {mapMode.kind === 'sendHere' ? 'Click the map to send the medic there'
              : mapMode.kind === 'addWaypoint' ? 'Click to queue waypoints — finish in the panel'
              : 'Click the map to report an incident there'}
            <button onClick={() => setMapMode(null)} style={{ border: 'none', background: 'rgba(0,0,0,0.18)', color: '#1a1206', borderRadius: 999, width: 22, height: 22, cursor: 'pointer', fontWeight: 900 }}>✕</button>
          </div>
        )}

        {/* Medic marker context menu */}
        {medicCtx && (() => {
          const m = entities.find(e => e.id === medicCtx.id)
          if (!m) return null
          const items: Array<{ label: string; color: string; action: () => void }> = [
            { label: 'Open control panel', color: '#e2e8f0', action: () => selectMedic(m.id) },
            { label: 'Send here (pick on map)', color: '#22c55e', action: () => { selectMedic(m.id); setMapMode({ kind: 'sendHere', id: m.id }) } },
            { label: m.paused ? 'Resume movement' : 'Freeze in place', color: '#f59e0b', action: () => patchEntity(m.id, { paused: !m.paused }) },
            { label: m.offline ? 'Go online' : 'Go offline', color: '#64748b', action: () => patchEntity(m.id, { offline: !m.offline }) },
            { label: 'Report incident here', color: '#ef4444', action: () => void reportIncident(m.id) },
            { label: 'Remove medic', color: '#f87171', action: () => removeEntity(m.id) },
          ]
          return (
            <div style={{ position: 'absolute', top: medicCtx.y, left: medicCtx.x, zIndex: 100, background: 'rgba(8,18,36,0.98)', border: '1px solid rgba(148,163,184,0.18)', borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.55)', overflow: 'hidden', minWidth: 210 }}>
              <div style={{ padding: '8px 12px 6px', borderBottom: '1px solid rgba(148,163,184,0.08)', fontSize: 11, fontWeight: 800, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
              {items.map(item => (
                <button key={item.label} onClick={() => { item.action(); setMedicCtx(null) }} style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12.5, fontWeight: 700, color: item.color }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${item.color}14` }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'none' }}>{item.label}</button>
              ))}
            </div>
          )
        })()}

        {/* Medic control panel */}
        {selectedEntity && (
          <MedicControlPanel
            medic={selectedEntity}
            incidents={incidents}
            tracks={tracks}
            mapMode={mapMode}
            onClose={() => selectMedic(null)}
            onPatch={(patch) => patchEntity(selectedEntity.id, patch)}
            onStatus={(s) => setMedicStatusFn(selectedEntity.id, s)}
            onSetMapMode={setMapMode}
            onSendToIncident={(inc) => sendToIncident(selectedEntity.id, inc)}
            onFollowTrack={(tid, mode, dir) => followTrack(selectedEntity.id, tid, mode, dir)}
            onClearRoute={() => clearMedicRoute(selectedEntity.id)}
            onReportNow={(details) => void reportIncident(selectedEntity.id, undefined, details)}
            onChat={(text) => sendChat(selectedEntity.id, text)}
            onRefreshIncidents={refreshIncidents}
            onRemove={() => { removeEntity(selectedEntity.id); selectMedic(null) }}
          />
        )}
      </div>

      {/* ── Log panel ── */}
      <div style={{
        width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderLeft: '1px solid rgba(148,163,184,0.1)',
        background: 'rgba(4,12,26,0.97)',
      }}>
        <div
          onClick={() => setShowLog(v => !v)}
          style={{
            padding: '12px 16px', borderBottom: '1px solid rgba(148,163,184,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            cursor: 'pointer', userSelect: 'none',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Request log
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: '#334155', background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '2px 6px' }}>
              {logs.length}
            </span>
            {showLog ? <ChevronDown size={14} color="#475569" /> : <ChevronUp size={14} color="#475569" />}
          </div>
        </div>

        {showLog && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
            {logs.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#334155', fontSize: 12 }}>
                No requests yet. Start the simulation to see log entries.
              </div>
            ) : (
              logs.map(entry => (
                <div key={entry.id} style={{ padding: '5px 14px', borderBottom: '1px solid rgba(148,163,184,0.04)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 9, color: '#334155', flexShrink: 0, fontFamily: 'monospace' }}>
                      {entry.ts}
                    </span>
                    <span style={{ fontSize: 11, color: logColor(entry.type), lineHeight: 1.4 }}>
                      {entry.message}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Clear log */}
        {logs.length > 0 && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(148,163,184,0.08)' }}>
            <button
              onClick={() => setLogs([])}
              style={{
                fontSize: 11, color: '#475569', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0,
              }}
            >
              Clear log
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.15); border-radius: 2px; }
      `}</style>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      flex: 1, padding: '8px 10px', borderRadius: 10, textAlign: 'center',
      background: `${color}12`, border: `1px solid ${color}25`,
    }}>
      <div style={{ fontSize: 18, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: '#475569', fontWeight: 600 }}>{label}</div>
    </div>
  )
}

function CountBadge({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>
        <span style={{ color }}>{value}</span> {label}
      </span>
    </div>
  )
}

function AddPanel({
  label, icon, color, count, setCount, onAdd, onAddOne, children
}: {
  label: string; icon: React.ReactNode; color: string
  count: number; setCount: (n: number) => void
  onAdd: () => void; onAddOne: () => void
  children?: React.ReactNode
}) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, border: '1px solid rgba(148,163,184,0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ color }}>{icon}</div>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>{label}</span>
      </div>
      {children && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {children}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="number"
          value={count}
          min={1}
          max={50}
          onChange={e => setCount(Math.max(1, Math.min(50, Number(e.target.value))))}
          style={{
            width: 60, height: 36, borderRadius: 10,
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.15)',
            color: '#e2e8f0', fontSize: 14, fontWeight: 700, textAlign: 'center',
            outline: 'none',
          }}
        />
        <button onClick={onAdd} style={{
          flex: 1, height: 36, borderRadius: 10, cursor: 'pointer',
          background: `${color}18`, color, fontWeight: 700, fontSize: 12,
          border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <Plus size={13} /> Add {count}
        </button>
        <button onClick={onAddOne} style={{
          width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)', color: '#64748b', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid rgba(148,163,184,0.1)',
        }}>
          +1
        </button>
      </div>
    </div>
  )
}

// ─── Route dropdown ────────────────────────────────────────────────────────────

const SELECT_STYLE: React.CSSProperties = {
  width: '100%', height: 32, borderRadius: 8, padding: '0 8px',
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.15)',
  color: '#e2e8f0', fontSize: 11, fontWeight: 600, outline: 'none',
  cursor: 'pointer', appearance: 'none' as const,
}

function RouteDropdown({
  tracks, value, onChange
}: {
  tracks: Track[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Route
      </div>
      <select value={value} onChange={e => onChange(e.target.value)} style={SELECT_STYLE}>
        <option value="random">Random walk</option>
        {tracks.map(t => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Speed dropdown ────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [
  { label: 'Walk (1.5 m/s)', value: 1.5 },
  { label: 'Jog (3 m/s)', value: 3 },
  { label: 'Run (4.5 m/s)', value: 4.5 },
  { label: 'Fast (6 m/s)', value: 6 },
]

function SpeedDropdown({
  value, onChange
}: {
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Speed
      </div>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={SELECT_STYLE}
      >
        {SPEED_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function EntityList({ entities, onRemove, accentColor, onSelect, selectedId }: {
  entities: SimEntity[]
  onRemove: (id: string) => void
  accentColor: string
  onSelect?: (id: string) => void
  selectedId?: string | null
}) {
  if (entities.length === 0) return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: '#334155', fontSize: 12 }}>
      No entities yet. Add some above.
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entities.map(e => (
        <div key={e.id} onClick={() => onSelect?.(e.id)} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
          borderRadius: 10, cursor: onSelect ? 'pointer' : 'default',
          background: selectedId === e.id ? `${accentColor}1c` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${selectedId === e.id ? accentColor + '55' : 'rgba(148,163,184,0.06)'}`,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: '50%',
            background: e.color, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 800, color: '#fff',
            opacity: e.joined ? 1 : 0.5,
          }}>
            {e.name.split(' ').slice(0, 2).map((w: string) => w[0]?.toUpperCase() ?? '').join('')}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#c0cfe0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.name}
            </div>
            <div style={{ fontSize: 10, color: e.joined ? accentColor : '#475569' }}>
              {e.offline ? 'offline' : e.paused ? 'frozen' : e.role === 'medic' ? (e.status ?? 'available') : e.joined ? 'joined' : 'not joined'}
              {e.bibNumber ? ` · #${e.bibNumber}` : ''}{e.role === 'medic' && e.routeLabel ? ` · → ${e.routeLabel}` : ''}
            </div>
          </div>
          <button
            onClick={(ev) => { ev.stopPropagation(); onRemove(e.id) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#334155', padding: 4 }}
            onMouseEnter={el => { (el.currentTarget as HTMLElement).style.color = '#ef4444' }}
            onMouseLeave={el => { (el.currentTarget as HTMLElement).style.color = '#334155' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

function SettingsGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, padding: 14, border: '1px solid rgba(148,163,184,0.08)' }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 5 }}>{label}</div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', height: 36, borderRadius: 10, padding: '0 12px',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(148,163,184,0.15)',
          color: '#e2e8f0', fontSize: 12, outline: 'none',
        }}
      />
    </div>
  )
}

function SButton({ children, onClick, color = '#22c55e' }: {
  children: React.ReactNode; onClick: () => void; color?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%', height: 36, borderRadius: 10, cursor: 'pointer',
        background: `${color}15`, color, fontWeight: 700, fontSize: 12,
        border: `1px solid ${color}25`,
      }}
    >
      {children}
    </button>
  )
}
