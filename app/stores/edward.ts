/**
 * Edward Mode — fullscreen fediverse thought-stream overlay.
 */

import { defineStore } from 'pinia'
import type { ExtendedStatus } from '~/stores/instances'
import {
  statusToEdwardBall,
  type EdwardBallDescriptor,
} from '~/utils/edwardSemantics'
import { statusIdentity } from '~/utils/statusIdentity'
import {
  emptyAffinityContext,
  type EdwardAffinityContext,
} from '~/utils/edwardAffinity'
import {
  filterAndSortBalls,
  cycleEdwardSort,
  type EdwardSortMode,
} from '~/utils/edwardExplore'
import { dialectForHost, type EdwardServerDialect } from '~/utils/edwardServers'

export const EDWARD_MAX_BALLS = 280

export type EdwardFocusMode = 'off' | 'square' | 'bar' | 'circle'

interface EdwardState {
  active: boolean
  /** Dim / lower z so compose sheet can sit on top for quick reply */
  recessed: boolean
  statuses: ExtendedStatus[]
  selectedIdentity: string | null
  /** Identity currently inside the watch focus zone */
  focusedIdentity: string | null
  focusMode: EdwardFocusMode
  /** Explore console query — search / filter grammar */
  exploreQuery: string
  exploreSort: EdwardSortMode
  /**
   * Recently focused identities (oldest → newest).
   * Lets you scrub back when something cool just flew past.
   */
  watchHistory: string[]
  /** When true, live focus updates pause — you're scrubbing history */
  watchScrubbing: boolean
  /** Index into watchHistory while scrubbing; -1 when live */
  watchCursor: number
  loading: boolean
  error: string | null
  streamStartedAt: number | null
  /** How many servers the firehose is watching */
  sourceCount: number
  affinity: EdwardAffinityContext
}

