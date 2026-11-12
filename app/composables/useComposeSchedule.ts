/**
 * Compose scheduling — `datetime-local` value → ISO, ≥5 min floor, DST / invalid-time
 * problems, and the scheduled-vs-published result guard.
 */

import type { Ref } from 'vue'
import type { mastodon } from 'masto'
import { checkLocalSchedule, localTimeZoneLabel, scheduleCheckMessage } from '~/utils/scheduledPosts'

export const isScheduledResult = (
  result: mastodon.v1.Status | mastodon.v1.ScheduledStatus,
): result is mastodon.v1.ScheduledStatus =>
  'scheduledAt' in result && typeof (result as mastodon.v1.ScheduledStatus).scheduledAt === 'string' && !('account' in result)

export const formatScheduleAnnounce = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** `scheduledLocal` is the raw datetime-local value (local wall clock); empty = post now */
export function useComposeSchedule(scheduledLocal: Ref<string>) {
  const hasSchedule = computed(() => !!scheduledLocal.value.trim())

  /** Mastodon requires ≥5 minutes ahead — expose a floor for the picker */
  const scheduleMinLocal = computed(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })

  const scheduledAtIso = computed(() => {
    const local = scheduledLocal.value.trim()
    if (!local) return undefined
    const when = new Date(local)
    if (!Number.isFinite(when.getTime())) return undefined
    return when.toISOString()
  })
  /** Why the picked time can't be used (nonexistent DST time, invalid) — null when fine/unset */
  const scheduleProblem = computed(() => {
    const local = scheduledLocal.value.trim()
    if (!local) return null
    const check = checkLocalSchedule(local, 0)
    return check.ok || check.reason === 'too-soon' ? null : scheduleCheckMessage(check.reason)
  })
  const scheduleZone = computed(() => (hasSchedule.value ? localTimeZoneLabel(scheduledAtIso.value ?? Date.now()) : ''))

  const clearSchedule = () => {
    scheduledLocal.value = ''
  }

  return {
    hasSchedule,
    scheduleMinLocal,
    scheduledAtIso,
    scheduleProblem,
    scheduleZone,
    clearSchedule,
  }
}
