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

export const EDWARD_MAX_BALLS = 280

export type EdwardFocusMode = 'off' | 'square' | 'bar'

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

    ballCount(state): number {
      return state.statuses.length
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
      this.focusedIdentity = id
    },

    cycleFocusMode() {
      const order: EdwardFocusMode[] = ['bar', 'square', 'off']
      const i = order.indexOf(this.focusMode)
      this.focusMode = order[(i + 1) % order.length]!
      if (this.focusMode === 'off') this.focusedIdentity = null
    },

    setFocusMode(mode: EdwardFocusMode) {
      this.focusMode = mode
      if (mode === 'off') this.focusedIdentity = null
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
