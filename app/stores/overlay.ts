/**
 * Global lightbox + confirm dialog state.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { mapErrorToMessage } from '~/utils/friendlyError'

/** Optional attachment metadata for the lightbox loupe / analytical HUD */
export type LightboxMediaMeta = {
  width?: number | null
  height?: number | null
  aspect?: number | null
  focus?: { x: number; y: number } | null
  blurhash?: string | null
  mediaId?: string
}

export type LightboxItem = {
  src: string
  /** Accessible name — may be a fallback like "Image 1 of 2" */
  alt: string
  /** The author's own description, shown as a visible caption when present */
  caption?: string
  /** Small cached preview shown while the full-size `src` loads */
  preview?: string
  /** Dimensions, focal point, blurhash — power-user loupe HUD */
  meta?: LightboxMediaMeta
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
  /** Optional third choice between Cancel and the confirm button (e.g. "Save draft") */
  secondaryLabel: string
}

export type ConfirmChoice = 'confirm' | 'secondary' | 'cancel'

export type ReportCategory = 'spam' | 'legal' | 'violation' | 'other'

/** A recent post by the reported account that can be attached to the report */
export type ReportPost = { id: string; text: string; createdAt: string }

export type ReportState = {
  open: boolean
  accountAcct: string
  category: ReportCategory
  comment: string
  forward: boolean
  /** Server supports the `legal` category (Mastodon 4.2+) */
  allowLegal: boolean
  /** The opener supplied a post loader — show the "Add more posts" step */
  canAddPosts: boolean
  /** Recent posts to offer ("Add more posts"); null until loaded */
  posts: ReportPost[] | null
  postsLoading: boolean
  postsError: string | null
  /** Ids of the extra posts the reporter ticked */
  extraStatusIds: string[]
  submitting: boolean
  submitError: string | null
}

export type ReportPayload = {
  category: ReportCategory
  comment: string
  forward: boolean
  /** Additional post ids (besides the one being reported) */
  extraStatusIds: string[]
}

type ConfirmResolver = (choice: ConfirmChoice) => void
type ReportResolver = (payload: ReportPayload | null) => void
type ReportPerform = (payload: ReportPayload) => Promise<void>

let confirmResolve: ConfirmResolver | null = null
let reportResolve: ReportResolver | null = null
let reportLoadPosts: (() => Promise<ReportPost[]>) | null = null
let reportPerform: ReportPerform | null = null

export type AccountSwitcherState = {
  open: boolean
}

/** Mobile hammock-mode thread peek + quick reply drawer */
export type ThreadPeekState = {
  open: boolean
  status: mastodon.v1.Status | null
  focusInput: boolean
}

type ThreadPeekReplied = (created: mastodon.v1.Status) => void
let threadPeekOnReplied: ThreadPeekReplied | null = null

