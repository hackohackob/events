'use client'

import { useState } from 'react'
import { X, Megaphone, Send } from 'lucide-react'
import { broadcastToEvent } from '@/api/medics'

const PRESETS = [
  { title: '⚠️ Weather Alert', body: 'Severe weather incoming — seek shelter and stand by for instructions.' },
  { title: '📢 All Units', body: 'All medics report your status. Coordinator requesting a head-count.' },
  { title: '🏁 Event Update', body: 'Race start delayed by 15 minutes. Hold your positions.' },
]

export default function BroadcastModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSend = title.trim().length > 0 && body.trim().length > 0 && !sending

  async function handleSend() {
    if (!canSend) return
    setSending(true)
    setError(null)
    try {
      await broadcastToEvent(eventId, title.trim(), body.trim())
      setSent(true)
      setTimeout(onClose, 1100)
    } catch {
      setError('Failed to send broadcast. Try again.')
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 60, background: 'rgba(5,10,20,0.82)', backdropFilter: 'blur(14px)' }}
      onClick={onClose}
    >
      <div
        className="relative flex flex-col gap-5 p-7 rounded-3xl"
        style={{
          maxWidth: 460, width: '92%',
          background: 'rgba(8,15,28,0.98)',
          border: '1px solid rgba(245,158,11,0.25)',
          boxShadow: '0 0 60px rgba(245,158,11,0.12), 0 24px 80px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl transition-colors"
          style={{ color: '#64748b', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(148,163,184,0.1)' }}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)' }}>
            <Megaphone className="w-5 h-5" style={{ color: '#f59e0b' }} />
          </div>
          <div>
            <div className="text-lg font-bold text-slate-100">Broadcast to all medics</div>
            <div className="text-xs" style={{ color: '#64748b' }}>Pushes an alert to every device on this event</div>
          </div>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-2 py-8">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(34,197,94,0.15)', border: '2px solid #22c55e' }}>
              <Send className="w-6 h-6" style={{ color: '#22c55e' }} />
            </div>
            <div className="text-sm font-bold text-green-400">Broadcast sent</div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => (
                <button
                  key={p.title}
                  onClick={() => { setTitle(p.title); setBody(p.body) }}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all"
                  style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#fbbf24' }}
                >
                  {p.title}
                </button>
              ))}
            </div>

            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: '#64748b' }}>TITLE</div>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Weather Alert"
                className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-100 outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}
              />
            </div>

            <div>
              <div className="text-xs font-semibold mb-1.5" style={{ color: '#64748b' }}>MESSAGE</div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="What do the medics need to know?"
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-100 outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(148,163,184,0.15)' }}
              />
            </div>

            {error && <div className="text-xs" style={{ color: '#f87171' }}>{error}</div>}

            <button
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', boxShadow: '0 4px 14px rgba(245,158,11,0.35)' }}
            >
              <Send className="w-4 h-4" />
              {sending ? 'Sending…' : 'Send Broadcast'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
