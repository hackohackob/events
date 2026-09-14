/**
 * The output of all this planning: a per-medic call sheet.
 *
 * "21 Sep 09:00 — Point 1. Leave 10:40, 20 min drive. 11:00 — Point 2." That
 * sheet is what actually gets handed out at the briefing, so it is derived from
 * exactly the same timeline the map preview plays.
 */

import type { PlanMedic, PlanSweepJoin, VehicleType } from '@events/contracts'
import { VEHICLE_TYPE_META, planVehicleAt } from '@events/contracts'
import { resolveMedicTimeline, type ResolveOptions } from './schedule'

export type ItineraryStopKind = 'post' | 'sweep-start' | 'sweep-end'

export interface ItineraryStop {
  stationId: string
  kind: ItineraryStopKind
  /** Sweep stops only: whether they joined at the gun or from a post. */
  sweepJoin?: PlanSweepJoin
  /** This post ends by handing over to a sweep, not by driving somewhere. */
  handsOverToSweep?: boolean
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
  /** What they drive to get here. */
  vehicleLabel?: string
  vehicleIcon?: string
}

/** A vehicle swap, rendered inline in the call sheet at its own time. */
export interface ItineraryVehicleSwap {
  atMs: number
  label: string
  icon: string
}

export interface MedicItinerary {
  planMedicId: string
  name: string
  unit?: string
  vehicleLabel: string
  vehicleIcon: string
  color: string
  stops: ItineraryStop[]
  swaps: ItineraryVehicleSwap[]
  onDutyFromMs: number | null
  /** When they go off the board, when a stand-down is set. */
  standDownMs: number | null
  travelMinutes: number
  conflictCount: number
  /** Courses this medic sweeps, by name. */
  sweeps: string[]
}

function vehicleMeta(vehicle: VehicleType) {
  return VEHICLE_TYPE_META[vehicle] ?? VEHICLE_TYPE_META.foot
}

