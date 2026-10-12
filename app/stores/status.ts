/**
 * NeoSpace Status Actions Store
 *
 * Posting and account/status actions against the active Mastodon account.
 * Timeline fetching lives in TimelineColumn (per-column state).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { activeClient, activeCredentials, clientFor, publicClient } from '~/composables/useMasto'
import { hostnameOf } from '~/utils/instances'
import { postFormWithProgress, UploadCancelledError } from '~/utils/mediaUpload'
import {
  accountsMatch,
  classifyFederationError,
  hostOf,
  isTransient,
  resolveCandidates,
  type FederationFailure,
} from '~/utils/federation'

/** Per-account LRU for resolve=true status lookups (thread poll / actions). */
const RESOLVE_CACHE_MAX = 64
const resolveStatusCache = new Map<string, string>()

export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 4
/** Mastodon floor is 5 minutes; most servers cap at 30 days */
export const POLL_MIN_SECONDS = 5 * 60
export const POLL_MAX_SECONDS = 30 * 24 * 60 * 60

/** Trim, drop blanks and enforce 2–4 distinct options + a sane duration */
export function normalizePoll(
  poll:
    | { options: string[]; expiresIn: number; multiple?: boolean; hideTotals?: boolean }
    | undefined,
): mastodon.rest.v1.CreateStatusPollParam | undefined {
  if (!poll) return undefined
  const options = poll.options.map((o) => o.trim()).filter(Boolean)
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    throw new Error('Poll options must be different')
  }
  if (options.length < POLL_MIN_OPTIONS) {
    throw new Error(`A poll needs at least ${POLL_MIN_OPTIONS} options`)
  }
  if (options.length > POLL_MAX_OPTIONS) {
    throw new Error(`A poll can have at most ${POLL_MAX_OPTIONS} options`)
  }
  const expiresIn = Math.round(poll.expiresIn)
  if (!Number.isFinite(expiresIn) || expiresIn < POLL_MIN_SECONDS || expiresIn > POLL_MAX_SECONDS) {
    throw new Error('Pick a poll length between 5 minutes and 30 days')
  }
  return {
    options,
    expiresIn,
    ...(poll.multiple ? { multiple: true } : {}),
    ...(poll.hideTotals ? { hideTotals: true } : {}),
  }
}

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
        /** ISO 8601 — must be ≥5 minutes ahead; returns ScheduledStatus */
        scheduledAt?: string
        /** Poll to attach — needs text, can't be combined with media */
        poll?: {
          options: string[]
          /** Seconds the poll stays open */
          expiresIn: number
          multiple?: boolean
          hideTotals?: boolean
        }
      } = {},
    ): Promise<mastodon.v1.Status | mastodon.v1.ScheduledStatus> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) {
        throw new Error('Not authenticated')
      }

      const text = content.trim()
      const mediaIds = options.mediaIds?.filter(Boolean) ?? []
      if (!text && mediaIds.length === 0) {
        throw new Error('Write something or add a photo')
      }

      const scheduledAt = options.scheduledAt?.trim() || undefined
      if (scheduledAt) {
        const when = Date.parse(scheduledAt)
        if (!Number.isFinite(when)) {
          throw new Error('Pick a valid schedule time')
        }
        if (when < Date.now() + 5 * 60 * 1000) {
          throw new Error('Schedule at least 5 minutes from now')
        }
      }

      const client = this.getClient()
      const idempotencyKey =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `neo-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const poll = normalizePoll(options.poll)
      if (poll && mediaIds.length) {
        throw new Error('Polls can’t include photos or video')
      }
      if (poll && !text) {
        throw new Error('Add some text to your poll')
      }
      const base: mastodon.rest.v1.CreateStatusParamsBase = {
        visibility: options.visibility || 'public',
        spoilerText: options.spoilerText,
        inReplyToId: options.inReplyToId,
        sensitive: options.sensitive,
        ...(options.language ? { language: options.language } : {}),
        ...(options.quotedStatusId ? { quotedStatusId: options.quotedStatusId } : {}),
      }
      const params: mastodon.rest.v1.CreateStatusParams = mediaIds.length
        ? { ...base, status: text || undefined, mediaIds }
        : { ...base, status: text, ...(poll ? { poll } : {}) }
      // masto v7 only forwards headers via meta.requestInit
      if (scheduledAt) {
        const scheduled: mastodon.rest.v1.CreateScheduledStatusParams = {
          ...params,
          scheduledAt,
        }
        return await client.v1.statuses.create(scheduled, {
          requestInit: { headers: { 'Idempotency-Key': idempotencyKey } },
        })
      }
      return await client.v1.statuses.create(params, {
        requestInit: { headers: { 'Idempotency-Key': idempotencyKey } },
      })
    },

    /**
     * Upload an image/video for a status.
     * Raw XHR (not masto's media.create, which polls /api/v1/media until `url`
     * is set and routinely hangs 30–60s on mastodon.social). Reports real byte
     * progress when the browser can compute it, then — if the server answers
     * 202 (still transcoding) — polls GET /api/v1/media/:id for a bounded time.
     * Throws UploadCancelledError (caller aborted) / UploadTimeoutError (budget).
     */
    async uploadMedia(
      file: Blob,
      description?: string,
      opts?: {
        signal?: AbortSignal
        timeoutMs?: number
        /** 0..1, or null when unknown */
        onProgress?: (fraction: number | null) => void
        onPhase?: (phase: 'uploading' | 'processing') => void
      },
    ): Promise<mastodon.v1.MediaAttachment> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      // Same account postStatus() will use (honors the read-account override)
      const creds = activeCredentials()

      const named =
        file instanceof File
          ? file
          : new File([file], 'upload.bin', { type: file.type || 'application/octet-stream' })

      const form = new FormData()
      form.append('file', named)
      if (description) form.append('description', description)

      const authHeaders = { Authorization: `Bearer ${creds.accessToken}` }
      opts?.onPhase?.('uploading')
      const { status, body: raw } = await postFormWithProgress(`${creds.url}/api/v2/media`, form, {
        headers: authHeaders,
        signal: opts?.signal,
        timeoutMs: opts?.timeoutMs ?? 25_000,
        onProgress: opts?.onProgress,
        onSent: () => opts?.onPhase?.('processing'),
      })

      if (status < 200 || status >= 300) {
        const msg =
          (typeof raw.error === 'string' && raw.error) ||
          (typeof raw.error_description === 'string' && raw.error_description) ||
          `Upload failed (${status})`
        throw new Error(msg)
      }
      const id = String(raw.id || '')
      if (!id) throw new Error('Upload failed — no media id returned')

      let finalRaw = raw
      // 202 = accepted, still processing server-side (url is null until done)
      if (status === 202) {
        opts?.onPhase?.('processing')
        finalRaw = (await this.waitForMediaProcessing(id, creds, opts?.signal)) ?? raw
      }

      // Normalize snake_case Mastodon payload to the shape compose expects
      return {
        id,
        type: (finalRaw.type as mastodon.v1.MediaAttachment['type']) || 'image',
        url: (finalRaw.url as string) || null,
        previewUrl: (finalRaw.preview_url as string) || (finalRaw.previewUrl as string) || null,
        remoteUrl: (finalRaw.remote_url as string) || null,
        previewRemoteUrl: (finalRaw.preview_remote_url as string) || null,
        textUrl: (finalRaw.text_url as string) || null,
        description: (finalRaw.description as string) || null,
        blurhash: (finalRaw.blurhash as string) || null,
        meta: (finalRaw.meta as mastodon.v1.MediaAttachment['meta']) || undefined,
      } as mastodon.v1.MediaAttachment
    },

    /**
     * Poll until the server finishes processing (200 with a url). Bounded:
     * returns null on timeout / unsupported polling so callers keep the id
     * (previous behavior) instead of blocking forever.
     */
    async waitForMediaProcessing(
      id: string,
      creds: { url: string; accessToken: string },
      signal?: AbortSignal,
      budgetMs = 45_000,
    ): Promise<Record<string, unknown> | null> {
      const started = Date.now()
      let delay = 700
      while (Date.now() - started < budgetMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, delay)
          signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t)
              reject(new UploadCancelledError())
            },
            { once: true },
          )
        })
        if (signal?.aborted) throw new UploadCancelledError()
        const poll = new AbortController()
        const onAbort = () => poll.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        const pollTimer = setTimeout(() => poll.abort(), 10_000)
        try {
          const res = await fetch(`${creds.url}/api/v1/media/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${creds.accessToken}` },
            signal: poll.signal,
          })
          if (res.status === 200) {
            const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
            if (data && data.url) return data
          } else if (res.status !== 206) {
            return null // 404 / 501: can't poll here — id alone is enough to try posting
          }
        } catch {
          if (signal?.aborted) throw new UploadCancelledError()
          return null // network blip / poll timeout — keep the id (previous behavior)
        } finally {
          clearTimeout(pollTimer)
          signal?.removeEventListener('abort', onAbort)
        }
        delay = Math.min(delay * 1.5, 3000)
      }
      return null
    },

    /**
     * Scheduled posts for one account (Mastodon /api/v1/scheduled_statuses).
     * Requests are bound to `accountId` (default: active posting account) so a
     * queue never mixes accounts. Throws on unsupported servers — callers use
     * `isScheduledUnsupported(err)` to hide the UI.
     */
    async listScheduledStatuses(accountId?: string): Promise<mastodon.v1.ScheduledStatus[]> {
      const client = this.scheduledClient(accountId)
      const page = await client.v1.scheduledStatuses.list({ limit: 40 })
      const list = Array.isArray(page) ? page : []
      return [...list].sort(
        (a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt),
      )
    },

    async cancelScheduledStatus(id: string, accountId?: string): Promise<void> {
      await this.scheduledClient(accountId).v1.scheduledStatuses.$select(id).remove()
    },

    /** Reschedule — the server requires at least 5 minutes in the future. */
    async updateScheduledStatus(
      id: string,
      scheduledAt: string,
      accountId?: string,
    ): Promise<mastodon.v1.ScheduledStatus> {
      const when = Date.parse(scheduledAt)
      if (!Number.isFinite(when)) throw new Error('Pick a valid schedule time')
      if (when < Date.now() + 5 * 60 * 1000) {
        throw new Error('Schedule at least 5 minutes from now')
      }
      return await this.scheduledClient(accountId)
        .v1.scheduledStatuses.$select(id)
        .update({ scheduledAt: new Date(when).toISOString() })
    },

    scheduledClient(accountId?: string): mastodon.rest.Client {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      const id = accountId ?? instances.activeAccount?.id
      if (!id) throw new Error('Not authenticated')
      return clientFor(id)
    },

    async deleteStatus(
      statusId: string,
    ): Promise<{ text: string | null; spoilerText: string | null }> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      const creds = activeCredentials()
      const res = await fetch(
        `${creds.url}/api/v1/statuses/${encodeURIComponent(statusId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        },
      )
      if (!res.ok) {
        throw new Error(`Couldn't delete post (${res.status})`)
      }
      const raw = await res.json().catch(() => ({} as Record<string, unknown>))
      return {
        text: typeof raw.text === 'string' ? raw.text : null,
        spoilerText: typeof raw.spoiler_text === 'string' ? raw.spoiler_text : null,
      }
    },

    /** Plain-text source of your own post (Mastodon ≥ 3.5) — null when unsupported */
    async fetchStatusSource(
      statusId: string,
    ): Promise<{ text: string; spoilerText: string } | null> {
      try {
        const src = await this.getClient().v1.statuses.$select(statusId).source.fetch()
        return { text: src.text ?? '', spoilerText: src.spoilerText ?? '' }
      } catch {
        return null
      }
    },

    /** Pin one of your public / unlisted posts to your profile */
    async pinStatus(statusId: string): Promise<mastodon.v1.Status> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      return await this.getClient().v1.statuses.$select(statusId).pin()
    },

    async unpinStatus(statusId: string): Promise<mastodon.v1.Status> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      return await this.getClient().v1.statuses.$select(statusId).unpin()
    },

    /** Cast a vote (indexes into poll.options) — returns the updated poll */
    async votePoll(pollId: string, choices: number[]): Promise<mastodon.v1.Poll> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      if (!choices.length) throw new Error('Pick an option to vote')
      return await this.getClient().v1.polls.$select(pollId).votes.create({ choices })
    },

    /** Update alt text after upload (Mastodon PUT /api/v1/media/:id). */
    async updateMediaDescription(mediaId: string, description: string): Promise<void> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      const creds = activeCredentials()
      const form = new FormData()
      form.append('description', description)
      const res = await fetch(`${creds.url}/api/v1/media/${encodeURIComponent(mediaId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        body: form,
      })
      if (!res.ok) {
        throw new Error(`Couldn’t save alt text (${res.status})`)
      }
    },

    /**
     * Import a post from another server onto the acting account's server and
     * return its local id. Tries each candidate (ActivityPub id, then page
     * URL), retries once when the remote is just slow, and says why it failed.
     */
    async resolveStatusDetailed(
      candidates: string[],
    ): Promise<{ id: string | null; failure: FederationFailure | null }> {
      let failure: FederationFailure | null = null
      for (const url of candidates) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const id = await this.resolveStatusOnce(url)
            if (id) return { id, failure: null }
            failure = 'unreachable'
            break
          } catch (e) {
            failure = classifyFederationError(e)
            if (!isTransient(failure) || attempt === 1) break
            await new Promise((r) => setTimeout(r, 1200))
          }
        }
      }
      return { id: null, failure }
    },

    /** One resolve call; throws on HTTP errors so callers can tell why */
    async resolveStatusOnce(statusUrl: string): Promise<string | null> {
      // Key by the server that will act (read override included), not just the
      // active account id — an id resolved on one server is meaningless on another
      let actingUrl = 'anon'
      try {
        actingUrl = activeCredentials().url
      } catch {
        /* guest */
      }
      const cacheKey = `${actingUrl}|${statusUrl}`
      const cached = resolveStatusCache.get(cacheKey)
      if (cached) {
        resolveStatusCache.delete(cacheKey)
        resolveStatusCache.set(cacheKey, cached)
        return cached
      }
      const results = await this.getReadClient().v2.search.list({
        q: statusUrl,
        resolve: true,
        type: 'statuses',
        limit: 1,
      })
      const id = results.statuses[0]?.id ?? null
      if (id) {
        resolveStatusCache.set(cacheKey, id)
        if (resolveStatusCache.size > RESOLVE_CACHE_MAX) {
          const oldest = resolveStatusCache.keys().next().value
          if (oldest) resolveStatusCache.delete(oldest)
        }
      }
      return id
    },

    async resolveStatus(statusUrl: string): Promise<string | null> {
      const { id, failure } = await this.resolveStatusDetailed([statusUrl])
      if (!id && failure) console.warn('Failed to resolve status:', failure, statusUrl)
      return id
    },

    /**
     * Resolve a status id that is valid for the *active* posting account.
     * Multi-account / merged feeds often carry foreign ids that 404 on create.
     */
    async resolveReplyId(opts: {
      id?: string | null
      url?: string | null
      /** ActivityPub id — resolves more reliably than the page URL */
      uri?: string | null
      /** Origin instance URL the status was fetched from (e.g. _instanceUrl) */
      sourceInstanceUrl?: string | null
    }): Promise<string | null> {
      // The server that will post the reply (read override included)
      let activeUrl = ''
      try {
        activeUrl = activeCredentials().url
      } catch {
        return null
      }

      const activeHost = hostnameOf(activeUrl)
      const id = opts.id?.trim() || null
      const url = opts.url?.trim() || null
      const sourceHost = opts.sourceInstanceUrl
        ? hostnameOf(opts.sourceInstanceUrl)
        : ''

      // Same server as the posting account — raw id is already local
      if (id && sourceHost && sourceHost === activeHost) return id
      if (id && url && hostnameOf(url) === activeHost) return id

      const candidates = resolveCandidates(opts.uri, url)
      if (candidates.length) {
        const { id: resolved } = await this.resolveStatusDetailed(candidates)
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
      const want = acct.replace(/^@/, '').trim()
      if (!want) return null
      try {
        const client = this.getClient()
        let homeHost = ''
        try {
          homeHost = hostOf(activeCredentials().url)
        } catch {
          /* guest / no active account */
        }
        // Prefer lookup when available — returns the exact account or 404
        try {
          const found = await client.v1.accounts.lookup({ acct: want })
          if (found?.id && accountsMatch(want, found.acct, homeHost)) return found.id
        } catch {
          // fall through to search
        }
        // Search is fuzzy — only accept an exact identity match (fail closed)
        const results = await client.v1.accounts.search.list({
          q: want,
          resolve: true,
          limit: 5,
        })
        const exact = results.find((a) => accountsMatch(want, a.acct, homeHost))
        return exact?.id ?? null
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
