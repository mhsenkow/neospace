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

/** Module-level — keep DOM nodes out of Pinia state */
let chaosStyleElement: HTMLStyleElement | null = null

interface ThemeState {
  isChaosMode: boolean
  userCustomCSS: string
}

export const useThemeStore = defineStore('theme', {
  state: (): ThemeState => ({
    isChaosMode: false,
    userCustomCSS: '',
  }),

  getters: {
    /** Already sanitized in setUserCustomCSS */
    safeCustomCSS: (state): string => state.userCustomCSS,
  },

  actions: {
    setUserCustomCSS(css: string) {
      this.userCustomCSS = sanitizeProfileCss(css)
      if (this.isChaosMode) this.injectChaos()
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

    /** ?safe=1 disables profile CSS (escape hatch if a skin breaks the UI). */
    isSafeMode(): boolean {
      if (typeof window === 'undefined') return false
      try {
        const q = new URLSearchParams(window.location.search)
        if (q.get('safe') === '1' || q.get('safe') === 'true') return true
        return localStorage.getItem('neospace_disable_profile_css') === '1'
      } catch {
        return false
      }
    },

    injectChaos() {
      if (typeof document === 'undefined') return
      if (this.isSafeMode()) {
        this.ejectChaos()
        return
      }
      document.body.classList.add('chaos-active')
      this.ejectChaosStyle()

      const safe = this.safeCustomCSS
      if (safe) {
        const styleEl = document.createElement('style')
        styleEl.id = 'neospace-chaos-styles'
        styleEl.textContent = safe
        document.head.appendChild(styleEl)
        chaosStyleElement = styleEl
      }
    },

    ejectChaos() {
      if (typeof document === 'undefined') return
      document.body.classList.remove('chaos-active')
      this.ejectChaosStyle()
    },

    /** Persist escape hatch from Settings or ?safe=1 */
    setProfileCssDisabled(disabled: boolean) {
      if (typeof localStorage === 'undefined') return
      try {
        if (disabled) localStorage.setItem('neospace_disable_profile_css', '1')
        else localStorage.removeItem('neospace_disable_profile_css')
      } catch {
        /* quota / storage blocked — still apply for this session below */
      }
      if (disabled) this.disableChaosMode()
      else if (this.isChaosMode) this.injectChaos()
    },

    ejectChaosStyle() {
      if (chaosStyleElement) {
        chaosStyleElement.remove()
        chaosStyleElement = null
      }
      const existingStyle = document.getElementById('neospace-chaos-styles')
      if (existingStyle) existingStyle.remove()
      const dynamic = document.getElementById('neospace-chaos-dynamic')
      if (dynamic) dynamic.remove()
    },

    async loadUserTheme(customCSS: string) {
      // setUserCustomCSS already (re)injects when chaos mode is on
      this.setUserCustomCSS(customCSS)
    },
  },
})
