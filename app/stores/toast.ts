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

export const useToastStore = defineStore('toast', {
  state: () => ({
    toasts: [] as ToastItem[],
  }),

  actions: {
    show(opts: ToastAction) {
      const id = ++idSeq
      const duration = opts.duration ?? 4000
      const item: ToastItem = { id, ...opts, duration }
      this.toasts.push(item)
      if (duration > 0 && typeof window !== 'undefined') {
        window.setTimeout(() => this.dismiss(id), duration)
      }
      return id
    },

    dismiss(id: number) {
      this.toasts = this.toasts.filter((t) => t.id !== id)
    },

    clear() {
      this.toasts = []
    },
  },
})
