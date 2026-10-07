/**
 * Prev/next controls for overflow-x scroll rails (groups suggested row, etc.).
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export function useHorizontalRail(elRef: Ref<HTMLElement | null>) {
  const canScrollBack = ref(false)
  const canScrollForward = ref(false)

  const update = () => {
    const el = elRef.value
    if (!el) {
      canScrollBack.value = false
      canScrollForward.value = false
      return
    }
    const max = el.scrollWidth - el.clientWidth
    canScrollBack.value = el.scrollLeft > 4
    canScrollForward.value = max > 4 && el.scrollLeft < max - 4
  }

  const scrollBy = (delta: number) => {
    elRef.value?.scrollBy({ left: delta, behavior: 'smooth' })
  }

  let ro: ResizeObserver | null = null

  onMounted(() => {
    const el = elRef.value
    if (!el) return
    el.addEventListener('scroll', update, { passive: true })
    ro = new ResizeObserver(update)
    ro.observe(el)
    update()
  })

  onUnmounted(() => {
    elRef.value?.removeEventListener('scroll', update)
    ro?.disconnect()
  })

  return { canScrollBack, canScrollForward, scrollBy, update }
}
