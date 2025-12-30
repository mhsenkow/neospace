/**
 * NeoSpace Theme Store
 * 
 * Manages the dual-mode theme system:
 * - Mom Mode: Clean, accessible, professional
 * - Chaos Mode: User-defined CSS chaos from Myspace-era glory
 */

import { defineStore } from 'pinia'

interface ThemeState {
  isChaosMode: boolean
  userCustomCSS: string
  chaosStyleElement: HTMLStyleElement | null
}

export const useThemeStore = defineStore('theme', {
  state: (): ThemeState => ({
    isChaosMode: false,
    userCustomCSS: '',
    chaosStyleElement: null
  }),

  getters: {
    /**
     * Returns the current mode name for display
     */
    currentModeName: (state): string => {
      return state.isChaosMode ? '🌀 Chaos Mode' : '👩 Mom Mode'
    },

    /**
     * Returns the opposite mode name for toggle button
     */
    toggleButtonText: (state): string => {
      return state.isChaosMode ? 'Switch to Mom Mode' : 'Unleash Chaos'
    }
  },

  actions: {
    /**
     * Sets the user's custom CSS from their profile
     * This would normally come from the Mastodon API profile metadata
     */
    setUserCustomCSS(css: string) {
      this.userCustomCSS = css
    },

    /**
     * Toggles between Mom Mode and Chaos Mode
     */
    toggleMode() {
      this.isChaosMode = !this.isChaosMode
      
      if (this.isChaosMode) {
        this.injectChaos()
      } else {
        this.ejectChaos()
      }
    },

    /**
     * Enables Chaos Mode
     */
    enableChaosMode() {
      if (!this.isChaosMode) {
        this.isChaosMode = true
        this.injectChaos()
      }
    },

    /**
     * Disables Chaos Mode (return to Mom Mode)
     */
    disableChaosMode() {
      if (this.isChaosMode) {
        this.isChaosMode = false
        this.ejectChaos()
      }
    },

    /**
     * Injects the user's custom CSS into the document
     * Creates a <style> element with the chaos CSS variables
     */
    injectChaos() {
      if (typeof document === 'undefined') return

      // Add chaos class to body
      document.body.classList.add('chaos-active')

      // Remove existing chaos style if present
      this.ejectChaosStyle()

      // Create and inject new style element
      if (this.userCustomCSS) {
        const styleEl = document.createElement('style')
        styleEl.id = 'neospace-chaos-styles'
        styleEl.textContent = this.userCustomCSS
        document.head.appendChild(styleEl)
        this.chaosStyleElement = styleEl
      }

      console.log('🌀 Chaos Mode activated! Welcome to the void.')
    },

    /**
     * Removes the chaos styles from the document
     */
    ejectChaos() {
      if (typeof document === 'undefined') return

      // Remove chaos class from body
      document.body.classList.remove('chaos-active')

      // Remove the style element
      this.ejectChaosStyle()

      console.log('👩 Mom Mode restored. Everything is fine.')
    },

    /**
     * Helper to remove the chaos style element
     */
    ejectChaosStyle() {
      if (this.chaosStyleElement) {
        this.chaosStyleElement.remove()
        this.chaosStyleElement = null
      }
      
      // Also check for orphaned style elements
      const existingStyle = document.getElementById('neospace-chaos-styles')
      if (existingStyle) {
        existingStyle.remove()
      }
    },

    /**
     * Loads and applies user theme from mock data or API
     */
    async loadUserTheme(customCSS: string) {
      this.setUserCustomCSS(customCSS)
      
      // If already in chaos mode, re-inject with new CSS
      if (this.isChaosMode) {
        this.injectChaos()
      }
    }
  }
})

