'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { IncidentMessage, MedicState } from '@events/contracts'
import { getActiveMedics } from '@/api/medics'
import {
  listIncidents,
  closeIncident as apiCloseIncident,
  actionIncident,
  listIncidentMessages,
  sendIncidentMessage,
} from '@/api/incidents'
import { wsUrl } from '@/env'

export interface UseLiveMapOptions {
  eventId: string | null
  enabled?: boolean
}

export interface RunnerLocation {
  userId: string
  lat: number
  lng: number
  /** ISO time the position was recorded (drives heatmap freshness). */
  recordedAt?: string
}

export interface LiveIncident {
  id: string
  name?: string
  lat: number
  lng: number
  type: string
  description?: string
  severity?: string
  photoUrl?: string
  status: string
  responders?: string[]
  reportedBy?: string
  vitals?: string
  treatment?: string
  transport?: string
  closedAt?: string
  createdAt: string
}

export interface BroadcastAlert {
  id: string
  title: string
  body: string
  sentAt: string
}

function toLiveIncident(inc: any): LiveIncident {
  return {
    id: inc.id,
    name: inc.name,
    lat: inc.lat,
    lng: inc.lng,
    type: inc.type ?? 'other',
    description: inc.description,
    severity: inc.severity,
    photoUrl: inc.photoUrl,
    status: inc.status ?? 'open',
    responders: inc.responders,
    reportedBy: inc.reportedBy,
    vitals: inc.vitals,
    treatment: inc.treatment,
    transport: inc.transport,
    closedAt: inc.closedAt,
    createdAt: inc.createdAt ?? new Date().toISOString(),
  }
}

