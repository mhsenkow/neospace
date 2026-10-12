/**
 * Scheduled-post queue helpers (pure — no store/network).
 */

import { httpStatusFrom } from '~/utils/friendlyError'

/** Mastodon requires scheduled_at ≥ 5 minutes ahead */
export const SCHEDULE_MIN_LEAD_MS = 5 * 60 * 1000

/** Server has no scheduled_statuses endpoint (or won't expose it) */
export function isScheduledUnsupported(err: unknown): boolean {
  const code = httpStatusFrom(err)
  return code === 404 || code === 405 || code === 501
}

/** `datetime-local` value (local time, minute precision) for an ISO date */
export function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local `datetime-local` string → ISO, or null if invalid / too soon */
export function validRescheduleIso(local: string, now = Date.now()): string | null {
  const when = Date.parse(local.trim())
  if (!Number.isFinite(when) || when < now + SCHEDULE_MIN_LEAD_MS) return null
  return new Date(when).toISOString()
}

/** One-line preview of what will be posted */
export function scheduledPreview(params: { text?: string | null; spoilerText?: string | null }, max = 140): string {
  const text = (params.spoilerText ? `CW: ${params.spoilerText} — ` : '') + (params.text || '')
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return '(no text)'
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
