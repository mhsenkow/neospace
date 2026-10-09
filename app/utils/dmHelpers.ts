/**
 * Shared DM helpers — open existing chat or start compose.
 */

import type { mastodon } from 'masto'
import { useConversationsStore } from '~/stores/conversations'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { accountHandle } from '~/composables/useAccountSearch'

/** Exact 1:1 DM with this account — never fall back to a group thread */
export function findExactOneToOne<T extends { accounts?: { id: string }[] | null }>(
  conversations: T[],
  accountId: string,
): T | null {
  if (!accountId) return null
  return (
    conversations.find((c) => {
      const ids = (c.accounts || []).map((a) => a.id)
      return ids.length === 1 && ids[0] === accountId
    }) || null
  )
}

export async function openOrComposeDirect(
  account: mastodon.v1.Account,
  router: { push: (to: string) => Promise<unknown> | unknown },
  opts?: {
    onPosted?: (status: mastodon.v1.Status) => void | Promise<void>
  },
) {
  const conversations = useConversationsStore()
  if (!conversations.conversations.length) {
    await conversations.fetchConversations({ quiet: true })
  }
  const existing = conversations.findDirectWith(account.id)
  const statusId = existing?.lastStatus?.id
  if (statusId) {
    if (existing?.unread) await conversations.markRead(existing.id)
    await router.push(`/status/${statusId}`)
    return 'opened' as const
  }

  const composeSheet = useComposeSheetStore()
  composeSheet.show({
    initialText: `${accountHandle(account)} `,
    visibility: 'direct',
    title: 'New message',
    placeholder: 'Write a private message…',
    onPosted: opts?.onPosted,
  })
  return 'compose' as const
}

export function participantLabel(c: mastodon.v1.Conversation): string {
  const names = (c.accounts || [])
    .map((a) => a.displayName || a.username)
    .filter(Boolean)
  if (!names.length) return 'Direct message'
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names[0]} +${names.length - 1}`
}

export function participantAccts(c: mastodon.v1.Conversation): string {
  return (c.accounts || []).map((a) => `@${a.acct}`).join(' ')
}

/** Recipient accts without "@", trimmed, de-duplicated case-insensitively */
export function normalizeRecipientAccts(accts: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of accts) {
    const acct = (raw || '').trim().replace(/^@/, '')
    if (!acct || /\s/.test(acct)) continue
    const key = acct.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(acct)
  }
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Does `text` already mention exactly `@acct`? `@bobby`, `@bob@other.host` and
 * `@bob@host.evil` don't count for `bob` / `bob@host` — Mastodon would deliver
 * those to someone else, and a direct post only reaches mentioned accounts.
 */
export function textMentionsAcct(text: string, acct: string): boolean {
  const handle = acct.trim().replace(/^@/, '')
  if (!handle) return false
  // No lookbehind (older Safari) — pad so the leading guard can match at the start
  return new RegExp(`(?:^|[^\\w=/@])@${escapeRe(handle)}(?![\\w@]|[.-]\\w)`, 'i').test(` ${text}`)
}

/**
 * Body for a direct-visibility post: prepend any recipient the text doesn't
 * already mention. Recipients are accts as the posting account's server
 * reports them ("alice" local, "bob@remote.social" remote).
 */
export function buildDirectBody(text: string, recipientAccts: readonly string[]): string {
  const body = text.trim()
  const missing = normalizeRecipientAccts(recipientAccts).filter((a) => !textMentionsAcct(body, a))
  if (!missing.length) return body
  const prefix = missing.map((a) => `@${a}`).join(' ')
  return body ? `${prefix} ${body}` : prefix
}

/**
 * Plain-text DM preview: drop the leading "@alice @bob" addressing for known
 * participants. Rendered mentions carry only the username ("@bob" for
 * bob@remote.social), so match both forms.
 */
export function stripLeadingMentionText(text: string, accts: readonly string[]): string {
  const handles = new Set<string>()
  for (const acct of normalizeRecipientAccts(accts)) {
    const lower = acct.toLowerCase()
    handles.add(lower)
    handles.add(lower.split('@')[0]!)
  }
  let out = text.trim()
  for (;;) {
    const m = /^@([\w.-]+(?:@[\w.-]+)?)(?=\s|$)/.exec(out)
    if (!m || !handles.has(m[1]!.toLowerCase())) break
    out = out.slice(m[0].length).trimStart()
  }
  return out
}

/** Only http(s) URLs are safe to put in an href/src from server or query data */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

/** Day key for chat separators (local calendar day) */
export function dayKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function daySeparatorLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((startToday.getTime() - startThat.getTime()) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}
