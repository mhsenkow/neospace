/**
 * NeoSpace Auth Store
 * 
 * Handles OAuth authentication with Mastodon/GoToSocial instances.
 * Stores credentials in localStorage for persistence.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'

interface AuthState {
  instanceUrl: string | null
  accessToken: string | null
  currentUser: mastodon.v1.Account | null
  isLoading: boolean
  error: string | null
  // OAuth app credentials (created during registration)
  clientId: string | null
  clientSecret: string | null
}

const STORAGE_KEY = 'neospace_auth'
const APP_NAME = 'NeoSpace'
const REDIRECT_URI = typeof window !== 'undefined' 
  ? `${window.location.origin}/auth/callback`
  : 'http://localhost:3000/auth/callback'
const SCOPES = 'read write follow push'

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    instanceUrl: null,
    accessToken: null,
    currentUser: null,
    isLoading: false,
    error: null,
    clientId: null,
    clientSecret: null,
  }),

  getters: {
    isAuthenticated: (state): boolean => !!state.accessToken && !!state.currentUser,
    
    userDisplayName: (state): string => {
      if (!state.currentUser) return 'Guest'
      return state.currentUser.displayName || state.currentUser.username
    },

    userAvatar: (state): string | null => {
      return state.currentUser?.avatar || null
    },

    /**
     * Extract custom CSS from user's profile fields
     * GoToSocial/Mastodon allows custom metadata fields
     */
    userCustomCSS: (state): string => {
      if (!state.currentUser?.fields) return ''
      
      // Look for a field named "css", "custom_css", "theme", or "style"
      const cssField = state.currentUser.fields.find(field => 
        ['css', 'custom_css', 'theme', 'style', 'chaos_css'].includes(
          field.name.toLowerCase().replace(/[^a-z_]/g, '')
        )
      )
      
      return cssField?.value || ''
    }
  },

  actions: {
    /**
     * Load saved auth from localStorage
     */
    loadFromStorage() {
      if (typeof window === 'undefined') return false
      
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          const data = JSON.parse(saved)
          this.instanceUrl = data.instanceUrl || null
          this.accessToken = data.accessToken || null
          this.clientId = data.clientId || null
          this.clientSecret = data.clientSecret || null
          return true
        }
      } catch (e) {
        console.error('Failed to load auth from storage:', e)
      }
      return false
    },

    /**
     * Save auth to localStorage
     */
    saveToStorage() {
      if (typeof window === 'undefined') return
      
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          instanceUrl: this.instanceUrl,
          accessToken: this.accessToken,
          clientId: this.clientId,
          clientSecret: this.clientSecret,
        }))
      } catch (e) {
        console.error('Failed to save auth to storage:', e)
      }
    },

    /**
     * Clear all auth data
     */
    clearAuth() {
      this.instanceUrl = null
      this.accessToken = null
      this.currentUser = null
      this.clientId = null
      this.clientSecret = null
      this.error = null
      
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY)
      }
    },

    /**
     * Register the app with an instance (first step of OAuth)
     */
    async registerApp(instanceUrl: string) {
      this.isLoading = true
      this.error = null
      
      try {
        // Normalize the URL
        const url = instanceUrl.replace(/\/+$/, '')
        this.instanceUrl = url
        
        // Create a client without auth to register the app
        const client = createRestAPIClient({ url })
        
        // Register the OAuth application
        const app = await client.v1.apps.create({
          clientName: APP_NAME,
          redirectUris: REDIRECT_URI,
          scopes: SCOPES,
          website: 'https://neospace.social',
        })
        
        this.clientId = app.clientId ?? null
        this.clientSecret = app.clientSecret ?? null
        this.saveToStorage()
        
        return app
      } catch (e: any) {
        this.error = e.message || 'Failed to register app with instance'
        throw e
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Get the OAuth authorization URL
     */
    getAuthUrl(): string {
      if (!this.instanceUrl || !this.clientId) {
        throw new Error('App not registered. Call registerApp first.')
      }
      
      const params = new URLSearchParams({
        client_id: this.clientId,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: SCOPES,
      })
      
      return `${this.instanceUrl}/oauth/authorize?${params.toString()}`
    },

    /**
     * Exchange OAuth code for access token
     */
    async handleCallback(code: string) {
      this.isLoading = true
      this.error = null
      
      try {
        if (!this.instanceUrl || !this.clientId || !this.clientSecret) {
          throw new Error('Missing OAuth credentials')
        }
        
        // Exchange code for token
        const response = await fetch(`${this.instanceUrl}/oauth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: this.clientId,
            client_secret: this.clientSecret,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
            code: code,
            scope: SCOPES,
          }),
        })
        
        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error_description || error.error || 'Token exchange failed')
        }
        
        const data = await response.json()
        this.accessToken = data.access_token
        this.saveToStorage()
        
        // Fetch current user
        await this.fetchCurrentUser()
        
        return data
      } catch (e: any) {
        this.error = e.message || 'Authentication failed'
        throw e
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Fetch the authenticated user's account
     */
    async fetchCurrentUser() {
      if (!this.instanceUrl || !this.accessToken) {
        throw new Error('Not authenticated')
      }
      
      try {
        const client = createRestAPIClient({
          url: this.instanceUrl,
          accessToken: this.accessToken,
        })
        
        this.currentUser = await client.v1.accounts.verifyCredentials()
        return this.currentUser
      } catch (e: any) {
        // Token might be expired
        if (e.status === 401 || e.status === 403) {
          this.clearAuth()
        }
        throw e
      }
    },

    /**
     * Initialize: load from storage and verify credentials
     */
    async initialize() {
      this.loadFromStorage()
      
      if (this.accessToken && this.instanceUrl) {
        try {
          await this.fetchCurrentUser()
        } catch (e) {
          console.warn('Stored credentials invalid, clearing auth')
          this.clearAuth()
        }
      }
    },

    /**
     * Logout
     */
    async logout() {
      // Optionally revoke the token
      if (this.instanceUrl && this.accessToken && this.clientId && this.clientSecret) {
        try {
          await fetch(`${this.instanceUrl}/oauth/revoke`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id: this.clientId,
              client_secret: this.clientSecret,
              token: this.accessToken,
            }),
          })
        } catch (e) {
          // Ignore revocation errors
        }
      }
      
      this.clearAuth()
    }
  }
})

