/**
 * Profile insights — paginate own statuses, aggregate engagement windows,
 * optionally surface Wrapstodon annual reports.
 */

import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { useInstancesStore } from '~/stores/instances'
import {
  buildInsightsReport,
  windowTruncated,
  type InsightsReport,
  type InsightsWindowDays,
} from '~/utils/insights'
import { logError } from '~/utils/log'

const PAGE_LIMIT = 40
const MAX_PAGES = 12 // up to ~480 statuses
const CACHE_TTL_MS = 5 * 60_000

type AnnualLite = {
  year: number
  shareUrl?: string | null
  archetype?: string | null
  topHashtags: { name: string; count: number }[]
  timeSeries: { month: number; statuses: number; followers: number }[]
}

type CacheEntry = {
  statuses: mastodon.v1.Status[]
  truncated: boolean
  fetchedAt: number
  windowDays: InsightsWindowDays
}

interface InsightsState {
  windowDays: InsightsWindowDays
  report: InsightsReport | null
  /** Same window without followers-only posts — the only thing CSV / Loom export may read */
  exportReport: InsightsReport | null
  annual: AnnualLite[]
  isLoading: boolean
  isLoadingAnnual: boolean
  error: string | null
  accountId: string | null
}

/** Module-level race + cache (not in Pinia so AbortController isn't serialized). */
let fetchGen = 0
let annualGen = 0
let fetchController: AbortController | null = null
/**
 * Keyed by signed-in account + account id: Mastodon ids are per-server, so two
 * linked accounts on different instances can share an id.
 */
const statusCache = new Map<string, CacheEntry>()
const cacheKey = (accountId: string) =>
  `${useInstancesStore().activeAccountId || ''}:${accountId}`

/** Wrapstodon share links come from the server — only ever render http(s) */
function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}

// masto doesn't re-export AnnualReport from v1 — derive it from the endpoint
type AnnualReport = Awaited<
  ReturnType<mastodon.rest.Client['v1']['annualReports']['list']>
>['annualReports'][number]

function coerceAnnual(raw: AnnualReport): AnnualLite {
  const data = (raw.data || {}) as unknown as Record<string, unknown>
  const tagsRaw = (data.topHashtags || data.top_hashtags || []) as unknown
  const seriesRaw = (data.timeSeries || data.time_series || []) as unknown
  const topHashtags = Array.isArray(tagsRaw)
    ? tagsRaw
        .map((t) => {
          const o = t as { name?: string; count?: number }
          return { name: String(o?.name || ''), count: Number(o?.count) || 0 }
        })
        .filter((t) => t.name)
    : []
  const timeSeries = Array.isArray(seriesRaw)
    ? seriesRaw.map((t) => {
        const o = t as { month?: number; statuses?: number; followers?: number }
        return {
          month: Number(o?.month) || 0,
          statuses: Number(o?.statuses) || 0,
          followers: Number(o?.followers) || 0,
        }
      })
    : []
  return {
    year: raw.year,
    shareUrl: safeHttpUrl(raw.shareUrl),
    archetype: typeof data.archetype === 'string' ? data.archetype : null,
    topHashtags,
    timeSeries,
  }
}

function oldestMs(statuses: mastodon.v1.Status[]): number | null {
  let oldest: number | null = null
  for (const s of statuses) {
    const t = s.createdAt ? Date.parse(s.createdAt) : NaN
    if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t
  }
  return oldest
}

function statusesCoverWindow(entry: CacheEntry, windowDays: InsightsWindowDays): boolean {
  // Longer window covers shorter ones when cache is fresh
  return entry.windowDays >= windowDays
}

