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

export const EDWARD_MAX_BALLS = 200

interface EdwardState {
  active: boolean
  statuses: ExtendedStatus[]
  selectedIdentity: string | null
  loading: boolean
  error: string | null
  streamStartedAt: number | null
}

export const useEdwardStore = defineStore('edward', {
  state: (): EdwardState => ({
    active: false,
    statuses: [],
    selectedIdentity: null,
    loading: false,
    error: null,
    streamStartedAt: null,
  }),

  getters: {
    balls(state): EdwardBallDescriptor[] {
      return state.statuses.map(statusToEdwardBall)
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
      this.streamStartedAt = Date.now()
      this.error = null
      if (typeof document !== 'undefined') {
        document.body.classList.add('edward-active')
      }
    },

    exit() {
      this.active = false
      this.selectedIdentity = null
      this.loading = false
      this.error = null
      this.streamStartedAt = null
      // Keep statuses briefly so remount can feel continuous if re-entered quickly —
      // cleared on next enter seed via replaceStatuses.
      if (typeof document !== 'undefined') {
        document.body.classList.remove('edward-active')
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
