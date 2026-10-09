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
import { activeClient, clientFor } from '~/composables/useMasto'
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
import { cursorPage } from '~/utils/linkHeader'
import { listenSuiteLook, readSuiteLook, writeSuiteLook } from '~/utils/suiteLook'

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
  {
    id: 'humans',
    label: 'Humans first',
    icon: 'heart',
    description: 'Why NeoSpace exists — people over farms',
    keywords: [
      'human',
      'humans',
      'bot',
      'bots',
      'intent',
      'mission',
      'values',
      'ai',
      'reality',
      'photo',
      'verify',
      'proof',
      'edward',
    ],
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
  /** Last open() named a category — phones should land on that panel, not the list */
  openedToCategory: boolean
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
    /** Collapse consecutive reblogs of the same post in Home ("A and N others reposted") */
    collapseReblogs: boolean
  }
  
  // Filters
  filters: mastodon.v2.Filter[]
  
  // Muted/Blocked
  mutedAccounts: mastodon.v1.Account[]
  blockedAccounts: mastodon.v1.Account[]
  blockedDomains: string[]
  hasMoreMuted: boolean
  hasMoreBlocked: boolean
  isLoadingMuted: boolean
  isLoadingBlocked: boolean
  /** Per-item moderation actions in flight */
  pendingModeration: Record<string, string>
  
  // Loading states
  isLoading: boolean
  isSaving: boolean
  error: string | null
  saveSuccess: boolean
}

const MODERATION_PAGE_SIZE = 40

type AppearancePrefs = typeof DEFAULT_APPEARANCE

/** Normalize the appearance subset of stored / imported prefs JSON. */
function parseAppearance(parsed: Record<string, any>, legacyCompact?: boolean): AppearancePrefs {
  return {
    theme: normalizeTheme(parsed.theme),
    ui: normalizeUi(parsed.ui),
    font: normalizeFont(parsed.font),
    fontSize: normalizeFontSize(parsed.fontSize),
    radius: normalizeRadius(parsed.radius),
    density: normalizeDensity(parsed.density, legacyCompact),
    line: normalizeLine(parsed.line),
    reduceMotion: !!parsed.reduceMotion,
    customProfileCss: !!parsed.customProfileCss,
    flipTextAlign: (['left', 'center', 'right'].includes(parsed.flipTextAlign)
      ? parsed.flipTextAlign
      : 'center') as AppearancePrefs['flipTextAlign'],
    flipTextSize: (['reading', 'large', 'display'].includes(parsed.flipTextSize)
      ? parsed.flipTextSize
      : 'large') as AppearancePrefs['flipTextSize'],
  }
}

/**
 * Bumped by clearModerationLists (account switch) so privacy-list pages for
 * the previous account are dropped instead of landing in the new account's lists.
 */
let moderationEpoch = 0
/** Link-header max_id cursors — mute/block rows aren't paged by account id */
const moderationCursor: { muted: string | null; blocked: string | null } = {
  muted: null,
  blocked: null,
}

const DEFAULT_APPEARANCE: Pick<
  SettingsState['localPreferences'],
  'theme' | 'ui' | 'font' | 'fontSize' | 'radius' | 'density' | 'line' | 'reduceMotion' | 'customProfileCss' | 'flipTextAlign' | 'flipTextSize'
> = {
  theme: 'auto',
  ui: 'braun',
  font: 'sans',
  fontSize: 'medium',
  radius: 'match',
  density: 'cozy',
  line: 'clean',
  reduceMotion: false,
  customProfileCss: false,
  flipTextAlign: 'center',
  flipTextSize: 'large',
}

const LOCAL_PREFS_KEY = 'neospace_local_prefs'

let saveSuccessTimer: ReturnType<typeof setTimeout> | null = null
const LOCAL_PREFS_VERSION = 1

/**
 * Parse the stored local-prefs blob. Corrupt JSON or a non-object value is
 * dropped (returns null) so the caller still applies defaults + suite look
 * instead of bailing out of appearance setup entirely.
 */
