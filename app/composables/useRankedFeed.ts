/**
 * Ranked algorithm feeds (X / Facebook / TikTok style) for a timeline column.
 *
 * Gathers a candidate pool from the ranker's sources (home, trending,
 * followed tags, local, federated), learns your taste from what you've liked
 * and bookmarked plus who you follow / who follows back, ranks with
 * utils/rankers, and serves the ranking a page at a time. When the unserved
 * remainder runs low it fetches the next page of every source and re-ranks
 * what's left — already-served posts never move.
 */

import type { mastodon } from 'masto'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { activeClient, publicClient } from '~/composables/useMasto'
import { statusIdentity } from '~/utils/statusIdentity'
import { httpStatusFrom } from '~/utils/friendlyError'
import { isPermanentSourceFailure, rankWhyLabel, sourceBackoffMs } from '~/utils/rankedSources'
import { cursorPage, type CursorPage } from '~/utils/linkHeader'
import { resolvePublicInstanceUrl } from '~/utils/instances'
import {
  RANKERS,
  emptyRankContext,
  rankFeed,
  qualifyAcct,
  tasteFrom,
  type CandidateSource,
  type RankContext,
  type RankerId,
} from '~/utils/rankers'

export type RankedStatus = ExtendedStatus & { _rankWhy?: string; _rankSource?: CandidateSource }

const PAGE = 20
/** Fetch more candidates when fewer than this many ranked posts are left */
const REFILL_BELOW = 30
const CONTEXT_TTL_MS = 15 * 60_000
const FOLLOW_MAX = 400
/** A context built from a failed fetch is retried soon instead of living the full TTL */
const PARTIAL_CONTEXT_TTL_MS = 20_000

/** Taste context is per account and slow-changing — shared across columns */
const contextCache = new Map<string, { at: number; ttl: number; ctx: RankContext }>()

/**
 * Follow lists paginate by follow-row id from the Link header — an account id
 * is not a valid `max_id`, so page 2+ skipped, repeated or ended early.
 */
async function pageAll<T>(fetchPage: (maxId?: string) => Promise<CursorPage<T>>, max: number) {
  const out: T[] = []
  let maxId: string | undefined
  while (out.length < max) {
    const page = await fetchPage(maxId)
    if (!page.items.length) break
    out.push(...page.items)
    if (!page.nextMaxId || page.nextMaxId === maxId) break
    maxId = page.nextMaxId
  }
  return out
}

