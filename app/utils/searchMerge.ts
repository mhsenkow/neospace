/**
 * Canonical merge helpers for multi-server Explore search.
 * Prefer the active / preferred server's copy so local snowflake IDs stay usable.
 */

import type { mastodon } from 'masto'
import { dedupeStatusesByIdentity } from '~/utils/statusIdentity'
import { hostOf } from '~/utils/federation'

export type SourcedAccount = mastodon.v1.Account & { _sourceUrl?: string | null }

export type SourcedStatus = mastodon.v1.Status & {
  _instanceUrl?: string
  _instanceId?: string
}

/** Full `user@host` used as the cross-server account identity key */
export function accountCanonicalKey(
  account: Pick<mastodon.v1.Account, 'acct' | 'username' | 'url'>,
  sourceHost?: string | null,
): string {
  const raw = (account.acct || account.username || '').replace(/^@/, '').trim()
  if (!raw) return ''
  if (raw.includes('@')) return raw.toLowerCase()
  const fromSource = (sourceHost || '').replace(/^@/, '').trim().toLowerCase()
  if (fromSource) return `${raw}@${fromSource}`.toLowerCase()
  const fromUrl = hostOf(account.url)
  if (fromUrl) return `${raw}@${fromUrl}`.toLowerCase()
  return raw.toLowerCase()
}

/** Prefer accounts that already live on the preferred host (active account). */
export function mergeAccountsByCanonical(
  batches: Array<{ accounts: SourcedAccount[]; sourceUrl: string; prefer?: boolean }>,
  preferredHost?: string | null,
): SourcedAccount[] {
  const prefer = (preferredHost || '').toLowerCase()
  const byAcct = new Map<string, SourcedAccount>()

  // Preferred batches first so their local IDs win ties
  const ordered = [
    ...batches.filter((b) => b.prefer),
    ...batches.filter((b) => !b.prefer),
  ]

  for (const batch of ordered) {
    const host = hostOf(batch.sourceUrl) || ''
    for (const account of batch.accounts) {
      const key = accountCanonicalKey(account, host)
      if (!key) continue
      const tagged: SourcedAccount = {
        ...account,
        _sourceUrl: account._sourceUrl || batch.sourceUrl,
      }
      const existing = byAcct.get(key)
      if (!existing) {
        byAcct.set(key, tagged)
        continue
      }
      // Keep preferred-host copy; otherwise keep first
      const existingHost = hostOf(existing._sourceUrl || '') || ''
      const taggedHost = host
      if (prefer && taggedHost === prefer && existingHost !== prefer) {
        byAcct.set(key, tagged)
      }
    }
  }
  return [...byAcct.values()]
}

export function mergeHashtagsByName(batches: mastodon.v1.Tag[][]): mastodon.v1.Tag[] {
  const byName = new Map<string, mastodon.v1.Tag>()
  for (const list of batches) {
    for (const tag of list) {
      const key = tag.name.toLowerCase()
      const existing = byName.get(key)
      if (!existing) {
        byName.set(key, tag)
        continue
      }
      // Merge 7-day history when both have it (prefer longer / denser sparkline)
      const a = existing.history || []
      const b = tag.history || []
      if (b.length > a.length) {
        byName.set(key, { ...existing, history: b, following: existing.following ?? tag.following })
      } else if (!a.length && b.length) {
        byName.set(key, { ...existing, history: b })
      } else if (existing.following == null && tag.following != null) {
        byName.set(key, { ...existing, following: tag.following })
      }
    }
  }
  return [...byName.values()]
}

export function mergeStatusesByIdentity(batches: SourcedStatus[][]): SourcedStatus[] {
  return dedupeStatusesByIdentity(batches.flat()) as SourcedStatus[]
}
