'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import type { MedicState } from '@events/contracts'
import { getActiveMedics } from '@/api/medics'
import { listIncidents } from '@/api/incidents'
import { wsUrl } from '@/env'

export interface UseLiveMapOptions {
  eventId: string | null
  enabled?: boolean
}

export interface RunnerLocation {
  userId: string
  lat: number
  lng: number
}

export interface LiveIncident {
  id: string
  lat: number
  lng: number
  type: string
  description?: string
  status: string
  createdAt: string
}

export function useLiveMap({ eventId, enabled = true }: UseLiveMapOptions) {
  const [medics, setMedics] = useState<Map<string, MedicState>>(new Map())
  const [runners, setRunners] = useState<Map<string, RunnerLocation>>(new Map())
  const [incidents, setIncidents] = useState<Map<string, LiveIncident>>(new Map())
  const [connected, setConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const medicsRef = useRef<Map<string, MedicState>>(new Map())
  const runnersRef = useRef<Map<string, RunnerLocation>>(new Map())
  const incidentsRef = useRef<Map<string, LiveIncident>>(new Map())

  // Sync ref → state on a rAF loop so map re-renders are cheap
  const scheduleSync = useCallback(() => {
    requestAnimationFrame(() => {
      setMedics(new Map(medicsRef.current))
      setRunners(new Map(runnersRef.current))
      setIncidents(new Map(incidentsRef.current))
    })
  }, [])

  useEffect(() => {
    if (!eventId || !enabled) return

    // Seed with last-known positions from DB on mount
    getActiveMedics(eventId)
      .then((initial) => {
        initial.forEach((m) => medicsRef.current.set(m.medicId, m))
        scheduleSync()
      })
      .catch(() => {/* non-critical */})

    // Seed existing incidents so they show immediately (not just real-time ones)
    listIncidents(eventId)
      .then((initial) => {
        initial.forEach((inc) => {
          if (inc.id) incidentsRef.current.set(inc.id, {
            id: inc.id,
            lat: inc.lat,
            lng: inc.lng,
            type: inc.type ?? 'other',
            description: inc.description,
            status: inc.status,
            createdAt: inc.createdAt,
          })
        })
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

    socket.on('location.updated', (payload: { userId: string; lat: number; lng: number }) => {
      runnersRef.current.set(payload.userId, { userId: payload.userId, lat: payload.lat, lng: payload.lng })
      scheduleSync()
    })

    socket.on('incident.created', (payload: LiveIncident) => {
      incidentsRef.current.set(payload.id, payload)
      scheduleSync()
    })

    socket.on('incident.action', (payload: { incidentId: string; status: string }) => {
      const existing = incidentsRef.current.get(payload.incidentId)
      if (existing) {
        incidentsRef.current.set(payload.incidentId, { ...existing, status: payload.status })
        scheduleSync()
      }
    })

    socket.on('incident.assigned', (payload: { incidentId: string; paramedicId: string }) => {
      const existing = incidentsRef.current.get(payload.incidentId)
      if (existing) {
        incidentsRef.current.set(payload.incidentId, { ...existing, status: 'assigned' })
        scheduleSync()
      }
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

  return {
    medics: Array.from(medics.values()),
    runners: Array.from(runners.values()),
    incidents: Array.from(incidents.values()),
    connected,
    assignDestination,
    removeActiveMedic,
    assignIncident,
  }
}
