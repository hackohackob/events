'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, FileText } from 'lucide-react'

const BARS = [8, 14, 10, 17, 12, 16, 9, 13, 18, 11, 15, 9, 14, 12, 16, 10]

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Custom voice-note player for the dashboard — matches the field app's bubble
 * (play/pause + waveform that fills with progress + duration + transcript)
 * instead of the raw browser <audio controls>.
 */
export default function VoiceMessage({
  src,
  durationMs,
  transcript,
  mine = false,
}: {
  src: string
  durationMs?: number
  transcript?: string
  mine?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const [dur, setDur] = useState(durationMs ? durationMs / 1000 : 0)

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => setProgress(a.duration ? a.currentTime / a.duration : 0)
    const onMeta = () => { if (a.duration && isFinite(a.duration)) setDur(a.duration) }
    const onEnd = () => { setPlaying(false); setProgress(0) }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onMeta)
    a.addEventListener('ended', onEnd)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onMeta)
      a.removeEventListener('ended', onEnd)
    }
  }, [])

  const toggle = () => {
    const a = audioRef.current
    if (!a) return
    if (playing) { a.pause(); setPlaying(false) }
    else { void a.play(); setPlaying(true) }
  }

  const accent = mine ? '#04121f' : '#34d399'
  const idle = mine ? 'rgba(4,18,31,0.3)' : 'rgba(148,163,184,0.35)'
  const filled = Math.round(progress * BARS.length)

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <button
          onClick={toggle}
          className="flex items-center justify-center rounded-full flex-shrink-0 transition-transform active:scale-95"
          style={{ width: 32, height: 32, background: mine ? '#04121f' : '#34d399' }}
        >
          {playing
            ? <Pause className="w-[15px] h-[15px]" style={{ color: mine ? '#34d399' : '#04121f' }} />
            : <Play className="w-[15px] h-[15px] ml-0.5" style={{ color: mine ? '#34d399' : '#04121f' }} />}
        </button>
        <div className="flex items-center gap-[2.5px]" style={{ height: 22 }}>
          {BARS.map((h, i) => (
            <div key={i} style={{ width: 2.5, height: h, borderRadius: 2, background: i < filled ? accent : idle }} />
          ))}
        </div>
        <span className="text-[11px] font-bold tabular-nums flex-shrink-0" style={{ color: mine ? 'rgba(4,18,31,0.75)' : '#9fb3cc' }}>
          {fmt(playing || progress > 0 ? progress * dur : dur)}
        </span>
      </div>
      {transcript ? (
        <div className="flex gap-1.5 mt-1.5 text-xs italic" style={{ color: mine ? 'rgba(4,18,31,0.78)' : '#aeb9c9' }}>
          <FileText className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>{transcript}</span>
        </div>
      ) : null}
      <audio ref={audioRef} src={src} preload="none" />
    </div>
  )
}
