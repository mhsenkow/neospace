/**
 * NeoSpace Status Actions Store
 *
 * Posting and account/status actions against the active Mastodon account.
 * Timeline fetching lives in TimelineColumn (per-column state).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient } from '~/composables/useMasto'

interface StatusState {
  error: string | null
}

export const useStatusStore = defineStore('status', {
  state: (): StatusState => ({
    error: null,
  }),

  actions: {
    getClient(): mastodon.rest.Client {
      return activeClient()
    },

    async postStatus(
      content: string,
      options: {
        visibility?: 'public' | 'unlisted' | 'private' | 'direct'
        spoilerText?: string
        mediaIds?: string[]
        inReplyToId?: string
      } = {},
    ) {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) {
        throw new Error('Not authenticated')
      }

      const client = this.getClient()
      return await client.v1.statuses.create({
        status: content,
        visibility: options.visibility || 'public',
        spoilerText: options.spoilerText,
        mediaIds: options.mediaIds,
        inReplyToId: options.inReplyToId,
      })
    },

    async resolveStatus(statusUrl: string): Promise<string | null> {
      try {
        const client = this.getClient()
        const results = await client.v2.search.fetch({
          q: statusUrl,
          resolve: true,
          type: 'statuses',
          limit: 1,
        })
        return results.statuses[0]?.id ?? null
      } catch (e) {
        console.warn('Failed to resolve status:', e)
        return null
      }
    },

    async muteAccount(accountId: string) {
      await this.getClient().v1.accounts.$select(accountId).mute()
    },

    async blockAccount(accountId: string) {
      await this.getClient().v1.accounts.$select(accountId).block()
    },

    async reportStatus(statusId: string, accountId: string, comment?: string) {
      await this.getClient().v1.reports.create({
        accountId,
        statusIds: [statusId],
        comment: comment || '',
      })
    },
  },
})

/** @deprecated Use useStatusStore — kept for transitional imports */
export const useTimelineStore = useStatusStore
