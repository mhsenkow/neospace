import type { mastodon } from 'masto'
import type { Ref, ComputedRef } from 'vue'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { activeClient, clientFor } from '~/composables/useMasto'

type ActionStatus = mastodon.v1.Status & { reblogged?: boolean; favourited?: boolean; bookmarked?: boolean }

/**
 * Like, boost, and bookmark handlers shared by RealPostCard (and future extracts).
 */
export function usePostActions(options: {
  displayStatus: ComputedRef<ActionStatus>
  statusUrl: ComputedRef<string | null | undefined>
  requireAuth: () => boolean
}) {
  const statusStore = useStatusStore()
  const instancesStore = useInstancesStore()
  const toastStore = useToastStore()

  const isFavouriting = ref(false)
  const isBoosting = ref(false)
  const isBookmarking = ref(false)
  const likePop = ref(false)

  let resolvedIdCache: string | null = null
  let resolvedClientCache: mastodon.rest.Client | null = null

  const clearActionCache = () => {
    resolvedIdCache = null
    resolvedClientCache = null
  }

  const getActionContext = async (): Promise<{ client: mastodon.rest.Client; id: string } | null> => {
    if (resolvedClientCache && resolvedIdCache) {
      return { client: resolvedClientCache, id: resolvedIdCache }
    }

    const status = options.displayStatus.value
    const ext = status as ExtendedStatus

    if (ext._instanceUrl) {
      const source = instancesStore.getInstanceByUrl(ext._instanceUrl)
      if (source?.accessToken) {
        const client = clientFor(source.id)
        resolvedClientCache = client
        resolvedIdCache = status.id
        return { client, id: status.id }
      }
    }

    if (!instancesStore.instanceUrl || !instancesStore.accessToken) return null

    const primaryClient = activeClient()
    const url = options.statusUrl.value

    if (url) {
      try {
        const statusDomain = new URL(url).hostname
        const primaryDomain = new URL(instancesStore.instanceUrl).hostname
        if (statusDomain === primaryDomain) {
          resolvedClientCache = primaryClient
          resolvedIdCache = status.id
          return { client: primaryClient, id: status.id }
        }
      } catch {
        /* fall through */
      }
    }

    if (url) {
      const localId = await statusStore.resolveStatus(url)
      if (localId) {
        resolvedClientCache = primaryClient
        resolvedIdCache = localId
        return { client: primaryClient, id: localId }
      }
    }

    return { client: primaryClient, id: status.id }
  }

  const handleFavourite = async () => {
    if (!options.requireAuth() || isFavouriting.value) return

    isFavouriting.value = true
    const s = options.displayStatus.value
    s.favourited = !s.favourited
    s.favouritesCount += s.favourited ? 1 : -1
    if (s.favourited) {
      likePop.value = true
      setTimeout(() => {
        likePop.value = false
      }, 320)
    }

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not authenticated')

      if (s.favourited) {
        await ctx.client.v1.statuses.$select(ctx.id).favourite()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unfavourite()
      }
    } catch (e) {
      clearActionCache()
      s.favourited = !s.favourited
      s.favouritesCount += s.favourited ? 1 : -1
      toastStore.show({
        message: 'Couldn’t update like',
        actionLabel: 'Retry',
        onAction: () => void handleFavourite(),
        duration: 5000,
      })
    } finally {
      isFavouriting.value = false
    }
  }

  const toggleBoost = async (wantBoost: boolean) => {
    if (!instancesStore.hasAuthenticatedInstance || isBoosting.value) return
    const s = options.displayStatus.value
    if (s.reblogged === wantBoost) return

    isBoosting.value = true
    s.reblogged = wantBoost
    s.reblogsCount += wantBoost ? 1 : -1

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not authenticated')

      if (wantBoost) {
        await ctx.client.v1.statuses.$select(ctx.id).reblog()
        toastStore.show({ message: 'Reposted', duration: 2200 })
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unreblog()
      }
    } catch (e) {
      clearActionCache()
      s.reblogged = !s.reblogged
      s.reblogsCount += s.reblogged ? 1 : -1
      toastStore.show({
        message: 'Couldn’t update repost',
        actionLabel: 'Retry',
        onAction: () => void toggleBoost(wantBoost),
        duration: 5000,
      })
    } finally {
      isBoosting.value = false
    }
  }

  const handleBookmark = async (closeMenu?: Ref<boolean>) => {
    if (!options.requireAuth() || isBookmarking.value) return

    isBookmarking.value = true
    const s = options.displayStatus.value
    s.bookmarked = !s.bookmarked

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not authenticated')

      if (s.bookmarked) {
        await ctx.client.v1.statuses.$select(ctx.id).bookmark()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unbookmark()
      }
    } catch (e) {
      s.bookmarked = !s.bookmarked
      toastStore.show({
        message: 'Couldn’t update bookmark',
        actionLabel: 'Retry',
        onAction: () => void handleBookmark(closeMenu),
        duration: 5000,
      })
    } finally {
      isBookmarking.value = false
      if (closeMenu) closeMenu.value = false
    }
  }

  return {
    isFavouriting,
    isBoosting,
    isBookmarking,
    likePop,
    handleFavourite,
    toggleBoost,
    handleBookmark,
    getActionContext,
    clearActionCache,
  }
}
