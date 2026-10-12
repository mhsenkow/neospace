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

export type LocalScheduleCheck =
  | { ok: true; iso: string }
  | { ok: false; reason: 'invalid' | 'too-soon' | 'nonexistent' }

/**
 * Validate a local `datetime-local` value. The browser silently normalizes times that
 * don't exist (spring-forward gap, 02:30 → 03:30), so the parsed parts are compared back.
 */
export function checkLocalSchedule(local: string, now = Date.now()): LocalScheduleCheck {
  const value = local.trim()
  const when = Date.parse(value)
  if (!Number.isFinite(when)) return { ok: false, reason: 'invalid' }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value)
  // Only zone-less local values can fall into a DST gap; "…Z" / offset values are exact instants
  if (m && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(value.slice(16))) {
    const d = new Date(when)
    const same =
      d.getFullYear() === Number(m[1]) &&
      d.getMonth() + 1 === Number(m[2]) &&
      d.getDate() === Number(m[3]) &&
      d.getHours() === Number(m[4]) &&
      d.getMinutes() === Number(m[5])
    if (!same) return { ok: false, reason: 'nonexistent' }
  }
  if (when < now + SCHEDULE_MIN_LEAD_MS) return { ok: false, reason: 'too-soon' }
  return { ok: true, iso: new Date(when).toISOString() }
}

/** User-facing correction for a failed schedule check */
export function scheduleCheckMessage(reason: 'invalid' | 'too-soon' | 'nonexistent'): string {
  if (reason === 'nonexistent') {
    return 'That local time doesn’t exist (clocks change that day) — pick a time an hour earlier or later.'
  }
  if (reason === 'invalid') return 'Pick a valid date and time'
  return 'Pick a time at least 5 minutes from now'
}

/** Local `datetime-local` string → ISO, or null if invalid / too soon / nonexistent */
export function validRescheduleIso(local: string, now = Date.now()): string | null {
  const res = checkLocalSchedule(local, now)
  return res.ok ? res.iso : null
}

/** Timezone the browser uses to read `datetime-local` values, e.g. "America/New_York (EDT)" */
export function localTimeZoneLabel(at: Date | string | number = Date.now()): string {
  try {
    const date = new Date(at)
    const name = new Intl.DateTimeFormat().resolvedOptions().timeZone
    const short = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value
    if (name && short && short !== name) return `${name} (${short})`
    return name || short || 'your local time'
  } catch {
    return 'your local time'
  }
}

/**
 * One-line preview of what will be posted. A content warning hides the body:
 * the preview shows the warning only (the queue reveals the text deliberately).
 */
export function scheduledPreview(params: { text?: string | null; spoilerText?: string | null }, max = 140): string {
  const flatten = (v: string | null | undefined) => (v || '').replace(/\s+/g, ' ').trim()
  const spoiler = flatten(params.spoilerText)
  const flat = spoiler ? `CW: ${spoiler}` : flatten(params.text)
  if (!flat) return '(no text)'
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Hidden body of a content-warned scheduled post (null when there's no warning to hide) */
export function scheduledHiddenBody(params: { text?: string | null; spoilerText?: string | null }): string | null {
  const spoiler = (params.spoilerText || '').trim()
  const text = (params.text || '').replace(/\s+/g, ' ').trim()
  return spoiler && text ? text : null
}

const VISIBILITY_LABEL: Record<string, string> = {
  public: 'Public',
  unlisted: 'Unlisted',
  private: 'Followers only',
  direct: 'Direct',
  limited: 'Limited',
}

export type ScheduledPostMeta = {
  visibility: string | null
  attachments: number
  inReply: boolean
  pollOptions: number
}

/** Short labels so similarly worded queue rows are distinguishable */
export function scheduledPostMeta(params: {
  visibility?: string | null
  mediaIds?: string[] | null
  mediaAttachments?: unknown[] | null
  inReplyToId?: string | null
  poll?: { options?: string[] | null } | null
}): ScheduledPostMeta {
  const vis = (params.visibility || '').trim()
  const attachments =
    params.mediaAttachments?.length ??
    (Array.isArray(params.mediaIds) ? params.mediaIds.length : 0)
  const pollOptions = params.poll?.options?.filter((o) => (o || '').trim()).length ?? 0
  return {
    visibility: VISIBILITY_LABEL[vis] || (vis ? vis : null),
    attachments,
    inReply: !!(params.inReplyToId && String(params.inReplyToId).trim()),
    pollOptions,
  }
}

export function scheduledMetaSummary(meta: ScheduledPostMeta): string {
  const parts: string[] = []
  if (meta.visibility) parts.push(meta.visibility)
  if (meta.attachments) parts.push(`${meta.attachments} attachment${meta.attachments === 1 ? '' : 's'}`)
  if (meta.inReply) parts.push('Reply')
  if (meta.pollOptions >= 2) parts.push(`Poll · ${meta.pollOptions} options`)
  return parts.join(' · ')
}
