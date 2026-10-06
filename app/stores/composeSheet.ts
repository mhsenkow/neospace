/**
 * Mobile compose sheet — opened from the center + tab (Threads-style).
 * Desktop keeps the inline first-column composer.
 * Messages can open with pickRecipient → then compose as direct.
 */

import { defineStore } from 'pinia'

export type ComposeVisibility = 'public' | 'unlisted' | 'private' | 'direct'

interface ComposeSheetState {
  open: boolean
  /** Bump to remount RealComposeBox cleanly */
  instanceKey: number
  initialText: string
  initialVisibility: ComposeVisibility | null
  placeholder: string | null
  title: string | null
  /** Show following/search picker before the composer */
  pickRecipient: boolean
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
  }),

  actions: {
    show(opts?: {
      initialText?: string
      visibility?: ComposeVisibility
      placeholder?: string
      title?: string
      pickRecipient?: boolean
    }) {
      this.initialText = opts?.initialText ?? ''
      this.initialVisibility = opts?.visibility ?? null
      this.placeholder = opts?.placeholder ?? null
      this.title = opts?.title ?? null
      this.pickRecipient = !!opts?.pickRecipient
      this.instanceKey += 1
      this.open = true
    },

    /** After picking someone — drop into a direct compose with @handle ready */
    continueWithRecipient(handle: string) {
      this.pickRecipient = false
      this.initialText = `${handle} `
      this.initialVisibility = 'direct'
      this.placeholder = 'Write a private message…'
      this.title = 'New message'
      this.instanceKey += 1
    },

    hide() {
      this.open = false
      this.initialText = ''
      this.initialVisibility = null
      this.placeholder = null
      this.title = null
      this.pickRecipient = false
    },
  },
})
