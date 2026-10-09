/**
 * Cross-server helpers. Every Mastodon server keeps its own copy of a post
 * under its own id, and you can only act (like, boost, reply, follow) through
 * the server your account lives on — so a post seen on another server must be
 * imported ("resolved") onto yours first. These helpers pick what to resolve,
 * explain why it failed, and offer the escape hatch when it can't.
 */

import { httpStatusFrom } from '~/utils/friendlyError'

export type FederationFailure =
  /** Your server looked and couldn't get it (private, deleted, blocked, or authorized-fetch refused) */
  | 'unreachable'
  /** Your server says you may not (suspended / limited server, or the post is followers-only) */
  | 'forbidden'
  /** Too many requests — try again in a moment */
  | 'rate-limited'
  /** The remote server was slow; a retry often works */
  | 'timeout'
  /** No network */
  | 'offline'
  | 'unknown'

export function classifyFederationError(err: unknown): FederationFailure {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  const status = httpStatusFrom(err)
  if (status === 429) return 'rate-limited'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404 || status === 410 || status === 422) return 'unreachable'
  if (status && status >= 500) return 'timeout'
  const msg = err instanceof Error ? err.message : String(err ?? '')
  if (/timeout|timed out|aborted/i.test(msg)) return 'timeout'
  if (/failed to fetch|network/i.test(msg)) return 'offline'
  return 'unknown'
}

/** Worth an automatic retry? (slow remote, brief rate limit) */
export const isTransient = (f: FederationFailure) => f === 'timeout' || f === 'rate-limited' || f === 'unknown'

const VERB = { like: 'like', repost: 'repost', bookmark: 'bookmark', reply: 'reply to', follow: 'follow' } as const
export type FederationAction = keyof typeof VERB

/** Plain-language reason, naming the servers involved */
export function federationMessage(
  failure: FederationFailure,
  action: FederationAction,
  opts: { home?: string | null; origin?: string | null } = {},
): string {
  const home = opts.home || 'your server'
  const origin = opts.origin || 'its server'
  const verb = VERB[action]
  switch (failure) {
    case 'unreachable':
      return `Can’t ${verb} this from ${home}: it couldn’t fetch the post from ${origin}. It may be private, deleted, or one server blocks the other.`
    case 'forbidden':
      return `${home} won’t let this account ${verb} that post — it may be followers-only, or ${origin} is limited there.`
    case 'rate-limited':
      return `${home} is rate-limiting requests — try again in a minute.`
    case 'timeout':
      return `${origin} was slow to answer ${home}. Trying again usually works.`
    case 'offline':
      return 'You’re offline.'
    default:
      return `Couldn’t ${verb} this post from ${home}.`
  }
}

/**
 * Mastodon's remote-interaction page on *your* server: it fetches the post
 * server-side and opens it in your own web UI, ready to like / boost / reply.
 */
export function authorizeInteractionUrl(homeUrl: string, uri: string): string {
  return `${homeUrl.replace(/\/+$/, '')}/authorize_interaction?uri=${encodeURIComponent(uri)}`
}

/**
 * What to hand your server's resolver, best first: the ActivityPub id (what
 * federation keys on), then the public page URL (some non-Mastodon software
 * only resolves one of the two). Deduped, http(s) only.
 */
export function resolveCandidates(...urls: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const u of urls) {
    const t = (u || '').trim()
    if (!t || !/^https?:\/\//i.test(t) || out.includes(t)) continue
    out.push(t)
  }
  return out
}

export const hostOf = (url?: string | null): string => {
  try {
    return url ? new URL(url).hostname.toLowerCase() : ''
  } catch {
    return ''
  }
}
