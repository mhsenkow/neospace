/**
 * NeoSpace Profile Store
 * 
 * Manages profile viewing and editing.
 * Updates sync directly to your Mastodon/GoToSocial instance.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient, activeCredentials } from '~/composables/useMasto'
import { accountsMatch, hostOf } from '~/utils/federation'
import { stripHtml } from '~/utils/stripHtml'
import { profileFieldLimit } from '~/utils/profileSources'
import { extractProfileCss } from '~/utils/profileCss'
import { httpStatusFrom } from '~/utils/friendlyError'
import {
  ACCOUNT_STATUS_PAGE_SIZE,
  accountStatusHasMore,
  dedupeStatusPage,
} from '~/composables/useAccountPager'
import { dropDeletedStatus, type DeletedStatusEvent } from '~/utils/deletedStatus'
import { logError } from '~/utils/log'

/**
 * Per-operation request sequences. A slow response for an older profile (A→B
 * navigation) or an older tab's status list must not overwrite newer state.
 */
let profileSeq = 0
let statusesSeq = 0
let pinnedSeq = 0

/**
 * Stamp the serving host on fetched posts. Own-post management proves a status id
 * belongs to the acting server from this tag; untagged posts get no delete / pin.
 */
function tagServingOrigin<T extends mastodon.v1.Status>(list: T[]): T[] {
  let origin = ''
  try {
    origin = activeCredentials().url
  } catch {
    return list
  }
  return list.map((s) => ({ ...s, _instanceUrl: origin }))
}

