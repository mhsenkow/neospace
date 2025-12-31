/**
 * NeoSpace Settings Store
 * 
 * Manages user preferences fetched from and synced to Mastodon.
 * Provides a 1:1 mapping with Mastodon's settings where possible.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import { useAuthStore } from './auth'

// Settings categories for the sidebar
export interface SettingsCategory {
  id: string
  label: string
  icon: string
  description?: string
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: 'profile', label: 'Profile', icon: '👤', description: 'Your public profile information' },
  { id: 'privacy', label: 'Privacy & Safety', icon: '🔒', description: 'Control who can see your content' },
  { id: 'notifications', label: 'Notifications', icon: '🔔', description: 'Manage your notification preferences' },
  { id: 'appearance', label: 'Appearance', icon: '🎨', description: 'Customize how NeoSpace looks' },
  { id: 'posting', label: 'Posting Defaults', icon: '✍️', description: 'Default settings for new posts' },
  { id: 'filters', label: 'Filters', icon: '🚫', description: 'Content filters and muted words' },
  { id: 'account', label: 'Account', icon: '⚙️', description: 'Account settings and data' },
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
    theme: 'auto' | 'light' | 'dark'
    fontSize: 'small' | 'medium' | 'large'
    reduceMotion: boolean
    compactMode: boolean
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

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    isOpen: false,
    activeCategory: 'profile',
    searchQuery: '',
    
    preferences: null,
    account: null,
    
    localPreferences: {
      theme: 'auto',
      fontSize: 'medium',
      reduceMotion: false,
      compactMode: false,
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
      return SETTINGS_CATEGORIES.filter(cat => 
        cat.label.toLowerCase().includes(query) ||
        cat.description?.toLowerCase().includes(query)
      )
    },
    
    /**
     * Current category info
     */
    currentCategory: (state): SettingsCategory | undefined => {
      return SETTINGS_CATEGORIES.find(c => c.id === state.activeCategory)
    },
    
    /**
     * Default post visibility
     */
    defaultVisibility: (state): string => {
      return state.preferences?.['posting:default:visibility'] || 'public'
    },
    
    /**
     * Default sensitive media
     */
    defaultSensitive: (state): boolean => {
      return state.preferences?.['posting:default:sensitive'] || false
    },
  },

  actions: {
    /**
     * Get authenticated API client
     */
    getClient(): mastodon.rest.Client {
      const authStore = useAuthStore()
      
      if (!authStore.instanceUrl || !authStore.accessToken) {
        throw new Error('Not authenticated')
      }
      
      return createRestAPIClient({
        url: authStore.instanceUrl,
        accessToken: authStore.accessToken,
      })
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
          this.localPreferences = { ...this.localPreferences, ...JSON.parse(saved) }
        }
      } catch (e) {
        console.error('Failed to load local preferences:', e)
      }
    },
    
    /**
     * Save local preferences to storage
     */
    saveLocalPreferences() {
      if (typeof window === 'undefined') return
      
      try {
        localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(this.localPreferences))
      } catch (e) {
        console.error('Failed to save local preferences:', e)
      }
    },
    
    /**
     * Load all settings from Mastodon
     */
    async loadSettings() {
      const authStore = useAuthStore()
      if (!authStore.isAuthenticated) return
      
      this.isLoading = true
      this.error = null
      
      try {
        const client = this.getClient()
        
        // Load in parallel
        const [preferences, account, filters] = await Promise.all([
          client.v1.preferences.fetch(),
          client.v1.accounts.verifyCredentials(),
          this.loadFilters(),
        ])
        
        this.preferences = preferences as MastodonPreferences
        this.account = account
        
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
        const authStore = useAuthStore()
        
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
        authStore.currentUser = updated
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
     * Update posting preferences
     * Note: Mastodon API doesn't have a direct endpoint for this,
     * but we can store it locally and use it when posting
     */
    async updatePostingDefaults(data: {
      visibility?: 'public' | 'unlisted' | 'private' | 'direct'
      sensitive?: boolean
      language?: string
    }) {
      // These are stored in preferences but read-only via API
      // We'll store locally and apply when posting
      if (this.preferences) {
        if (data.visibility) {
          this.preferences['posting:default:visibility'] = data.visibility
        }
        if (data.sensitive !== undefined) {
          this.preferences['posting:default:sensitive'] = data.sensitive
        }
      }
      
      // Store in local storage for use in compose
      const postingDefaults = {
        visibility: data.visibility || this.preferences?.['posting:default:visibility'],
        sensitive: data.sensitive ?? this.preferences?.['posting:default:sensitive'],
        language: data.language,
      }
      
      if (typeof window !== 'undefined') {
        localStorage.setItem('neospace_posting_defaults', JSON.stringify(postingDefaults))
      }
      
      this.saveSuccess = true
    },
    
    /**
     * Update local appearance preferences
     */
    updateAppearance(data: Partial<SettingsState['localPreferences']>) {
      this.localPreferences = { ...this.localPreferences, ...data }
      this.saveLocalPreferences()
      this.saveSuccess = true
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
      setTimeout(() => {
        this.saveSuccess = false
      }, 3000)
    }
  }
})

