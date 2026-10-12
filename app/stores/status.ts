/**
 * NeoSpace Status Actions Store
 *
 * Posting and account/status actions against the active Mastodon account.
 * Timeline fetching lives in TimelineColumn (per-column state).
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import {
  activeClient,
  activeCredentials,
  clientFor,
  credentialsFor,
  publicClient,
} from '~/composables/useMasto'
import { hostnameOf } from '~/utils/instances'
import { DEFAULT_POLL_LIMITS, type PollLimits } from '~/utils/instanceInfo'
import { mergeThreadBranches } from '~/utils/threadMerge'
import { classifyStatusSourceError, type StatusSourceOutcome } from '~/utils/redraft'
import {
  parseMediaId,
  postFormWithProgress,
  UploadCancelledError,
  UploadProtocolError,
} from '~/utils/mediaUpload'
import {
  accountsMatch,
  classifyFederationError,
  hostOf,
  isTransient,
  resolveCandidates,
  type FederationFailure,
} from '~/utils/federation'
import { logWarn } from '~/utils/log'

/** Per-account LRU for resolve=true status lookups (thread poll / actions). */
const RESOLVE_CACHE_MAX = 64
const resolveStatusCache = new Map<string, string>()

/** Upload transfer + server processing share this deadline (processing alone is capped lower) */
export const MEDIA_TOTAL_BUDGET_MS = 90_000
export const MEDIA_PROCESSING_BUDGET_MS = 45_000

export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 4
/** Mastodon floor is 5 minutes; most servers cap at 30 days */
export const POLL_MIN_SECONDS = 5 * 60
export const POLL_MAX_SECONDS = 30 * 24 * 60 * 60

/** Trim, drop blanks and enforce 2–N distinct options (server limits) + a sane duration */
export function normalizePoll(
  poll:
    | { options: string[]; expiresIn: number; multiple?: boolean; hideTotals?: boolean }
    | undefined,
  limits: PollLimits = DEFAULT_POLL_LIMITS,
): mastodon.rest.v1.CreateStatusPollParam | undefined {
  if (!poll) return undefined
  const options = poll.options.map((o) => o.trim()).filter(Boolean)
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    throw new Error('Poll options must be different')
  }
  if (options.length < POLL_MIN_OPTIONS) {
    throw new Error(`A poll needs at least ${POLL_MIN_OPTIONS} options`)
  }
  if (options.length > limits.maxOptions) {
    throw new Error(`A poll can have at most ${limits.maxOptions} options`)
  }
  if (options.some((o) => [...o].length > limits.maxCharactersPerOption)) {
    throw new Error(`Poll options can be at most ${limits.maxCharactersPerOption} characters`)
  }
  const expiresIn = Math.round(poll.expiresIn)
  if (
    !Number.isFinite(expiresIn) ||
    expiresIn < limits.minExpiration ||
    expiresIn > limits.maxExpiration
  ) {
    throw new Error(
      limits.minExpiration === POLL_MIN_SECONDS && limits.maxExpiration === POLL_MAX_SECONDS
        ? 'Pick a poll length between 5 minutes and 30 days'
        : 'Pick a poll length this server allows',
    )
  }
  return {
    options,
    expiresIn,
    ...(poll.multiple ? { multiple: true } : {}),
    ...(poll.hideTotals ? { hideTotals: true } : {}),
  }
}

/** Upload result — `processing` means the server hasn't finished (no `url` yet), so it can't be posted */
export type UploadedMedia = mastodon.v1.MediaAttachment & { processing?: boolean }

/** Outcome of polling a media attachment the server is still working on */
export type MediaProcessingOutcome =
  | { state: 'ready'; data: Record<string, unknown> }
  /** Budget expired or the poll failed — the id is valid, check again later */
  | { state: 'processing' }
  /** Server has no GET /api/v1/media/:id — nothing to wait for */
  | { state: 'unsupported' }

/** Upper bound on scheduled-queue pages fetched per load (40 each) */
const SCHEDULED_MAX_PAGES = 10

/** Consecutive transient poll failures tolerated before giving the attachment back as `processing` */
const MEDIA_POLL_MAX_FAILURES = 3

/** Retry-After as milliseconds (delta-seconds or HTTP date); 0 when absent/invalid, capped at 10s */
export function parseRetryAfterMs(value: string | null | undefined): number {
  if (!value) return 0
  const secs = Number(value)
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(value) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 10_000) : 0
}

