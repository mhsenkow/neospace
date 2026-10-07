/**
 * NeoSpace Status Actions Store
 *
 * Posting and account/status actions against the active Mastodon account.
 * Timeline fetching lives in TimelineColumn (per-column state).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient, publicClient } from '~/composables/useMasto'
import { hostnameOf } from '~/utils/instances'

/** Per-account LRU for resolve=true status lookups (thread poll / actions). */
const RESOLVE_CACHE_MAX = 64
const resolveStatusCache = new Map<string, string | null>()

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

    /** Prefer authenticated client; fall back to public browsing client */
    getReadClient(): mastodon.rest.Client {
      try {
        return activeClient()
      } catch {
        return publicClient()
      }
    },

    async postStatus(
      content: string,
      options: {
        visibility?: 'public' | 'unlisted' | 'private' | 'direct'
        spoilerText?: string
        mediaIds?: string[]
        inReplyToId?: string
        sensitive?: boolean
        language?: string
        quotedStatusId?: string
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
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `neo-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const params: Record<string, unknown> = {
        status: text || undefined,
        visibility: options.visibility || 'public',
        spoilerText: options.spoilerText,
        inReplyToId: options.inReplyToId,
        sensitive: options.sensitive,
      }
      if (mediaIds.length) params.mediaIds = mediaIds
      if (options.language) params.language = options.language
      if (options.quotedStatusId) params.quotedStatusId = options.quotedStatusId
      return await client.v1.statuses.create(params as any, {
        headers: { 'Idempotency-Key': idempotencyKey },
      } as any)
    },

    /**
     * Upload an image/video for a status.
     * Uses raw fetch — masto's media.create polls /api/v1/media until `url` is
     * set, which routinely hangs 30–60s on mastodon.social even with skipPolling
     * (and older cached bundles ignored it). The media id from v2 is enough to post.
     */
    async uploadMedia(
      file: Blob,
      description?: string,
      opts?: { signal?: AbortSignal; timeoutMs?: number },
    ): Promise<mastodon.v1.MediaAttachment> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated || !instances.instanceUrl || !instances.accessToken) {
        throw new Error('Not authenticated')
      }

      const named =
        file instanceof File
          ? file
          : new File([file], 'upload.bin', { type: file.type || 'application/octet-stream' })

      const form = new FormData()
      form.append('file', named)
      if (description) form.append('description', description)

      const controller = new AbortController()
      const onExternalAbort = () => controller.abort()
      opts?.signal?.addEventListener('abort', onExternalAbort, { once: true })
      const timeoutMs = opts?.timeoutMs ?? 25_000
      const timer = window.setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(`${instances.instanceUrl}/api/v2/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${instances.accessToken}` },
          body: form,
          signal: controller.signal,
        })
        const raw = await res.json().catch(() => ({} as Record<string, unknown>))
        if (!res.ok) {
          const msg =
            (typeof raw.error === 'string' && raw.error) ||
            (typeof raw.error_description === 'string' && raw.error_description) ||
            `Upload failed (${res.status})`
          throw new Error(msg)
        }
        const id = String(raw.id || '')
        if (!id) throw new Error('Upload failed — no media id returned')

        // Normalize snake_case Mastodon payload to the shape compose expects
        return {
          id,
          type: (raw.type as mastodon.v1.MediaAttachment['type']) || 'image',
          url: (raw.url as string) || null,
          previewUrl: (raw.preview_url as string) || (raw.previewUrl as string) || null,
          remoteUrl: (raw.remote_url as string) || null,
          previewRemoteUrl: (raw.preview_remote_url as string) || null,
          textUrl: (raw.text_url as string) || null,
          description: (raw.description as string) || null,
          blurhash: (raw.blurhash as string) || null,
          meta: (raw.meta as mastodon.v1.MediaAttachment['meta']) || undefined,
        } as mastodon.v1.MediaAttachment
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          throw new Error('Upload timed out — tap the image to retry')
        }
        throw e
      } finally {
        opts?.signal?.removeEventListener('abort', onExternalAbort)
        window.clearTimeout(timer)
      }
    },

    async deleteStatus(statusId: string): Promise<void> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated || !instances.instanceUrl || !instances.accessToken) {
        throw new Error('Not authenticated')
      }
      const res = await fetch(
        `${instances.instanceUrl}/api/v1/statuses/${encodeURIComponent(statusId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${instances.accessToken}` },
        },
      )
      if (!res.ok) {
        throw new Error(`Couldn't delete message (${res.status})`)
      }
    },

    /** Update alt text after upload (Mastodon PUT /api/v1/media/:id). */
    async updateMediaDescription(mediaId: string, description: string): Promise<void> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated || !instances.instanceUrl || !instances.accessToken) {
        throw new Error('Not authenticated')
      }
      const form = new FormData()
      form.append('description', description)
      const res = await fetch(`${instances.instanceUrl}/api/v1/media/${encodeURIComponent(mediaId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${instances.accessToken}` },
        body: form,
      })
      if (!res.ok) {
        throw new Error(`Couldn’t save alt text (${res.status})`)
      }
    },

    async resolveStatus(statusUrl: string): Promise<string | null> {
      const instances = useInstancesStore()
      const cacheKey = `${instances.activeAccountId || 'anon'}|${statusUrl}`
      const cached = resolveStatusCache.get(cacheKey)
      if (cached !== undefined) return cached

      try {
        const client = this.getReadClient()
        const results = await client.v2.search.fetch({
          q: statusUrl,
          resolve: true,
          type: 'statuses',
          limit: 1,
        })
        const id = results.statuses[0]?.id ?? null
        resolveStatusCache.set(cacheKey, id)
        if (resolveStatusCache.size > RESOLVE_CACHE_MAX) {
          const oldest = resolveStatusCache.keys().next().value
          if (oldest) resolveStatusCache.delete(oldest)
        }
        return id
      } catch (e) {
        console.warn('Failed to resolve status:', e)
        return null
      }
    },

    /**
     * Resolve a status id that is valid for the *active* posting account.
     * Multi-account / merged feeds often carry foreign ids that 404 on create.
     */
    async resolveReplyId(opts: {
      id?: string | null
      url?: string | null
      /** Origin instance URL the status was fetched from (e.g. _instanceUrl) */
      sourceInstanceUrl?: string | null
    }): Promise<string | null> {
      const instances = useInstancesStore()
      const activeUrl = instances.instanceUrl
      if (!activeUrl) return null

      const activeHost = hostnameOf(activeUrl)
      const id = opts.id?.trim() || null
      const url = opts.url?.trim() || null
      const sourceHost = opts.sourceInstanceUrl
        ? hostnameOf(opts.sourceInstanceUrl)
        : ''

      // Same server as the posting account — raw id is already local
      if (id && sourceHost && sourceHost === activeHost) return id
      if (id && url && hostnameOf(url) === activeHost) return id

      if (url) {
        const resolved = await this.resolveStatus(url)
        if (resolved) return resolved
      }

      // Last resort: verify the raw id exists on the active account
      if (id) {
        try {
          await this.fetchStatus(id)
          return id
        } catch {
          /* foreign id */
        }
      }

      return null
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
      return await this.getReadClient().v1.statuses.$select(statusId).fetch()
    },

    async fetchThread(statusId: string): Promise<{
      status: mastodon.v1.Status
      ancestors: mastodon.v1.Status[]
      descendants: mastodon.v1.Status[]
    }> {
      const client = this.getReadClient()
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
      const id = opts?.acct ? await this.resolveAccount(opts.acct) : accountIdOrAcct
      if (!id) throw new Error('Couldn’t find that account on your server')
      await this.getClient().v1.accounts.$select(id).mute()
    },

    async blockAccount(accountIdOrAcct: string, opts?: { acct?: string }) {
      const id = opts?.acct ? await this.resolveAccount(opts.acct) : accountIdOrAcct
      if (!id) throw new Error('Couldn’t find that account on your server')
      await this.getClient().v1.accounts.$select(id).block()
    },

    async reportStatus(
      statusId: string,
      accountId: string,
      comment?: string,
      opts?: {
        statusUrl?: string
        acct?: string
        category?: 'spam' | 'violation' | 'other'
        forward?: boolean
      },
    ) {
      let localStatusId = statusId
      let localAccountId = accountId

      if (opts?.statusUrl) {
        const resolved = await this.resolveStatus(opts.statusUrl)
        if (!resolved) throw new Error('Couldn’t find that post on your server')
        localStatusId = resolved
      }
      if (opts?.acct) {
        const resolvedAcct = await this.resolveAccount(opts.acct)
        if (!resolvedAcct) throw new Error('Couldn’t find that account on your server')
        localAccountId = resolvedAcct
      } else if (!localAccountId) {
        throw new Error('Couldn’t find that account on your server')
      }

      await this.getClient().v1.reports.create({
        accountId: localAccountId,
        statusIds: [localStatusId],
        comment: comment || '',
        category: opts?.category || 'other',
        forward: opts?.forward ?? true,
      } as never)
    },
  },
})

/** @deprecated Use useStatusStore — kept for transitional imports */
export const useTimelineStore = useStatusStore
