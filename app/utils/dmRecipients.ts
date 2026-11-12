/**
 * Pure helpers for the new-message recipient chips.
 * A Mastodon group DM is a direct-visibility status that mentions each person.
 */

import { normalizeRecipientAccts } from './dmHelpers'

/** Mastodon delivers a direct post to each mention — keep the picker small. */
export const DM_RECIPIENT_LIMIT = 8

export type RecipientAddResult<T> = {
  selected: T[]
  added: boolean
  reason?: 'duplicate' | 'limit'
}

export function addDmRecipient<T extends { id: string }>(
  selected: readonly T[],
  account: T,
  limit = DM_RECIPIENT_LIMIT,
): RecipientAddResult<T> {
  if (selected.some((a) => a.id === account.id)) {
    return { selected: [...selected], added: false, reason: 'duplicate' }
  }
  if (selected.length >= limit) {
    return { selected: [...selected], added: false, reason: 'limit' }
  }
  return { selected: [...selected, account], added: true }
}

export function removeDmRecipient<T extends { id: string }>(
  selected: readonly T[],
  id: string,
): T[] {
  return selected.filter((a) => a.id !== id)
}

/** "Message" until a second person is added, then "Message N people". */
export function dmConfirmLabel(count: number): string {
  if (count > 1) return `Message ${count} people`
  return 'Message'
}

export function recipientLabel(account: {
  displayName?: string | null
  username?: string | null
  acct?: string | null
}): string {
  return (
    (account.displayName || '').trim() ||
    (account.username || '').trim() ||
    (account.acct || '').trim() ||
    'person'
  )
}

export function recipientRemoveLabel(account: {
  displayName?: string | null
  username?: string | null
  acct?: string | null
}): string {
  return `Remove ${recipientLabel(account)}`
}

export type GroupDirectCompose = {
  pickRecipient: false
  visibility: 'direct'
  title: string
  placeholder: string
  /** Visible addressing, same shape as a 1:1 (`@alice @bob `). */
  initialText: string
  /**
   * Added again on send if a mention is deleted from the field.
   * Accts without "@", as the posting server reports them.
   */
  mentionAccts: string[]
}

/**
 * Payload for `composeSheet.show()` — two or more people.
 * Returns null when fewer than two real accts remain (caller keeps the 1:1 path).
 */
export function groupDirectCompose(
  accounts: readonly { acct?: string | null }[],
): GroupDirectCompose | null {
  const mentionAccts = normalizeRecipientAccts(accounts.map((a) => a.acct)).slice(
    0,
    DM_RECIPIENT_LIMIT,
  )
  if (mentionAccts.length < 2) return null
  return {
    pickRecipient: false,
    visibility: 'direct',
    title: 'New message',
    placeholder: 'Write a private message…',
    initialText: `${mentionAccts.map((acct) => `@${acct}`).join(' ')} `,
    mentionAccts,
  }
}
