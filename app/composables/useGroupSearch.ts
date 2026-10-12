/**
 * Debounced hashtag-group search with a race guard.
 * Shared by the Groups page and the compose group picker.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { useGroupsStore, type Group } from '~/stores/groups'
import { createRaceGuard } from '~/composables/useRace'
import { normalizeHashtagInput } from '~/utils/hashtag'

export function useGroupSearch(
  query: Ref<string>,
  opts: { minLength?: number; delayMs?: number } = {},
) {
  const groupsStore = useGroupsStore()
  const minLength = opts.minLength ?? 1
  const delayMs = opts.delayMs ?? 300

  const results = ref<Group[]>([])
  const isSearching = ref(false)
  /** The last search failed (offline, 401, 429) — distinct from "no such tag" */
  const searchError = ref<string | null>(null)
  const race = createRaceGuard()
  let timer: ReturnType<typeof setTimeout> | null = null

  /** Stop any pending/in-flight search (results stay as they are) */
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    race.abort()
    isSearching.value = false
  }

  const reset = () => {
    cancel()
    results.value = []
    searchError.value = null
  }

  const run = async (trimmed: string) => {
    const ticket = race.next()
    searchError.value = null
    try {
      const hits = await groupsStore.searchGroups(trimmed)
      if (!ticket.isCurrent()) return
      results.value = hits
    } catch {
      if (!ticket.isCurrent()) return
      results.value = []
      searchError.value = 'Couldn’t search — check your connection'
    } finally {
      if (ticket.isCurrent()) isSearching.value = false
    }
  }

  watch(query, (q) => {
    if (timer) clearTimeout(timer)
    timer = null
    const trimmed = normalizeHashtagInput(q)
    if (!trimmed || trimmed.length < minLength) {
      reset()
      return
    }
    // Busy immediately so "no results" doesn't flash during the debounce
    isSearching.value = true
    timer = setTimeout(() => {
      timer = null
      void run(trimmed)
    }, delayMs)
  })

  /** Re-run the current query now (the Retry button) */
  const retry = () => {
    const trimmed = normalizeHashtagInput(query.value)
    if (!trimmed || trimmed.length < minLength) return
    isSearching.value = true
    void run(trimmed)
  }

  onScopeDispose(cancel)

  return { results, isSearching, searchError, retry, reset, cancel }
}