/** Normalize a snake_case Mastodon media payload to the shape compose expects */
function normalizeMedia(id: string, raw: Record<string, unknown>, processing: boolean): UploadedMedia {
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
    ...(processing ? { processing: true } : {}),
  } as UploadedMedia
}

interface StatusState {
  error: string | null
  /** Bumped whenever a post is scheduled so an open queue can refresh itself */
  scheduledRevision: number
}

export const useStatusStore = defineStore('status', {
  state: (): StatusState => ({
    error: null,
    scheduledRevision: 0,
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
      const poll = normalizePoll(options.poll, useInstancesStore().composePollLimits)
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
        const created = await client.v1.statuses.create(scheduled, {
          requestInit: { headers: { 'Idempotency-Key': idempotencyKey } },
        })
        this.scheduledRevision += 1
        return created
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
     * Still-processing media come back with `processing: true` (never promoted to ready).
     * `opts.accountId` pins the upload to the account that owns the attachment.
     */
    async uploadMedia(
      file: Blob,
      description?: string,
      opts?: {
        signal?: AbortSignal
        /** Transfer-only budget (bytes on the wire) */
        timeoutMs?: number
        /** Upload + server processing together; processing only gets what transfer left */
        totalTimeoutMs?: number
        /** Owning account — defaults to the one postStatus() will use */
        accountId?: string
        /** 0..1, or null when unknown */
        onProgress?: (fraction: number | null) => void
        onPhase?: (phase: 'uploading' | 'processing') => void
      },
    ): Promise<UploadedMedia> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      // Same account postStatus() will use (honors the read-account override)
      const creds = opts?.accountId ? credentialsFor(opts.accountId) : activeCredentials()

      const named =
        file instanceof File
          ? file
          : new File([file], 'upload.bin', { type: file.type || 'application/octet-stream' })

      const form = new FormData()
      form.append('file', named)
      if (description) form.append('description', description)

      const authHeaders = { Authorization: `Bearer ${creds.accessToken}` }
      // One deadline for transfer + processing; a transfer timeout is an UploadTimeoutError,
      // a processing timeout leaves a retryable `processing` attachment
      const deadline = Date.now() + (opts?.totalTimeoutMs ?? MEDIA_TOTAL_BUDGET_MS)
      opts?.onPhase?.('uploading')
      const {
        status,
        body: raw,
        malformed,
      } = await postFormWithProgress(`${creds.url}/api/v2/media`, form, {
        headers: authHeaders,
        signal: opts?.signal,
        timeoutMs: Math.min(opts?.timeoutMs ?? 25_000, Math.max(1_000, deadline - Date.now())),
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
      // A 2xx that isn't a media object (HTML page, array, null) is a protocol fault
      if (malformed) throw new UploadProtocolError()
      const id = parseMediaId(raw.id)
      if (!id) throw new UploadProtocolError('Upload failed — the server returned no valid media id')

      let finalRaw = raw
      let processing = false
      // 202 = accepted, still processing server-side (url is null until done)
      if (status === 202) {
        opts?.onPhase?.('processing')
        const outcome = await this.waitForMediaProcessing(
          id,
          creds,
          opts?.signal,
          Math.min(MEDIA_PROCESSING_BUDGET_MS, Math.max(0, deadline - Date.now())),
        )
        if (outcome.state === 'ready') finalRaw = outcome.data
        else processing = outcome.state === 'processing'
      }

      return normalizeMedia(id, finalRaw, processing)
    },

    /** Check an already-uploaded, still-processing attachment again (no re-upload) */
    async resumeMediaProcessing(
      id: string,
      opts?: { signal?: AbortSignal; accountId?: string },
    ): Promise<UploadedMedia> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      const creds = opts?.accountId ? credentialsFor(opts.accountId) : activeCredentials()
      const outcome = await this.waitForMediaProcessing(id, creds, opts?.signal)
      return outcome.state === 'ready'
        ? normalizeMedia(id, outcome.data, false)
        : normalizeMedia(id, {}, outcome.state === 'processing')
    },

    /**
     * Poll until the server finishes processing (200 with a url). Bounded:
     * budget expiry or a failed poll is `processing` (id stays valid, not ready);
     * a server without the poll endpoint is `unsupported` (id alone is all we have).
     */
    async waitForMediaProcessing(
      id: string,
      creds: { url: string; accessToken: string },
      signal?: AbortSignal,
      budgetMs = MEDIA_PROCESSING_BUDGET_MS,
    ): Promise<MediaProcessingOutcome> {
      const started = Date.now()
      let delay = 700
      let failures = 0
      while (Date.now() - started < budgetMs) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(t)
            reject(new UploadCancelledError())
          }
          // Drop the abort listener once the delay elapses — `once` only removes it on abort
          const t = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          }, delay)
          signal?.addEventListener('abort', onAbort, { once: true })
        })
        if (signal?.aborted) throw new UploadCancelledError()
        const poll = new AbortController()
        const onAbort = () => poll.abort()
        signal?.addEventListener('abort', onAbort, { once: true })
        const pollTimer = setTimeout(() => poll.abort(), 10_000)
        let transient = false
        let retryAfterMs = 0
        try {
          const res = await fetch(`${creds.url}/api/v1/media/${encodeURIComponent(id)}`, {
            headers: { Authorization: `Bearer ${creds.accessToken}` },
            signal: poll.signal,
          })
          if (res.status === 200) {
            failures = 0
            const data = (await res.json().catch(() => null)) as Record<string, unknown> | null
            if (data && data.url) return { state: 'ready', data }
          } else if (res.status === 206) {
            failures = 0
          } else if (res.status === 404 || res.status === 501) {
            return { state: 'unsupported' }
          } else if (res.status === 429 || res.status >= 500) {
            transient = true
            retryAfterMs = parseRetryAfterMs(res.headers.get('Retry-After'))
          } else {
            return { state: 'processing' } // other failure — keep the id, retry later
          }
        } catch {
          if (signal?.aborted) throw new UploadCancelledError()
          transient = true // network blip / poll timeout — back off, bounded below
        } finally {
          clearTimeout(pollTimer)
          signal?.removeEventListener('abort', onAbort)
        }
        if (transient) {
          failures += 1
          if (failures >= MEDIA_POLL_MAX_FAILURES) return { state: 'processing' }
          delay = Math.min(Math.max(delay * 2, retryAfterMs), 10_000)
          // Never sleep past the budget
          if (Date.now() - started + delay >= budgetMs) return { state: 'processing' }
        } else {
          delay = Math.min(delay * 1.5, 3000)
        }
      }
      return { state: 'processing' }
    },

    /**
     * Scheduled posts for one account (Mastodon /api/v1/scheduled_statuses).
     * Requests are bound to `accountId` (default: active posting account) so a
     * queue never mixes accounts. Throws on unsupported servers — callers use
     * `isScheduledUnsupported(err)` to hide the UI.
     */
    async listScheduledStatuses(accountId?: string): Promise<mastodon.v1.ScheduledStatus[]> {
      const client = this.scheduledClient(accountId)
      // Follow Link cursors so accounts with more than one page (40) can reach every item
      const all: mastodon.v1.ScheduledStatus[] = []
      const seen = new Set<string>()
      let pages = 0
      try {
        for await (const page of client.v1.scheduledStatuses.list({ limit: 40 })) {
          pages += 1
          for (const item of Array.isArray(page) ? page : []) {
            if (seen.has(item.id)) continue
            seen.add(item.id)
            all.push(item)
          }
          if (pages >= SCHEDULED_MAX_PAGES) break
        }
      } catch (e) {
        // A later page failing shouldn't hide what we already have; the first page must succeed
        if (pages === 0) throw e
      }
      return all.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
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

    /**
     * Credentials of one specific signed-in account — never "whoever is active now".
     * Destructive actions are bound to the account captured when the user confirmed.
     */
    credentialsForAccount(accountId: string): { url: string; accessToken: string } {
      const instances = useInstancesStore()
      const account = instances.instances.find((i) => i.id === accountId)
      if (!account?.url || !account.accessToken) {
        throw new Error('That account is no longer signed in')
      }
      return { url: account.url.replace(/\/+$/, ''), accessToken: account.accessToken }
    },

    /** Delete a status as `accountId` (the account that owned it when confirmed). */
    async deleteStatus(
      statusId: string,
      accountId: string,
    ): Promise<{ text: string | null; spoilerText: string | null }> {
      const creds = this.credentialsForAccount(accountId)
      const res = await fetch(
        `${creds.url}/api/v1/statuses/${encodeURIComponent(statusId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${creds.accessToken}` },
        },
      )
      if (!res.ok) {
        // `status` lets callers tell "server refused" from "never got an answer"
        throw Object.assign(new Error(`Couldn't delete post (${res.status})`), { status: res.status })
      }
      const raw = await res.json().catch(() => ({} as Record<string, unknown>))
      return {
        text: typeof raw.text === 'string' ? raw.text : null,
        spoilerText: typeof raw.spoiler_text === 'string' ? raw.spoiler_text : null,
      }
    },

    /**
     * Plain-text source of your own post (Mastodon ≥ 3.5), as a typed outcome:
     * `unsupported` (no /source route) is the only failure callers may fall back
     * from — `network` / `auth` / `unknown` mean the post was never read.
     */
    async fetchStatusSource(statusId: string, accountId: string): Promise<StatusSourceOutcome> {
      this.credentialsForAccount(accountId) // throws when the account is gone
      try {
        const src = await clientFor(accountId).v1.statuses.$select(statusId).source.fetch()
        return { ok: true, text: src.text ?? '', spoilerText: src.spoilerText ?? '' }
      } catch (error) {
        return { ok: false, reason: classifyStatusSourceError(error), error }
      }
    },

    /** Pin one of your public / unlisted posts to your profile */
    async pinStatus(statusId: string, accountId: string): Promise<mastodon.v1.Status> {
      this.credentialsForAccount(accountId)
      return await clientFor(accountId).v1.statuses.$select(statusId).pin()
    },

    async unpinStatus(statusId: string, accountId: string): Promise<mastodon.v1.Status> {
      this.credentialsForAccount(accountId)
      return await clientFor(accountId).v1.statuses.$select(statusId).unpin()
    },

    /** Cast a vote (indexes into poll.options) — returns the updated poll */
    async votePoll(pollId: string, choices: number[]): Promise<mastodon.v1.Poll> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      if (!choices.length) throw new Error('Pick an option to vote')
      return await this.getClient().v1.polls.$select(pollId).votes.create({ choices })
    },

    /**
     * Update alt text after upload (Mastodon PUT /api/v1/media/:id).
     * Pass the uploading account — media ids only exist on that account's server.
     */
    async updateMediaDescription(
      mediaId: string,
      description: string,
      accountId?: string,
    ): Promise<void> {
      const instances = useInstancesStore()
      if (!instances.isAuthenticated) throw new Error('Not authenticated')
      const creds = accountId ? credentialsFor(accountId) : activeCredentials()
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
      if (!id && failure) logWarn('Failed to resolve status:', failure, statusUrl)
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

      // Last resort: the raw id exists on the active account AND is the same post.
      // A foreign id can collide with an unrelated local status — fail closed without
      // a matching ActivityPub uri.
      if (id && opts.uri) {
        try {
          const fetched = await this.fetchStatus(id)
          if (fetched?.uri === opts.uri) return id
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
        logWarn('Failed to resolve account:', e)
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
      // Tag the serving host so own-post actions can prove these ids belong to it
      let origin = ''
      try {
        origin = activeCredentials().url
      } catch {
        /* guest read — no acting server */
      }
      const tag = <T extends mastodon.v1.Status>(s: T): T =>
        origin ? ({ ...s, _instanceUrl: origin } as T) : s
      let ancestors = (context.ancestors || []).map(tag)
      let descendants = (context.descendants || []).map(tag)

      // Group DMs: the opened message's context is only its own parent chain, so a
      // second reply to the same parent is invisible. The root's context has them all.
      const root = ancestors[0]
      if (status.visibility === 'direct' && root) {
        try {
          const rootContext = await client.v1.statuses.$select(root.id).context.fetch()
          const merged = mergeThreadBranches(tag(status), {
            root,
            rootDescendants: (rootContext.descendants || []).map(tag),
            ancestors,
            descendants,
          })
          ancestors = merged.ancestors
          descendants = merged.descendants
        } catch (e) {
          // Keep the focus context we already have
          logWarn('Couldn’t load the full conversation:', e)
        }
      }
      return { status: tag(status), ancestors, descendants }
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