export function useRankedFeed() {
  const instances = useInstancesStore()
  const groups = useGroupsStore()

  let ranker: RankerId | null = null
  let ctx: RankContext = emptyRankContext()
  /** Every candidate seen this session, by identity */
  let pool = new Map<string, RankedStatus>()
  const served = new Set<string>()
  let queue: RankedStatus[] = []
  let cursors: Partial<Record<CandidateSource, string | number | null>> = {}
  /** Followed tags take turns as the "tag" source */
  let tagTurn = 0
  /** Per followed tag: where its next page starts (null = exhausted) */
  let tagCursors = new Map<string, string | null>()
  let dry = false
  /** Bumped on every reset — in-flight fetches from an older session drop their results */
  let session = 0
  /** Consecutive failures and next-allowed attempt per source (backoff) */
  let failures: Partial<Record<CandidateSource, { n: number; retryAt: number }>> = {}

  const signedIn = () => !!instances.activeAccount?.accessToken

  /** Followed tags are read live — joining a group applies on the next refill, not after the context TTL */
  const liveFollowedTags = () => {
    const out = new Set<string>()
    for (const t of groups.followedTags) {
      const n = (t.name || '').replace(/^#/, '').toLowerCase()
      if (n) out.add(n)
    }
    return out
  }

  const hostOf = (url?: string | null) => {
    try {
      return url ? new URL(url).host.toLowerCase() : null
    } catch {
      return null
    }
  }

  const loadContext = async (): Promise<RankContext> => {
    const acct = instances.activeAccount
    const user = instances.currentUser
    const key = acct?.id && user?.id ? `${acct.id}:${user.id}` : 'guest'
    const hit = contextCache.get(key)
    if (hit && Date.now() - hit.at < hit.ttl) return { ...hit.ctx, now: Date.now() }

    // At app start the groups init is still in flight; reading before it lands pins an empty tag set
    try {
      await groups.initializeGroups()
    } catch {
      /* groups are an optional signal */
    }
    const next = emptyRankContext()
    next.followedTags = liveFollowedTags()
    next.host = hostOf(acct?.url)
    if (!acct?.accessToken || !user?.id) {
      // Signed in but the user isn't loaded yet: don't pin a guest-shaped context
      if (!acct?.accessToken) contextCache.set(key, { at: Date.now(), ttl: CONTEXT_TTL_MS, ctx: next })
      return next
    }
    next.selfAcct = qualifyAcct(user.acct || user.username || '', next.host)
    const client = activeClient()
    const self = client.v1.accounts.$select(user.id)
    // A failed fetch leaves the context partial (follows missing) — retry soon
    let partial = false
    const soft = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn()
      } catch {
        partial = true
        return []
      }
    }
    const [following, followers, favs, marks] = await Promise.all([
      soft(() =>
        pageAll<mastodon.v1.Account>(
          (maxId) => cursorPage(self.following.list.$raw({ limit: 80, ...(maxId ? { maxId } : {}) })),
          FOLLOW_MAX,
        ),
      ),
      soft(() =>
        pageAll<mastodon.v1.Account>(
          (maxId) => cursorPage(self.followers.list.$raw({ limit: 80, ...(maxId ? { maxId } : {}) })),
          FOLLOW_MAX,
        ),
      ),
      soft(async () => await client.v1.favourites.list({ limit: 40 })),
      soft(async () => await client.v1.bookmarks.list({ limit: 40 })),
    ])
    // Same-server accts come back without a host; qualify them so `bob` never matches `bob@elsewhere`
    const followerSet = new Set(followers.map((a) => qualifyAcct(a.acct, next.host)))
    for (const a of following) {
      const k = qualifyAcct(a.acct, next.host)
      next.following.add(k)
      if (followerSet.has(k)) next.mutuals.add(k)
    }
    const taste = tasteFrom([...favs, ...marks], next.host)
    next.likedAuthors = taste.likedAuthors
    next.likedTags = taste.likedTags
    next.likedWords = taste.likedWords
    contextCache.set(key, { at: Date.now(), ttl: partial ? PARTIAL_CONTEXT_TTL_MS : CONTEXT_TTL_MS, ctx: next })
    return next
  }

  const mark = (list: (mastodon.v1.Status | ExtendedStatus)[], source: CandidateSource, url?: string, id?: string) =>
    list.map(
      (s) =>
        ({
          ...s,
          ...(url && id && !(s as ExtendedStatus)._instanceUrl ? { _instanceUrl: url, _instanceId: id } : {}),
          _rankSource: source,
        }) as RankedStatus,
    )

  const fetchSource = async (source: CandidateSource, token: number): Promise<RankedStatus[]> => {
    const cur = cursors[source]
    if (cur === null) return [] // exhausted
    const fail = failures[source]
    if (fail && Date.now() < fail.retryAt) return [] // backing off
    /** A newer session started while awaiting — drop this result instead of polluting it */
    const stale = () => token !== session
    try {
      if (source === 'home') {
        if (!signedIn()) return []
        const acct = instances.activeAccount!
        const page = await instances.fetchMergedHomeTimeline(
          PAGE,
          typeof cur === 'string' ? { [acct.id]: cur } : undefined,
        )
        if (stale()) return []
        cursors.home = page.length ? page[page.length - 1]!.id : null
        delete failures.home
        return mark(page, 'home')
      }
      if (source === 'local' || source === 'federated') {
        const page = await instances.fetchMergedTimeline(source, PAGE, typeof cur === 'string' ? cur : undefined)
        if (stale()) return []
        cursors[source] = page.length ? page[page.length - 1]!.id : null
        delete failures[source]
        return mark(page, source)
      }
      if (source === 'trend') {
        const offset = typeof cur === 'number' ? cur : 0
        if (offset >= 80) {
          cursors.trend = null
          return []
        }
        const acct = instances.activeAccount
        const url = acct?.accessToken ? acct.url : resolvePublicInstanceUrl(acct?.url || instances.instances[0]?.url)
        const client = acct?.accessToken ? activeClient() : publicClient(url)
        // Mastodon pages trends by offset (masto's params type omits it)
        const page = await client.v1.trends.statuses.list({ limit: PAGE, ...({ offset } as object) })
        if (stale()) return []
        cursors.trend = page.length ? offset + page.length : null
        delete failures.trend
        return mark(page, 'trend', url, acct?.accessToken ? acct.id : `public:${url}`)
      }
      // tag: one followed tag per fetch, rotating; each tag keeps its own cursor
      const tags = [...liveFollowedTags()]
      if (!tags.length || !signedIn()) {
        cursors.tag = null
        return []
      }
      const open = tags.filter((t) => tagCursors.get(t) !== null)
      if (!open.length) {
        cursors.tag = null
        return []
      }
      const tag = open[tagTurn++ % open.length]!
      const maxId = tagCursors.get(tag)
      const acct = instances.activeAccount!
      const page = await activeClient()
        .v1.timelines.tag.$select(encodeURIComponent(tag))
        .list({ limit: PAGE, ...(maxId ? { maxId } : {}) })
      if (stale()) return []
      const fresh = page.filter((st) => {
        const k = statusIdentity(st as ExtendedStatus)
        return !k || !pool.has(k)
      })
      // A tag that returns nothing new is exhausted — don't spend more requests on it
      tagCursors.set(tag, fresh.length && page.length ? page[page.length - 1]!.id : null)
      if (open.every((t) => tagCursors.get(t) === null) || tagTurn >= tags.length * 3) cursors.tag = null
      delete failures.tag
      return mark(page, 'tag', acct.url, acct.id)
    } catch (e) {
      if (stale()) return []
      if (isPermanentSourceFailure(httpStatusFrom(e))) cursors[source] = null // endpoint will never work here
      else {
        const n = (failures[source]?.n || 0) + 1
        failures[source] = { n, retryAt: Date.now() + sourceBackoffMs(n) }
      }
      return []
    }
  }

  /** Pull one round from every source, add unseen posts to the pool, re-rank the rest */
  const refill = async (token: number) => {
    if (!ranker) return
    const sources = RANKERS[ranker].sources
    const pages = await Promise.all(sources.map((s) => fetchSource(s, token)))
    if (token !== session) return
    let added = 0
    for (const s of pages.flat()) {
      const key = statusIdentity(s)
      if (!key || pool.has(key)) continue
      pool.set(key, s)
      added++
    }
    if (!added && sources.every((s) => cursors[s] === null || !pages[sources.indexOf(s)]!.length)) dry = true
    const unserved = [...pool.values()].filter((s) => !served.has(statusIdentity(s)!))
    ctx = { ...ctx, now: Date.now(), followedTags: liveFollowedTags() }
    queue = rankFeed(ranker, unserved, ctx).map((r) => ({
      ...r.status,
      _rankWhy: rankWhyLabel(RANKERS[ranker!].short, r.why),
    }))
  }

  /** Start fresh for a ranker (column load / refresh); returns the new session token */
  const reset = async (id: RankerId): Promise<number> => {
    const token = ++session
    ranker = id
    pool = new Map()
    served.clear()
    queue = []
    cursors = {}
    tagCursors = new Map()
    failures = {}
    tagTurn = 0
    dry = false
    const next = await loadContext()
    if (token === session) ctx = next
    return token
  }

  /**
   * Next page of the ranking. `fresh` restarts the session (first load /
   * pull to refresh); otherwise it continues where the column left off.
   * A call overtaken by a newer session returns an empty, non-final page.
   */
  const nextPage = async (
    id: RankerId,
    fresh: boolean,
  ): Promise<{ statuses: RankedStatus[]; exhausted: boolean }> => {
    const token = fresh || ranker !== id ? await reset(id) : session
    const superseded = { statuses: [] as RankedStatus[], exhausted: false }
    if (token !== session) return superseded
    // Two rounds on a fresh start: a deeper pool ranks better
    if (fresh) await refill(token)
    if (token !== session) return superseded
    if (queue.length < REFILL_BELOW && !dry) await refill(token)
    if (token !== session) return superseded
    const page = queue.splice(0, PAGE)
    for (const s of page) served.add(statusIdentity(s)!)
    return { statuses: page, exhausted: dry && !queue.length }
  }

  return { nextPage }
}