export const useOverlayStore = defineStore('overlay', {
  state: () => ({
    accountSwitcher: {
      open: false,
    } as AccountSwitcherState,
    /** Accounts & servers manager — stacks with confirm/lightbox like the switcher */
    accountsManager: {
      open: false,
    } as AccountSwitcherState,
    threadPeek: {
      open: false,
      status: null,
      focusInput: false,
    } as ThreadPeekState,
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
      secondaryLabel: '',
    } as ConfirmState,
    report: {
      open: false,
      accountAcct: '',
      category: 'other',
      comment: '',
      forward: true,
      allowLegal: false,
      canAddPosts: false,
      posts: null,
      postsLoading: false,
      postsError: null,
      extraStatusIds: [],
      submitting: false,
      submitError: null,
    } as ReportState,
  }),

  actions: {
    openAccountsManager() {
      this.accountsManager.open = true
    },

    closeAccountsManager() {
      this.accountsManager.open = false
    },

    openAccountSwitcher() {
      this.accountSwitcher.open = true
    },

    closeAccountSwitcher() {
      this.accountSwitcher.open = false
    },

    toggleAccountSwitcher() {
      this.accountSwitcher.open = !this.accountSwitcher.open
    },

    openThreadPeek(opts: {
      status: mastodon.v1.Status
      focusInput?: boolean
      onReplied?: ThreadPeekReplied
    }) {
      threadPeekOnReplied = opts.onReplied ?? null
      this.threadPeek = {
        open: true,
        status: opts.status,
        focusInput: !!opts.focusInput,
      }
    },

    notifyThreadPeekReplied(created: mastodon.v1.Status) {
      threadPeekOnReplied?.(created)
    },

    closeThreadPeek() {
      this.threadPeek = { open: false, status: null, focusInput: false }
      threadPeekOnReplied = null
    },

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
      return this.openChoice(opts).then((c) => c === 'confirm')
    },

    /** Like openConfirm, plus an optional secondary action (Cancel stays the safe default) */
    openChoice(opts: {
      title: string
      body: string
      confirmLabel?: string
      danger?: boolean
      secondaryLabel?: string
    }): Promise<ConfirmChoice> {
      if (confirmResolve) {
        confirmResolve('cancel')
        confirmResolve = null
      }
      this.confirm = {
        open: true,
        title: opts.title,
        body: opts.body,
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        danger: !!opts.danger,
        secondaryLabel: opts.secondaryLabel ?? '',
      }
      return new Promise<ConfirmChoice>((resolve) => {
        confirmResolve = resolve
      })
    },

    resolveConfirm(ok: boolean | ConfirmChoice) {
      this.confirm.open = false
      const resolve = confirmResolve
      confirmResolve = null
      resolve?.(typeof ok === 'string' ? ok : ok ? 'confirm' : 'cancel')
    },

    openReport(opts: {
      accountAcct: string
      allowLegal?: boolean
      /** Loads the account's recent posts (local ids) for the optional "Add more posts" step */
      loadPosts?: () => Promise<ReportPost[]>
      /** Runs while the dialog stays open; failures stay inline instead of toasting after close */
      perform?: ReportPerform
    }): Promise<ReportPayload | null> {
      if (reportResolve) {
        reportResolve(null)
        reportResolve = null
      }
      reportLoadPosts = opts.loadPosts ?? null
      reportPerform = opts.perform ?? null
      this.report = {
        open: true,
        accountAcct: opts.accountAcct,
        category: 'other',
        comment: '',
        forward: true,
        allowLegal: !!opts.allowLegal,
        canAddPosts: !!opts.loadPosts,
        posts: null,
        postsLoading: false,
        postsError: null,
        extraStatusIds: [],
        submitting: false,
        submitError: null,
      }
      return new Promise<ReportPayload | null>((resolve) => {
        reportResolve = resolve
      })
    },

    /** Fetch the offer list once, when the reporter opens "Add more posts" */
    async loadReportPosts() {
      if (!reportLoadPosts || this.report.posts || this.report.postsLoading) return
      const loader = reportLoadPosts
      this.report.postsLoading = true
      this.report.postsError = null
      try {
        const posts = await loader()
        if (loader === reportLoadPosts) this.report.posts = posts
      } catch {
        if (loader === reportLoadPosts) this.report.postsError = 'Couldn’t load posts.'
      } finally {
        if (loader === reportLoadPosts) this.report.postsLoading = false
      }
    },

    cancelReport() {
      if (this.report.submitting) return
      this.report.open = false
      const resolve = reportResolve
      reportResolve = null
      reportPerform = null
      reportLoadPosts = null
      resolve?.(null)
    },

    async submitReport() {
      if (this.report.submitting) return
      const payload: ReportPayload = {
        category: this.report.category,
        comment: this.report.comment.trim(),
        forward: this.report.forward,
        extraStatusIds: [...this.report.extraStatusIds],
      }
      this.report.submitting = true
      this.report.submitError = null
      try {
        if (reportPerform) await reportPerform(payload)
        this.report.open = false
        const resolve = reportResolve
        reportResolve = null
        reportPerform = null
        reportLoadPosts = null
        resolve?.(payload)
      } catch (e: unknown) {
        this.report.submitError =
          mapErrorToMessage(e).detail || 'Failed to submit report. Please try again.'
      } finally {
        this.report.submitting = false
      }
    },

    resolveReport(payload: ReportPayload | null) {
      if (payload) {
        void this.submitReport()
        return
      }
      this.cancelReport()
    },
  },
})