export const useInsightsStore = defineStore('insights', {
  state: (): InsightsState => ({
    windowDays: 30,
    report: null,
    exportReport: null,
    annual: [],
    isLoading: false,
    isLoadingAnnual: false,
    error: null,
    accountId: null,
  }),

  actions: {
    setWindow(days: InsightsWindowDays) {
      this.windowDays = days
    },

    abortInFlight() {
      fetchController?.abort()
      fetchController = null
      fetchGen += 1
      annualGen += 1
      // The dropped request's finally no longer owns the flags
      this.isLoading = false
      this.isLoadingAnnual = false
    },

    async fetchInsights(account: mastodon.v1.Account, windowDays?: InsightsWindowDays) {
      if (windowDays) this.windowDays = windowDays
      const days = this.windowDays
      this.isLoading = true
      this.error = null
      this.accountId = account.id

      const gen = ++fetchGen
      fetchController?.abort()
      fetchController = new AbortController()
      const { signal } = fetchController

      /** On-screen report counts followers-only posts; the export copy never does */
      const render = (statuses: mastodon.v1.Status[], truncated: boolean) => {
        const input = statuses.filter((s) => s.visibility !== 'direct')
        const oldest = oldestMs(statuses)
        const capped = windowTruncated(truncated, oldest, days)
        this.report = markRaw(
          buildInsightsReport({
            account,
            statuses: input,
            windowDays: days,
            truncated: capped,
            includePrivate: true,
          }),
        )
        this.exportReport = markRaw(
          buildInsightsReport({
            account,
            statuses: input,
            windowDays: days,
            truncated: capped,
            includePrivate: false,
          }),
        )
      }

      try {
        const key = cacheKey(account.id)
        const cached = statusCache.get(key)
        const fresh =
          cached &&
          Date.now() - cached.fetchedAt < CACHE_TTL_MS &&
          statusesCoverWindow(cached, days)

        if (fresh && cached) {
          render(cached.statuses, cached.truncated)
          return
        }

        const client = activeClient()
        const collected: mastodon.v1.Status[] = []
        let truncated = false
        let maxId: string | undefined
        // The requested window decides when the first paint happens; the rest of the 90 days
        // (so shorter windows reuse the cache) is fetched after, in the background.
        const fullDays = Math.max(days, 90) as InsightsWindowDays
        const requestCutoff = Date.now() - days * 86_400_000
        const fullCutoff = Date.now() - fullDays * 86_400_000
        let rendered = false

        for (let page = 0; page < MAX_PAGES; page++) {
          if (signal.aborted || gen !== fetchGen) return
          const batch = await client.v1.accounts.$select(account.id).statuses.list(
            {
              limit: PAGE_LIMIT,
              maxId,
              excludeReplies: false,
              excludeReblogs: false,
            },
            { requestInit: { signal } },
          )
          if (signal.aborted || gen !== fetchGen) return

          if (batch.length) collected.push(...batch)

          const oldest = batch[batch.length - 1]
          maxId = oldest?.id
          const oldestTs = oldest?.createdAt ? Date.parse(oldest.createdAt) : NaN
          const lastPage = page === MAX_PAGES - 1
          const exhausted = !batch.length || batch.length < PAGE_LIMIT
          const pastFull = Number.isFinite(oldestTs) && oldestTs < fullCutoff
          if (lastPage && !exhausted && !pastFull) truncated = true

          const coversRequest =
            exhausted || lastPage || (Number.isFinite(oldestTs) && oldestTs < requestCutoff)
          if (!rendered && coversRequest) {
            rendered = true
            render(collected, truncated)
            // First paint done — what follows only warms the cache
            this.isLoading = false
            statusCache.set(key, {
              statuses: collected,
              truncated,
              fetchedAt: Date.now(),
              windowDays: days,
            })
          }

          if (exhausted || pastFull) break
        }

        if (gen !== fetchGen) return
        if (!rendered) render(collected, truncated)
        statusCache.set(key, {
          statuses: collected,
          truncated,
          fetchedAt: Date.now(),
          windowDays: fullDays,
        })
      } catch (e: any) {
        if (e?.name === 'AbortError' || gen !== fetchGen) return
        logError('Insights fetch failed:', e)
        // A failed backfill after a good first paint keeps what's on screen
        if (!this.report) {
          this.error = e?.message || 'Could not load insights'
          this.report = null
          this.exportReport = null
        }
      } finally {
        if (gen === fetchGen) {
          this.isLoading = false
          fetchController = null
        }
      }
    },

    async fetchAnnualReports() {
      const gen = ++annualGen
      this.isLoadingAnnual = true
      try {
        const client = activeClient()
        const wrapped = await client.v1.annualReports.list()
        if (gen !== annualGen) return
        this.annual = (wrapped.annualReports || []).map(coerceAnnual)
      } catch {
        if (gen !== annualGen) return
        // Optional — many instances / forks omit Wrapstodon
        this.annual = []
      } finally {
        if (gen === annualGen) this.isLoadingAnnual = false
      }
    },

    clear() {
      this.abortInFlight()
      this.report = null
      this.exportReport = null
      this.annual = []
      this.error = null
      this.accountId = null
    },
  },
})