export function buildItinerary(medic: PlanMedic, options: ResolveOptions = {}): MedicItinerary {
  const timeline = resolveMedicTimeline(medic, options)
  const stations = timeline.stations
  const meta = vehicleMeta(medic.vehicleType)

  const stops: ItineraryStop[] = stations.map((station, i) => {
    const arriveMs = new Date(station.arriveAt).getTime()
    const move = timeline.segments.find(s => s.kind === 'move' && s.stationId === station.id)
    const sweepOut = timeline.segments.find(
      s => s.kind === 'sweep' && s.fromMs === arriveMs,
    )
    const nextStation = stations[i + 1]
    const nextLeg = nextStation
      ? timeline.segments.find(
          s => (s.kind === 'move' || s.kind === 'sweep') && s.stationId === nextStation.id,
        )
      : undefined
    // Picking up the tail from a post involves no journey, so there is no leg
    // to read a departure off — they stop holding the instant the tail arrives.
    const handsOverToSweep = nextStation?.noTravel === true && nextStation.sweep != null
    const departMs = nextLeg
      ? nextLeg.fromMs
      : handsOverToSweep
        ? new Date(nextStation!.arriveAt).getTime()
        : null
    const legVehicle = move?.vehicleType ?? planVehicleAt(medic, arriveMs)
    const legMeta = vehicleMeta(legVehicle)
    return {
      stationId: station.id,
      kind: station.sweep ? (station.sweep.edge === 'start' ? 'sweep-start' : 'sweep-end') : 'post',
      sweepJoin: station.sweep?.joinFrom,
      handsOverToSweep: handsOverToSweep || undefined,
      arriveMs,
      departMs,
      label: station.label,
      note: station.note,
      poiId: station.poiId,
      travelMinutes: move ? Math.round((move.toMs - move.fromMs) / 60000) : 0,
      // "On station" is meaningless for a sweep start — they leave immediately,
      // with the field — so it is reported as the sweep's own duration instead.
      dwellMinutes:
        sweepOut != null
          ? Math.max(0, Math.round((sweepOut.toMs - sweepOut.fromMs) / 60000))
          : departMs != null
            ? Math.max(0, Math.round((departMs - arriveMs) / 60000))
            : null,
      tight: move?.tight,
      shortfallMinutes: move?.shortfallMinutes,
      vehicleLabel: move ? legMeta.label : undefined,
      vehicleIcon: move ? legMeta.icon : undefined,
    }
  })

  const swaps: ItineraryVehicleSwap[] = (medic.vehicleChanges ?? [])
    .map(change => {
      const at = new Date(change.at).getTime()
      const changeMeta = vehicleMeta(change.vehicleType)
      return { atMs: at, label: changeMeta.label, icon: changeMeta.icon }
    })
    .filter(swap => Number.isFinite(swap.atMs))

  const sweeps = timeline.segments
    .filter(s => s.kind === 'sweep')
    .map(s => s.label)

  return {
    planMedicId: medic.id,
    name: medic.name,
    unit: medic.unit,
    vehicleLabel: meta.label,
    vehicleIcon: meta.icon,
    color: medic.color,
    stops,
    swaps,
    onDutyFromMs: timeline.onDutyFromMs,
    standDownMs: timeline.standDownMs,
    travelMinutes: timeline.travelMinutes,
    conflictCount: timeline.conflicts.length,
    sweeps,
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
  lines.push(`${itinerary.name}${itinerary.unit ? ` (${itinerary.unit})` : ''} — starts on ${itinerary.vehicleLabel}`)
  lines.push(eventTitle)
  lines.push('')

  // Swaps are events on the same clock as the stops, so they are merged into
  // one stream rather than listed separately — a call sheet is read top to
  // bottom, and "switch to the bike" has to appear where it happens.
  type Row = { atMs: number; text: string[]; day: number }
  const rows: Row[] = []
  for (const stop of itinerary.stops) {
    const text: string[] = []
    if (stop.kind === 'sweep-start') {
      const course = stop.label.replace(/ (start|tail)$/, '')
      text.push(
        stop.sweepJoin === 'post'
          ? `  ${formatTime(stop.arriveMs)}  LAST RUNNER REACHES YOU — go with them (${course})`
          : `  ${formatTime(stop.arriveMs)}  START SWEEPING ${course}`,
      )
      text.push('           ↳ stay with the last participant')
    } else if (stop.kind === 'sweep-end') {
      text.push(`  ${formatTime(stop.arriveMs)}  sweep complete — ${stop.label.replace(/ finish$/, '')}`)
    } else {
      text.push(`  ${formatTime(stop.arriveMs)}  Be at ${stop.label}`)
      if (stop.note) text.push(`           ↳ ${stop.note}`)
    }
    // The journey gets a line of its own at the departure — "be at Point 2 by
    // 11:00" does not tell anyone to leave Point 1 at 10:38, and that is the
    // half of the sheet they act on first.
    const next = itinerary.stops[itinerary.stops.indexOf(stop) + 1]
    if (next && next.travelMinutes > 0 && stop.departMs != null && !stop.handsOverToSweep) {
      const how = next.vehicleLabel ? ` by ${next.vehicleLabel.toLowerCase()}` : ''
      text.push(
        `  ${formatTime(stop.departMs)}  Travel to ${next.label.replace(/ (start|tail|finish)$/, '')} (${formatDuration(next.travelMinutes)}${how})`,
      )
    }
    rows.push({ atMs: stop.arriveMs, text, day: 0 })
  }
  for (const swap of itinerary.swaps) {
    rows.push({ atMs: swap.atMs, text: [`  ${formatTime(swap.atMs)}  switch to ${swap.icon} ${swap.label}`], day: 0 })
  }
  rows.sort((a, b) => a.atMs - b.atMs)

  let lastDay = ''
  for (const row of rows) {
    const day = formatDay(row.atMs)
    if (day !== lastDay) {
      lines.push(day.toUpperCase())
      lastDay = day
    }
    lines.push(...row.text)
  }

  if (itinerary.standDownMs != null) {
    lines.push(`  ${formatTime(itinerary.standDownMs)}  stand down`)
  }
  lines.push('')
  const moves = itinerary.stops.filter(s => s.kind === 'post').length
  lines.push(`Moves: ${Math.max(0, moves - 1)} · Travel: ${formatDuration(itinerary.travelMinutes)}`)
  return lines.join('\n')
}

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value)
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

/** One row per stop, every medic — the format planners paste into a spreadsheet. */
export function itinerariesToCsv(itineraries: MedicItinerary[]): string {
  const rows = [
    ['Medic', 'Unit', 'Type', 'Vehicle in', 'Date', 'Arrive', 'Location', 'Depart', 'On station', 'Travel in (min)', 'Note'],
  ]
  for (const it of itineraries) {
    for (const stop of it.stops) {
      rows.push([
        it.name,
        it.unit ?? '',
        stop.kind === 'post' ? 'Post' : stop.kind === 'sweep-start' ? 'Sweep start' : 'Sweep end',
        stop.vehicleLabel ?? it.vehicleLabel,
        formatDay(stop.arriveMs),
        formatTime(stop.arriveMs),
        stop.label,
        stop.departMs != null ? formatTime(stop.departMs) : '',
        stop.dwellMinutes != null ? formatDuration(stop.dwellMinutes) : 'until end',
        String(stop.travelMinutes),
        stop.note ?? '',
      ])
    }
    for (const swap of it.swaps) {
      rows.push([
        it.name,
        it.unit ?? '',
        'Vehicle swap',
        swap.label,
        formatDay(swap.atMs),
        formatTime(swap.atMs),
        `Switch to ${swap.label}`,
        '',
        '',
        '',
        '',
      ])
    }
  }
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}
