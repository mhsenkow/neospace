/**
 * Fetch the signed-in account's Mastodon lists for board / drawer chrome.
 */
import type { mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'

export type MastodonListRow = {
  id: string
  title: string
}

export function useMastodonLists() {
  const instances = useInstancesStore()
  const lists = useState<MastodonListRow[]>('neo-mastodon-lists', () => [])
  const loading = useState('neo-mastodon-lists-loading', () => false)
  const loadedFor = useState<string | null>('neo-mastodon-lists-account', () => null)

  const refresh = async (force = false) => {
    const accountId = instances.activeAccountId
    if (!accountId || !instances.isAuthenticated) {
      lists.value = []
      loadedFor.value = null
      return
    }
    if (!force && loadedFor.value === accountId && lists.value.length) return
    loading.value = true
    try {
      const client = instances.getClient(accountId)
      const rows: MastodonListRow[] = []
      for await (const batch of client.v1.lists.list()) {
        const chunk = (Array.isArray(batch) ? batch : [batch]) as mastodon.v1.List[]
        for (const list of chunk) {
          if (list?.id && list.title) rows.push({ id: list.id, title: list.title })
        }
        if (rows.length >= 40) break
      }
      lists.value = rows
      loadedFor.value = accountId
    } catch {
      lists.value = []
    } finally {
      loading.value = false
    }
  }

  if (import.meta.client) {
    watch(
      () => instances.activeAccountId,
      () => {
        void refresh(true)
      },
      { immediate: true },
    )
  }

  return { lists, loading, refresh }
}
