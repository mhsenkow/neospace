/**
 * Compose sheet — new post, reply, quote, and DM pick (Threads-style).
 * Desktop still has an inline first-column composer for new posts.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'

export type ComposeVisibility = 'public' | 'unlisted' | 'private' | 'direct'

export interface ComposeContextPost {
  id: string
  name: string
  handle: string
  avatar?: string | null
  text: string
  url?: string | null
}

interface ComposeSheetState {
  open: boolean
  /** Bump to remount RealComposeBox cleanly */
  instanceKey: number
  initialText: string
  initialVisibility: ComposeVisibility | null
  placeholder: string | null
  title: string | null
  pickRecipient: boolean
  inReplyToId: string | null
  quoteUrl: string | null
  contextPost: ComposeContextPost | null
  /** Threads-style group / hashtag tag for the post */
  groupTag: string | null
  onPosted: ((status: mastodon.v1.Status) => void) | null
}

export const useComposeSheetStore = defineStore('composeSheet', {
  state: (): ComposeSheetState => ({
    open: false,
    instanceKey: 0,
    initialText: '',
    initialVisibility: null,
    placeholder: null,
    title: null,
    pickRecipient: false,
    inReplyToId: null,
    quoteUrl: null,
    contextPost: null,
    groupTag: null,
    onPosted: null,
  }),

  getters: {
    isReply: (state) => !!state.inReplyToId,
    isQuote: (state) => !!state.quoteUrl && !state.inReplyToId,
  },

  actions: {
    show(opts?: {
      initialText?: string
      visibility?: ComposeVisibility
      placeholder?: string
      title?: string
      pickRecipient?: boolean
      inReplyToId?: string | null
      quoteUrl?: string | null
      contextPost?: ComposeContextPost | null
      groupTag?: string | null
      onPosted?: (status: mastodon.v1.Status) => void
    }) {
      const nextReply = opts?.inReplyToId ?? null
      const nextQuote = opts?.quoteUrl ?? null
      const contextChanged =
        this.inReplyToId !== nextReply ||
        this.quoteUrl !== nextQuote ||
        !!opts?.pickRecipient !== this.pickRecipient

      this.initialText = opts?.initialText ?? ''
      this.initialVisibility = opts?.visibility ?? null
      this.placeholder = opts?.placeholder ?? null
      this.title = opts?.title ?? null
      this.pickRecipient = !!opts?.pickRecipient
      this.inReplyToId = nextReply
      this.quoteUrl = nextQuote
      this.contextPost = opts?.contextPost ?? null
      this.groupTag = opts?.groupTag ? opts.groupTag.replace(/^#/, '') : null
      this.onPosted = opts?.onPosted ?? null

      // Remounting while already open wipes an in-progress Loom draft —
      // only bump when opening fresh or switching reply/quote context
      if (!this.open || contextChanged) {
        this.instanceKey += 1
      }
      this.open = true
    },

    /** After picking someone — drop into a direct compose with @handle ready */
    continueWithRecipient(handle: string) {
      this.pickRecipient = false
      this.initialText = `${handle} `
      this.initialVisibility = 'direct'
      this.placeholder = 'Write a private message…'
      this.title = 'New message'
      this.inReplyToId = null
      this.quoteUrl = null
      this.contextPost = null
      // keep onPosted (e.g. navigate into the new conversation)
      this.instanceKey += 1
    },

    posted(status: mastodon.v1.Status) {
      this.onPosted?.(status)
      this.hide()
    },

    hide() {
      this.open = false
      this.initialText = ''
      this.initialVisibility = null
      this.placeholder = null
      this.title = null
      this.pickRecipient = false
      this.inReplyToId = null
      this.quoteUrl = null
      this.contextPost = null
      this.groupTag = null
      this.onPosted = null
    },
  },
})
