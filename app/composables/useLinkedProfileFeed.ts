/**
 * Column-local profile peek for linked accounts.
 * Fetches via clientFor — does not change the global active account.
 */

import type { mastodon } from 'masto'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { clientFor } from '~/composables/useMasto'
import { usePager } from '~/composables/usePager'

const PAGE_SIZE = 20

export function useLinkedProfileFeed() {
  const instancesStore = useInstancesStore()

  const viewingInstanceId = ref<string | null>(null)
  const account = ref<mastodon.v1.Account | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const loadMoreError = ref<string | null>(null)

  const linkedAccounts = computed(() => instancesStore.authenticatedInstances)

  const resolvedInstanceId = computed(() => {
    const peek = viewingInstanceId.value
    if (peek && linkedAccounts.value.some((i) => i.id === peek)) return peek
    return instancesStore.activeAccountId || linkedAccounts.value[0]?.id || null
  })

  const viewingInstance = computed(() =>
    linkedAccounts.value.find((i) => i.id === resolvedInstanceId.value) || null,
  )

  const ensureViewingId = () => {
    if (!resolvedInstanceId.value) {
      viewingInstanceId.value = null
      return false
    }
    if (
      !viewingInstanceId.value ||
      !linkedAccounts.value.some((i) => i.id === viewingInstanceId.value)
    ) {
      viewingInstanceId.value = resolvedInstanceId.value
    }
    return !!viewingInstanceId.value
  }

  /**
   * Bumped per refresh: picking account A then B quickly must not let A's
   * slower verifyCredentials land in `account` (B's client would then page
   * statuses for A's account id).
   */
  let refreshGen = 0

  const fetchAccount = async (instanceId: string, gen: number) => {
    // Never keep showing the previous instance's account while this one loads
    account.value = linkedAccounts.value.find((i) => i.id === instanceId)?.user || null

    try {
      const client = clientFor(instanceId)
      const fresh = await client.v1.accounts.verifyCredentials()
      instancesStore.updateActiveAccount(fresh, instanceId)
      if (gen === refreshGen) account.value = fresh
    } catch (e: any) {
      if (gen === refreshGen && !account.value) {
        throw e
      }
    }
  }

  const statusPager = usePager<ExtendedStatus>(async ({ maxId, signal }) => {
    const instanceId = resolvedInstanceId.value
    const user = account.value
    if (!instanceId || !user) return []

    const client = clientFor(instanceId)
    const instanceUrl = viewingInstance.value?.url || ''
    void signal
    const page = await client.v1.accounts.$select(user.id).statuses.list({
      limit: PAGE_SIZE,
      maxId,
      excludeReplies: true,
      excludeReblogs: false,
    } as any)

    return page.map((s) => ({
      ...s,
      _instanceId: instanceId,
      _instanceUrl: instanceUrl,
    }))
  })

  const statuses = statusPager.items
  const hasMore = statusPager.hasMore

  const refresh = async () => {
    if (!ensureViewingId()) {
      refreshGen += 1
      isLoading.value = false
      account.value = null
      statusPager.reset()
      error.value = null
      return
    }

    const instanceId = resolvedInstanceId.value
    if (!instanceId) return

    const gen = ++refreshGen
    isLoading.value = true
    error.value = null
    try {
      await fetchAccount(instanceId, gen)
      if (gen !== refreshGen) return
      statusPager.reset()
      await statusPager.loadInitial()
    } catch (e: any) {
      if (gen !== refreshGen) return
      error.value = e?.message || 'Failed to load profile'
      statusPager.reset()
    } finally {
      if (gen === refreshGen) isLoading.value = false
    }
  }

  const loadMore = async () => {
    if (!hasMore.value || statusPager.isLoading.value || statusPager.isLoadingMore.value) return
    loadMoreError.value = null
    await statusPager.loadMore()
    const err = statusPager.error.value
    if (err) {
      loadMoreError.value = err instanceof Error ? err.message : 'Could not load more'
    }
  }

  const selectAccount = (instanceId: string) => {
    if (!linkedAccounts.value.some((i) => i.id === instanceId)) return
    if (viewingInstanceId.value === instanceId) return
    viewingInstanceId.value = instanceId
    void refresh()
  }

  watch(
    () => [instancesStore.activeAccountId, linkedAccounts.value.map((i) => i.id).join(',')] as const,
    () => {
      const peek = viewingInstanceId.value
      const stillLinked = peek && linkedAccounts.value.some((i) => i.id === peek)
      if (!stillLinked) {
        viewingInstanceId.value = instancesStore.activeAccountId
        void refresh()
      }
    },
  )

  // Initial load also uses isLoadingStatuses for the first page — expose combined busy
  const loadingStatuses = computed(
    () => statusPager.isLoading.value || statusPager.isLoadingMore.value,
  )

  return {
    viewingInstanceId,
    resolvedInstanceId,
    viewingInstance,
    linkedAccounts,
    account,
    statuses,
    isLoading,
    isLoadingStatuses: loadingStatuses,
    error,
    loadMoreError,
    hasMore,
    selectAccount,
    refresh,
    loadMore,
  }
}
