/**
 * Federated firehose for Edward Mode — multi-server seed + fast sinceId poll.
 * Hits every connected instance's public federated (+ local) timelines when possible.
 */

import { useEdwardStore, EDWARD_MAX_BALLS, newestIdPerInstance } from '~/stores/edward'
import { useInstancesStore, type ExtendedStatus } from '~/stores/instances'
import { useGroupsStore } from '~/stores/groups'
import { statusIdentity, dedupeStatusesByIdentity } from '~/utils/statusIdentity'
import { hostnameOf, isAuthGatedPublicHost, resolvePublicInstanceUrl } from '~/utils/instances'
import { publicClient } from '~/composables/useMasto'
import {
  emptyAffinityContext,
  type EdwardAffinityContext,
} from '~/utils/edwardAffinity'
import { httpStatusFrom } from '~/utils/friendlyError'
import type { EdwardSource } from '~/utils/edwardSemantics'
import { speedMeta } from '~/utils/edwardPace'

/**
 * Mastodon allows ~300 requests / 5 min per account (and per IP for guests) —
 * shared with every other open column. Each poll costs 1–2 requests per server,
 * so poll at a calm pace, fetch `local` only every few polls, and back off hard
 * on 429 / errors instead of hammering through them.
 */
const POLL_MS = 12_000
const POLL_MAX_MS = 120_000
/** Federated every poll; local every Nth (it overlaps heavily anyway) */
const LOCAL_EVERY = 3
const SEED_LIMIT = 40
const POLL_LIMIT = 25
const FOLLOWING_PAGE = 80
const FOLLOWING_MAX = 300
const HOME_SAMPLE = 40
/** Who-you-follow barely changes between sessions — don't refetch it each time */
const AFFINITY_TTL_MS = 15 * 60_000
/** Your feeds, prepped alongside the firehose */
const HOME_LIMIT = 30
const TAG_LIMIT = 20
const TREND_LIMIT = 20
/** Home every Nth poll, one followed tag per poll, trends rarely (they change slowly) */
const HOME_EVERY = 2
const TREND_EVERY = 12
/** Backpack: what's fetched waits here and drips onto the stage */
const BACKPACK_MAX = 360
/** Plenty in the backpack → skip the firehose fetch this poll (rate limits) */
const BACKPACK_FULL = 90
/** Seed: how many go straight onto the stage; the rest wait */
const SEED_STAGE = 90
/** Release mix — your feeds come up more often than the firehose */
const SOURCE_WEIGHT: Record<EdwardSource, number> = { home: 3, tag: 2, trend: 1, firehose: 3 }
let affinityCache: { userKey: string; at: number; ctx: EdwardAffinityContext } | null = null

