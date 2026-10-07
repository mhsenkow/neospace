/**
 * Global lightbox + confirm dialog state.
 */

import { defineStore } from 'pinia'

export type LightboxState = {
  open: boolean
  src: string
  alt: string
}

export type ConfirmState = {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  danger: boolean
}

type ConfirmResolver = (ok: boolean) => void

let confirmResolve: ConfirmResolver | null = null

export const useOverlayStore = defineStore('overlay', {
  state: () => ({
    lightbox: {
      open: false,
      src: '',
      alt: '',
    } as LightboxState,
    confirm: {
      open: false,
      title: '',
      body: '',
      confirmLabel: 'Confirm',
      danger: false,
    } as ConfirmState,
  }),

  actions: {
    openLightbox(opts: { src: string; alt?: string }) {
      this.lightbox = {
        open: true,
        src: opts.src,
        alt: opts.alt ?? '',
      }
    },

    closeLightbox() {
      this.lightbox = { open: false, src: '', alt: '' }
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
  },
})