export function parseStoredLocalPrefs(saved: string | null): Record<string, unknown> | null {
  if (!saved) return null
  let raw: unknown
  try {
    raw = JSON.parse(saved)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  // Fields are read individually (parseAppearance etc.) — never spread into state
  const { v: _v, ...rest } = raw as Record<string, unknown>
  return rest
}

function readStoredLocalPrefs(): Record<string, any> | null {
  try {
    return parseStoredLocalPrefs(localStorage.getItem(LOCAL_PREFS_KEY))
  } catch {
    return null
  }
}

/** Active account the loaded `account` / `preferences` / `filters` belong to. */
let settingsOwnerId: string | null = null
let settingsLoadSeq = 0

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    isOpen: false,
    activeCategory: 'profile',
    openedToCategory: false,
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
      collapseReblogs: true,
    },
    
    filters: [],
    mutedAccounts: [],
    blockedAccounts: [],
    blockedDomains: [],
    hasMoreMuted: true,
    hasMoreBlocked: true,
    isLoadingMuted: false,
    isLoadingBlocked: false,
    pendingModeration: {},
    
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

    /** Post language — server prefs, then browser locale. */
    defaultLanguage: (state): string => {
      const pref = state.preferences?.['posting:default:language']
      if (pref && pref.trim()) return pref.trim()
      if (typeof navigator !== 'undefined') {
        return (navigator.language || 'en').split('-')[0] || 'en'
      }
      return 'en'
    },
  },

  actions: {
    /**
     * Get authenticated API client
     */
    getClient(): mastodon.rest.Client {
      // Settings always act on the global active account — never a page's
      // transient read override (/profile?account=…), or a PATCH could land on
      // the linked account while the result is filed under the active one.
      const activeId = useInstancesStore().activeAccountId
      return activeId ? clientFor(activeId) : activeClient()
    },
    
    /**
     * Open the settings modal
     */
    open(category?: string) {
      this.isOpen = true
      this.openedToCategory = !!category
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
        const parsed = readStoredLocalPrefs()
        if (parsed) {
          const vis = parsed.defaultVisibility
          const appearance = parseAppearance(parsed, !!parsed.compactMode)
          this.localPreferences = {
            ...this.localPreferences,
            ...appearance,
            compactMode: appearance.density === 'dense',
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
            collapseReblogs: parsed.collapseReblogs !== false,
          }
        }
        // Suite look (wordcount / bruh / loom) wins when hopping instruments —
        // same ibm.tools.shared blob the waffle started on.
        const suite = readSuiteLook()
        if (suite.theme) this.localPreferences.theme = suite.theme
        if (suite.ui) this.localPreferences.ui = suite.ui
        if (suite.font) this.localPreferences.font = suite.font
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
      writeSuiteLook({
        theme: this.localPreferences.theme,
        ui: this.localPreferences.ui,
        font: this.localPreferences.font,
      })
    },

    /** Follow sibling tools editing ibm.tools.shared (bruh / loom / words). */
    startSuiteLookSync(): () => void {
      return listenSuiteLook((slice) => {
        let changed = false
        if (slice.theme && slice.theme !== this.localPreferences.theme) {
          this.localPreferences.theme = slice.theme
          changed = true
        }
        if (slice.ui && slice.ui !== this.localPreferences.ui) {
          this.localPreferences.ui = slice.ui
          changed = true
        }
        if (slice.font && slice.font !== this.localPreferences.font) {
          this.localPreferences.font = slice.font
          changed = true
        }
        if (!changed) return
        // Apply without re-writing the blob we just read (avoid storage thrash).
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
        this.saveLocalPreferences()
      })
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

      // Never show (or save over) another account's profile while this one loads
      const ownerId = instancesStore.activeAccountId
      if (settingsOwnerId !== ownerId) {
        this.account = null
        this.preferences = null
        this.filters = []
      }

      const seq = ++settingsLoadSeq
      this.isLoading = true
      this.error = null

      try {
        const client = this.getClient()

        const [prefResult, accountResult, filterResult] = await Promise.allSettled([
          client.v1.preferences.fetch(),
          client.v1.accounts.verifyCredentials(),
          client.v2.filters.list(),
        ])
        // Account switched / reloaded mid-flight — a newer load owns state now
        if (seq !== settingsLoadSeq || instancesStore.activeAccountId !== ownerId) return

        if (accountResult.status === 'fulfilled') {
          this.account = accountResult.value
          settingsOwnerId = ownerId
        } else {
          throw accountResult.reason
        }
        if (prefResult.status === 'fulfilled') {
          this.preferences = prefResult.value as MastodonPreferences
        }
        if (filterResult.status === 'fulfilled') {
          this.filters = filterResult.value
        } else {
          console.error('Failed to load filters:', filterResult.reason)
        }
        
        // Also load local preferences
        this.loadLocalPreferences()
        
      } catch (e: any) {
        if (seq !== settingsLoadSeq) return
        this.error = e?.message || 'Failed to load settings'
        console.error('Settings load error:', e)
      } finally {
        if (seq === settingsLoadSeq) this.isLoading = false
      }
    },
    
    clearModerationLists() {
      moderationEpoch += 1
      moderationCursor.muted = null
      moderationCursor.blocked = null
      this.mutedAccounts = []
      this.blockedAccounts = []
      this.blockedDomains = []
      this.hasMoreMuted = true
      this.hasMoreBlocked = true
      // In-flight loads for the old account are stale — don't let them block the new one
      this.isLoadingMuted = false
      this.isLoadingBlocked = false
      this.pendingModeration = {}
    },

    /** True while a load started under (epoch, accountId) is still current */
    isModerationLoadCurrent(epoch: number, accountId: string | null) {
      return epoch === moderationEpoch && accountId === useInstancesStore().activeAccountId
    },

    moderationPendingKey(action: string, id: string) {
      return `${action}:${id}`
    },

    setModerationPending(action: string, id: string, pending: boolean) {
      const key = this.moderationPendingKey(action, id)
      if (pending) this.pendingModeration[key] = action
      else delete this.pendingModeration[key]
    },

    isModerationPending(action: string, id: string) {
      return !!this.pendingModeration[this.moderationPendingKey(action, id)]
    },

    /**
     * Load muted accounts
     */
    async loadMutedAccounts(opts?: { more?: boolean }) {
      if (this.isLoadingMuted) return
      if (opts?.more && !moderationCursor.muted) {
        this.hasMoreMuted = false
        return
      }
      const epoch = moderationEpoch
      const accountId = useInstancesStore().activeAccountId
      this.isLoadingMuted = true
      try {
        const client = this.getClient()
        const page = await cursorPage(
          client.v1.mutes.list.$raw({
            limit: MODERATION_PAGE_SIZE,
            maxId: (opts?.more && moderationCursor.muted) || undefined,
          }),
        )
        if (!this.isModerationLoadCurrent(epoch, accountId)) return
        const items = page.items
        moderationCursor.muted = page.nextMaxId
        if (opts?.more) {
          const seen = new Set(this.mutedAccounts.map((a) => a.id))
          this.mutedAccounts = [
            ...this.mutedAccounts,
            ...items.filter((a) => !seen.has(a.id)),
          ]
        } else {
          this.mutedAccounts = items
        }
        this.hasMoreMuted = !!page.nextMaxId && items.length > 0
      } catch (e) {
        if (!this.isModerationLoadCurrent(epoch, accountId)) return
        console.error('Failed to load muted accounts:', e)
        this.error = e instanceof Error ? e.message : 'Failed to load muted accounts'
      } finally {
        if (epoch === moderationEpoch) this.isLoadingMuted = false
      }
    },
    
    /**
     * Load blocked accounts
     */
    async loadBlockedAccounts(opts?: { more?: boolean }) {
      if (this.isLoadingBlocked) return
      if (opts?.more && !moderationCursor.blocked) {
        this.hasMoreBlocked = false
        return
      }
      const epoch = moderationEpoch
      const accountId = useInstancesStore().activeAccountId
      this.isLoadingBlocked = true
      try {
        const client = this.getClient()
        const page = await cursorPage(
          client.v1.blocks.list.$raw({
            limit: MODERATION_PAGE_SIZE,
            maxId: (opts?.more && moderationCursor.blocked) || undefined,
          }),
        )
        if (!this.isModerationLoadCurrent(epoch, accountId)) return
        const items = page.items
        moderationCursor.blocked = page.nextMaxId
        if (opts?.more) {
          const seen = new Set(this.blockedAccounts.map((a) => a.id))
          this.blockedAccounts = [
            ...this.blockedAccounts,
            ...items.filter((a) => !seen.has(a.id)),
          ]
        } else {
          this.blockedAccounts = items
        }
        this.hasMoreBlocked = !!page.nextMaxId && items.length > 0
      } catch (e) {
        if (!this.isModerationLoadCurrent(epoch, accountId)) return
        console.error('Failed to load blocked accounts:', e)
        this.error = e instanceof Error ? e.message : 'Failed to load blocked accounts'
      } finally {
        if (epoch === moderationEpoch) this.isLoadingBlocked = false
      }
    },
    
    /**
     * Load blocked domains
     */
    async loadBlockedDomains() {
      const epoch = moderationEpoch
      const accountId = useInstancesStore().activeAccountId
      try {
        const client = this.getClient()
        const domains = await client.v1.domainBlocks.list()
        if (!this.isModerationLoadCurrent(epoch, accountId)) return
        this.blockedDomains = domains
      } catch (e) {
        console.error('Failed to load blocked domains:', e)
      }
    },

    async blockDomain(domain: string) {
      const normalized = domain.trim().toLowerCase().replace(/^@/, '')
      if (!normalized) throw new Error('Enter a domain like example.social')
      this.setModerationPending('block-domain', normalized, true)
      this.error = null
      try {
        const client = this.getClient()
        await client.v1.domainBlocks.create({ domain: normalized })
        if (!this.blockedDomains.includes(normalized)) {
          this.blockedDomains = [...this.blockedDomains, normalized].sort()
        }
        this.saveSuccess = true
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Failed to block domain'
        throw e
      } finally {
        this.setModerationPending('block-domain', normalized, false)
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
        // The PATCH goes to this account even if the user switches mid-request
        const ownerId = instancesStore.activeAccountId

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

        if (ownerId) instancesStore.updateActiveAccount(updated, ownerId)
        if (instancesStore.activeAccountId === ownerId) this.account = updated
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
      const source: Partial<Pick<mastodon.v1.AccountSource, 'privacy' | 'sensitive' | 'language'>> = {}
      if (data.visibility) source.privacy = data.visibility
      if (data.sensitive !== undefined) source.sensitive = data.sensitive
      if (data.language !== undefined) source.language = data.language

      if (Object.keys(source).length) {
        try {
          const client = this.getClient()
          await client.v1.accounts.updateCredentials({ source })
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
        fontSize: normalizeFontSize(data.fontSize ?? this.localPreferences.fontSize),
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

    resetAppearance() {
      this.updateAppearance({ ...DEFAULT_APPEARANCE })
    },

    exportAppearanceJson() {
      const payload = {
        v: LOCAL_PREFS_VERSION,
        ...DEFAULT_APPEARANCE,
        theme: this.localPreferences.theme,
        ui: this.localPreferences.ui,
        font: this.localPreferences.font,
        fontSize: this.localPreferences.fontSize,
        radius: this.localPreferences.radius,
        density: this.localPreferences.density,
        line: this.localPreferences.line,
        reduceMotion: this.localPreferences.reduceMotion,
        customProfileCss: this.localPreferences.customProfileCss,
        flipTextAlign: this.localPreferences.flipTextAlign,
        flipTextSize: this.localPreferences.flipTextSize,
      }
      return JSON.stringify(payload, null, 2)
    },

    importAppearanceJson(raw: string) {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid appearance JSON')
      this.updateAppearance(parseAppearance(parsed))
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
      this.setModerationPending('delete-filter', filterId, true)
      this.error = null
      try {
        const client = this.getClient()
        await client.v2.filters.$select(filterId).remove()
        this.filters = this.filters.filter(f => f.id !== filterId)
        this.saveSuccess = true
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Failed to delete filter'
        throw e
      } finally {
        this.setModerationPending('delete-filter', filterId, false)
      }
    },
    
    /**
     * Unmute an account
     */
    async unmuteAccount(accountId: string) {
      this.setModerationPending('unmute', accountId, true)
      this.error = null
      try {
        const client = this.getClient()
        await client.v1.accounts.$select(accountId).unmute()
        this.mutedAccounts = this.mutedAccounts.filter(a => a.id !== accountId)
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Failed to unmute account'
        throw e
      } finally {
        this.setModerationPending('unmute', accountId, false)
      }
    },
    
    /**
     * Unblock an account
     */
    async unblockAccount(accountId: string) {
      this.setModerationPending('unblock', accountId, true)
      this.error = null
      try {
        const client = this.getClient()
        await client.v1.accounts.$select(accountId).unblock()
        this.blockedAccounts = this.blockedAccounts.filter(a => a.id !== accountId)
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Failed to unblock account'
        throw e
      } finally {
        this.setModerationPending('unblock', accountId, false)
      }
    },
    
    /**
     * Unblock a domain
     */
    async unblockDomain(domain: string) {
      this.setModerationPending('unblock-domain', domain, true)
      this.error = null
      try {
        const client = this.getClient()
        await client.v1.domainBlocks.remove({ domain })
        this.blockedDomains = this.blockedDomains.filter(d => d !== domain)
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Failed to unblock domain'
        throw e
      } finally {
        this.setModerationPending('unblock-domain', domain, false)
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

