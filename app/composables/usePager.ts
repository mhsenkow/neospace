/**
 * Generic max_id pager with dedupe, generation token, and AbortController.
 *
 * fetchPage may return a plain array (cursor = last item id — statuses) or a
 * CursorPage with an explicit `nextMaxId` from the Link header (account lists,
 * whose ids are not valid max_id cursors).
 */

import { ref, type Ref } from 'vue'
import type { CursorPage } from '~/utils/linkHeader'

export type PagerItem = { id: string }

export type FetchPageFn<T extends PagerItem> = (opts: {
  maxId?: string
  signal: AbortSignal
}) => Promise<T[] | CursorPage<T>>

function normalizePage<T>(page: T[] | CursorPage<T>, lastId: (items: T[]) => string | null) {
  if (Array.isArray(page)) return { items: page, nextMaxId: lastId(page), explicit: false }
  return { items: page.items, nextMaxId: page.nextMaxId, explicit: true }
}

export function usePager<T extends PagerItem>(fetchPage: FetchPageFn<T>) {
  const items = ref<T[]>([]) as Ref<T[]>
  const hasMore = ref(true)
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const error = ref<unknown>(null)

  let generation = 0
  let controller: AbortController | null = null
  /** Cursor for the next page (Link-header max_id, or last item id) */
  let nextMaxId: string | null = null

  const lastIdOf = (page: T[]) => page[page.length - 1]?.id ?? null

  const abortActive = () => {
    controller?.abort()
    controller = null
  }

  const reset = () => {
    abortActive()
    generation += 1
    nextMaxId = null
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
      const page = normalizePage(await fetchPage({ signal }), lastIdOf)
      if (gen !== generation) return
      dedupeAppend(page.items, true)
      nextMaxId = page.nextMaxId
      hasMore.value = page.items.length > 0 && (!page.explicit || !!page.nextMaxId)
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
    if (!items.value.length) {
      await loadInitial()
      return
    }
    const cursor = nextMaxId ?? lastIdOf(items.value)
    if (!cursor) {
      hasMore.value = false
      return
    }

    abortActive()
    const gen = generation
    controller = new AbortController()
    const { signal } = controller

    isLoadingMore.value = true
    error.value = null

    try {
      const page = normalizePage(await fetchPage({ maxId: cursor, signal }), lastIdOf)
      if (gen !== generation) return
      if (!page.items.length) {
        hasMore.value = false
        return
      }
      const before = items.value.length
      dedupeAppend(page.items, false)
      nextMaxId = page.nextMaxId
      if (items.value.length === before || (page.explicit && !page.nextMaxId)) hasMore.value = false
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
