/**
 * NeoSpace Profile Store
 * 
 * Manages profile viewing and editing.
 * Updates sync directly to your Mastodon/GoToSocial instance.
 */

import { defineStore } from 'pinia'
import { createRestAPIClient, type mastodon } from 'masto'
import { useAuthStore } from './auth'

interface ProfileState {
  // Viewed profile (can be self or other user)
  viewedProfile: mastodon.v1.Account | null
  // User's own statuses
  statuses: mastodon.v1.Status[]
  // Pinned statuses
  pinnedStatuses: mastodon.v1.Status[]
  // Loading states
  isLoading: boolean
  isLoadingStatuses: boolean
  isUpdating: boolean
  // Edit mode
  isEditing: boolean
  // Edit form data
  editForm: {
    displayName: string
    note: string
    fields: { name: string; value: string }[]
    avatar: File | null
    header: File | null
    locked: boolean
    bot: boolean
    discoverable: boolean
  }
  // Errors
  error: string | null
  // Pagination
  maxStatusId: string | null
  hasMoreStatuses: boolean
}

export const useProfileStore = defineStore('profile', {
  state: (): ProfileState => ({
    viewedProfile: null,
    statuses: [],
    pinnedStatuses: [],
    isLoading: false,
    isLoadingStatuses: false,
    isUpdating: false,
    isEditing: false,
    editForm: {
      displayName: '',
      note: '',
      fields: [],
      avatar: null,
      header: null,
      locked: false,
      bot: false,
      discoverable: true,
    },
    error: null,
    maxStatusId: null,
    hasMoreStatuses: true,
  }),

  getters: {
    /**
     * Check if viewing own profile
     */
    isOwnProfile(): boolean {
      const authStore = useAuthStore()
      if (!authStore.currentUser || !this.viewedProfile) return false
      return authStore.currentUser.id === this.viewedProfile.id
    },

    /**
     * Get formatted join date
     */
    joinDate(): string {
      if (!this.viewedProfile?.createdAt) return ''
      return new Date(this.viewedProfile.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      })
    },

    /**
     * Extract custom CSS from profile fields
     */
    profileCustomCSS(): string {
      if (!this.viewedProfile?.fields) return ''
      const cssField = this.viewedProfile.fields.find(field =>
        ['css', 'custom_css', 'theme', 'style', 'chaos_css'].includes(
          field.name.toLowerCase().replace(/[^a-z_]/g, '')
        )
      )
      return cssField?.value || ''
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
     * Fetch a profile by ID or username
     */
    async fetchProfile(accountId?: string) {
      const authStore = useAuthStore()
      
      this.isLoading = true
      this.error = null

      try {
        const client = this.getClient()
        
        if (accountId) {
          this.viewedProfile = await client.v1.accounts.$select(accountId).fetch()
        } else {
          // Fetch own profile
          this.viewedProfile = await client.v1.accounts.verifyCredentials()
        }

        // Initialize edit form with current values
        this.initEditForm()

        // Fetch statuses
        await this.fetchStatuses(true)
        await this.fetchPinnedStatuses()

      } catch (e: any) {
        this.error = e.message || 'Failed to fetch profile'
        console.error('Profile fetch error:', e)
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Fetch profile by username (handle lookup)
     */
    async fetchProfileByUsername(username: string) {
      this.isLoading = true
      this.error = null

      try {
        const client = this.getClient()
        
        // Search for the account
        const results = await client.v1.accounts.lookup({ acct: username })
        
        if (results) {
          this.viewedProfile = results
          this.initEditForm()
          await this.fetchStatuses(true)
          await this.fetchPinnedStatuses()
        } else {
          this.error = 'User not found'
        }
      } catch (e: any) {
        this.error = e.message || 'Failed to find user'
        console.error('Profile lookup error:', e)
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Fetch user's statuses
     */
    async fetchStatuses(refresh = false) {
      if (!this.viewedProfile) return

      if (refresh) {
        this.statuses = []
        this.maxStatusId = null
        this.hasMoreStatuses = true
      }

      this.isLoadingStatuses = true

      try {
        const client = this.getClient()
        
        const statuses = await client.v1.accounts.$select(this.viewedProfile.id).statuses.list({
          limit: 20,
          maxId: this.maxStatusId || undefined,
          excludeReplies: false,
          excludeReblogs: false,
        })

        if (refresh) {
          this.statuses = statuses
        } else {
          this.statuses = [...this.statuses, ...statuses]
        }

        if (statuses.length > 0) {
          this.maxStatusId = statuses[statuses.length - 1].id
        }
        
        this.hasMoreStatuses = statuses.length === 20

      } catch (e: any) {
        console.error('Failed to fetch statuses:', e)
      } finally {
        this.isLoadingStatuses = false
      }
    },

    /**
     * Fetch pinned statuses
     */
    async fetchPinnedStatuses() {
      if (!this.viewedProfile) return

      try {
        const client = this.getClient()
        
        this.pinnedStatuses = await client.v1.accounts.$select(this.viewedProfile.id).statuses.list({
          pinned: true,
        })
      } catch (e: any) {
        console.error('Failed to fetch pinned statuses:', e)
      }
    },

    /**
     * Initialize edit form with current profile data
     */
    initEditForm() {
      if (!this.viewedProfile) return

      // Strip HTML from bio for editing
      const tempDiv = typeof document !== 'undefined' ? document.createElement('div') : null
      let plainBio = this.viewedProfile.note || ''
      if (tempDiv) {
        tempDiv.innerHTML = plainBio
        plainBio = tempDiv.textContent || tempDiv.innerText || ''
      }

      this.editForm = {
        displayName: this.viewedProfile.displayName || '',
        note: plainBio,
        fields: this.viewedProfile.fields?.map(f => ({
          name: f.name,
          value: f.value.replace(/<[^>]*>/g, ''), // Strip HTML from field values
        })) || [],
        avatar: null,
        header: null,
        locked: this.viewedProfile.locked || false,
        bot: this.viewedProfile.bot || false,
        discoverable: this.viewedProfile.discoverable ?? true,
      }
    },

    /**
     * Add a new profile field
     */
    addField() {
      if (this.editForm.fields.length < 4) {
        this.editForm.fields.push({ name: '', value: '' })
      }
    },

    /**
     * Remove a profile field
     */
    removeField(index: number) {
      this.editForm.fields.splice(index, 1)
    },

    /**
     * Update profile on the server
     */
    async updateProfile() {
      const authStore = useAuthStore()
      if (!this.isOwnProfile) {
        throw new Error('Cannot edit someone else\'s profile')
      }

      this.isUpdating = true
      this.error = null

      try {
        const client = this.getClient()

        // Build the update payload
        const updateData: any = {
          displayName: this.editForm.displayName,
          note: this.editForm.note,
          locked: this.editForm.locked,
          bot: this.editForm.bot,
          discoverable: this.editForm.discoverable,
        }

        // Add fields (filter out empty ones)
        const validFields = this.editForm.fields.filter(f => f.name.trim() || f.value.trim())
        if (validFields.length > 0) {
          updateData.fieldsAttributes = validFields.map((f, i) => ({
            name: f.name,
            value: f.value,
          }))
        }

        // Handle avatar upload
        if (this.editForm.avatar) {
          updateData.avatar = this.editForm.avatar
        }

        // Handle header upload
        if (this.editForm.header) {
          updateData.header = this.editForm.header
        }

        // Update the profile
        const updated = await client.v1.accounts.updateCredentials(updateData)

        // Update local state
        this.viewedProfile = updated
        authStore.currentUser = updated
        
        // Exit edit mode
        this.isEditing = false

        // Re-init form with new values
        this.initEditForm()

        return updated

      } catch (e: any) {
        this.error = e.message || 'Failed to update profile'
        console.error('Profile update error:', e)
        throw e
      } finally {
        this.isUpdating = false
      }
    },

    /**
     * Follow a user
     */
    async followUser() {
      if (!this.viewedProfile || this.isOwnProfile) return

      try {
        const client = this.getClient()
        const relationship = await client.v1.accounts.$select(this.viewedProfile.id).follow()
        
        // Update follower count optimistically
        if (this.viewedProfile) {
          this.viewedProfile = {
            ...this.viewedProfile,
            followersCount: (this.viewedProfile.followersCount || 0) + 1,
          }
        }

        return relationship
      } catch (e: any) {
        console.error('Follow error:', e)
        throw e
      }
    },

    /**
     * Unfollow a user
     */
    async unfollowUser() {
      if (!this.viewedProfile || this.isOwnProfile) return

      try {
        const client = this.getClient()
        const relationship = await client.v1.accounts.$select(this.viewedProfile.id).unfollow()
        
        // Update follower count optimistically
        if (this.viewedProfile) {
          this.viewedProfile = {
            ...this.viewedProfile,
            followersCount: Math.max(0, (this.viewedProfile.followersCount || 0) - 1),
          }
        }

        return relationship
      } catch (e: any) {
        console.error('Unfollow error:', e)
        throw e
      }
    },

    /**
     * Get relationship with current user
     */
    async getRelationship(): Promise<mastodon.v1.Relationship | null> {
      if (!this.viewedProfile || this.isOwnProfile) return null

      try {
        const client = this.getClient()
        const relationships = await client.v1.accounts.relationships.fetch({
          id: [this.viewedProfile.id],
        })
        return relationships[0] || null
      } catch (e: any) {
        console.error('Relationship fetch error:', e)
        return null
      }
    },

    /**
     * Toggle edit mode
     */
    toggleEditMode() {
      this.isEditing = !this.isEditing
      if (this.isEditing) {
        this.initEditForm()
      }
    },

    /**
     * Cancel editing
     */
    cancelEdit() {
      this.isEditing = false
      this.initEditForm()
    },

    /**
     * Clear profile state
     */
    clear() {
      this.viewedProfile = null
      this.statuses = []
      this.pinnedStatuses = []
      this.isEditing = false
      this.error = null
    },
  },
})

