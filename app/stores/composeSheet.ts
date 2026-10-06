/**
 * Mobile compose sheet — opened from the center + tab (Threads-style).
 * Desktop keeps the inline first-column composer.
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
}

export const useComposeSheetStore = defineStore('composeSheet', {
  state: (): ComposeSheetState => ({
    open: false,
    instanceKey: 0,
    initialText: '',
    initialVisibility: null,
    placeholder: null,
  }),

  actions: {
    show(opts?: {
      initialText?: string
      visibility?: ComposeVisibility
      placeholder?: string
    }) {
      this.initialText = opts?.initialText ?? ''
      this.initialVisibility = opts?.visibility ?? null
      this.placeholder = opts?.placeholder ?? null
      this.instanceKey += 1
      this.open = true
    },

    hide() {
      this.open = false
      this.initialText = ''
      this.initialVisibility = null
      this.placeholder = null
    },
  },
})
