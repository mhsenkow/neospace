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
  const rtf = getRtf(locale)

  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(duration) < amount) {
      return rtf.format(Math.round(duration), unit)
    }
    duration /= amount
  }
  return rtf.format(Math.round(duration), 'year')
}

/** Full localized date/time for `<time title>` / tooltips. */
export function formatAbsoluteTime(
  date: Date | string | number,
  locale?: string,
): string {
  const d = toDate(date)
  if (!Number.isFinite(d.getTime())) return ''
  const loc = locale || (typeof navigator !== 'undefined' ? navigator.language : 'en')
  return new Intl.DateTimeFormat(loc, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}