export const useEdwardStore = defineStore('edward', {
  state: (): EdwardState => ({
    active: false,
    recessed: false,
    statuses: [],
    selectedIdentity: null,
    focusedIdentity: null,
    focusMode: 'bar',
    exploreQuery: '',
    exploreSort: 'stream',
    watchHistory: [],
    watchScrubbing: false,
    watchCursor: -1,
    loading: false,
    error: null,
    streamStartedAt: null,
    sourceCount: 0,
    affinity: emptyAffinityContext(),
  }),

  getters: {
    balls(state): EdwardBallDescriptor[] {
      return state.statuses.map((s) => statusToEdwardBall(s, state.affinity))
    },

    /** Filtered + sorted view the canvas actually renders */
    visibleBalls(state): EdwardBallDescriptor[] {
      const all = state.statuses.map((s) => statusToEdwardBall(s, state.affinity))
      return filterAndSortBalls(all, state.exploreQuery, state.exploreSort).balls
    },

    exploreSummary(state): {
      matched: number
      total: number
      sort: EdwardSortMode
      active: boolean
    } {
      const all = state.statuses.map((s) => statusToEdwardBall(s, state.affinity))
      const { balls, sort } = filterAndSortBalls(all, state.exploreQuery, state.exploreSort)
      return {
        matched: balls.length,
        total: all.length,
        sort,
        active: !!state.exploreQuery.trim() || state.exploreSort !== 'stream',
      }
    },

    selectedStatus(state): ExtendedStatus | null {
      if (!state.selectedIdentity) return null
      return (
        state.statuses.find((s) => statusIdentity(s) === state.selectedIdentity) || null
      )
    },

    /** Post currently in the watch deck (live focus or scrubbed) */
    watchedStatus(state): ExtendedStatus | null {
      if (!state.focusedIdentity) return null
      return (
        state.statuses.find((s) => statusIdentity(s) === state.focusedIdentity) || null
      )
    },

    watchCanPrev(state): boolean {
      if (!state.watchHistory.length) return false
      if (!state.watchScrubbing) return state.watchHistory.length >= 1
      return state.watchCursor > 0
    },

    watchCanNext(state): boolean {
      return state.watchScrubbing
    },

    ballCount(state): number {
      return state.statuses.length
    },

    /** Live server mix — for explore chips + HUD legend */
    serverDialects(state): (EdwardServerDialect & { count: number })[] {
      const counts = new Map<string, number>()
      for (const s of state.statuses) {
        const body = s.reblog || s
        let host = ''
        try {
          host = s._instanceUrl ? new URL(s._instanceUrl).host : ''
        } catch {
          host = ''
        }
        if (!host) {
          try {
            host = body.url || body.uri ? new URL(body.url || body.uri || '').host : ''
          } catch {
            host = ''
          }
        }
        const key = (host || 'unknown').toLowerCase().replace(/^www\./, '')
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      return [...counts.entries()]
        .map(([host, count]) => ({ ...dialectForHost(host), count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8)
    },
  },

  actions: {
    toggle() {
      if (this.active) this.exit()
      else this.enter()
    },

    enter() {
      this.active = true
      this.recessed = false
      this.streamStartedAt = Date.now()
      this.error = null
      if (typeof document !== 'undefined') {
        document.body.classList.add('edward-active')
      }
    },

    exit() {
      this.active = false
      this.recessed = false
      this.selectedIdentity = null
      this.focusedIdentity = null
      this.exploreQuery = ''
      this.exploreSort = 'stream'
      this.watchHistory = []
      this.watchScrubbing = false
      this.watchCursor = -1
      this.loading = false
      this.error = null
      this.streamStartedAt = null
      this.sourceCount = 0
      this.affinity = emptyAffinityContext()
      if (typeof document !== 'undefined') {
        document.body.classList.remove('edward-active')
      }
    },

    setExploreQuery(q: string) {
      this.exploreQuery = q
    },

    clearExplore() {
      this.exploreQuery = ''
      this.exploreSort = 'stream'
    },

    setExploreSort(mode: EdwardSortMode) {
      this.exploreSort = mode
    },

    cycleExploreSort() {
      this.exploreSort = cycleEdwardSort(this.exploreSort)
    },

    /** Toggle a chip query token into / out of the explore bar */
    toggleExploreChip(token: string) {
      const q = this.exploreQuery.trim()
      if (!q) {
        this.exploreQuery = token
        return
      }
      const parts = q.split(/\s+/).filter(Boolean)
      const key = token.toLowerCase()
      const idx = parts.findIndex((p) => p.toLowerCase() === key)
      if (idx >= 0) parts.splice(idx, 1)
      else parts.push(token)
      this.exploreQuery = parts.join(' ')
    },

    setRecessed(v: boolean) {
      this.recessed = v
    },

    setSourceCount(n: number) {
      this.sourceCount = Math.max(0, n)
    },

    setAffinity(ctx: EdwardAffinityContext) {
      this.affinity = ctx
    },

    setFocusedIdentity(id: string | null) {
      // Live autofocus must not clobber a scrub session
      if (this.watchScrubbing) return
      if (id && id !== this.focusedIdentity) this.pushWatchHistory(id)
      this.focusedIdentity = id
    },

    pushWatchHistory(id: string) {
      if (!id) return
      const last = this.watchHistory[this.watchHistory.length - 1]
      if (last === id) return
      this.watchHistory = [...this.watchHistory, id].slice(-48)
    },

    /** Step back — "oh wait that was cool" */
    watchPrev() {
      if (!this.watchHistory.length) return
      if (!this.watchScrubbing) {
        this.watchScrubbing = true
        this.watchCursor = this.watchHistory.length - 1
        // If live focus is already the latest, step back one more
        if (
          this.focusedIdentity === this.watchHistory[this.watchCursor] &&
          this.watchCursor > 0
        ) {
          this.watchCursor -= 1
        }
      } else if (this.watchCursor > 0) {
        this.watchCursor -= 1
      }
      this.focusedIdentity = this.watchHistory[this.watchCursor] || null
    },

    /** Step forward toward live; at end, resume autofocus */
    watchNext() {
      if (!this.watchScrubbing) return
      if (this.watchCursor < this.watchHistory.length - 1) {
        this.watchCursor += 1
        this.focusedIdentity = this.watchHistory[this.watchCursor] || null
        return
      }
      this.resumeWatchLive()
    },

    resumeWatchLive() {
      this.watchScrubbing = false
      this.watchCursor = -1
    },

    cycleFocusMode() {
      const order: EdwardFocusMode[] = ['bar', 'square', 'circle', 'off']
      const i = order.indexOf(this.focusMode)
      this.focusMode = order[(i + 1) % order.length]!
      if (this.focusMode === 'off') {
        this.focusedIdentity = null
        this.resumeWatchLive()
      }
    },

    setFocusMode(mode: EdwardFocusMode) {
      this.focusMode = mode
      if (mode === 'off') {
        this.focusedIdentity = null
        this.resumeWatchLive()
      }
    },

    selectByIdentity(identity: string | null) {
      this.selectedIdentity = identity
    },

    clearSelection() {
      this.selectedIdentity = null
    },

    setLoading(v: boolean) {
      this.loading = v
    },

    setError(msg: string | null) {
      this.error = msg
    },

    replaceStatuses(list: ExtendedStatus[]) {
      this.statuses = list.slice(0, EDWARD_MAX_BALLS)
    },

    /** Prepend newer posts; drop oldest beyond cap. Returns newly added identities. */
    mergeNewer(incoming: ExtendedStatus[]): string[] {
      if (!incoming.length) return []
      const seen = new Set(this.statuses.map((s) => statusIdentity(s)))
      const added: ExtendedStatus[] = []
      const addedIds: string[] = []
      for (const s of incoming) {
        const key = statusIdentity(s)
        if (!key || seen.has(key)) continue
        seen.add(key)
        added.push(s)
        addedIds.push(key)
      }
      if (!added.length) return []
      this.statuses = [...added, ...this.statuses].slice(0, EDWARD_MAX_BALLS)
      return addedIds
    },

    clearStatuses() {
      this.statuses = []
      this.selectedIdentity = null
    },
  },
})
