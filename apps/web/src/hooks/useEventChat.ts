import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { wsUrl } from '@/env'
import type { EventMessage } from '@events/contracts'
import { listEventMessages, sendEventMessage } from '@/api/event-chat'

/**
 * Event-wide team chat for the dashboard — the same shared thread + live feed
 * (incident / response / POI) the field app uses. Loads history, then keeps a
 * dedicated socket subscription to `event.message`. Only active when `enabled`.
 */
export function useEventChat({ eventId, enabled }: { eventId: string; enabled: boolean }) {
  const [messages, setMessages] = useState<EventMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [unread, setUnread] = useState(0)
  const seenRef = useRef(false) // whether the chat panel is currently open

  const markRead = useCallback(() => {
    seenRef.current = true
    setUnread(0)
  }, [])
  const setOpen = useCallback((open: boolean) => {
    seenRef.current = open
    if (open) setUnread(0)
  }, [])

  useEffect(() => {
    if (!enabled || !eventId) return
    let alive = true
    setLoading(true)
    listEventMessages(eventId)
      .then((list) => alive && setMessages(list))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false))

    const socket: Socket = io(wsUrl, {
      transports: ['websocket'],
      auth: { eventId, role: 'coordinator' },
    })
    socket.on('event.message', (msg: EventMessage) => {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
      if (!seenRef.current) setUnread((n) => Math.min(99, n + 1))
    })
    return () => {
      alive = false
      socket.disconnect()
    }
  }, [eventId, enabled])

  const send = useCallback(
    async (text: string) => {
      const t = text.trim()
      if (!t) return
      const msg = await sendEventMessage(t, eventId)
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]))
    },
    [eventId],
  )

  return { messages, loading, unread, markRead, setOpen, send }
}
