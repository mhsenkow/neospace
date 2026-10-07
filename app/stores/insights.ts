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

type AnnualLite = {
  year: number
  shareUrl?: string | null
  archetype?: string | null
  topHashtags: { name: string; count: number }[]
  timeSeries: { month: number; statuses: number; followers: number }[]
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

    async fetchInsights(account: mastodon.v1.Account, windowDays?: InsightsWindowDays) {
      if (windowDays) this.windowDays = windowDays
      this.isLoading = true
      this.error = null
      this.accountId = account.id

      try {
        const client = activeClient()
        const collected: mastodon.v1.Status[] = []
        let maxId: string | undefined
        let truncated = false
        const cutoff = Date.now() - this.windowDays * 86_400_000

        for (let page = 0; page < MAX_PAGES; page++) {
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

        this.report = buildInsightsReport({
          account,
          statuses: collected,
          windowDays: this.windowDays,
          truncated,
        })
      } catch (e: any) {
        console.error('Insights fetch failed:', e)
        this.error = e?.message || 'Could not load insights'
        this.report = null
      } finally {
        this.isLoading = false
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
      this.report = null
      this.annual = []
      this.error = null
      this.accountId = null
    },
  },
})