export function useLiveMap({ eventId, enabled = true }: UseLiveMapOptions) {
  const [medics, setMedics] = useState<Map<string, MedicState>>(new Map())
  const [runners, setRunners] = useState<Map<string, RunnerLocation>>(new Map())
  const [incidents, setIncidents] = useState<Map<string, LiveIncident>>(new Map())
  const [incidentMessages, setIncidentMessages] = useState<Map<string, IncidentMessage[]>>(new Map())
  const [connected, setConnected] = useState(false)
  /** Bumped each time a brand-new incident arrives — drives the dashboard alarm. */
  const [alarmSignal, setAlarmSignal] = useState<{ count: number; incident: LiveIncident | null }>({ count: 0, incident: null })
  const [broadcasts, setBroadcasts] = useState<BroadcastAlert[]>([])

  const socketRef = useRef<Socket | null>(null)
  const medicsRef = useRef<Map<string, MedicState>>(new Map())
  const runnersRef = useRef<Map<string, RunnerLocation>>(new Map())
  const incidentsRef = useRef<Map<string, LiveIncident>>(new Map())
  const messagesRef = useRef<Map<string, IncidentMessage[]>>(new Map())

  const scheduleSync = useCallback(() => {
    requestAnimationFrame(() => {
      setMedics(new Map(medicsRef.current))
      setRunners(new Map(runnersRef.current))
      setIncidents(new Map(incidentsRef.current))
      setIncidentMessages(new Map(messagesRef.current))
    })
  }, [])

  useEffect(() => {
    if (!eventId || !enabled) return

    getActiveMedics(eventId)
      .then((initial) => {
        initial.forEach((m) => medicsRef.current.set(m.medicId, m))
        scheduleSync()
      })
      .catch(() => {/* non-critical */})

    listIncidents(eventId)
      .then((initial) => {
        initial.forEach((inc) => { if (inc.id) incidentsRef.current.set(inc.id, toLiveIncident(inc)) })
        scheduleSync()
      })
      .catch(() => {/* non-critical */})

    const socket = io(wsUrl, {
      transports: ['websocket'],
      auth: { eventId, role: 'coordinator' },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    })

    socketRef.current = socket

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socket.on('medic_location', (payload: MedicState) => {
      medicsRef.current.set(payload.medicId, payload)
      scheduleSync()
    })

    socket.on(
      'location.updated',
      (payload: { userId: string; lat: number; lng: number; timestamp?: string; recordedAt?: string }) => {
        runnersRef.current.set(payload.userId, {
          userId: payload.userId,
          lat: payload.lat,
          lng: payload.lng,
          recordedAt: payload.recordedAt ?? payload.timestamp ?? new Date().toISOString(),
        })
        scheduleSync()
      },
    )

    socket.on('incident.created', (payload: any) => {
      const incident = toLiveIncident(payload)
      incidentsRef.current.set(incident.id, incident)
      setAlarmSignal((prev) => ({ count: prev.count + 1, incident }))
      scheduleSync()
    })

    socket.on('incident.updated', (payload: any) => {
      const incident = toLiveIncident(payload)
      incidentsRef.current.set(incident.id, { ...incidentsRef.current.get(incident.id), ...incident })
      scheduleSync()
    })

    socket.on('incident.action', (payload: { incidentId: string; status: string }) => {
      const existing = incidentsRef.current.get(payload.incidentId)
      if (existing) {
        incidentsRef.current.set(payload.incidentId, { ...existing, status: payload.status })
        scheduleSync()
      }
    })

    socket.on('incident.assigned', (payload: { incidentId: string; responders?: string[] }) => {
      const existing = incidentsRef.current.get(payload.incidentId)
      if (existing) {
        incidentsRef.current.set(payload.incidentId, { ...existing, status: 'assigned', responders: payload.responders ?? existing.responders })
        scheduleSync()
      }
    })

    socket.on('incident.message', (msg: IncidentMessage) => {
      const list = messagesRef.current.get(msg.incidentId) ?? []
      if (!list.some((m) => m.id === msg.id)) {
        messagesRef.current.set(msg.incidentId, [...list, msg])
        scheduleSync()
      }
    })

    socket.on('broadcast', (payload: { title: string; body: string; sentAt?: string }) => {
      const alert: BroadcastAlert = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: payload.title,
        body: payload.body,
        sentAt: payload.sentAt ?? new Date().toISOString(),
      }
      // Keep the 4 most recent, newest first.
      setBroadcasts((prev) => [alert, ...prev].slice(0, 4))
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [eventId, enabled, scheduleSync])

  const assignDestination = useCallback(
    async (medicId: string, destination: { lat: number; lng: number; label: string } | null) => {
      if (!eventId) return
      const { assignMedicDestination } = await import('@/api/medics')
      const updated = await assignMedicDestination(eventId, medicId, destination)
      medicsRef.current.set(updated.medicId, updated)
      scheduleSync()
    },
    [eventId, scheduleSync],
  )

  const removeActiveMedic = useCallback(
    async (medicId: string) => {
      if (!eventId) return
      const { removeActiveMedic: apiRemove } = await import('@/api/medics')
      await apiRemove(eventId, medicId)
      medicsRef.current.delete(medicId)
      scheduleSync()
    },
    [eventId, scheduleSync],
  )

  const assignIncident = useCallback(
    async (incidentId: string, medicId: string) => {
      if (!eventId) return
      const { assignMedicToIncident } = await import('@/api/incidents')
      await assignMedicToIncident(eventId, incidentId, medicId)
      const existing = incidentsRef.current.get(incidentId)
      if (existing) {
        incidentsRef.current.set(incidentId, { ...existing, status: 'assigned' })
        scheduleSync()
      }
    },
    [eventId, scheduleSync],
  )

  const resolveIncident = useCallback(
    async (incidentId: string) => {
      await actionIncident(incidentId, { incidentId, action: 'resolved' }, eventId ?? undefined)
      const existing = incidentsRef.current.get(incidentId)
      if (existing) {
        incidentsRef.current.set(incidentId, { ...existing, status: 'resolved' })
        scheduleSync()
      }
    },
    [eventId, scheduleSync],
  )

  const closeIncident = useCallback(
    async (incidentId: string, payload: { vitals?: string; treatment?: string; transport?: string }) => {
      const updated = await apiCloseIncident(incidentId, payload, eventId ?? undefined)
      incidentsRef.current.set(incidentId, toLiveIncident(updated))
      scheduleSync()
    },
    [eventId, scheduleSync],
  )

  const updateIncidentNotes = useCallback(
    async (incidentId: string, description: string) => {
      const { updateIncidentDetails } = await import('@/api/incidents')
      const updated = await updateIncidentDetails(incidentId, { description }, eventId ?? undefined)
      incidentsRef.current.set(incidentId, toLiveIncident(updated))
      scheduleSync()
    },
    [eventId, scheduleSync],
  )

  const loadMessages = useCallback(
    async (incidentId: string) => {
      const list = await listIncidentMessages(incidentId, eventId ?? undefined)
      messagesRef.current.set(incidentId, list)
      scheduleSync()
    },
    [eventId, scheduleSync],
  )

  const dismissBroadcast = useCallback((id: string) => {
    setBroadcasts((prev) => prev.filter((b) => b.id !== id))
  }, [])

  const sendMessage = useCallback(
    async (incidentId: string, text: string) => {
      const msg = await sendIncidentMessage(incidentId, { text }, eventId ?? undefined)
      const list = messagesRef.current.get(incidentId) ?? []
      if (!list.some((m) => m.id === msg.id)) {
        messagesRef.current.set(incidentId, [...list, msg])
        scheduleSync()
      }
    },
    [eventId, scheduleSync],
  )

  return {
    medics: Array.from(medics.values()),
    runners: Array.from(runners.values()),
    // Archived incidents are hidden everywhere (map + lists).
    incidents: Array.from(incidents.values()).filter((i) => i.status !== 'archived'),
    incidentMessages,
    connected,
    alarmSignal,
    broadcasts,
    dismissBroadcast,
    assignDestination,
    removeActiveMedic,
    assignIncident,
    resolveIncident,
    closeIncident,
    updateIncidentNotes,
    loadMessages,
    sendMessage,
  }
}