export function useEdwardStream() {
  const edward = useEdwardStore()
  const instances = useInstancesStore()
  const groups = useGroupsStore()

  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pollCount = 0
  let failStreak = 0
  /** Set by fetchFromTargets when any server answered 429 */
  let rateLimited = false
  /** Newest status id per instance for sinceId polls */
  let sinceCursors: Record<string, string> = {}
  let affinityLoaded = false

  // ── Backpack (prepped posts waiting to drip in) ──
  const backpack: Record<EdwardSource, ExtendedStatus[]> = { home: [], tag: [], trend: [], firehose: [] }
  const backpackKeys = new Set<string>()
  let dripTimer: ReturnType<typeof setTimeout> | null = null
  let dripTurn = 0
  let homeSince: string | null = null
  const tagSince: Record<string, string> = {}
  let tagCursor = 0

  const backpackSize = () =>
    backpack.home.length + backpack.tag.length + backpack.trend.length + backpack.firehose.length

  const syncBackpackCount = () => edward.setBackpack(backpackSize(), {
    home: backpack.home.length,
    tag: backpack.tag.length,
    trend: backpack.trend.length,
    firehose: backpack.firehose.length,
  })

  /** Stash fetched posts, skipping anything on stage or already packed */
  const pack = (list: ExtendedStatus[]) => {
    const onStage = new Set(edward.statuses.map((s) => statusIdentity(s)))
    for (const s of list) {
      const key = statusIdentity(s)
      if (!key || onStage.has(key) || backpackKeys.has(key)) continue
      const src = ((s as { _edSource?: EdwardSource })._edSource || 'firehose') as EdwardSource
      backpackKeys.add(key)
      backpack[src].push(s)
    }
    // Over the cap: shed the oldest firehose first, then the rest
    for (const src of ['firehose', 'trend', 'tag', 'home'] as EdwardSource[]) {
      while (backpackSize() > BACKPACK_MAX && backpack[src].length) {
        const gone = backpack[src].pop()!
        backpackKeys.delete(statusIdentity(gone))
      }
    }
    syncBackpackCount()
  }

  /** Weighted round-robin across sources so the field stays varied */
  const takeNext = (): ExtendedStatus | null => {
    const order: EdwardSource[] = []
    for (const src of ['home', 'firehose', 'tag', 'trend'] as EdwardSource[]) {
      for (let i = 0; i < SOURCE_WEIGHT[src]; i++) order.push(src)
    }
    for (let i = 0; i < order.length; i++) {
      const src = order[(dripTurn + i) % order.length]!
      const next = backpack[src].shift()
      if (next) {
        dripTurn = (dripTurn + i + 1) % order.length
        backpackKeys.delete(statusIdentity(next))
        return next
      }
    }
    return null
  }

  /** Release pace follows the stream speed; still holds everything back */
  const dripDelay = () => {
    const mul = speedMeta(edward.speed).mul
    if (!mul) return 2500
    return Math.round(2600 / mul)
  }

  const drip = () => {
    dripTimer = null
    if (!running) return
    if (speedMeta(edward.speed).mul > 0 && edward.active) {
      const next = takeNext()
      if (next) {
        edward.mergeNewer([next])
        syncBackpackCount()
      }
    }
    dripTimer = setTimeout(drip, dripDelay())
  }

  const tag = (list: ExtendedStatus[], source: EdwardSource, tagName?: string) =>
    list.map((s) => ({ ...s, _edSource: source, ...(tagName ? { _edTag: tagName } : {}) }) as ExtendedStatus)

  /** Account whose home / tags / trends we read: active if signed in, else primary */
  const feedAccount = () => {
    const active = instances.activeAccount
    if (active?.accessToken) return active
    const primary = instances.primaryInstance
    return primary?.accessToken ? primary : null
  }

  const followedTagNames = () => {
    const names = new Set<string>()
    for (const t of groups.followedTags) {
      const n = (t.name || '').replace(/^#/, '').toLowerCase()
      if (n) names.add(n)
    }
    for (const g of groups.joinedGroups) {
      const n = (g.tag || '').replace(/^#/, '').toLowerCase()
      if (n) names.add(n)
    }
    return [...names]
  }

  const fetchHome = async (): Promise<ExtendedStatus[]> => {
    const acct = feedAccount()
    if (!acct) return []
    try {
      const client = instances.getClient(acct.id)
      const list = await client.v1.timelines.home.list({
        limit: HOME_LIMIT,
        ...(homeSince ? { sinceId: homeSince } : {}),
      })
      if (list[0]?.id) homeSince = list[0].id
      return tag(
        list.map((s) => ({ ...s, _instanceId: acct.id, _instanceUrl: acct.url }) as ExtendedStatus),
        'home',
      )
    } catch (e) {
      if (httpStatusFrom(e) === 429) rateLimited = true
      return []
    }
  }

  /** One (or a few, when seeding) followed tags per call — they take turns */
  const fetchTags = async (count: number): Promise<ExtendedStatus[]> => {
    const acct = feedAccount()
    const names = followedTagNames()
    if (!acct || !names.length) return []
    const client = instances.getClient(acct.id)
    const picks: string[] = []
    for (let i = 0; i < Math.min(count, names.length); i++) {
      picks.push(names[(tagCursor + i) % names.length]!)
    }
    tagCursor = (tagCursor + picks.length) % Math.max(1, names.length)
    const pages = await Promise.all(
      picks.map(async (name) => {
        try {
          const list = await client.v1.timelines.tag.$select(encodeURIComponent(name)).list({
            limit: TAG_LIMIT,
            ...(tagSince[name] ? { sinceId: tagSince[name] } : {}),
          })
          if (list[0]?.id) tagSince[name] = list[0].id
          return tag(
            list.map((s) => ({ ...s, _instanceId: acct.id, _instanceUrl: acct.url }) as ExtendedStatus),
            'tag',
            name,
          )
        } catch (e) {
          if (httpStatusFrom(e) === 429) rateLimited = true
          return [] as ExtendedStatus[]
        }
      }),
    )
    return pages.flat()
  }

  /** Trending posts on your server — or the public host for guests */
  const fetchTrends = async (): Promise<ExtendedStatus[]> => {
    const acct = feedAccount()
    try {
      if (acct) {
        const list = await instances.getClient(acct.id).v1.trends.statuses.list({ limit: TREND_LIMIT })
        return tag(
          list.map((s) => ({ ...s, _instanceId: acct.id, _instanceUrl: acct.url }) as ExtendedStatus),
          'trend',
        )
      }
      const url = resolvePublicInstanceUrl(instances.activeAccount?.url || instances.instances[0]?.url)
      const list = await publicClient(url).v1.trends.statuses.list({ limit: TREND_LIMIT })
      const host = hostnameOf(url) || 'public'
      return tag(
        list.map((s) => ({ ...s, _instanceId: `public:${host}`, _instanceUrl: url }) as ExtendedStatus),
        'trend',
      )
    } catch {
      return []
    }
  }

  const firehoseTargets = () => {
    // Watch every connected server — denser than active-only publicTimelineTargets
    if (instances.instances.length) return instances.instances
    return instances.publicTimelineTargets()
  }

  /**
   * Bumped by stop(): a seed / poll still in flight from a previous session
   * (or before an account switch) must not write into the next one.
   */
  let generation = 0

  const refreshSinceCursors = () => {
    sinceCursors = newestIdPerInstance(edward.statuses)
  }

  const fetchFromTargets = async (
    limit: number,
    cursors?: Record<string, string>,
    opts?: { since?: boolean },
  ): Promise<ExtendedStatus[]> => {
    const targets = firehoseTargets()
    if (!targets.length) {
      return instances.fetchMergedTimeline('federated', limit, undefined, opts)
    }

    const errors: string[] = []
    let succeeded = 0
    // Seed always pulls local for density; polls only every few rounds
    const withLocal = !opts?.since || pollCount % LOCAL_EVERY === 0
    const pages = await Promise.all(
      targets.map(async (instance) => {
        try {
          if (!instance.accessToken && isAuthGatedPublicHost(instance.url)) {
            errors.push(`${instance.name} requires login`)
            return [] as ExtendedStatus[]
          }
          const client = instances.getClient(instance.id)
          const cursor = cursors?.[instance.id]
          // Federated + local in parallel for denser stream
          const [fed, local] = await Promise.all([
            client.v1.timelines.public.list({
              local: false,
              limit,
              ...(cursor ? (opts?.since ? { sinceId: cursor } : { maxId: cursor }) : {}),
            }),
            withLocal
              ? client.v1.timelines.public.list({
                  local: true,
                  limit: Math.ceil(limit / 2),
                  ...(cursor ? (opts?.since ? { sinceId: cursor } : {}) : {}),
                })
              : Promise.resolve([] as Awaited<ReturnType<typeof client.v1.timelines.public.list>>),
          ])
          succeeded += 1
          const map = (s: (typeof fed)[number]): ExtendedStatus => ({
            ...s,
            _instanceId: instance.id,
            _instanceUrl: instance.url,
          })
          return [...fed.map(map), ...local.map(map)]
        } catch (e: unknown) {
          if (httpStatusFrom(e) === 429) rateLimited = true
          const message = e instanceof Error ? e.message : 'Failed'
          errors.push(`${instance.name}: ${message}`)
          return []
        }
      }),
    )

    let all = pages.flat()
    // Guest fallback only when no server could answer — an empty *poll*
    // (nothing new since the cursor) must not pull a stranger's firehose in.
    if (!all.length && !succeeded && !rateLimited) {
      // Guest / gated fallback — tag the real host so likes can resolve later
      try {
        const fallbackUrl = resolvePublicInstanceUrl(
          instances.activeAccount?.url || instances.instances[0]?.url,
        )
        const client = publicClient(fallbackUrl)
        const statuses = await client.v1.timelines.public.list({ local: false, limit })
        const host = hostnameOf(fallbackUrl) || 'fallback'
        all = statuses.map((s) => ({
          ...s,
          _instanceId: `public:${host}`,
          _instanceUrl: fallbackUrl,
        }))
      } catch {
        if (errors[0]) throw new Error(errors[0])
      }
    }

    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    return dedupeStatusesByIdentity(all).slice(0, Math.max(limit, EDWARD_MAX_BALLS))
  }

  const loadAffinity = async () => {
    if (affinityLoaded) return
    affinityLoaded = true
    const gen = generation
    const ctx: EdwardAffinityContext = emptyAffinityContext()
    const user = instances.currentUser
    if (!user) {
      edward.setAffinity(ctx)
      return
    }
    const userKey = `${instances.primaryInstance?.id || ''}:${user.id}`
    if (affinityCache && affinityCache.userKey === userKey && Date.now() - affinityCache.at < AFFINITY_TTL_MS) {
      edward.setAffinity(affinityCache.ctx)
      return
    }

    ctx.selfAcct = (user.acct || '').replace(/^@/, '').toLowerCase() || null
    ctx.selfUsername = (user.username || '').toLowerCase() || null

    try {
      if (!groups.followedTags.length) {
        await groups.fetchFollowedTags().catch(() => {})
      }
      for (const t of groups.followedTags) {
        const name = (t.name || '').replace(/^#/, '').toLowerCase()
        if (name) ctx.tags.add(name)
      }
    } catch {
      /* soft */
    }

    try {
      const primary = instances.primaryInstance
      if (primary?.accessToken) {
        const client = instances.getClient(primary.id)
        const userId = user.id
        const collected: string[] = []
        let maxId: string | undefined
        while (collected.length < FOLLOWING_MAX) {
          const batch = await client.v1.accounts.$select(userId).following.list({
            limit: FOLLOWING_PAGE,
            maxId,
          })
          const list = Array.isArray(batch) ? batch : []
          if (!list.length) break
          for (const a of list) {
            const acct = (a.acct || '').replace(/^@/, '').toLowerCase()
            if (acct) {
              ctx.following.add(acct)
              collected.push(acct)
            }
          }
          if (list.length < FOLLOWING_PAGE) break
          maxId = list[list.length - 1]?.id
          if (!maxId) break
        }

        try {
          const home = await client.v1.timelines.home.list({ limit: HOME_SAMPLE })
          for (const s of home) {
            const body = s.reblog || s
            const acct = (body.account?.acct || '').replace(/^@/, '').toLowerCase()
            if (acct) ctx.homeAuthors.add(acct)
          }
        } catch {
          /* soft */
        }
      }
    } catch {
      /* guest / soft-fail */
    }

    affinityCache = { userKey, at: Date.now(), ctx }
    if (!running || gen !== generation) return
    edward.setAffinity(ctx)
  }

  const seed = async () => {
    const gen = generation
    edward.setLoading(true)
    edward.setError(null)
    rateLimited = false
    try {
      void loadAffinity()
      // Followed tags / groups feed the tag source — fetch them alongside
      if (!groups.followedTags.length) await groups.fetchFollowedTags().catch(() => {})
      const [page, home, tags, trends] = await Promise.all([
        fetchFromTargets(SEED_LIMIT),
        fetchHome(),
        fetchTags(3),
        fetchTrends(),
      ])
      if (gen !== generation) return
      // Everything goes in the backpack; a varied first handful takes the stage
      pack([...home, ...tags, ...trends, ...page])
      const stage: ExtendedStatus[] = []
      while (stage.length < SEED_STAGE) {
        const next = takeNext()
        if (!next) break
        stage.push(next)
      }
      syncBackpackCount()
      edward.replaceStatuses(stage)
      sinceCursors = newestIdPerInstance(page)
      edward.setSourceCount(firehoseTargets().length || 1)
      if (!stage.length && rateLimited) {
        failStreak += 1
        edward.setError('Your server is rate-limiting us — the stream will fill in shortly.')
      }
    } catch (e: unknown) {
      if (gen !== generation) return
      const msg = e instanceof Error ? e.message : 'Failed to load thought stream'
      edward.setError(msg)
      edward.replaceStatuses([])
    } finally {
      if (gen === generation) edward.setLoading(false)
    }
  }

  let inFlight = false
  let lastPollAt = 0

  const poll = async () => {
    if (!edward.active || !running || inFlight) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    inFlight = true
    lastPollAt = Date.now()
    rateLimited = false
    pollCount += 1
    const gen = generation
    let failed = false
    // Re-seeding manages its own backoff bookkeeping
    const reseeding = !edward.statuses.length
    try {
      if (reseeding) {
        await seed()
        return
      }
      if (!Object.keys(sinceCursors).length) refreshSinceCursors()
      // Backpack already full: skip the firehose this round — easy on rate limits
      const wantFirehose = backpackSize() < BACKPACK_FULL
      const [newer, home, tags, trends] = await Promise.all([
        wantFirehose
          ? fetchFromTargets(POLL_LIMIT, { ...sinceCursors }, { since: true })
          : Promise.resolve([] as ExtendedStatus[]),
        pollCount % HOME_EVERY === 0 ? fetchHome() : Promise.resolve([] as ExtendedStatus[]),
        fetchTags(1),
        pollCount % TREND_EVERY === 0 ? fetchTrends() : Promise.resolve([] as ExtendedStatus[]),
      ])
      if (!edward.active || gen !== generation) return

      if (newer.length) {
        const merged = { ...sinceCursors, ...newestIdPerInstance(newer) }
        sinceCursors = merged
      }
      pack([...home, ...tags, ...trends, ...newer])
    } catch {
      // Every server (and the guest fallback) failed — offline, DNS, 5xx.
      // Back off like a 429 instead of retrying at full pace.
      failed = true
    } finally {
      // A stale poll must not clear the next run's in-flight flag / backoff
      if (gen === generation) {
        inFlight = false
        if (!reseeding) failStreak = rateLimited || failed ? failStreak + 1 : 0
      }
    }
  }

  /** Next poll delay: calm by default, doubling per consecutive rate-limit */
  const nextDelay = () =>
    failStreak ? Math.min(POLL_MAX_MS, POLL_MS * 2 ** failStreak) : POLL_MS

  const schedule = () => {
    if (!running) return
    const gen = generation
    timer = setTimeout(async () => {
      timer = null
      await poll()
      // stop() (+ start()) while this poll was in flight: the new run has its own loop
      if (gen === generation) schedule()
    }, nextDelay())
  }

  const onVisibility = () => {
    if (typeof document === 'undefined') return
    if (document.visibilityState !== 'visible' || !edward.active || !running) return
    // Coming back to the tab: catch up once, unless we polled moments ago
    // or the server asked us to back off.
    if (failStreak || Date.now() - lastPollAt < POLL_MS / 2) return
    void poll()
  }

  const start = async () => {
    if (running) return
    running = true
    affinityLoaded = false
    pollCount = 0
    failStreak = 0
    edward.clearStatuses()
    edward.setAffinity(emptyAffinityContext())
    const gen = generation
    await seed()
    if (!running || gen !== generation) return
    lastPollAt = Date.now()
    schedule()
    if (dripTimer) clearTimeout(dripTimer)
    dripTimer = setTimeout(drip, dripDelay())
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility)
    }
  }

  const stop = () => {
    running = false
    generation += 1
    inFlight = false
    affinityLoaded = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    sinceCursors = {}
    if (dripTimer) {
      clearTimeout(dripTimer)
      dripTimer = null
    }
    for (const src of Object.keys(backpack) as EdwardSource[]) backpack[src] = []
    backpackKeys.clear()
    homeSince = null
    for (const k of Object.keys(tagSince)) delete tagSince[k]
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  return {
    start,
    stop,
    poll,
    seed,
    maxBalls: EDWARD_MAX_BALLS,
  }
}
