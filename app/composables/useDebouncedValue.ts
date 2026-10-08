/**
 * Debounced mirror of a ref — for find-in-feed filters that do per-row work.
 * Clearing (empty/whitespace) applies immediately so the full list snaps back.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'

export function useDebouncedValue(source: Ref<string>, delayMs = 150): Readonly<Ref<string>> {
  const debounced = ref(source.value)
  let timer: ReturnType<typeof setTimeout> | null = null

  watch(source, (val) => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!val.trim()) {
      debounced.value = val
      return
    }
    timer = setTimeout(() => {
      timer = null
      debounced.value = val
    }, delayMs)
  })

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
    timer = null
  })

  return debounced
}
