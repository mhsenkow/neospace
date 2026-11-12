/**
 * Compose sheet — new post, reply, quote, and DM pick (Threads-style New thread modal).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { logError } from '~/utils/log'
import type { ComposeModality } from '~/composables/useComposeModality'

export type ComposeVisibility = 'public' | 'unlisted' | 'private' | 'direct'

export interface ComposeEditAttachment {
  id: string
  previewUrl: string | null
  description: string
}

export interface ComposeContextPost {
  /** Local id on the posting account — omit when unresolved (URL-only quote) */
  id?: string
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
  /** Prefilled content warning (delete & redraft) */
  initialSpoiler: string
  /** Own draft slot (`redraft:<id>`, or a saved draft's key) so a "new post" draft can't overwrite the prefill */
  draftSlot: string | null
  /** When set, Post updates this status in place instead of creating a new one */
  editStatusId: string | null
  /** Existing attachments while editing — alt text is saved with the post */
  editAttachments: ComposeEditAttachment[]
  /** Sensitive flag of the post being edited */
  editSensitive: boolean
  initialVisibility: ComposeVisibility | null
  placeholder: string | null
  title: string | null
  pickRecipient: boolean
  inReplyToId: string | null
  quoteUrl: string | null
  contextPost: ComposeContextPost | null
  /** Threads-style group / hashtag tag for the post */
  groupTag: string | null
  /** Mentions added on send (not shown in the field) — reply sheet */
  mentionAccts: string[] | null
  /**
   * Entry modality for the peek FAB / optimized compose.
   * `null` = neutral (tab-bar New thread). Applied on mount only.
   */
  initialModality: ComposeModality | null
  onPosted: ((status: mastodon.v1.Status) => void) | null
}

export const useComposeSheetStore = defineStore('composeSheet', {
  state: (): ComposeSheetState => ({
    open: false,
    instanceKey: 0,
    initialText: '',
    initialSpoiler: '',
    draftSlot: null,
    editStatusId: null,
    editAttachments: [],
    editSensitive: false,
    initialVisibility: null,
    placeholder: null,
    title: null,
    pickRecipient: false,
    inReplyToId: null,
    quoteUrl: null,
    contextPost: null,
    groupTag: null,
    mentionAccts: null,
    initialModality: null,
    onPosted: null,
  }),

  actions: {
    show(opts?: {
      initialText?: string
      spoilerText?: string
      draftSlot?: string | null
      editStatusId?: string | null
      editAttachments?: ComposeEditAttachment[]
      editSensitive?: boolean
      visibility?: ComposeVisibility
      placeholder?: string
      title?: string
      pickRecipient?: boolean
      inReplyToId?: string | null
      quoteUrl?: string | null
      contextPost?: ComposeContextPost | null
      groupTag?: string | null
      mentionAccts?: string[] | null
      modality?: ComposeModality | null
      onPosted?: (status: mastodon.v1.Status) => void
    }) {
      const nextReply = opts?.inReplyToId ?? null
      const nextQuote = opts?.quoteUrl ?? null
      const nextSlot = opts?.draftSlot ?? null
      const nextEdit = opts?.editStatusId ?? null
      const contextChanged =
        this.draftSlot !== nextSlot ||
        this.editStatusId !== nextEdit ||
        this.inReplyToId !== nextReply ||
        this.quoteUrl !== nextQuote ||
        !!opts?.pickRecipient !== this.pickRecipient

      this.initialText = opts?.initialText ?? ''
      this.initialSpoiler = opts?.spoilerText ?? ''
      this.draftSlot = nextSlot
      this.editStatusId = nextEdit
      this.editAttachments = opts?.editAttachments?.map((a) => ({ ...a })) ?? []
      this.editSensitive = !!opts?.editSensitive
      this.initialVisibility = opts?.visibility ?? null
      this.placeholder = opts?.placeholder ?? null
      this.pickRecipient = !!opts?.pickRecipient
      this.inReplyToId = nextReply
      this.quoteUrl = nextQuote
      this.contextPost = opts?.contextPost ?? null
      this.groupTag = opts?.groupTag ? opts.groupTag.replace(/^#/, '') : null
      this.mentionAccts = opts?.mentionAccts?.length ? [...opts.mentionAccts] : null
      this.initialModality = opts?.modality ?? null
      this.onPosted = opts?.onPosted ?? null
      // Default chrome title — DMs keep an explicit title from the caller
      this.title =
        opts?.title ??
        (nextEdit
          ? 'Edit post'
          : opts?.pickRecipient
            ? 'New message'
            : nextReply
              ? 'New thread'
              : nextQuote
                ? 'Quote'
                : this.initialModality === 'media'
                  ? 'New photo'
                  : this.initialModality === 'voice'
                    ? 'Voice note'
                    : 'New thread')

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
      this.initialSpoiler = ''
      this.draftSlot = null
      this.editStatusId = null
      this.editAttachments = []
      this.editSensitive = false
      this.initialVisibility = 'direct'
      this.placeholder = 'Write a private message…'
      this.title = 'New message'
      this.inReplyToId = null
      this.quoteUrl = null
      this.contextPost = null
      this.groupTag = null
      this.mentionAccts = null
      this.initialModality = null
      // keep onPosted (e.g. navigate into the new conversation)
      this.instanceKey += 1
    },

    posted(status: mastodon.v1.Status) {
      const cb = this.onPosted
      // Always close — a throwing callback left the sheet open on a sent post,
      // inviting a second tap on Post (duplicate status).
      this.hide()
      const fail = (e: unknown) => logError('compose onPosted failed:', e)
      try {
        // Some callers pass async handlers (dmHelpers) — catch their rejections too
        const result: unknown = cb?.(status)
        if (result instanceof Promise) result.catch(fail)
      } catch (e) {
        fail(e)
      }
    },

    hide() {
      this.open = false
      this.initialText = ''
      this.initialSpoiler = ''
      this.draftSlot = null
      this.editStatusId = null
      this.editAttachments = []
      this.editSensitive = false
      this.initialVisibility = null
      this.placeholder = null
      this.title = null
      this.pickRecipient = false
      this.inReplyToId = null
      this.quoteUrl = null
      this.contextPost = null
      this.groupTag = null
      this.mentionAccts = null
      this.initialModality = null
      this.onPosted = null
    },
  },
})
