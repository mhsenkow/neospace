/**
 * NeoSpace Settings Store
 * 
 * Manages user preferences fetched from and synced to Mastodon.
 * Provides a 1:1 mapping with Mastodon's settings where possible.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { useThemeStore } from './theme'
import { activeClient } from '~/composables/useMasto'
import type {
  NeoDensityId,
  NeoFontId,
  NeoFontSizeId,
  NeoLineId,
  NeoRadiusId,
  NeoThemeId,
  NeoUiId,
} from '~/utils/appearance'
import {
  applyAppearance,
  normalizeDensity,
  normalizeFont,
  normalizeFontSize,
  normalizeLine,
  normalizeRadius,
  normalizeTheme,
  normalizeUi,
  nextDensity,
  nextLine,
  nextRadius,
  nextTheme,
  nextUi,
} from '~/utils/appearance'
import { ensureFontsLoaded } from '~/utils/loadFonts'

// Settings categories for the sidebar
export interface SettingsCategory {
  id: string
  label: string
  icon: string
  description?: string
  keywords?: string[]
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: 'profile',
    label: 'Profile',
    icon: 'user',
    description: 'Your public profile information',
    keywords: ['name', 'bio', 'avatar', 'header', 'display', 'about', 'fields', 'website'],
  },
  {
    id: 'privacy',
    label: 'Privacy & Safety',
    icon: 'lock',
    description: 'Control who can see your content',
    keywords: ['mute', 'block', 'locked', 'discoverable', 'safety', 'hide', 'domain'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: 'bell',
    description: 'Manage your notification preferences',
    keywords: ['alerts', 'mentions', 'push', 'email', 'activity'],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    icon: 'palette',
    description: 'Customize how NeoSpace looks',
    keywords: ['theme', 'dark', 'light', 'font', 'dyslexic', 'density', 'radius', 'ui', 'contrast', 'motion', 'css'],
  },
  {
    id: 'posting',
    label: 'Posting Defaults',
    icon: 'pen',
    description: 'Default settings for new posts',
    keywords: ['visibility', 'public', 'unlisted', 'followers', 'sensitive', 'cw', 'language', 'compose'],
  },
  {
    id: 'filters',
    label: 'Filters',
    icon: 'ban',
    description: 'Content filters and muted words',
    keywords: ['mute', 'keyword', 'hide', 'words', 'phrases'],
  },
  {
    id: 'account',
    label: 'Account',
    icon: 'settings',
    description: 'Account settings and data',
    keywords: ['logout', 'sign out', 'clear', 'data', 'export', 'instance', 'linked', 'accounts'],
  },
]

// Mastodon preferences structure
interface MastodonPreferences {
  'posting:default:visibility': 'public' | 'unlisted' | 'private' | 'direct'
  'posting:default:sensitive': boolean
  'posting:default:language': string | null
  'reading:expand:media': 'default' | 'show_all' | 'hide_all'
  'reading:expand:spoilers': boolean
  'reading:autoplay:gifs': boolean
}

interface SettingsState {
  // Modal state
  isOpen: boolean
  activeCategory: string
  searchQuery: string
  
  // Mastodon preferences
  preferences: MastodonPreferences | null
  
  // Account/profile settings (from current user)
  account: mastodon.v1.Account | null
  
  // Local app preferences (stored locally)
  localPreferences: {
    theme: NeoThemeId
    ui: NeoUiId
    font: NeoFontId
    fontSize: NeoFontSizeId
    radius: NeoRadiusId
    density: NeoDensityId
    line: NeoLineId
    reduceMotion: boolean
    /** @deprecated use density === 'dense'; kept in sync for older prefs */
    compactMode: boolean
    /** Apply custom CSS from your Mastodon profile fields (css / custom_css / theme / style / chaos_css) */
    customProfileCss: boolean
    /** How Flip-mode post text is laid out */
    flipTextAlign: 'left' | 'center' | 'right'
    /** Type scale for Flip-mode text (esp. text-only slides) */
    flipTextSize: 'reading' | 'large' | 'display'
    /** null = follow server preference */
    defaultVisibility: 'public' | 'unlisted' | 'private' | 'direct' | null
    defaultSensitive: boolean | null
    /** True only after the user saves Posting Defaults (avoids hard-coded public shadowing server prefs) */
    postingDefaultsTouched: boolean
  }
  
  // Filters
  filters: mastodon.v2.Filter[]
  
  // Muted/Blocked
  mutedAccounts: mastodon.v1.Account[]
  blockedAccounts: mastodon.v1.Account[]
  blockedDomains: string[]
  
  // Loading states
  isLoading: boolean
  isSaving: boolean
  error: string | null
  saveSuccess: boolean
}

