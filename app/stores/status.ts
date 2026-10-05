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
        sensitive?: boolean
      } = {},
    ) {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) {
        throw new Error('Not authenticated')
      }

      const text = content.trim()
      const mediaIds = options.mediaIds?.filter(Boolean) ?? []
      if (!text && mediaIds.length === 0) {
        throw new Error('Write something or add a photo')
      }

      const client = this.getClient()
      return await client.v1.statuses.create({
        status: text || undefined,
        visibility: options.visibility || 'public',
        spoilerText: options.spoilerText,
        mediaIds: mediaIds.length ? mediaIds : undefined,
        inReplyToId: options.inReplyToId,
        sensitive: options.sensitive,
      })
    },

    /**
     * Upload an image/video for a status. Masto polls until processing completes.
     */
    async uploadMedia(file: Blob, description?: string): Promise<mastodon.v1.MediaAttachment> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) {
        throw new Error('Not authenticated')
      }

      const client = this.getClient()
      return await client.v2.media.create({
        file,
        description: description || undefined,
        skipPolling: false,
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

    async resolveAccount(acct: string): Promise<string | null> {
      try {
        const client = this.getClient()
        // Prefer lookup when available
        try {
          const found = await client.v1.accounts.lookup({ acct: acct.replace(/^@/, '') })
          if (found?.id) return found.id
        } catch {
          // fall through to search
        }
        const results = await client.v1.accounts.search({
          q: acct.replace(/^@/, ''),
          resolve: true,
          limit: 1,
        })
        return results[0]?.id ?? null
      } catch (e) {
        console.warn('Failed to resolve account:', e)
        return null
      }
    },

    async fetchStatus(statusId: string): Promise<mastodon.v1.Status> {
      return await this.getClient().v1.statuses.$select(statusId).fetch()
    },

    async fetchThread(statusId: string): Promise<{
      status: mastodon.v1.Status
      ancestors: mastodon.v1.Status[]
      descendants: mastodon.v1.Status[]
    }> {
      const client = this.getClient()
      const [status, context] = await Promise.all([
        client.v1.statuses.$select(statusId).fetch(),
        client.v1.statuses.$select(statusId).context.fetch(),
      ])
      return {
        status,
        ancestors: context.ancestors || [],
        descendants: context.descendants || [],
      }
    },

    /**
     * Resolve a remote/local status id for thread viewing.
     * Prefers explicit URL resolve, then tries the raw id on the active account.
     */
    async resolveThreadId(opts: {
      id?: string | null
      url?: string | null
    }): Promise<string | null> {
      if (opts.url) {
        const fromUrl = await this.resolveStatus(opts.url)
        if (fromUrl) return fromUrl
      }
      if (opts.id) {
        try {
          await this.fetchStatus(opts.id)
          return opts.id
        } catch {
          // try resolve by constructing/searching if url missing
        }
      }
      return null
    },

    async muteAccount(accountIdOrAcct: string, opts?: { acct?: string }) {
      const id =
        (opts?.acct ? await this.resolveAccount(opts.acct) : null) || accountIdOrAcct
      await this.getClient().v1.accounts.$select(id).mute()
    },

    async blockAccount(accountIdOrAcct: string, opts?: { acct?: string }) {
      const id =
        (opts?.acct ? await this.resolveAccount(opts.acct) : null) || accountIdOrAcct
      await this.getClient().v1.accounts.$select(id).block()
    },

    async reportStatus(
      statusId: string,
      accountId: string,
      comment?: string,
      opts?: { statusUrl?: string; acct?: string },
    ) {
      let localStatusId = statusId
      let localAccountId = accountId

      if (opts?.statusUrl) {
        const resolved = await this.resolveStatus(opts.statusUrl)
        if (resolved) localStatusId = resolved
      }
      if (opts?.acct) {
        const resolvedAcct = await this.resolveAccount(opts.acct)
        if (resolvedAcct) localAccountId = resolvedAcct
      }

      await this.getClient().v1.reports.create({
        accountId: localAccountId,
        statusIds: [localStatusId],
        comment: comment || '',
      })
    },
  },
})

/** @deprecated Use useStatusStore — kept for transitional imports */
export const useTimelineStore = useStatusStore
