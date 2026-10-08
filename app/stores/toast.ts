/**
 * Global toast queue — one host renders all toasts.
 */

import { defineStore } from 'pinia'

export type ToastAction = {
  message: string
  actionLabel?: string
  onAction?: () => void
  duration?: number
}

export type ToastItem = ToastAction & {
  id: number
}

let idSeq = 0

/** Toasts with an action stay long enough to reach the button (WCAG 2.2.1) */
const ACTION_MIN_MS = 10000

/** Per-toast timers — paused while hovered / focused, resumed with what was left */
const timers = new Map<number, { handle: number | null; remaining: number; startedAt: number }>()

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: [] as ToastItem[],
  }),

  actions: {
    show(opts: ToastAction) {
      const id = ++idSeq
      let duration = opts.duration ?? (opts.actionLabel ? ACTION_MIN_MS : 4000)
      if (opts.actionLabel && duration > 0) duration = Math.max(duration, ACTION_MIN_MS)
      const item: ToastItem = { id, ...opts, duration }
      this.toasts.push(item)
      if (duration > 0 && typeof window !== 'undefined') {
        timers.set(id, { handle: null, remaining: duration, startedAt: 0 })
        this.resume(id)
      }
      return id
    },

    /** Stop the auto-dismiss clock (hover / focus inside the toast) */
    pause(id: number) {
      const t = timers.get(id)
      if (!t || t.handle === null) return
      window.clearTimeout(t.handle)
      t.handle = null
      t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt))
    },

    /** Restart the clock with the time that was left */
    resume(id: number) {
      const t = timers.get(id)
      if (!t || t.handle !== null) return
      t.startedAt = Date.now()
      // Never vanish the instant the pointer leaves — leave a beat to read
      t.handle = window.setTimeout(() => this.dismiss(id), Math.max(t.remaining, 1500))
    },

    dismiss(id: number) {
      const t = timers.get(id)
      if (t?.handle != null) window.clearTimeout(t.handle)
      timers.delete(id)
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },

    clear() {
      for (const t of timers.values()) {
        if (t.handle != null) window.clearTimeout(t.handle)
      }
      timers.clear()
      this.toasts = []
    },
  },
})
