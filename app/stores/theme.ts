/**
 * NeoSpace Theme Store
 *
 * Manages optional custom profile CSS (historically "Chaos Mode"):
 * Myspace-era skins from Mastodon profile metadata fields
 * (css | custom_css | theme | style | chaos_css).
 * Default UI is always clean; custom CSS is opt-in via Settings → Appearance.
 * CSS is sanitized before inject — profile fields are attacker-controlled.
 */

import { defineStore } from 'pinia'
import { sanitizeProfileCss } from '~/utils/sanitizeCss'

interface ThemeState {
  isChaosMode: boolean
  userCustomCSS: string
  chaosStyleElement: HTMLStyleElement | null
}

export const useThemeStore = defineStore('theme', {
  state: (): ThemeState => ({
    isChaosMode: false,
    userCustomCSS: '',
    chaosStyleElement: null,
  }),

  getters: {
    currentModeName: (state): string => {
      return state.isChaosMode ? 'Custom profile CSS' : 'Default'
    },

    toggleButtonText: (state): string => {
      return state.isChaosMode ? 'Turn off profile CSS' : 'Apply profile CSS'
    },

    /** Sanitized CSS safe to inject into a <style> tag */
    safeCustomCSS: (state): string => sanitizeProfileCss(state.userCustomCSS),
  },

  actions: {
    setUserCustomCSS(css: string) {
      this.userCustomCSS = sanitizeProfileCss(css)
    },

    toggleMode() {
      this.isChaosMode = !this.isChaosMode
      if (this.isChaosMode) this.injectChaos()
      else this.ejectChaos()
    },

    enableChaosMode() {
      if (!this.isChaosMode) {
        this.isChaosMode = true
        this.injectChaos()
      }
    },

    disableChaosMode() {
      if (this.isChaosMode) {
        this.isChaosMode = false
        this.ejectChaos()
      }
    },

    injectChaos() {
      if (typeof document === 'undefined') return
      document.body.classList.add('chaos-active')
      this.ejectChaosStyle()

      const safe = this.safeCustomCSS
      if (safe) {
        const styleEl = document.createElement('style')
        styleEl.id = 'neospace-chaos-styles'
        styleEl.textContent = safe
        document.head.appendChild(styleEl)
        this.chaosStyleElement = styleEl
      }
    },

    ejectChaos() {
      if (typeof document === 'undefined') return
      document.body.classList.remove('chaos-active')
      this.ejectChaosStyle()
    },

    ejectChaosStyle() {
      if (this.chaosStyleElement) {
        this.chaosStyleElement.remove()
        this.chaosStyleElement = null
      }
      const existingStyle = document.getElementById('neospace-chaos-styles')
      if (existingStyle) existingStyle.remove()
      const dynamic = document.getElementById('neospace-chaos-dynamic')
      if (dynamic) dynamic.remove()
    },

    async loadUserTheme(customCSS: string) {
      this.setUserCustomCSS(customCSS)
      if (this.isChaosMode) this.injectChaos()
    },
  },
})
