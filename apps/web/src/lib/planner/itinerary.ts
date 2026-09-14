/**
 * The output of all this planning: a per-medic call sheet.
 *
 * "21 Sep 09:00 — Point 1. Leave 10:40, 20 min drive. 11:00 — Point 2." That
 * sheet is what actually gets handed out at the briefing, so it is derived from
 * exactly the same timeline the map preview plays.
 */

import type { PlanMedic, PlanStation } from '@events/contracts'
import { VEHICLE_TYPE_META } from '@events/contracts'
import { resolveMedicTimeline, sortedStations, type ResolveOptions } from './schedule'

export interface ItineraryStop {
  stationId: string
  arriveMs: number
  /** When they have to leave for the next stop; null at the last one. */
  departMs: number | null
  label: string
  note?: string
  poiId?: string
  /** Minutes travelling to get here (0 for the first stop). */
  travelMinutes: number
  /** Minutes on station before leaving; null at the last one. */
  dwellMinutes: number | null
  /** The move into this stop doesn't fit in the time allowed. */
  tight?: boolean
  shortfallMinutes?: number
}

export interface MedicItinerary {
  planMedicId: string
  name: string
  unit?: string
  vehicleLabel: string
  vehicleIcon: string
  color: string
  stops: ItineraryStop[]
  onDutyFromMs: number | null
  travelMinutes: number
  conflictCount: number
}

export function buildItinerary(medic: PlanMedic, options: ResolveOptions = {}): MedicItinerary {
  const stations: PlanStation[] = sortedStations(medic)
  const timeline = resolveMedicTimeline(medic, options)
  const meta = VEHICLE_TYPE_META[medic.vehicleType] ?? VEHICLE_TYPE_META.foot

  const stops: ItineraryStop[] = stations.map((station, i) => {
    const arriveMs = new Date(station.arriveAt).getTime()
    const move = timeline.segments.find(s => s.kind === 'move' && s.stationId === station.id)
    const nextMove = stations[i + 1]
      ? timeline.segments.find(s => s.kind === 'move' && s.stationId === stations[i + 1].id)
      : undefined
    const departMs = nextMove ? nextMove.fromMs : null
    return {
      stationId: station.id,
      arriveMs,
      departMs,
      label: station.label,
      note: station.note,
      poiId: station.poiId,
      travelMinutes: move ? Math.round((move.toMs - move.fromMs) / 60000) : 0,
      dwellMinutes: departMs != null ? Math.max(0, Math.round((departMs - arriveMs) / 60000)) : null,
      tight: move?.tight,
      shortfallMinutes: move?.shortfallMinutes,
    }
  })

  return {
    planMedicId: medic.id,
    name: medic.name,
    unit: medic.unit,
    vehicleLabel: meta.label,
    vehicleIcon: meta.icon,
    color: medic.color,
    stops,
    onDutyFromMs: timeline.onDutyFromMs,
    travelMinutes: timeline.travelMinutes,
    conflictCount: timeline.conflicts.length,
  }
}

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

export function formatDay(ms: number): string {
  return DATE_FMT.format(new Date(ms))
}

export function formatTime(ms: number): string {
  return TIME_FMT.format(new Date(ms))
}

/** "21 Sep 09:00" — used wherever a plan can span more than one day, i.e. everywhere. */
export function formatStamp(ms: number): string {
  return `${formatDay(ms)} ${formatTime(ms)}`
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

/** A plain-text briefing sheet — pasteable into a radio log or a group chat. */
export function itineraryToText(itinerary: MedicItinerary, eventTitle: string): string {
  const lines: string[] = []
  lines.push(`${itinerary.name}${itinerary.unit ? ` (${itinerary.unit})` : ''} — ${itinerary.vehicleLabel}`)
  lines.push(eventTitle)
  lines.push('')
  let lastDay = ''
  for (const stop of itinerary.stops) {
    const day = formatDay(stop.arriveMs)
    if (day !== lastDay) {
      lines.push(day.toUpperCase())
      lastDay = day
    }
    const travel = stop.travelMinutes > 0 ? ` (${formatDuration(stop.travelMinutes)} travel)` : ''
    lines.push(`  ${formatTime(stop.arriveMs)}  ${stop.label}${travel}`)
    if (stop.note) lines.push(`           ↳ ${stop.note}`)
    if (stop.departMs != null) {
      lines.push(`  ${formatTime(stop.departMs)}  leave ${stop.label}`)
    }
  }
  lines.push('')
  lines.push(`Moves: ${Math.max(0, itinerary.stops.length - 1)} · Travel: ${formatDuration(itinerary.travelMinutes)}`)
  return lines.join('\n')
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value)
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

/** One row per stop, every medic — the format planners paste into a spreadsheet. */
export function itinerariesToCsv(itineraries: MedicItinerary[]): string {
  const rows = [
    ['Medic', 'Unit', 'Vehicle', 'Date', 'Arrive', 'Location', 'Depart', 'On station', 'Travel in (min)', 'Note'],
  ]
  for (const it of itineraries) {
    for (const stop of it.stops) {
      rows.push([
        it.name,
        it.unit ?? '',
        it.vehicleLabel,
        formatDay(stop.arriveMs),
        formatTime(stop.arriveMs),
        stop.label,
        stop.departMs != null ? formatTime(stop.departMs) : '',
        stop.dwellMinutes != null ? formatDuration(stop.dwellMinutes) : 'until end',
        String(stop.travelMinutes),
        stop.note ?? '',
      ])
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}