type StatusListOpts = { excludeReplies?: boolean; onlyMedia?: boolean; excludeReblogs?: boolean }

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
  /** HTTP status behind `error` when there was one (404 → "Account not found", no Retry) */
  errorStatus: number | null
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
    errorStatus: null,
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
    /** Profile metadata slots the active instance accepts (Mastodon default 4). */
    maxProfileFields(): number {
      return profileFieldLimit(useInstancesStore().activeAccount?.instanceInfo?.maxProfileFields)
    },

    profileCustomCSS(): string {
      return extractProfileCss(this.viewedProfile?.fields)
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
      this.errorStatus = null

      try {
        const client = this.getClient()

        const account = accountId
          ? await client.v1.accounts.$select(accountId).fetch()
          : await client.v1.accounts.verifyCredentials()
        if (seq !== profileSeq) return

        this.setViewedProfile(account)

        await Promise.all([
          this.fetchStatuses(true, { excludeReplies: true, excludeReblogs: true }),
          this.fetchPinnedStatuses(),
        ])

      } catch (e: any) {
        if (seq !== profileSeq) return
        this.error = e.message || 'Failed to fetch profile'
        this.errorStatus = httpStatusFrom(e)
        logError('Profile fetch error:', e)
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
      this.errorStatus = null

      try {
        const client = this.getClient()
        let account: mastodon.v1.Account | null = null

        const want = username.replace(/^@/, '').trim()
        let homeHost = ''
        try {
          homeHost = hostOf(activeCredentials().url)
        } catch {
          /* guest */
        }
        try {
          const found = await client.v1.accounts.lookup({ acct: want })
          if (found && accountsMatch(want, found.acct, homeHost)) account = found
        } catch {
          const res = await client.v2.search.list({
            q: want,
            type: 'accounts',
            resolve: true,
            limit: 5,
          })
          account =
            res.accounts?.find((a) => accountsMatch(want, a.acct, homeHost)) || null
        }
        if (seq !== profileSeq) return

        if (account) {
          this.setViewedProfile(account)
          await Promise.all([
            this.fetchStatuses(true, { excludeReplies: true, excludeReblogs: true }),
            this.fetchPinnedStatuses(),
          ])
        } else {
          this.error = 'User not found'
          this.errorStatus = 404
        }
      } catch (e: any) {
        if (seq !== profileSeq) return
        this.error = e.message || 'Failed to find user'
        this.errorStatus = httpStatusFrom(e)
        logError('Profile lookup error:', e)
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
          excludeReblogs: opts?.excludeReblogs ?? false,
          onlyMedia: opts?.onlyMedia ?? false,
        })
        // Newer fetch (tab switch / other profile) owns the list now
        if (seq !== statusesSeq || this.viewedProfile?.id !== profileId) return

        this.statuses = dedupeStatusPage(this.statuses, tagServingOrigin(statuses), refresh)

        if (statuses.length > 0) {
          this.maxStatusId = statuses[statuses.length - 1]?.id ?? null
        }

        this.hasMoreStatuses = accountStatusHasMore(statuses.length)

      } catch (e: any) {
        if (seq !== statusesSeq) return
        logError('Failed to fetch statuses:', e)
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
        this.pinnedStatuses = tagServingOrigin(pinned)
      } catch (e: any) {
        logError('Failed to fetch pinned statuses:', e)
      }
    },

    /** A post was deleted elsewhere in the app — drop it from the lists without a refetch. */
    removeDeletedStatus(event: DeletedStatusEvent) {
      this.statuses = dropDeletedStatus(this.statuses, event)
      this.pinnedStatuses = dropDeletedStatus(this.pinnedStatuses, event)
    },

    /** Swap the viewed profile; an open editor never carries over to someone else. */
    setViewedProfile(account: mastodon.v1.Account) {
      if (this.viewedProfile?.id !== account.id) {
        this.isEditing = false
        this.saveError = null
      }
      this.viewedProfile = account
      this.initEditForm()
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
      if (this.editForm.fields.length < this.maxProfileFields) {
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

        // Always send every slot (padded empty) so cleared fields actually delete on
        // the server. Cap at the instance's limit, not a hard-coded 4 — servers that
        // allow more (and the profile page's presence merge) would lose fields.
        const maxFields = this.maxProfileFields
        const ownerId = instancesStore.activeAccountId
        const slots = [...this.editForm.fields]
        while (slots.length < maxFields) slots.push({ name: '', value: '' })

        // Build the update payload
        const updateData: mastodon.rest.v1.UpdateCredentialsParams = {
          displayName: this.editForm.displayName,
          note: this.editForm.note,
          locked: this.editForm.locked,
          bot: this.editForm.bot,
          discoverable: this.editForm.discoverable,
          fieldsAttributes: slots.slice(0, maxFields).map((f) => ({
            name: f.name,
            value: f.value,
          })),
          // Only send images that changed
          ...(this.editForm.avatar ? { avatar: this.editForm.avatar } : {}),
          ...(this.editForm.header ? { header: this.editForm.header } : {}),
        }

        // Update the profile
        const updated = await client.v1.accounts.updateCredentials(updateData)

        // Update local state (the PATCH went to ownerId even if the user switched since)
        if (ownerId) instancesStore.updateActiveAccount(updated, ownerId)
        if (this.viewedProfile?.id !== updated.id) return updated
        this.viewedProfile = updated
        
        // Exit edit mode
        this.isEditing = false

        // Re-init form with new values
        this.initEditForm()

        return updated

      } catch (e: any) {
        this.saveError = e.message || 'Failed to update profile'
        logError('Profile update error:', e)
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

      const targetId = this.viewedProfile.id
      try {
        const client = this.getClient()
        const relationship = await client.v1.accounts.$select(targetId).follow()
        
        // Only bump the count when follow succeeded (not a pending request) — and
        // only on the same profile (A→B navigation mid-request)
        if (this.viewedProfile?.id === targetId && relationship.following) {
          this.viewedProfile = {
            ...this.viewedProfile,
            followersCount: (this.viewedProfile.followersCount || 0) + 1,
          }
        }

        return relationship
      } catch (e: any) {
        logError('Follow error:', e)
        throw e
      }
    },

    /**
     * Unfollow a user
     */
    async unfollowUser() {
      if (!this.viewedProfile || this.isOwnProfile) return

      const targetId = this.viewedProfile.id
      try {
        const client = this.getClient()
        const relationship = await client.v1.accounts.$select(targetId).unfollow()
        
        // Update follower count (same profile only — A→B navigation mid-request)
        if (this.viewedProfile?.id === targetId) {
          this.viewedProfile = {
            ...this.viewedProfile,
            followersCount: Math.max(0, (this.viewedProfile.followersCount || 0) - 1),
          }
        }

        return relationship
      } catch (e: any) {
        logError('Unfollow error:', e)
        throw e
      }
    },

    /**
     * Mute / block (or undo) the viewed profile. Resolves with the Relationship the
     * server returns so the page paints the real state; the caller ignores it if the
     * user navigated to another profile meanwhile (compare `viewedProfile.id`).
     */
    async setRelationship(
      kind: 'mute' | 'unmute' | 'block' | 'unblock',
    ): Promise<mastodon.v1.Relationship | null> {
      if (!this.viewedProfile || this.isOwnProfile) return null
      const target = this.getClient().v1.accounts.$select(this.viewedProfile.id)
      return await target[kind]()
    },

    /** Report the viewed profile (no specific post) */
    async reportViewedAccount(opts: {
      comment?: string
      category: 'spam' | 'violation' | 'other'
      forward: boolean
    }) {
      if (!this.viewedProfile || this.isOwnProfile) return
      await this.getClient().v1.reports.create({
        accountId: this.viewedProfile.id,
        comment: opts.comment || '',
        category: opts.category,
        forward: opts.forward,
      } as never)
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
        logError('Relationship fetch error:', e)
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
      this.errorStatus = null
      this.saveError = null
      this.initEditForm()
    },
  },
})

