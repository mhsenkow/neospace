import type { mastodon } from 'masto'
import type { Ref, ComputedRef } from 'vue'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { activeClient, activeCredentials, clientFor } from '~/composables/useMasto'
import { hostnameOf } from '~/utils/instances'
import {
  authorizeInteractionUrl,
  federationMessage,
  isTransient,
  resolveCandidates,
  type FederationAction,
  type FederationFailure,
} from '~/utils/federation'

/** "Acting as @x" is said once per account per session, not on every like */
const announcedActingAs = new Set<string>()

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
  const boostPop = ref(false)
  const bookmarkPop = ref(false)
  const popTimers: Record<'like' | 'boost' | 'bookmark', ReturnType<typeof setTimeout> | null> = {
    like: null,
    boost: null,
    bookmark: null,
  }
  const flash = (kind: 'like' | 'boost' | 'bookmark', flag: Ref<boolean>, ms = 420) => {
    flag.value = true
    if (popTimers[kind]) clearTimeout(popTimers[kind]!)
    popTimers[kind] = setTimeout(() => {
      popTimers[kind] = null
      flag.value = false
    }, ms)
  }
  onUnmounted(() => {
    for (const k of Object.keys(popTimers) as Array<keyof typeof popTimers>) {
      if (popTimers[k]) clearTimeout(popTimers[k]!)
    }
  })

  let resolvedIdCache: string | null = null
  let resolvedClientCache: mastodon.rest.Client | null = null
  let resolvedInstanceIdCache: string | null = null
  /** Why the last resolve failed — drives the toast wording + escape hatch */
  let lastFailure: FederationFailure | null = null
  type ActionCtx = { client: mastodon.rest.Client; id: string; instanceId: string }
  let inflight: Promise<ActionCtx | null> | null = null

  const clearActionCache = () => {
    resolvedIdCache = null
    resolvedClientCache = null
    resolvedInstanceIdCache = null
    inflight = null
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

  const remember = (client: mastodon.rest.Client, id: string, instanceId: string) => {
    resolvedClientCache = client
    resolvedIdCache = id
    resolvedInstanceIdCache = instanceId
    return { client, id, instanceId }
  }

  /**
   * Pick a client + status id that the favourite/reblog/bookmark APIs accept.
   * Never send a foreign snowflake to the active account — that 404s for remote
   * federated posts (especially reblogs, where `_instanceUrl` lives on the wrapper).
   */
  /** The server that acts (honours a read-account override, like the client does) */
  const actingUrl = () => {
    try {
      return activeCredentials().url
    } catch {
      return ''
    }
  }

  const getActionContext = async (): Promise<ActionCtx | null> => {
    if (resolvedClientCache && resolvedIdCache && resolvedInstanceIdCache) {
      return {
        client: resolvedClientCache,
        id: resolvedIdCache,
        instanceId: resolvedInstanceIdCache,
      }
    }
    // A prewarm may already be resolving this post — share it
    if (inflight) return inflight
    inflight = resolveContext().finally(() => {
      inflight = null
    })
    return inflight
  }

  const resolveContext = async (): Promise<ActionCtx | null> => {
    lastFailure = null
    const homeUrl = actingUrl()
    if (!homeUrl) return null

    const status = options.displayStatus.value
    const primaryClient = activeClient()
    const activeId = instancesStore.activeAccountId || ''
    const activeHost = hostnameOf(homeUrl)
    const sourceUrl = sourceUrlOf()
    const sourceHost = sourceUrl ? hostnameOf(sourceUrl) : ''
    // ActivityPub URI resolves more reliably than the HTML url across forks.
    const lookupUrl =
      status.uri?.trim() || options.statusUrl.value?.trim() || status.url?.trim() || ''

    // Fetched via the active account — local id is already valid.
    if (sourceHost && sourceHost === activeHost) {
      return remember(primaryClient, status.id, activeId)
    }

    // Multi-account / Edward: act on the account that served this row — its id
    // is already valid there, so no cross-server import is needed. Say so once.
    if (sourceUrl) {
      const source = instancesStore.getInstanceByUrl(sourceUrl)
      if (source?.accessToken) {
        const who = source.user?.acct ? `@${source.user.acct}@${hostnameOf(source.url)}` : hostnameOf(source.url)
        if (!announcedActingAs.has(source.id)) {
          announcedActingAs.add(source.id)
          toastStore.show({ message: `Acting as ${who} — the account that saw this post`, duration: 3600 })
        }
        return remember(clientFor(source.id), status.id, source.id)
      }
    }

    // Status HTML/AP URL is on the active host.
    if (lookupUrl && hostnameOf(lookupUrl) === activeHost) {
      return remember(primaryClient, status.id, activeId)
    }

    // Import onto your server: ActivityPub id first, then the page URL
    const candidates = resolveCandidates(status.uri, options.statusUrl.value, status.url)
    if (candidates.length) {
      const { id: localId, failure } = await statusStore.resolveStatusDetailed(candidates)
      if (localId) return remember(primaryClient, localId, activeId)
      lastFailure = failure
    }

    // Last resort: the raw id exists locally AND is the same post (same-server edge
    // cases). A foreign snowflake/ULID can collide with an unrelated local status, so
    // without a matching ActivityPub uri we fail closed instead of acting on it.
    try {
      const fetched = await statusStore.fetchStatus(status.id)
      if (status.uri && fetched?.uri === status.uri) {
        return remember(primaryClient, status.id, activeId)
      }
    } catch {
      /* foreign id */
    }

    return null
  }

  /**
   * Say *why* it failed, naming both servers. Slow / rate-limited → Retry.
   * Your server can't fetch it → open it on your own server's web page, which
   * does the import server-side (works for posts the API search won't return).
   */
  const actionFailedToast = (kind: FederationAction, retry: () => void) => {
    const failure = lastFailure ?? 'unknown'
    const home = hostnameOf(actingUrl()) || null
    const origin = hostnameOf(options.statusUrl.value || options.displayStatus.value.uri || '') || null
    const uri = options.displayStatus.value.uri || options.statusUrl.value || ''
    const canHandOff = !!uri && !!actingUrl() && !isTransient(failure) && failure !== 'offline'
    toastStore.show({
      message: federationMessage(failure, kind, { home, origin }),
      actionLabel: canHandOff ? `Open on ${home}` : 'Retry',
      onAction: canHandOff
        ? () => window.open(authorizeInteractionUrl(actingUrl(), uri), '_blank', 'noopener')
        : retry,
      duration: 7000,
    })
  }

  /**
   * Start the cross-server import before the tap (hover / focus on the action
   * row, or a post landing on Edward's deck) so the like itself is instant —
   * and any failure is known before you press.
   */
  const prewarm = () => {
    if (!instancesStore.hasAuthenticatedInstance || resolvedIdCache || inflight) return
    void getActionContext().catch(() => {})
  }

  const handleFavourite = async () => {
    if (!options.requireAuth() || isFavouriting.value) return

    isFavouriting.value = true
    const s = options.displayStatus.value
    // Capture the intent — the same object can be toggled from another card
    // (board columns share statuses) while this request is in flight.
    const want = !s.favourited
    s.favourited = want
    s.favouritesCount = Math.max(0, (s.favouritesCount || 0) + (want ? 1 : -1))
    if (want) {
      flash('like', likePop, 420)
    }

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not resolvable')

      if (import.meta.client && !navigator.onLine && ctx.instanceId) {
        const { enqueue } = useOfflineQueue()
        enqueue({
          kind: want ? 'favourite' : 'unfavourite',
          statusId: ctx.id,
          instanceId: ctx.instanceId,
        })
        toastStore.show({
          message: want ? 'Liked — will sync when you’re back online' : 'Unlike queued offline',
          duration: 3200,
        })
        return
      }

      if (want) {
        await ctx.client.v1.statuses.$select(ctx.id).favourite()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unfavourite()
      }
    } catch (e) {
      clearActionCache()
      // Network drop mid-flight — keep the optimistic state and queue it
      const offlineish =
        import.meta.client &&
        (!navigator.onLine ||
          (e instanceof TypeError && /fetch|network/i.test(e.message || '')))
      if (offlineish) {
        try {
          const ctx = await getActionContext().catch(() => null)
          if (ctx) {
            const { enqueue } = useOfflineQueue()
            enqueue({
              kind: want ? 'favourite' : 'unfavourite',
              statusId: ctx.id,
              instanceId: ctx.instanceId,
            })
            toastStore.show({
              message: want ? 'Liked — will sync when you’re back online' : 'Unlike queued offline',
              duration: 3200,
            })
            return
          }
        } catch {
          /* fall through to revert */
        }
      }
      if (s.favourited === want) {
        s.favourited = !want
        s.favouritesCount = Math.max(0, (s.favouritesCount || 0) + (want ? -1 : 1))
      }
      actionFailedToast('like', () => void handleFavourite())
    } finally {
      isFavouriting.value = false
    }
  }

  const toggleBoost = async (wantBoost: boolean) => {
    if (!instancesStore.hasAuthenticatedInstance || isBoosting.value) return
    const s = options.displayStatus.value
    if (s.reblogged === wantBoost) return
    // Followers-only / direct posts can't be reposted — say so instead of failing mid-flight
    if (wantBoost && (s.visibility === 'private' || s.visibility === 'direct')) {
      toastStore.show({
        message:
          s.visibility === 'direct'
            ? 'Direct messages can’t be reposted'
            : 'Followers-only posts can’t be reposted',
        duration: 3200,
      })
      return
    }

    isBoosting.value = true
    s.reblogged = wantBoost
    s.reblogsCount = Math.max(0, (s.reblogsCount || 0) + (wantBoost ? 1 : -1))
    if (wantBoost) flash('boost', boostPop, 320)

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not resolvable')

      if (import.meta.client && !navigator.onLine && ctx.instanceId) {
        const { enqueue } = useOfflineQueue()
        enqueue({
          kind: wantBoost ? 'reblog' : 'unreblog',
          statusId: ctx.id,
          instanceId: ctx.instanceId,
        })
        toastStore.show({
          message: wantBoost
            ? 'Reposted — will sync when you’re back online'
            : 'Undo repost queued offline',
          duration: 3200,
        })
        return
      }

      if (wantBoost) {
        await ctx.client.v1.statuses.$select(ctx.id).reblog()
        toastStore.show({ message: 'Reposted', duration: 2200 })
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unreblog()
      }
    } catch (e) {
      clearActionCache()
      if (s.reblogged === wantBoost) {
        s.reblogged = !wantBoost
        s.reblogsCount = Math.max(0, (s.reblogsCount || 0) + (wantBoost ? -1 : 1))
      }
      actionFailedToast('repost', () => void toggleBoost(wantBoost))
    } finally {
      isBoosting.value = false
    }
  }

  const handleBookmark = async (closeMenu?: Ref<boolean>) => {
    if (!options.requireAuth() || isBookmarking.value) return

    isBookmarking.value = true
    const s = options.displayStatus.value
    const want = !s.bookmarked
    s.bookmarked = want
    if (want) flash('bookmark', bookmarkPop, 280)

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not resolvable')

      if (want) {
        await ctx.client.v1.statuses.$select(ctx.id).bookmark()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unbookmark()
      }
    } catch (e) {
      clearActionCache()
      if (s.bookmarked === want) s.bookmarked = !want
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
    boostPop,
    bookmarkPop,
    handleFavourite,
    toggleBoost,
    handleBookmark,
    getActionContext,
    clearActionCache,
    prewarm,
  }
}
