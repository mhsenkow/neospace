/**
 * Generic max_id pager with dedupe, generation token, and AbortController.
 */

import { ref, type Ref } from 'vue'

export type PagerItem = { id: string }

export type FetchPageFn<T extends PagerItem> = (opts: {
  maxId?: string
  signal: AbortSignal
}) => Promise<T[]>

export function usePager<T extends PagerItem>(fetchPage: FetchPageFn<T>) {
  const items = ref<T[]>([]) as Ref<T[]>
  const hasMore = ref(true)
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const error = ref<unknown>(null)

  let generation = 0
  let controller: AbortController | null = null

  const abortActive = () => {
    controller?.abort()
    controller = null
  }

  const reset = () => {
    abortActive()
    generation += 1
    items.value = []
    hasMore.value = true
    isLoading.value = false
    isLoadingMore.value = false
    error.value = null
  }

  const dedupeAppend = (page: T[], replace: boolean) => {
    if (replace) {
      const seen = new Set<string>()
      const next: T[] = []
      for (const item of page) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        next.push(item)
      }
      items.value = next
      return
    }
    const seen = new Set(items.value.map((i) => i.id))
    const next = [...items.value]
    for (const item of page) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      next.push(item)
    }
    items.value = next
  }

  const loadInitial = async () => {
    abortActive()
    const gen = ++generation
    controller = new AbortController()
    const { signal } = controller

    isLoading.value = true
    isLoadingMore.value = false
    error.value = null
    hasMore.value = true

    try {
      const page = await fetchPage({ signal })
      if (gen !== generation) return
      dedupeAppend(page, true)
      hasMore.value = page.length > 0
    } catch (e) {
      if (gen !== generation) return
      if ((e as { name?: string })?.name === 'AbortError') return
      error.value = e
    } finally {
      if (gen === generation) {
        isLoading.value = false
        controller = null
      }
    }
  }

  const loadMore = async () => {
    if (!hasMore.value || isLoading.value || isLoadingMore.value) return
    const last = items.value[items.value.length - 1]
    if (!last) {
      await loadInitial()
      return
    }

    abortActive()
    const gen = generation
    controller = new AbortController()
    const { signal } = controller

    isLoadingMore.value = true
    error.value = null

    try {
      const page = await fetchPage({ maxId: last.id, signal })
      if (gen !== generation) return
      if (!page.length) {
        hasMore.value = false
        return
      }
      const before = items.value.length
      dedupeAppend(page, false)
      if (items.value.length === before) hasMore.value = false
    } catch (e) {
      if (gen !== generation) return
      if ((e as { name?: string })?.name === 'AbortError') return
      error.value = e
    } finally {
      if (gen === generation) {
        isLoadingMore.value = false
        controller = null
      }
    }
  }

  return {
    items,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    reset,
    loadInitial,
    loadMore,
  }
}
