/**
 * Profile insights — paginate own statuses, aggregate engagement windows,
 * optionally surface Wrapstodon annual reports.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import {
  buildInsightsReport,
  type InsightsReport,
  type InsightsWindowDays,
} from '~/utils/insights'

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
  annual: AnnualLite[]
  isLoading: boolean
  isLoadingAnnual: boolean
  error: string | null
  accountId: string | null
}

/** Module-level race + cache (not in Pinia so AbortController isn't serialized). */
let fetchGen = 0
let fetchController: AbortController | null = null
const statusCache = new Map<string, CacheEntry>()

function coerceAnnual(raw: mastodon.v1.AnnualReport): AnnualLite {
  const data = (raw.data || {}) as Record<string, unknown>
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
    shareUrl: raw.shareUrl,
    archetype: typeof data.archetype === 'string' ? data.archetype : null,
    topHashtags,
    timeSeries,
  }
}

function statusesCoverWindow(entry: CacheEntry, windowDays: InsightsWindowDays): boolean {
  // Longer window covers shorter ones when cache is fresh
  return entry.windowDays >= windowDays
}

export const useInsightsStore = defineStore('insights', {
  state: (): InsightsState => ({
    windowDays: 30,
    report: null,
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

      try {
        const cached = statusCache.get(account.id)
        const fresh =
          cached &&
          Date.now() - cached.fetchedAt < CACHE_TTL_MS &&
          statusesCoverWindow(cached, days)

        let collected: mastodon.v1.Status[]
        let truncated: boolean

        if (fresh && cached) {
          collected = cached.statuses
          truncated = cached.truncated
        } else {
          const client = activeClient()
          collected = []
          truncated = false
          let maxId: string | undefined
          // Always fetch up to 90d so shorter windows reuse the cache
          const fetchDays = Math.max(days, 90) as InsightsWindowDays
          const cutoff = Date.now() - fetchDays * 86_400_000

          for (let page = 0; page < MAX_PAGES; page++) {
            if (signal.aborted || gen !== fetchGen) return
            const batch = await client.v1.accounts.$select(account.id).statuses.list({
              limit: PAGE_LIMIT,
              maxId,
              excludeReplies: false,
              excludeReblogs: false,
            } as any)

            if (!batch.length) break
            collected.push(...batch)

            const oldest = batch[batch.length - 1]
            maxId = oldest?.id
            const oldestTs = oldest?.createdAt ? Date.parse(oldest.createdAt) : NaN
            if (Number.isFinite(oldestTs) && oldestTs < cutoff) break
            if (batch.length < PAGE_LIMIT) break
            if (page === MAX_PAGES - 1) truncated = true
          }

          if (gen !== fetchGen) return
          statusCache.set(account.id, {
            statuses: collected,
            truncated,
            fetchedAt: Date.now(),
            windowDays: Math.max(days, 90) as InsightsWindowDays,
          })
        }

        if (gen !== fetchGen) return
        this.report = buildInsightsReport({
          account,
          statuses: collected,
          windowDays: days,
          truncated,
        })
      } catch (e: any) {
        if (e?.name === 'AbortError' || gen !== fetchGen) return
        console.error('Insights fetch failed:', e)
        this.error = e?.message || 'Could not load insights'
        this.report = null
      } finally {
        if (gen === fetchGen) {
          this.isLoading = false
          fetchController = null
        }
      }
    },

    async fetchAnnualReports() {
      this.isLoadingAnnual = true
      try {
        const client = activeClient()
        const wrapped = await client.v1.annualReports.list()
        this.annual = (wrapped.annualReports || []).map(coerceAnnual)
      } catch {
        // Optional — many instances / forks omit Wrapstodon
        this.annual = []
      } finally {
        this.isLoadingAnnual = false
      }
    },

    clear() {
      this.abortInFlight()
      this.report = null
      this.annual = []
      this.error = null
      this.accountId = null
    },
  },
})
