import type { mastodon } from 'masto'
import type { Ref, ComputedRef } from 'vue'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { activeClient, clientFor } from '~/composables/useMasto'
import { hostnameOf } from '~/utils/instances'

// Status already carries reblogged/favourited/bookmarked (as boolean | null)
type ActionStatus = mastodon.v1.Status

/**
 * Like, boost, and bookmark handlers shared by RealPostCard (and future extracts).
 */
export function usePostActions(options: {
  displayStatus: ComputedRef<ActionStatus>
  statusUrl: ComputedRef<string | null | undefined>
  requireAuth: () => boolean
  /**
   * Timeline-row provenance. Reblog cards unwrap to the inner status, which does
   * not carry `_instanceUrl` — callers must pass the outer row's origin.
   */
  sourceInstanceUrl?: ComputedRef<string | null | undefined>
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

  const sourceUrlOf = () => {
    const fromOpt = options.sourceInstanceUrl?.value?.trim() || ''
    if (fromOpt) return fromOpt
    const ext = options.displayStatus.value as ExtendedStatus
    return ext._instanceUrl?.trim() || ''
  }

  // Resolved id/client belong to one post on one account — drop them when
  // either changes (card reuse, live deck swaps, account switch).
  watch(
    () => {
      const s = options.displayStatus.value as ExtendedStatus
      return `${s.id}|${s.uri || ''}|${sourceUrlOf()}|${instancesStore.activeAccountId || ''}`
    },
    clearActionCache,
  )

  const remember = (client: mastodon.rest.Client, id: string) => {
    resolvedClientCache = client
    resolvedIdCache = id
    return { client, id }
  }

  /**
   * Pick a client + status id that the favourite/reblog/bookmark APIs accept.
   * Never send a foreign snowflake to the active account — that 404s for remote
   * federated posts (especially reblogs, where `_instanceUrl` lives on the wrapper).
   */
  const getActionContext = async (): Promise<{ client: mastodon.rest.Client; id: string } | null> => {
    if (resolvedClientCache && resolvedIdCache) {
      return { client: resolvedClientCache, id: resolvedIdCache }
    }

    if (!instancesStore.instanceUrl || !instancesStore.accessToken) return null

    const status = options.displayStatus.value
    const primaryClient = activeClient()
    const activeHost = hostnameOf(instancesStore.instanceUrl)
    const sourceUrl = sourceUrlOf()
    const sourceHost = sourceUrl ? hostnameOf(sourceUrl) : ''
    // ActivityPub URI resolves more reliably than the HTML url across forks.
    const lookupUrl =
      status.uri?.trim() || options.statusUrl.value?.trim() || status.url?.trim() || ''

    // Fetched via the active account — local id is already valid.
    if (sourceHost && sourceHost === activeHost) {
      return remember(primaryClient, status.id)
    }

    // Multi-account / Edward: act on the account that served this row.
    if (sourceUrl) {
      const source = instancesStore.getInstanceByUrl(sourceUrl)
      if (source?.accessToken) {
        return remember(clientFor(source.id), status.id)
      }
    }

    // Status HTML/AP URL is on the active host.
    if (lookupUrl && hostnameOf(lookupUrl) === activeHost) {
      return remember(primaryClient, status.id)
    }

    // Search+resolve onto the active account (remote federated posts).
    if (lookupUrl) {
      const localId = await statusStore.resolveStatus(lookupUrl)
      if (localId) return remember(primaryClient, localId)
    }

    // Last resort: verify the raw id exists locally (same-server edge cases).
    try {
      await statusStore.fetchStatus(status.id)
      return remember(primaryClient, status.id)
    } catch {
      /* foreign id */
    }

    return null
  }

  const actionFailedToast = (kind: 'like' | 'repost' | 'bookmark', retry: () => void) => {
    toastStore.show({
      message:
        kind === 'like'
          ? 'Couldn’t update like — post may not be on your server yet'
          : kind === 'repost'
            ? 'Couldn’t update repost — post may not be on your server yet'
            : 'Couldn’t update bookmark — post may not be on your server yet',
      actionLabel: 'Retry',
      onAction: retry,
      duration: 5000,
    })
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
      if (!ctx) throw new Error('Not resolvable')

      if (s.favourited) {
        await ctx.client.v1.statuses.$select(ctx.id).favourite()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unfavourite()
      }
    } catch (e) {
      clearActionCache()
      s.favourited = !s.favourited
      s.favouritesCount += s.favourited ? 1 : -1
      actionFailedToast('like', () => void handleFavourite())
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
      if (!ctx) throw new Error('Not resolvable')

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
      actionFailedToast('repost', () => void toggleBoost(wantBoost))
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
      if (!ctx) throw new Error('Not resolvable')

      if (s.bookmarked) {
        await ctx.client.v1.statuses.$select(ctx.id).bookmark()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unbookmark()
      }
    } catch (e) {
      clearActionCache()
      s.bookmarked = !s.bookmarked
      actionFailedToast('bookmark', () => void handleBookmark(closeMenu))
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
