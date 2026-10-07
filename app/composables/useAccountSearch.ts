/**
 * Account search + following list for mention / DM recipient picking.
 */

import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { createRaceGuard } from '~/composables/useRace'
import { useInstancesStore } from '~/stores/instances'

export function useAccountSearch() {
  const instancesStore = useInstancesStore()
  const results = ref<mastodon.v1.Account[]>([])
  const following = ref<mastodon.v1.Account[]>([])
  const isSearching = ref(false)
  const isLoadingFollowing = ref(false)
  const searchRace = createRaceGuard()
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const loadFollowing = async (limit = 40, force = false) => {
    if (!instancesStore.currentUser?.id || !instancesStore.hasAuthenticatedInstance) {
      following.value = []
      return
    }
    if (following.value.length && !force) return
    isLoadingFollowing.value = true
    try {
      const client = activeClient()
      const list = await client.v1.accounts
        .$select(instancesStore.currentUser.id)
        .following.list({ limit })
      following.value = Array.isArray(list) ? list : []
    } catch (e) {
      console.warn('Failed to load following:', e)
      following.value = []
    } finally {
      isLoadingFollowing.value = false
    }
  }

  const search = (query: string, limit = 8) => {
    const q = query.replace(/^@/, '').trim()
    if (searchTimer) clearTimeout(searchTimer)
    if (!q) {
      searchRace.next()
      results.value = []
      isSearching.value = false
      return
    }
    isSearching.value = true
    searchTimer = setTimeout(async () => {
      const ticket = searchRace.next()
      try {
        if (!instancesStore.hasAuthenticatedInstance) {
          if (ticket.isCurrent()) results.value = []
          return
        }
        const client = activeClient()
        const found = await client.v1.accounts.search.list({
          q,
          limit,
          resolve: q.includes('@'),
        })
        if (!ticket.isCurrent()) return
        results.value = Array.isArray(found) ? found : []
      } catch (e) {
        if (!ticket.isCurrent()) return
        console.warn('Account search failed:', e)
        results.value = []
      } finally {
        if (ticket.isCurrent()) isSearching.value = false
      }
    }, 220)
  }

  const clear = () => {
    if (searchTimer) clearTimeout(searchTimer)
    searchRace.next()
    results.value = []
    isSearching.value = false
  }

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
    searchRace.next()
  })

  return {
    results,
    following,
    isSearching,
    isLoadingFollowing,
    loadFollowing,
    search,
    clear,
  }
}

export function accountHandle(account: mastodon.v1.Account) {
  return `@${account.acct}`
}
