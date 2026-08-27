/**
 * Event dates are CALENDAR dates — "the race is on 29 August" — not instants.
 *
 * Round-tripping them through `Date`/`toISOString()` silently shifts them by a
 * day for anyone east of UTC: local midnight on 30 August is 29 August 21:00
 * UTC in Sofia, so `toISOString().split("T")[0]` yields "2026-08-29". West of
 * UTC the same trick shifts a *displayed* date the other way. These helpers
 * keep calendar dates in calendar terms at every boundary.
 */

/** `Date` → "YYYY-MM-DD" using the LOCAL calendar, never UTC. */
export function toCalendarDate(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** "YYYY-MM-DD" → a `Date` at LOCAL midnight of that calendar day. */
export function fromCalendarDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return new Date(NaN)
  return new Date(year, month - 1, day)
}

/** Format a "YYYY-MM-DD" without ever constructing a UTC instant from it. */
export function formatCalendarDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
  locale = 'en-US',
): string {
  const date = fromCalendarDate(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale, options)
}

/** The calendar year of a "YYYY-MM-DD". */
export function calendarYear(value: string): number {
  return fromCalendarDate(value).getFullYear()
}
