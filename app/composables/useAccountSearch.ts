/**
 * Account search + following list for mention / DM recipient picking.
 */

import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { useInstancesStore } from '~/stores/instances'

export function useAccountSearch() {
  const instancesStore = useInstancesStore()
  const results = ref<mastodon.v1.Account[]>([])
  const following = ref<mastodon.v1.Account[]>([])
  const isSearching = ref(false)
  const isLoadingFollowing = ref(false)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const loadFollowing = async (limit = 40) => {
    if (!instancesStore.currentUser?.id || !instancesStore.hasAuthenticatedInstance) {
      following.value = []
      return
    }
    if (following.value.length) return
    isLoadingFollowing.value = true
    try {
      const client = activeClient()
      const list = (await client.v1.accounts
        .$select(instancesStore.currentUser.id)
        .following.list({ limit } as any)) as mastodon.v1.Account[]
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
      results.value = []
      isSearching.value = false
      return
    }
    isSearching.value = true
    searchTimer = setTimeout(async () => {
      try {
        if (!instancesStore.hasAuthenticatedInstance) {
          results.value = []
          return
        }
        const client = activeClient()
        const found = (await client.v1.accounts.search({
          q,
          limit,
          resolve: true,
        } as any)) as mastodon.v1.Account[]
        results.value = Array.isArray(found) ? found : []
      } catch (e) {
        console.warn('Account search failed:', e)
        results.value = []
      } finally {
        isSearching.value = false
      }
    }, 220)
  }

  const clear = () => {
    if (searchTimer) clearTimeout(searchTimer)
    results.value = []
    isSearching.value = false
  }

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
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
