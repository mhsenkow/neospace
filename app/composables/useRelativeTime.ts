/**
 * Shared minute-ticking `now` for relative timestamps.
 */

import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import {
  formatAbsoluteTime,
  formatCompactRelativeTime,
  formatRelativeTime,
} from '~/utils/relativeTime'

const now = ref(Date.now())
/** Skip the mount-time refresh when `now` is this fresh — every bump re-renders all timestamps. */
const FRESH_MS = 15_000
let subscribers = 0
let timer: ReturnType<typeof setInterval> | null = null

function ensureTicking() {
  if (typeof window === 'undefined' || timer) return
  timer = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
}

function maybeStop() {
  if (subscribers > 0 || !timer) return
  clearInterval(timer)
  timer = null
}

export function useRelativeTime() {
  onMounted(() => {
    subscribers += 1
    const t = Date.now()
    if (t - now.value > FRESH_MS) now.value = t
    ensureTicking()
  })

  onUnmounted(() => {
    subscribers = Math.max(0, subscribers - 1)
    maybeStop()
  })

  const relative = (date: Date | string | number) => formatRelativeTime(date, now.value)
  const absolute = (date: Date | string | number) => formatAbsoluteTime(date)
  const compact = (date: Date | string | number) => formatCompactRelativeTime(date, now.value)

  return {
    now: now as Ref<number>,
    relative,
    absolute,
    /** Uses shared minute-ticking `now` so list timestamps refresh together */
    formatRelativeTime: relative,
    formatAbsoluteTime: absolute,
    /** "5m" / "3h" / "Oct 3" — for tight rows on phones */
    formatCompactRelativeTime: compact,
  }
}