const LOCAL_PREFS_KEY = 'neospace_local_prefs'

let saveSuccessTimer: ReturnType<typeof setTimeout> | null = null
const LOCAL_PREFS_VERSION = 1

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    isOpen: false,
    activeCategory: 'profile',
    searchQuery: '',
    
    preferences: null,
    account: null,
    
    localPreferences: {
      theme: 'auto',
      ui: 'braun',
      font: 'sans',
      fontSize: 'medium',
      radius: 'match',
      density: 'cozy',
      line: 'clean',
      reduceMotion: false,
      compactMode: false,
      customProfileCss: false,
      flipTextAlign: 'center',
      flipTextSize: 'large',
      defaultVisibility: null,
      defaultSensitive: null,
      postingDefaultsTouched: false,
    },
    
    filters: [],
    mutedAccounts: [],
    blockedAccounts: [],
    blockedDomains: [],
    
    isLoading: false,
    isSaving: false,
    error: null,
    saveSuccess: false,
  }),

  getters: {
    /**
     * Get filtered categories based on search
     */
    filteredCategories: (state): SettingsCategory[] => {
      if (!state.searchQuery.trim()) return SETTINGS_CATEGORIES

      const query = state.searchQuery.toLowerCase()
      return SETTINGS_CATEGORIES.filter(
        (cat) =>
          cat.label.toLowerCase().includes(query) ||
          cat.description?.toLowerCase().includes(query) ||
          cat.keywords?.some((k) => k.includes(query) || query.includes(k)),
      )
    },
    
    /**
     * Current category info
     */
    currentCategory: (state): SettingsCategory | undefined => {
      return SETTINGS_CATEGORIES.find(c => c.id === state.activeCategory)
    },
    
    /**
     * Default post visibility — prefers local override, then Mastodon prefs
     */
    defaultVisibility: (state): 'public' | 'unlisted' | 'private' | 'direct' => {
      return (
        state.localPreferences.defaultVisibility ??
        state.preferences?.['posting:default:visibility'] ??
        'public'
      )
    },
    
    /**
     * Default sensitive media
     */
    defaultSensitive: (state): boolean => {
      if (
        state.localPreferences.postingDefaultsTouched &&
        typeof state.localPreferences.defaultSensitive === 'boolean'
      ) {
        return state.localPreferences.defaultSensitive
      }
      return state.preferences?.['posting:default:sensitive'] || false
    },
  },

  actions: {
    /**
     * Get authenticated API client
     */
    getClient(): mastodon.rest.Client {
      return activeClient()
    },
    
    /**
     * Open the settings modal
     */
    open(category?: string) {
      this.isOpen = true
      if (category) {
        this.activeCategory = category
      }
      this.loadSettings()
    },
    
    /**
     * Close the settings modal
     */
    close() {
      this.isOpen = false
      this.searchQuery = ''
      this.error = null
      this.saveSuccess = false
    },
    
    /**
     * Set active category
     */
    setCategory(categoryId: string) {
      this.activeCategory = categoryId
      this.error = null
      this.saveSuccess = false
    },
    
    /**
     * Load local preferences from storage
     */
    loadLocalPreferences() {
      if (typeof window === 'undefined') return
      
      try {
        const saved = localStorage.getItem(LOCAL_PREFS_KEY)
        if (saved) {
          const raw = JSON.parse(saved)
          const parsed =
            raw && typeof raw === 'object' && typeof raw.v === 'number'
              ? (({ v: _v, ...rest }) => rest)(raw)
              : raw
          const vis = parsed.defaultVisibility
          this.localPreferences = {
            ...this.localPreferences,
            ...parsed,
            theme: normalizeTheme(parsed.theme),
            ui: normalizeUi(parsed.ui),
            font: normalizeFont(parsed.font),
            fontSize: normalizeFontSize(parsed.fontSize),
            radius: normalizeRadius(parsed.radius),
            density: normalizeDensity(parsed.density, !!parsed.compactMode),
            line: normalizeLine(parsed.line),
            reduceMotion: !!parsed.reduceMotion,
            compactMode: normalizeDensity(parsed.density, !!parsed.compactMode) === 'dense',
            customProfileCss: !!parsed.customProfileCss,
            flipTextAlign: (['left', 'center', 'right'].includes(parsed.flipTextAlign)
              ? parsed.flipTextAlign
              : 'center') as SettingsState['localPreferences']['flipTextAlign'],
            flipTextSize: (['reading', 'large', 'display'].includes(parsed.flipTextSize)
              ? parsed.flipTextSize
              : 'large') as SettingsState['localPreferences']['flipTextSize'],
            postingDefaultsTouched: !!parsed.postingDefaultsTouched,
            defaultVisibility:
              parsed.postingDefaultsTouched &&
              ['public', 'unlisted', 'private', 'direct'].includes(vis)
                ? vis
                : null,
            defaultSensitive:
              parsed.postingDefaultsTouched && typeof parsed.defaultSensitive === 'boolean'
                ? parsed.defaultSensitive
                : null,
          }
        }
        this.applyLocalAppearance()
        this.syncCustomProfileCss()
      } catch (e) {
        console.error('Failed to load local preferences:', e)
      }
    },

    applyLocalAppearance() {
      applyAppearance({
        theme: this.localPreferences.theme,
        ui: this.localPreferences.ui,
        font: this.localPreferences.font,
        fontSize: this.localPreferences.fontSize,
        radius: this.localPreferences.radius,
        density: this.localPreferences.density,
        line: this.localPreferences.line,
      })
      ensureFontsLoaded(this.localPreferences.ui, this.localPreferences.font)
      if (typeof document !== 'undefined') {
        document.documentElement.classList.toggle(
          'reduce-motion',
          this.localPreferences.reduceMotion,
        )
      }
    },

    /**
     * Apply or clear Myspace-style profile CSS ("Chaos Mode").
     * CSS comes from Mastodon profile metadata fields: css, custom_css, theme, style, chaos_css.
     */
    syncCustomProfileCss() {
      const themeStore = useThemeStore()
      const instancesStore = useInstancesStore()
      const css = instancesStore.userCustomCSS
      if (css) themeStore.setUserCustomCSS(css)

      if (this.localPreferences.customProfileCss && css) {
        themeStore.enableChaosMode()
      } else {
        themeStore.disableChaosMode()
      }
    },
    
    /**
     * Save local preferences to storage
     */
    saveLocalPreferences() {
      if (typeof window === 'undefined') return
      
      try {
        localStorage.setItem(
          LOCAL_PREFS_KEY,
          JSON.stringify({ v: LOCAL_PREFS_VERSION, ...this.localPreferences }),
        )
      } catch (e) {
        console.error('Failed to save local preferences:', e)
      }
    },
    
    /**
     * Load all settings from Mastodon
     */
    async loadSettings() {
      const instancesStore = useInstancesStore()
      if (!instancesStore.isAuthenticated) return
      
      this.isLoading = true
      this.error = null
      
      try {
        const client = this.getClient()
        
        const [prefResult, accountResult, filterResult] = await Promise.allSettled([
          client.v1.preferences.fetch(),
          client.v1.accounts.verifyCredentials(),
          this.loadFilters(),
        ])

        if (accountResult.status === 'fulfilled') {
          this.account = accountResult.value
        } else {
          throw accountResult.reason
        }
        if (prefResult.status === 'fulfilled') {
          this.preferences = prefResult.value as MastodonPreferences
        }
        if (filterResult.status === 'fulfilled') {
          this.filters = filterResult.value
        }
        
        // Also load local preferences
        this.loadLocalPreferences()
        
      } catch (e: any) {
        this.error = e.message || 'Failed to load settings'
        console.error('Settings load error:', e)
      } finally {
        this.isLoading = false
      }
    },
    
    /**
     * Load content filters
     */
    async loadFilters(): Promise<mastodon.v2.Filter[]> {
      try {
        const client = this.getClient()
        this.filters = await client.v2.filters.list()
        return this.filters
      } catch (e) {
        console.error('Failed to load filters:', e)
        return []
      }
    },
    
    clearModerationLists() {
      this.mutedAccounts = []
      this.blockedAccounts = []
      this.blockedDomains = []
    },

    /**
     * Load muted accounts
     */
    async loadMutedAccounts() {
      try {
        const client = this.getClient()
        this.mutedAccounts = await client.v1.mutes.list()
      } catch (e) {
        console.error('Failed to load muted accounts:', e)
      }
    },
    
    /**
     * Load blocked accounts
     */
    async loadBlockedAccounts() {
      try {
        const client = this.getClient()
        this.blockedAccounts = await client.v1.blocks.list()
      } catch (e) {
        console.error('Failed to load blocked accounts:', e)
      }
    },
    
    /**
     * Load blocked domains
     */
    async loadBlockedDomains() {
      try {
        const client = this.getClient()
        this.blockedDomains = await client.v1.domainBlocks.list()
      } catch (e) {
        console.error('Failed to load blocked domains:', e)
      }
    },
    
    /**
     * Update profile settings
     */
    async updateProfile(data: {
      displayName?: string
      note?: string
      avatar?: File
      header?: File
      locked?: boolean
      bot?: boolean
      discoverable?: boolean
      fields?: { name: string; value: string }[]
    }) {
      this.isSaving = true
      this.error = null
      this.saveSuccess = false
      
      try {
        const client = this.getClient()
        const instancesStore = useInstancesStore()
        
        const updateData: any = {}
        
        if (data.displayName !== undefined) updateData.displayName = data.displayName
        if (data.note !== undefined) updateData.note = data.note
        if (data.locked !== undefined) updateData.locked = data.locked
        if (data.bot !== undefined) updateData.bot = data.bot
        if (data.discoverable !== undefined) updateData.discoverable = data.discoverable
        if (data.avatar) updateData.avatar = data.avatar
        if (data.header) updateData.header = data.header
        if (data.fields) {
          updateData.fieldsAttributes = data.fields.map(f => ({
            name: f.name,
            value: f.value,
          }))
        }
        
        const updated = await client.v1.accounts.updateCredentials(updateData)
        
        this.account = updated
        instancesStore.updateActiveAccount(updated)
        this.saveSuccess = true
        
        return updated
      } catch (e: any) {
        this.error = e.message || 'Failed to update profile'
        throw e
      } finally {
        this.isSaving = false
      }
    },
    
    /**
     * Update posting defaults — local cache + server via updateCredentials source.
     */
    async updatePostingDefaults(data: {
      visibility?: 'public' | 'unlisted' | 'private' | 'direct'
      sensitive?: boolean
      language?: string
    }) {
      if (data.visibility) {
        this.localPreferences.defaultVisibility = data.visibility
        this.localPreferences.postingDefaultsTouched = true
        if (this.preferences) {
          this.preferences['posting:default:visibility'] = data.visibility
        }
      }
      if (data.sensitive !== undefined) {
        this.localPreferences.defaultSensitive = data.sensitive
        this.localPreferences.postingDefaultsTouched = true
        if (this.preferences) {
          this.preferences['posting:default:sensitive'] = data.sensitive
        }
      }
      if (data.language !== undefined && this.preferences) {
        this.preferences['posting:default:language'] = data.language
      }
      this.saveLocalPreferences()

      // Mastodon accepts source[privacy|sensitive|language] on update_credentials
      const source: Record<string, string | boolean> = {}
      if (data.visibility) source.privacy = data.visibility
      if (data.sensitive !== undefined) source.sensitive = data.sensitive
      if (data.language !== undefined) source.language = data.language

      if (Object.keys(source).length) {
        try {
          const client = this.getClient()
          await client.v1.accounts.updateCredentials({ source } as any)
        } catch (e) {
          console.warn('Could not sync posting defaults to server:', e)
        }
      }

      this.saveSuccess = true
    },
    
    /**
     * Update local appearance preferences
     */
    updateAppearance(data: Partial<SettingsState['localPreferences']>) {
      this.localPreferences = {
        ...this.localPreferences,
        ...data,
        theme: normalizeTheme(data.theme ?? this.localPreferences.theme),
        ui: normalizeUi(data.ui ?? this.localPreferences.ui),
        font: normalizeFont(data.font ?? this.localPreferences.font),
        radius: normalizeRadius(data.radius ?? this.localPreferences.radius),
        density: normalizeDensity(data.density ?? this.localPreferences.density),
        line: normalizeLine(data.line ?? this.localPreferences.line),
        compactMode: normalizeDensity(data.density ?? this.localPreferences.density) === 'dense',
      }
      this.saveLocalPreferences()
      this.applyLocalAppearance()
      if (typeof data.customProfileCss === 'boolean') {
        this.syncCustomProfileCss()
      }
      this.saveSuccess = true
    },

    cycleTheme() {
      const upcoming = nextTheme(this.localPreferences.theme)
      this.updateAppearance({ theme: upcoming })
      return upcoming
    },

    cycleUi() {
      const upcoming = nextUi(this.localPreferences.ui)
      this.updateAppearance({ ui: upcoming })
      return upcoming
    },

    cycleRadius() {
      const upcoming = nextRadius(this.localPreferences.radius)
      this.updateAppearance({ radius: upcoming })
      return upcoming
    },

    cycleDensity() {
      const upcoming = nextDensity(this.localPreferences.density)
      this.updateAppearance({ density: upcoming })
      return upcoming
    },

    cycleLine() {
      const upcoming = nextLine(this.localPreferences.line)
      this.updateAppearance({ line: upcoming })
      return upcoming
    },
    
    /**
     * Create a content filter
     */
    async createFilter(data: {
      title: string
      keywords: string[]
      context: ('home' | 'notifications' | 'public' | 'thread' | 'account')[]
      filterAction?: 'warn' | 'hide'
      expiresIn?: number
    }) {
      this.isSaving = true
      this.error = null
      
      try {
        const client = this.getClient()
        
        const filter = await client.v2.filters.create({
          title: data.title,
          context: data.context,
          filterAction: data.filterAction || 'warn',
          expiresIn: data.expiresIn,
          keywordsAttributes: data.keywords.map(keyword => ({
            keyword,
            wholeWord: true,
          })),
        })
        
        this.filters.push(filter)
        this.saveSuccess = true
        
        return filter
      } catch (e: any) {
        this.error = e.message || 'Failed to create filter'
        throw e
      } finally {
        this.isSaving = false
      }
    },
    
    /**
     * Delete a filter
     */
    async deleteFilter(filterId: string) {
      this.isSaving = true
      
      try {
        const client = this.getClient()
        await client.v2.filters.$select(filterId).remove()
        
        this.filters = this.filters.filter(f => f.id !== filterId)
        this.saveSuccess = true
      } catch (e: any) {
        this.error = e.message || 'Failed to delete filter'
        throw e
      } finally {
        this.isSaving = false
      }
    },
    
    /**
     * Unmute an account
     */
    async unmuteAccount(accountId: string) {
      try {
        const client = this.getClient()
        await client.v1.accounts.$select(accountId).unmute()
        
        this.mutedAccounts = this.mutedAccounts.filter(a => a.id !== accountId)
      } catch (e: any) {
        this.error = e.message || 'Failed to unmute account'
        throw e
      }
    },
    
    /**
     * Unblock an account
     */
    async unblockAccount(accountId: string) {
      try {
        const client = this.getClient()
        await client.v1.accounts.$select(accountId).unblock()
        
        this.blockedAccounts = this.blockedAccounts.filter(a => a.id !== accountId)
      } catch (e: any) {
        this.error = e.message || 'Failed to unblock account'
        throw e
      }
    },
    
    /**
     * Unblock a domain
     */
    async unblockDomain(domain: string) {
      try {
        const client = this.getClient()
        await client.v1.domainBlocks.remove({ domain })
        
        this.blockedDomains = this.blockedDomains.filter(d => d !== domain)
      } catch (e: any) {
        this.error = e.message || 'Failed to unblock domain'
        throw e
      }
    },
    
    /**
     * Clear success message after delay
     */
    clearSuccess() {
      if (saveSuccessTimer) clearTimeout(saveSuccessTimer)
      saveSuccessTimer = setTimeout(() => {
        this.saveSuccess = false
        saveSuccessTimer = null
      }, 3000)
    },
  }
})

