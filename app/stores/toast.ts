/**
 * Global toast queue — one host renders all toasts.
 */

import { defineStore } from 'pinia'

export type ToastKind = 'info' | 'success' | 'error'

export type ToastAction = {
  message: string
  /** Severity — styles the toast and picks polite vs assertive announcement */
  kind?: ToastKind
  actionLabel?: string
  onAction?: () => void
  duration?: number
}

export type ToastItem = ToastAction & {
  id: number
  kind: ToastKind
}

/** Most toasts on screen at once — the oldest makes room for the newest */
export const MAX_TOASTS = 3

const ERROR_RE = /^(couldn['’]?t|could not|can['’]?t|cannot|unable|failed|failure|error|something went wrong)\b|\bfailed\b/i

/** Callers rarely pass `kind`; failure copy reliably starts "Couldn't …" / "Failed …" */
export function inferToastKind(message: string, kind?: ToastKind): ToastKind {
  if (kind) return kind
  return ERROR_RE.test(message.trim()) ? 'error' : 'info'
}

let idSeq = 0

/** Toasts with an action stay long enough to reach the button (WCAG 2.2.1) */
const ACTION_MIN_MS = 10000

/** Per-toast timers — paused while hovered / focused, resumed with what was left */
const timers = new Map<number, { handle: number | null; remaining: number; startedAt: number }>()

/** Toasts whose clock was stopped by a hidden tab — resumed when it comes back */
const hiddenPaused = new Set<number>()
let visibilityBound = false

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: [] as ToastItem[],
  }),

  actions: {
    show(opts: ToastAction) {
      const kind = inferToastKind(opts.message, opts.kind)
      let duration = opts.duration ?? (opts.actionLabel ? ACTION_MIN_MS : 4000)
      if (opts.actionLabel && duration > 0) duration = Math.max(duration, ACTION_MIN_MS)

      // Merge identical messages (repeated offline / rate-limit failures) instead of stacking
      const same = this.toasts.find(
        (t) => t.message === opts.message && t.kind === kind && t.actionLabel === opts.actionLabel,
      )
      if (same) {
        const t = timers.get(same.id)
        if (t) {
          if (t.handle !== null && typeof window !== 'undefined') window.clearTimeout(t.handle)
          t.handle = null
          t.remaining = duration
          if (typeof window !== 'undefined' && duration > 0) this.resume(same.id)
        }
        same.onAction = opts.onAction
        return same.id
      }

      this.bindVisibility()
      const id = ++idSeq
      const item: ToastItem = { id, ...opts, kind, duration }
      while (this.toasts.length >= MAX_TOASTS) this.dismiss(this.toasts[0]!.id)
      this.toasts.push(item)
      if (duration > 0 && typeof window !== 'undefined') {
        timers.set(id, { handle: null, remaining: duration, startedAt: 0 })
        this.resume(id)
      }
      return id
    },

    /** A 10s "Undo" shouldn't expire unseen while the user is in another tab or app */
    bindVisibility() {
      if (visibilityBound || typeof document === 'undefined') return
      visibilityBound = true
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          for (const [id, t] of timers) {
            if (t.handle === null) continue
            this.pause(id)
            hiddenPaused.add(id)
          }
        } else {
          for (const id of hiddenPaused) this.resume(id)
          hiddenPaused.clear()
        }
      })
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
      hiddenPaused.delete(id)
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },

    clear() {
      for (const t of timers.values()) {
        if (t.handle != null) window.clearTimeout(t.handle)
      }
      timers.clear()
      hiddenPaused.clear()
      this.toasts = []
    },
  },
})
