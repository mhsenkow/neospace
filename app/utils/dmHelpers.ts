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
