/**
 * Shared minute-ticking `now` for relative timestamps.
 */

import { onMounted, onUnmounted, ref, type Ref } from 'vue'
import { formatAbsoluteTime, formatRelativeTime } from '~/utils/relativeTime'

const now = ref(Date.now())
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
    now.value = Date.now()
    ensureTicking()
  })

  onUnmounted(() => {
    subscribers = Math.max(0, subscribers - 1)
    maybeStop()
  })

  const relative = (date: Date | string | number) => formatRelativeTime(date, now.value)
  const absolute = (date: Date | string | number) => formatAbsoluteTime(date)

  return {
    now: now as Ref<number>,
    relative,
    absolute,
    /** Uses shared minute-ticking `now` so list timestamps refresh together */
    formatRelativeTime: relative,
    formatAbsoluteTime: absolute,
  }
}
