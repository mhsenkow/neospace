/**
 * Relative + absolute time helpers (Intl.RelativeTimeFormat).
 */

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
]

const rtfCache = new Map<string, Intl.RelativeTimeFormat>()

function getRtf(locale?: string) {
  const key = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en')
  let rtf = rtfCache.get(key)
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(key, { numeric: 'auto' })
    rtfCache.set(key, rtf)
  }
  return rtf
}

/** Intl constructors are costly — every card formats on each minute tick */
const fmtCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()

function cachedFormat<T extends Intl.NumberFormat | Intl.DateTimeFormat>(
  key: string,
  make: () => T,
): T {
  let f = fmtCache.get(key) as T | undefined
  if (!f) {
    f = make()
    fmtCache.set(key, f)
  }
  return f
}

function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input)
}

export function formatRelativeTime(
  date: Date | string | number,
  now: Date | string | number = Date.now(),
  locale?: string,
): string {
  const then = toDate(date).getTime()
  const base = toDate(now).getTime()
  if (!Number.isFinite(then) || !Number.isFinite(base)) return ''

  let duration = (then - base) / 1000
  // A server clock a little ahead of ours shouldn't read "in 20 seconds"
  if (duration > 0 && duration < 60) duration = 0
  const rtf = getRtf(locale)

  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return rtf.format(Math.round(duration), unit)
    }
    duration /= amount
  }
  return rtf.format(Math.round(duration), 'year')
}

const COMPACT_UNITS: { seconds: number; unit: 'minute' | 'hour' | 'day' }[] = [
  { seconds: 86_400, unit: 'day' },
  { seconds: 3_600, unit: 'hour' },
  { seconds: 60, unit: 'minute' },
]

/**
 * Narrow timestamp for tight rows on phones: "now", "5m", "3h", "2d", then a
 * short date ("Oct 3", or "Oct 3, 2024" outside the current year).
 */
export function formatCompactRelativeTime(
  date: Date | string | number,
  now: Date | string | number = Date.now(),
  locale?: string,
): string {
  const then = toDate(date)
  const base = toDate(now)
  if (!Number.isFinite(then.getTime()) || !Number.isFinite(base.getTime())) return ''

  const loc = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en')
  const elapsed = Math.max(0, (base.getTime() - then.getTime()) / 1000)

  if (elapsed < 7 * 86_400) {
    for (const { seconds, unit } of COMPACT_UNITS) {
      if (elapsed >= seconds) {
        return cachedFormat(
          `n|${loc}|${unit}`,
          () => new Intl.NumberFormat(loc, { style: 'unit', unit, unitDisplay: 'narrow' }),
        ).format(Math.round(elapsed / seconds))
      }
    }
    return getRtf(loc).format(0, 'second')
  }

  const withYear = then.getFullYear() !== base.getFullYear()
  return cachedFormat(
    `d|${loc}|${withYear ? 'y' : ''}`,
    () =>
      new Intl.DateTimeFormat(loc, {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' as const } : {}),
      }),
  ).format(then)
}

/** Full localized date/time for `<time title>` / tooltips. */
export function formatAbsoluteTime(
  date: Date | string | number,
  locale?: string,
): string {
  const d = toDate(date)
  if (!Number.isFinite(d.getTime())) return ''
  const loc = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en')
  return cachedFormat(
    `a|${loc}`,
    () => new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short' }),
  ).format(d)
}
