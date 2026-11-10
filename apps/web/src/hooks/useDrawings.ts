'use client'

import { useCallback, useEffect, useState } from 'react'
import type { CreateDrawingRequest, EventDrawing, UpdateDrawingRequest } from '@events/contracts'
import { createDrawing, deleteDrawing, listDrawings, updateDrawing } from '@/api/drawings'

/**
 * Dashboard drawing state: fetched once + on window focus, with optimistic
 * local mutations. Drawings are only ever made here, so there is nobody else's
 * edit to wait for — the focus refetch just covers a second coordinator's tab.
 */
export function useDrawings(eventId: string | undefined) {
  const [drawings, setDrawings] = useState<EventDrawing[]>([])

  useEffect(() => {
    if (!eventId) return
    const fetchDrawings = () => {
      listDrawings(eventId).then(setDrawings).catch(() => {/* non-critical */})
    }
    fetchDrawings()
    window.addEventListener('focus', fetchDrawings)
    return () => window.removeEventListener('focus', fetchDrawings)
  }, [eventId])

  const create = useCallback(async (body: CreateDrawingRequest) => {
    if (!eventId) return null
    const drawing = await createDrawing(eventId, body)
    setDrawings(prev => [...prev, drawing])
    return drawing
  }, [eventId])

  const update = useCallback(async (drawingId: string, patch: UpdateDrawingRequest) => {
    if (!eventId) return
    // Optimistic — the PATCH result confirms/overwrites.
    setDrawings(prev => prev.map(d => (d.id === drawingId ? { ...d, ...patch, lines: patch.lines ?? d.lines } as EventDrawing : d)))
    try {
      const drawing = await updateDrawing(eventId, drawingId, patch)
      setDrawings(prev => prev.map(d => (d.id === drawingId ? drawing : d)))
    } catch {
      // Put back what the server actually holds rather than guessing.
      listDrawings(eventId).then(setDrawings).catch(() => {/* offline — keep the optimistic view */})
    }
  }, [eventId])

  const remove = useCallback(async (drawingId: string) => {
    if (!eventId) return
    setDrawings(prev => prev.filter(d => d.id !== drawingId))
    await deleteDrawing(eventId, drawingId).catch(() => {/* already gone */})
  }, [eventId])

  /** Put a just-deleted drawing back (the Undo on the delete toast). */
  const restore = useCallback(async (drawing: EventDrawing) => {
    if (!eventId) return null
    return create({
      name: drawing.name,
      color: drawing.color,
      lines: drawing.lines,
      note: drawing.note,
      dashed: drawing.dashed,
      snapped: drawing.snapped,
      visible: drawing.visible,
    })
  }, [eventId, create])

  return { drawings, createDrawing: create, updateDrawing: update, removeDrawing: remove, restoreDrawing: restore }
}
