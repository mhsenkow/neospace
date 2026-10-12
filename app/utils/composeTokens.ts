/**
 * Compose autocomplete tokens — @mentions, #hashtags and :emoji: at the caret.
 * Pure helpers (no Vue / network) so selection can be verified in unit tests.
 */

import type { mastodon } from 'masto'

export type ComposeTokenKind = 'mention' | 'hashtag' | 'emoji'

export interface ComposeToken {
  kind: ComposeTokenKind
  /** Index of the trigger character (@ # :) */
  start: number
  /** Caret position — the token spans [start, end) */
  end: number
  /** Text after the trigger character */
  query: string
}

export type ComposeSuggestion =
  | { kind: 'mention'; key: string; account: mastodon.v1.Account }
  | { kind: 'hashtag'; key: string; name: string; uses: number | null }
  | { kind: 'emoji'; key: string; shortcode: string; url: string }

export const ALL_TOKEN_KINDS: readonly ComposeTokenKind[] = ['mention', 'hashtag', 'emoji']

/** A trigger only counts at the start of text or after whitespace / opening punctuation */
const OPEN = `[\\s([{“"'‘]`
const PATTERNS: Record<ComposeTokenKind, { re: RegExp; trigger: string }> = {
  mention: { re: new RegExp(`(?:^|${OPEN})@([a-zA-Z0-9_.@/-]*)$`), trigger: '@' },
  hashtag: { re: new RegExp(`(?:^|${OPEN})#([\\p{L}\\p{N}_]+)$`, 'u'), trigger: '#' },
  // ≥2 chars so ":)" / "10:30" / URLs (preceded by a word char) never open the list
  emoji: { re: new RegExp(`(?:^|${OPEN}):([a-zA-Z0-9_+-]{2,})$`), trigger: ':' },
}

/** The token ending at `caret`, if any (only the text before the caret matters). */
export function findComposeToken(
  text: string,
  caret: number,
  kinds: readonly ComposeTokenKind[] = ALL_TOKEN_KINDS,
): ComposeToken | null {
  const end = Math.max(0, Math.min(caret, text.length))
  const before = text.slice(0, end)
  for (const kind of kinds) {
    const m = before.match(PATTERNS[kind].re)
    if (!m) continue
    const query = m[1] ?? ''
    return { kind, start: end - query.length - 1, end, query }
  }
  return null
}

export function sameToken(a: ComposeToken | null, b: ComposeToken | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.start === b.start && a.query === b.query
}

/** Text a suggestion inserts (without the trailing space) */
export function insertionFor(item: ComposeSuggestion): string {
  switch (item.kind) {
    case 'mention':
      return `@${item.account.acct}`
    case 'hashtag':
      return `#${item.name}`
    case 'emoji':
      return `:${item.shortcode}:`
  }
}

/**
 * Replace only [token.start, token.end) — everything before and after the
 * token (including other tokens) is preserved byte-for-byte.
 */
export function applyToken(
  text: string,
  token: ComposeToken,
  insert: string,
): { text: string; caret: number } {
  const before = text.slice(0, token.start)
  const after = text.slice(token.end)
  // Don't stack a second space when one already follows the caret
  const gap = /^\s/.test(after) ? '' : ' '
  const next = `${before}${insert}${gap}${after}`
  return { text: next, caret: before.length + insert.length + 1 }
}

/** Local filter over a (cached) custom-emoji list: prefix matches first. */
export function filterEmojis(
  list: readonly mastodon.v1.CustomEmoji[],
  query: string,
  limit = 8,
): ComposeSuggestion[] {
  const q = query.toLowerCase()
  if (!q) return []
  const prefix: mastodon.v1.CustomEmoji[] = []
  const infix: mastodon.v1.CustomEmoji[] = []
  for (const e of list) {
    if (e.visibleInPicker === false) continue
    const name = e.shortcode.toLowerCase()
    if (name.startsWith(q)) prefix.push(e)
    else if (name.includes(q)) infix.push(e)
  }
  return [...prefix, ...infix].slice(0, limit).map((e) => ({
    kind: 'emoji' as const,
    key: e.shortcode,
    shortcode: e.shortcode,
    url: e.staticUrl || e.url,
  }))
}

/**
 * Small TTL cache keyed per instance; concurrent callers share one in-flight
 * promise and failures are never cached.
 */
export function createKeyedCache<T>(ttlMs: number, max = 8) {
  const entries = new Map<string, { at: number; promise: Promise<T> }>()
  return {
    get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
      const hit = entries.get(key)
      if (hit && now - hit.at < ttlMs) return hit.promise
      const promise = load().catch((e) => {
        if (entries.get(key)?.promise === promise) entries.delete(key)
        throw e
      })
      entries.delete(key)
      entries.set(key, { at: now, promise })
      while (entries.size > max) {
        const oldest = entries.keys().next().value
        if (oldest === undefined) break
        entries.delete(oldest)
      }
      return promise
    },
    clear: () => entries.clear(),
  }
}
