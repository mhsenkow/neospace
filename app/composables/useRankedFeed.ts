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
import { resolvePublicInstanceUrl } from '~/utils/instances'
import {
  RANKERS,
  emptyRankContext,
  rankFeed,
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

/** Taste context is per account and slow-changing — shared across columns */
const contextCache = new Map<string, { at: number; ctx: RankContext }>()

async function pageAll<T>(fetchPage: (maxId?: string) => Promise<T[]>, getId: (t: T) => string, max: number) {
  const out: T[] = []
  let maxId: string | undefined
  while (out.length < max) {
    const page = await fetchPage(maxId)
    if (!page.length) break
    out.push(...page)
    if (page.length < 40) break
    maxId = getId(page[page.length - 1]!)
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
  let dry = false

  const signedIn = () => !!instances.activeAccount?.accessToken

  const loadContext = async (): Promise<RankContext> => {
    const acct = instances.activeAccount
    const user = instances.currentUser
    const key = acct?.id && user?.id ? `${acct.id}:${user.id}` : 'guest'
    const hit = contextCache.get(key)
    if (hit && Date.now() - hit.at < CONTEXT_TTL_MS) return { ...hit.ctx, now: Date.now() }

    const next = emptyRankContext()
    for (const t of groups.followedTags) {
      const n = (t.name || '').replace(/^#/, '').toLowerCase()
      if (n) next.followedTags.add(n)
    }
    if (!acct?.accessToken || !user?.id) {
      contextCache.set(key, { at: Date.now(), ctx: next })
      return next
    }
    next.selfAcct = (user.acct || user.username || '').toLowerCase()
    const client = activeClient()
    const self = client.v1.accounts.$select(user.id)
    const soft = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn()
      } catch {
        return []
      }
    }
    const [following, followers, favs, marks] = await Promise.all([
      soft(() =>
        pageAll<mastodon.v1.Account>(async (maxId) => await self.following.list({ limit: 80, maxId }), (a) => a.id, FOLLOW_MAX),
      ),
      soft(() =>
        pageAll<mastodon.v1.Account>(async (maxId) => await self.followers.list({ limit: 80, maxId }), (a) => a.id, FOLLOW_MAX),
      ),
      soft(async () => await client.v1.favourites.list({ limit: 40 })),
      soft(async () => await client.v1.bookmarks.list({ limit: 40 })),
    ])
    const followerSet = new Set(followers.map((a) => a.acct.toLowerCase()))
    for (const a of following) {
      const k = a.acct.toLowerCase()
      next.following.add(k)
      if (followerSet.has(k)) next.mutuals.add(k)
    }
    const taste = tasteFrom([...favs, ...marks])
    next.likedAuthors = taste.likedAuthors
    next.likedTags = taste.likedTags
    next.likedWords = taste.likedWords
    contextCache.set(key, { at: Date.now(), ctx: next })
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

  const fetchSource = async (source: CandidateSource): Promise<RankedStatus[]> => {
    const cur = cursors[source]
    if (cur === null) return [] // exhausted
    try {
      if (source === 'home') {
        if (!signedIn()) return []
        const acct = instances.activeAccount!
        const page = await instances.fetchMergedHomeTimeline(
          PAGE,
          typeof cur === 'string' ? { [acct.id]: cur } : undefined,
        )
        cursors.home = page.length ? page[page.length - 1]!.id : null
        return mark(page, 'home')
      }
      if (source === 'local' || source === 'federated') {
        const page = await instances.fetchMergedTimeline(source, PAGE, typeof cur === 'string' ? cur : undefined)
        cursors[source] = page.length ? page[page.length - 1]!.id : null
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
        cursors.trend = page.length ? offset + page.length : null
        return mark(page, 'trend', url, acct?.accessToken ? acct.id : `public:${url}`)
      }
      // tag: one followed tag per fetch, rotating
      const tags = [...ctx.followedTags]
      if (!tags.length || !signedIn()) {
        cursors.tag = null
        return []
      }
      const tag = tags[tagTurn++ % tags.length]!
      const acct = instances.activeAccount!
      const page = await activeClient().v1.timelines.tag.$select(encodeURIComponent(tag)).list({ limit: PAGE })
      if (tagTurn >= tags.length * 3) cursors.tag = null
      return mark(page, 'tag', acct.url, acct.id)
    } catch {
      return []
    }
  }

  /** Pull one round from every source, add unseen posts to the pool, re-rank the rest */
  const refill = async () => {
    if (!ranker) return
    const sources = RANKERS[ranker].sources
    const pages = await Promise.all(sources.map((s) => fetchSource(s)))
    let added = 0
    for (const s of pages.flat()) {
      const key = statusIdentity(s)
      if (!key || pool.has(key)) continue
      pool.set(key, s)
      added++
    }
    if (!added && sources.every((s) => cursors[s] === null || !pages[sources.indexOf(s)]!.length)) dry = true
    const unserved = [...pool.values()].filter((s) => !served.has(statusIdentity(s)!))
    ctx = { ...ctx, now: Date.now() }
    queue = rankFeed(ranker, unserved, ctx).map((r) => ({
      ...r.status,
      _rankWhy: `${RANKERS[ranker!].short} · ${r.why.join(' · ')}`,
    }))
  }

  /** Start fresh for a ranker (column load / refresh) */
  const reset = async (id: RankerId) => {
    ranker = id
    pool = new Map()
    served.clear()
    queue = []
    cursors = {}
    tagTurn = 0
    dry = false
    ctx = await loadContext()
  }

  /**
   * Next page of the ranking. `fresh` restarts the session (first load /
   * pull to refresh); otherwise it continues where the column left off.
   */
  const nextPage = async (
    id: RankerId,
    fresh: boolean,
  ): Promise<{ statuses: RankedStatus[]; exhausted: boolean }> => {
    if (fresh || ranker !== id) await reset(id)
    // Two rounds on a fresh start: a deeper pool ranks better
    if (fresh) await refill()
    if (queue.length < REFILL_BELOW && !dry) await refill()
    const page = queue.splice(0, PAGE)
    for (const s of page) served.add(statusIdentity(s)!)
    return { statuses: page, exhausted: dry && !queue.length }
  }

  return { nextPage }
}
