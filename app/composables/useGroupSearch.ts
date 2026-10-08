/**
 * Debounced hashtag-group search with a race guard.
 * Shared by the Groups page and the compose group picker.
 */

import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { useGroupsStore, type Group } from '~/stores/groups'
import { createRaceGuard } from '~/composables/useRace'

export function useGroupSearch(
  query: Ref<string>,
  opts: { minLength?: number; delayMs?: number } = {},
) {
  const groupsStore = useGroupsStore()
  const minLength = opts.minLength ?? 1
  const delayMs = opts.delayMs ?? 300

  const results = ref<Group[]>([])
  const isSearching = ref(false)
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
  }

  watch(query, (q) => {
    if (timer) clearTimeout(timer)
    timer = null
    const trimmed = q.trim()
    if (trimmed.length < minLength) {
      reset()
      return
    }
    // Busy immediately so "no results" doesn't flash during the debounce
    isSearching.value = true
    timer = setTimeout(async () => {
      timer = null
      const ticket = race.next()
      try {
        const hits = await groupsStore.searchGroups(trimmed)
        if (!ticket.isCurrent()) return
        results.value = hits
      } catch {
        if (!ticket.isCurrent()) return
        results.value = []
      } finally {
        if (ticket.isCurrent()) isSearching.value = false
      }
    }, delayMs)
  })

  onScopeDispose(cancel)

  return { results, isSearching, reset, cancel }
}
