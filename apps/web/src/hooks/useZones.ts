'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CreateZoneRequest, EventZone, UpdateZoneRequest } from '@events/contracts'
import { createZone, deleteZone, listZones, updateZone } from '@/api/zones'

/**
 * Dashboard zone state: fetched once + on window focus (zones drawn in the
 * field appear when the coordinator returns to the tab), with optimistic
 * local mutations for the dashboard's own edits.
 */
export function useZones(eventId: string | undefined) {
  const [zones, setZones] = useState<EventZone[]>([])

  useEffect(() => {
    if (!eventId) return
    const fetchZones = () => {
      listZones(eventId).then(setZones).catch(() => {/* non-critical */})
    }
    fetchZones()
    const onFocus = () => fetchZones()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [eventId])

  const create = useCallback(async (body: CreateZoneRequest) => {
    if (!eventId) return null
    const zone = await createZone(eventId, body)
    setZones(prev => [...prev, zone])
    return zone
  }, [eventId])

  const update = useCallback(async (zoneId: string, patch: UpdateZoneRequest) => {
    if (!eventId) return
    // Optimistic — the PATCH result confirms/overwrites.
    setZones(prev => prev.map(z => (z.id === zoneId ? { ...z, ...patch, polygon: patch.polygon ?? z.polygon } as EventZone : z)))
    const zone = await updateZone(eventId, zoneId, patch)
    setZones(prev => prev.map(z => (z.id === zoneId ? zone : z)))
  }, [eventId])

  const remove = useCallback(async (zoneId: string) => {
    if (!eventId) return
    setZones(prev => prev.filter(z => z.id !== zoneId))
    await deleteZone(eventId, zoneId).catch(() => {/* already gone */})
  }, [eventId])

  return { zones, createZone: create, updateZone: update, removeZone: remove }
}
