/**
 * Global lightbox + confirm dialog state.
 */

import { defineStore } from 'pinia'

export type LightboxItem = {
  src: string
  alt: string
}

export type LightboxState = {
  open: boolean
  src: string
  alt: string
  items: LightboxItem[]
  index: number
}

export type ConfirmState = {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger: boolean
}

export type ReportCategory = 'spam' | 'violation' | 'other'

export type ReportState = {
  open: boolean
  accountAcct: string
  category: ReportCategory
  comment: string
  forward: boolean
}

export type ReportPayload = {
  category: ReportCategory
  comment: string
  forward: boolean
}

type ConfirmResolver = (ok: boolean) => void
type ReportResolver = (payload: ReportPayload | null) => void

let confirmResolve: ConfirmResolver | null = null
let reportResolve: ReportResolver | null = null

export const useOverlayStore = defineStore('overlay', {
  state: () => ({
    lightbox: {
      open: false,
      src: '',
      alt: '',
      items: [],
      index: 0,
    } as LightboxState,
    confirm: {
      open: false,
      title: '',
      body: '',
      confirmLabel: 'Confirm',
      danger: false,
    } as ConfirmState,
    report: {
      open: false,
      accountAcct: '',
      category: 'other',
      comment: '',
      forward: true,
    } as ReportState,
  }),

  actions: {
    openLightbox(opts: { src: string; alt?: string; items?: LightboxItem[]; index?: number }) {
      const items =
        opts.items?.length
          ? opts.items
          : [{ src: opts.src, alt: opts.alt ?? '' }]
      const index = Math.min(Math.max(opts.index ?? 0, 0), items.length - 1)
      const current = items[index]!
      this.lightbox = {
        open: true,
        src: current.src,
        alt: current.alt,
        items,
        index,
      }
    },

    lightboxStep(delta: number) {
      const { items, index } = this.lightbox
      if (items.length <= 1) return
      const next = (index + delta + items.length) % items.length
      const item = items[next]!
      this.lightbox.index = next
      this.lightbox.src = item.src
      this.lightbox.alt = item.alt
    },

    closeLightbox() {
      this.lightbox = { open: false, src: '', alt: '', items: [], index: 0 }
    },

    openConfirm(opts: {
      title: string
      body: string
      confirmLabel?: string
      danger?: boolean
    }): Promise<boolean> {
      if (confirmResolve) {
        confirmResolve(false)
        confirmResolve = null
      }
      this.confirm = {
        open: true,
        title: opts.title,
        body: opts.body,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        danger: !!opts.danger,
      }
      return new Promise<boolean>((resolve) => {
        confirmResolve = resolve
      })
    },

    resolveConfirm(ok: boolean) {
      this.confirm.open = false
      const resolve = confirmResolve
      confirmResolve = null
      resolve?.(ok)
    },

    openReport(opts: { accountAcct: string }): Promise<ReportPayload | null> {
      if (reportResolve) {
        reportResolve(null)
        reportResolve = null
      }
      this.report = {
        open: true,
        accountAcct: opts.accountAcct,
        category: 'other',
        comment: '',
        forward: true,
      }
      return new Promise<ReportPayload | null>((resolve) => {
        reportResolve = resolve
      })
    },

    resolveReport(payload: ReportPayload | null) {
      this.report.open = false
      const resolve = reportResolve
      reportResolve = null
      resolve?.(payload)
    },
  },
})
