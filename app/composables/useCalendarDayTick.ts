import { localDayKey, msUntilNextLocalDay } from '~/utils/calendarDay'

/**
 * Shared local-day key so Today/Yesterday labels recompute after midnight
 * without each page polling `new Date()` on a timer of its own.
 */
export function useCalendarDayTick() {
  const day = ref(localDayKey())
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = () => {
    day.value = localDayKey()
    timer = setTimeout(tick, msUntilNextLocalDay())
  }

  onMounted(() => {
    timer = setTimeout(tick, msUntilNextLocalDay())
  })
  onUnmounted(() => {
    if (timer) clearTimeout(timer)
  })

  return day
}
