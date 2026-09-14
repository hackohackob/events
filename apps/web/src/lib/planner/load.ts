/**
 * A discipline's lane on the timeline is not a plain bar — it is filled with
 * the shape of the field itself: how many people are out on the course at each
 * moment between the start and the cut-off. That is the single most useful
 * thing a coordinator can see when deciding when a medic can stand down.
 */

import type { PlanDisciplineSchedule } from '@events/contracts'
import type { FieldShape } from './field'

/** Samples across the discipline window. 64 keeps the CSS gradient small. */
const SAMPLES = 64

/** Share of the field on course at each sample, 0…1. */
export function fieldLoad(schedule: PlanDisciplineSchedule, shape: FieldShape): number[] {
  const windowMin = schedule.slowestMinutes + (schedule.startWindowMinutes ?? 0)
  const out = new Array<number>(SAMPLES).fill(0)
  const runners = shape.finishMinutes.length
  if (runners === 0 || windowMin <= 0) return out

  for (let s = 0; s < SAMPLES; s += 1) {
    const elapsed = (windowMin * s) / (SAMPLES - 1)
    let onCourse = 0
    for (let k = 0; k < runners; k += 1) {
      const own = elapsed - shape.startOffsetMinutes[k]
      if (own >= 0 && own < shape.finishMinutes[k]) onCourse += 1
    }
    out[s] = onCourse / runners
  }
  return out
}

/**
 * The load curve as a CSS gradient, ready to drop onto the lane's background.
 * Rendering it as a gradient rather than an SVG area keeps the lane a single
 * DOM node — which matters when a 50-hour event is scrolled at 60 fps.
 */
export function fieldLoadCurve(
  schedule: PlanDisciplineSchedule,
  shape: FieldShape,
  color: string,
): string {
  const load = fieldLoad(schedule, shape)
  const stops = load.map((value, i) => {
    const alpha = (0.1 + 0.75 * value).toFixed(3)
    const at = ((i / (SAMPLES - 1)) * 100).toFixed(2)
    return `${hexToRgba(color, Number(alpha))} ${at}%`
  })
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean
  const n = parseInt(full, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
