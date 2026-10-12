/**
 * Prev/next controls for overflow-x scroll rails (groups suggested row, etc.).
 */

import { ref, watch, onUnmounted, type Ref } from 'vue'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

export function useHorizontalRail(elRef: Ref<HTMLElement | null>) {
  const canScrollBack = ref(false)
  const canScrollForward = ref(false)
  const reduceMotion = usePrefersReducedMotion()

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
    elRef.value?.scrollBy({ left: delta, behavior: reduceMotion.value ? 'auto' : 'smooth' })
  }

  let ro: ResizeObserver | null = null
  let mo: MutationObserver | null = null
  let attached: HTMLElement | null = null

  const detach = () => {
    attached?.removeEventListener('scroll', update)
    ro?.disconnect()
    ro = null
    mo?.disconnect()
    mo = null
    attached = null
  }

  // Rails often mount after the page (behind v-if while data loads) — follow the ref
  // instead of measuring once in onMounted, or the arrows never appear.
  watch(
    elRef,
    (el) => {
      detach()
      if (el) {
        attached = el
        el.addEventListener('scroll', update, { passive: true })
        ro = new ResizeObserver(update)
        ro.observe(el)
        // Items added or removed change scrollWidth without resizing the rail itself
        if (typeof MutationObserver !== 'undefined') {
          mo = new MutationObserver(update)
          mo.observe(el, { childList: true })
        }
      }
      update()
    },
    { immediate: true, flush: 'post' },
  )

  onUnmounted(detach)

  return { canScrollBack, canScrollForward, scrollBy, update }
}
