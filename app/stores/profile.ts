/**
 * NeoSpace Profile Store
 * 
 * Manages profile viewing and editing.
 * Updates sync directly to your Mastodon/GoToSocial instance.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient } from '~/composables/useMasto'
import { stripHtml } from '~/utils/sanitizeHtml'
import {
  ACCOUNT_STATUS_PAGE_SIZE,
  accountStatusHasMore,
  dedupeStatusPage,
} from '~/composables/useAccountPager'

/**
 * Per-operation request sequences. A slow response for an older profile (A→B
 * navigation) or an older tab's status list must not overwrite newer state.
 */
let profileSeq = 0
let statusesSeq = 0
let pinnedSeq = 0

type StatusListOpts = { excludeReplies?: boolean; onlyMedia?: boolean }

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
  /** Inline save failures — keep the form mounted */
  saveError: string | null
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
    saveError: null,
    maxStatusId: null,
    hasMoreStatuses: true,
  }),

  getters: {
    /**
     * Check if viewing own profile
     */
    isOwnProfile(): boolean {
      const instancesStore = useInstancesStore()
      if (!instancesStore.currentUser || !this.viewedProfile) return false
      return instancesStore.currentUser.id === this.viewedProfile.id
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
      return activeClient()
    },

    /**
     * Fetch a profile by ID or username
     */
    async fetchProfile(accountId?: string) {
      const seq = ++profileSeq
      this.isLoading = true
      this.error = null

      try {
        const client = this.getClient()

        const account = accountId
          ? await client.v1.accounts.$select(accountId).fetch()
          : await client.v1.accounts.verifyCredentials()
        if (seq !== profileSeq) return

        this.viewedProfile = account
        this.initEditForm()

        await Promise.all([
          this.fetchStatuses(true, { excludeReplies: true }),
          this.fetchPinnedStatuses(),
        ])

      } catch (e: any) {
        if (seq !== profileSeq) return
        this.error = e.message || 'Failed to fetch profile'
        console.error('Profile fetch error:', e)
      } finally {
        if (seq === profileSeq) this.isLoading = false
      }
    },

    /**
     * Fetch profile by username (handle lookup)
     */
    async fetchProfileByUsername(username: string) {
      const seq = ++profileSeq
      this.isLoading = true
      this.error = null

      try {
        const client = this.getClient()
        let account: mastodon.v1.Account | null = null

        try {
          account = await client.v1.accounts.lookup({ acct: username })
        } catch {
          const res = await client.v2.search.list({
            q: username,
            type: 'accounts',
            resolve: true,
            limit: 1,
          })
          account = res.accounts?.[0] || null
        }
        if (seq !== profileSeq) return

        if (account) {
          this.viewedProfile = account
          this.initEditForm()
          await Promise.all([
            this.fetchStatuses(true, { excludeReplies: true }),
            this.fetchPinnedStatuses(),
          ])
        } else {
          this.error = 'User not found'
        }
      } catch (e: any) {
        if (seq !== profileSeq) return
        this.error = e.message || 'Failed to find user'
        console.error('Profile lookup error:', e)
      } finally {
        if (seq === profileSeq) this.isLoading = false
      }
    },

    /**
     * Fetch user's statuses
     */
    async fetchStatuses(refresh = false, opts?: StatusListOpts) {
      if (!this.viewedProfile) return
      const seq = ++statusesSeq
      const profileId = this.viewedProfile.id

      if (refresh) {
        this.statuses = []
        this.maxStatusId = null
        this.hasMoreStatuses = true
      }

      this.isLoadingStatuses = true

      try {
        const client = this.getClient()
        
        const statuses = await client.v1.accounts.$select(profileId).statuses.list({
          limit: ACCOUNT_STATUS_PAGE_SIZE,
          maxId: this.maxStatusId || undefined,
          excludeReplies: opts?.excludeReplies ?? false,
          excludeReblogs: false,
          onlyMedia: opts?.onlyMedia ?? false,
        })
        // Newer fetch (tab switch / other profile) owns the list now
        if (seq !== statusesSeq || this.viewedProfile?.id !== profileId) return

        this.statuses = dedupeStatusPage(this.statuses, statuses, refresh)

        if (statuses.length > 0) {
          this.maxStatusId = statuses[statuses.length - 1]?.id ?? null
        }

        this.hasMoreStatuses = accountStatusHasMore(statuses.length)

      } catch (e: any) {
        if (seq !== statusesSeq) return
        console.error('Failed to fetch statuses:', e)
      } finally {
        if (seq === statusesSeq) this.isLoadingStatuses = false
      }
    },

    /**
     * Fetch pinned statuses
     */
    async fetchPinnedStatuses() {
      if (!this.viewedProfile) return
      const seq = ++pinnedSeq
      const profileId = this.viewedProfile.id

      try {
        const client = this.getClient()

        const pinned = await client.v1.accounts.$select(profileId).statuses.list({
          pinned: true,
        })
        if (seq !== pinnedSeq || this.viewedProfile?.id !== profileId) return
        this.pinnedStatuses = pinned
      } catch (e: any) {
        console.error('Failed to fetch pinned statuses:', e)
      }
    },

    /**
     * Initialize edit form with current profile data
     */
    initEditForm() {
      if (!this.viewedProfile) return

      // Strip HTML from bio for editing (no innerHTML — avoids XSS sinks)
      const plainBio = stripHtml(this.viewedProfile.note || '')

      this.editForm = {
        displayName: this.viewedProfile.displayName || '',
        note: plainBio,
        fields: this.viewedProfile.fields?.map(f => ({
          name: f.name,
          value: stripHtml(f.value || ''),
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
      const instancesStore = useInstancesStore()
      if (!this.isOwnProfile) {
        throw new Error('Cannot edit someone else\'s profile')
      }

      this.isUpdating = true
      this.saveError = null

      try {
        const client = this.getClient()

        // Always send 4 slots (padded empty) so cleared fields actually delete on the server
        const slots = [...this.editForm.fields]
        while (slots.length < 4) slots.push({ name: '', value: '' })

        // Build the update payload
        const updateData: mastodon.rest.v1.UpdateCredentialsParams = {
          displayName: this.editForm.displayName,
          note: this.editForm.note,
          locked: this.editForm.locked,
          bot: this.editForm.bot,
          discoverable: this.editForm.discoverable,
          fieldsAttributes: slots.slice(0, 4).map((f) => ({
            name: f.name,
            value: f.value,
          })),
          // Only send images that changed
          ...(this.editForm.avatar ? { avatar: this.editForm.avatar } : {}),
          ...(this.editForm.header ? { header: this.editForm.header } : {}),
        }

        // Update the profile
        const updated = await client.v1.accounts.updateCredentials(updateData)

        // Update local state
        this.viewedProfile = updated
        instancesStore.updateActiveAccount(updated)
        
        // Exit edit mode
        this.isEditing = false

        // Re-init form with new values
        this.initEditForm()

        return updated

      } catch (e: any) {
        this.saveError = e.message || 'Failed to update profile'
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
        
        // Only bump the count when follow succeeded (not a pending request)
        if (this.viewedProfile && relationship.following) {
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
      // Drop any in-flight responses for the profile being left
      profileSeq += 1
      statusesSeq += 1
      pinnedSeq += 1
      this.viewedProfile = null
      this.statuses = []
      this.pinnedStatuses = []
      this.isLoading = false
      this.isLoadingStatuses = false
      this.isUpdating = false
      this.isEditing = false
      this.maxStatusId = null
      this.hasMoreStatuses = true
      this.error = null
      this.saveError = null
      this.initEditForm()
    },
  },
})

