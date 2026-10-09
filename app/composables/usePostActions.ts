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
  let likePopTimer: ReturnType<typeof setTimeout> | null = null
  onUnmounted(() => {
    if (likePopTimer) clearTimeout(likePopTimer)
  })

  let resolvedIdCache: string | null = null
  let resolvedClientCache: mastodon.rest.Client | null = null
  /** Why the last resolve failed — drives the toast wording + escape hatch */
  let lastFailure: FederationFailure | null = null
  let inflight: Promise<{ client: mastodon.rest.Client; id: string } | null> | null = null

  const clearActionCache = () => {
    resolvedIdCache = null
    resolvedClientCache = null
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
  /** The server that acts (honours a read-account override, like the client does) */
  const actingUrl = () => {
    try {
      return activeCredentials().url
    } catch {
      return ''
    }
  }

  const getActionContext = async (): Promise<{ client: mastodon.rest.Client; id: string } | null> => {
    if (resolvedClientCache && resolvedIdCache) {
      return { client: resolvedClientCache, id: resolvedIdCache }
    }
    // A prewarm may already be resolving this post — share it
    if (inflight) return inflight
    inflight = resolveContext().finally(() => {
      inflight = null
    })
    return inflight
  }

  const resolveContext = async (): Promise<{ client: mastodon.rest.Client; id: string } | null> => {
    lastFailure = null
    const homeUrl = actingUrl()
    if (!homeUrl) return null

    const status = options.displayStatus.value
    const primaryClient = activeClient()
    const activeHost = hostnameOf(homeUrl)
    const sourceUrl = sourceUrlOf()
    const sourceHost = sourceUrl ? hostnameOf(sourceUrl) : ''
    // ActivityPub URI resolves more reliably than the HTML url across forks.
    const lookupUrl =
      status.uri?.trim() || options.statusUrl.value?.trim() || status.url?.trim() || ''

    // Fetched via the active account — local id is already valid.
    if (sourceHost && sourceHost === activeHost) {
      return remember(primaryClient, status.id)
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
        return remember(clientFor(source.id), status.id)
      }
    }

    // Status HTML/AP URL is on the active host.
    if (lookupUrl && hostnameOf(lookupUrl) === activeHost) {
      return remember(primaryClient, status.id)
    }

    // Import onto your server: ActivityPub id first, then the page URL
    const candidates = resolveCandidates(status.uri, options.statusUrl.value, status.url)
    if (candidates.length) {
      const { id: localId, failure } = await statusStore.resolveStatusDetailed(candidates)
      if (localId) return remember(primaryClient, localId)
      lastFailure = failure
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
      likePop.value = true
      if (likePopTimer) clearTimeout(likePopTimer)
      likePopTimer = setTimeout(() => {
        likePopTimer = null
        likePop.value = false
      }, 320)
    }

    try {
      const ctx = await getActionContext()
      if (!ctx) throw new Error('Not resolvable')

      if (want) {
        await ctx.client.v1.statuses.$select(ctx.id).favourite()
      } else {
        await ctx.client.v1.statuses.$select(ctx.id).unfavourite()
      }
    } catch (e) {
      clearActionCache()
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

    isBoosting.value = true
    s.reblogged = wantBoost
    s.reblogsCount = Math.max(0, (s.reblogsCount || 0) + (wantBoost ? 1 : -1))

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
    handleFavourite,
    toggleBoost,
    handleBookmark,
    getActionContext,
    clearActionCache,
    prewarm,
  }
}
