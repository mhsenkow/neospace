/**
 * Column-local profile peek for linked accounts.
 * Fetches via clientFor — does not change the global active account.
 */

import type { mastodon } from 'masto'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { clientFor } from '~/composables/useMasto'

const PAGE_SIZE = 20

export function useLinkedProfileFeed() {
  const instancesStore = useInstancesStore()

  const viewingInstanceId = ref<string | null>(null)
  const account = ref<mastodon.v1.Account | null>(null)
  const statuses = ref<ExtendedStatus[]>([])
  const isLoading = ref(false)
  const isLoadingStatuses = ref(false)
  const error = ref<string | null>(null)
  const maxStatusId = ref<string | null>(null)
  const hasMore = ref(true)

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

  const fetchAccount = async (instanceId: string) => {
    const cached = linkedAccounts.value.find((i) => i.id === instanceId)?.user
    if (cached) account.value = cached

    try {
      const client = clientFor(instanceId)
      const fresh = await client.v1.accounts.verifyCredentials()
      account.value = fresh
      const inst = instancesStore.instances.find((i) => i.id === instanceId)
      if (inst) inst.user = fresh
    } catch (e: any) {
      if (!account.value) {
        throw e
      }
    }
  }

  const fetchStatuses = async (refresh = false) => {
    const instanceId = resolvedInstanceId.value
    const user = account.value
    if (!instanceId || !user) return

    if (refresh) {
      statuses.value = []
      maxStatusId.value = null
      hasMore.value = true
    }

    isLoadingStatuses.value = true
    try {
      const client = clientFor(instanceId)
      const instanceUrl = viewingInstance.value?.url || ''
      const page = await client.v1.accounts.$select(user.id).statuses.list({
        limit: PAGE_SIZE,
        maxId: maxStatusId.value || undefined,
        excludeReplies: true,
        excludeReblogs: false,
      } as any)

      const tagged: ExtendedStatus[] = page.map((s) => ({
        ...s,
        _instanceId: instanceId,
        _instanceUrl: instanceUrl,
      }))

      if (refresh) {
        statuses.value = tagged
      } else {
        statuses.value = [...statuses.value, ...tagged]
      }

      if (tagged.length > 0) {
        maxStatusId.value = tagged[tagged.length - 1].id
      }
      hasMore.value = tagged.length === PAGE_SIZE
    } catch (e: any) {
      error.value = e?.message || 'Failed to load posts'
    } finally {
      isLoadingStatuses.value = false
    }
  }

  const refresh = async () => {
    if (!ensureViewingId()) {
      account.value = null
      statuses.value = []
      error.value = null
      return
    }

    const instanceId = resolvedInstanceId.value
    if (!instanceId) return

    isLoading.value = true
    error.value = null
    try {
      await fetchAccount(instanceId)
      await fetchStatuses(true)
    } catch (e: any) {
      error.value = e?.message || 'Failed to load profile'
      statuses.value = []
    } finally {
      isLoading.value = false
    }
  }

  const loadMore = async () => {
    if (!hasMore.value || isLoadingStatuses.value) return
    await fetchStatuses(false)
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

  return {
    viewingInstanceId,
    resolvedInstanceId,
    viewingInstance,
    linkedAccounts,
    account,
    statuses,
    isLoading,
    isLoadingStatuses,
    error,
    hasMore,
    selectAccount,
    refresh,
    loadMore,
  }
}
