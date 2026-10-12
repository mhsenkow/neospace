import { describe, expect, it, vi } from 'vitest'
import { launchAccountId } from '../app/stores/instances'
import { supportsLegalReports } from '../app/utils/serverCapabilities'
import { notificationViewLabel } from '../app/utils/notifHelpers'
import { earlierPostMissing } from '../app/utils/threadMerge'
import { canApplyUpdateNow } from '../app/utils/pwaUpdate'
import { buildZip, crc32 } from '../app/utils/zip'
import { findThreadConversation, threadNeedsRefetch } from '../app/utils/dmThread'
import { buildInsightsReport, windowTruncated } from '../app/utils/insights'

vi.mock('../app/composables/useMasto', () => ({
  activeClient: vi.fn(),
  clientFor: vi.fn(),
  publicClient: vi.fn(),
  activeCredentials: vi.fn(),
}))

describe('launchAccountId ("main" account semantics)', () => {
  const base = { activeId: 'b', primaryId: 'a', authenticatedIds: ['a', 'b'] }
  it('a fresh launch posts as the main account', () => {
    expect(launchAccountId({ ...base, sessionStarted: false })).toBe('a')
  })
  it('a reload in the same session keeps the account the user switched to', () => {
    expect(launchAccountId({ ...base, sessionStarted: true })).toBe('b')
  })
  it('falls back to the active account when main is signed out or unset', () => {
    expect(launchAccountId({ ...base, authenticatedIds: ['b'], sessionStarted: false })).toBe('b')
    expect(launchAccountId({ ...base, primaryId: null, sessionStarted: false })).toBe('b')
  })
})

describe('supportsLegalReports', () => {
  it('needs Mastodon 4.2+', () => {
    expect(supportsLegalReports({ software: 'mastodon', version: '4.2.0' })).toBe(true)
    expect(supportsLegalReports({ software: 'mastodon', version: '4.3.1+glitch' })).toBe(true)
    expect(supportsLegalReports({ software: 'mastodon', version: '5.0.0' })).toBe(true)
    expect(supportsLegalReports({ software: 'mastodon', version: '4.1.9' })).toBe(false)
  })
  it('is withheld unless the version proves support', () => {
    expect(supportsLegalReports({ software: 'mastodon', version: null })).toBe(false)
    expect(supportsLegalReports({ software: 'pleroma', version: '4.9.0' })).toBe(false)
    expect(supportsLegalReports({ software: 'mastodon', version: 'weird' })).toBe(false)
  })
})

describe('notificationViewLabel', () => {
  it('is null for the default view', () => {
    expect(notificationViewLabel('all', 'newest')).toBeNull()
  })
  it('names the narrowing filter and order', () => {
    expect(notificationViewLabel('mention', 'newest')).toBe('Mentions')
    expect(notificationViewLabel('all', 'oldest')).toBe('Oldest first')
    expect(notificationViewLabel('reblog', 'oldest')).toBe('Boosts · Oldest first')
  })
})

describe('earlierPostMissing', () => {
  it('is null when the thread root is shown', () => {
    expect(earlierPostMissing({ inReplyToId: null }, [])).toBeNull()
  })
  it('flags a topmost post that still replies to something unseen', () => {
    expect(earlierPostMissing({ inReplyToId: '9', url: 'https://x/9' }, [])).toEqual({ url: 'https://x/9' })
    expect(
      earlierPostMissing({ inReplyToId: '9', url: 'f' }, [{ inReplyToId: '5', url: 'https://x/5' }]),
    ).toEqual({ url: 'https://x/5' })
  })
})

describe('canApplyUpdateNow', () => {
  it('only reloads for an update while hidden and nothing modal is open', () => {
    expect(canApplyUpdateNow({ hidden: true, modalOpen: false })).toBe(true)
    expect(canApplyUpdateNow({ hidden: false, modalOpen: false })).toBe(false)
    expect(canApplyUpdateNow({ hidden: true, modalOpen: true })).toBe(false)
  })
})

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('writes a valid archive: local headers, central directory, end record', () => {
    const zip = buildZip(
      [
        { name: 'a.csv', data: 'x,y\n1,2\n' },
        { name: 'b.csv', data: 'z\n3\n' },
      ],
      new Date(2026, 9, 12, 12, 0, 0),
    )
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    expect(dv.getUint32(0, true)).toBe(0x04034b50)
    const eocd = zip.byteLength - 22
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50)
    expect(dv.getUint16(eocd + 10, true)).toBe(2) // entries
    expect(new TextDecoder().decode(zip.slice(30, 35))).toBe('a.csv')
  })
})

describe('dmThread', () => {
  const convos = [
    { id: 'g', lastStatus: { id: 's9' }, accounts: [{ id: 'a' }, { id: 'b' }] },
    { id: 'o', lastStatus: { id: 's1' }, accounts: [{ id: 'a' }] },
  ]
  it('matches by last message first, else the exact participant set', () => {
    expect(findThreadConversation(convos, { statusIds: ['s1'], accountIds: [] })?.id).toBe('o')
    expect(findThreadConversation(convos, { statusIds: [], accountIds: ['a'] })?.id).toBe('o')
    expect(findThreadConversation(convos, { statusIds: [], accountIds: ['a', 'b'] })?.id).toBe('g')
    expect(findThreadConversation(convos, { statusIds: [], accountIds: ['zzz'] })).toBeNull()
  })
  it('refetches the thread only when the newest message is unseen', () => {
    expect(threadNeedsRefetch(convos[1]!, new Set(['s1']))).toBe(false)
    expect(threadNeedsRefetch(convos[1]!, new Set())).toBe(true)
    expect(threadNeedsRefetch(null, new Set())).toBe(false)
  })
})

describe('windowTruncated', () => {
  const now = Date.UTC(2026, 9, 12)
  const day = 86_400_000
  it('is false when the fetch was not capped', () => {
    expect(windowTruncated(false, now - day, 90, now)).toBe(false)
  })
  it('a capped 90d backfill that still reaches back past 7d is not truncated for 7d', () => {
    expect(windowTruncated(true, now - 30 * day, 7, now)).toBe(false)
    expect(windowTruncated(true, now - 30 * day, 90, now)).toBe(true)
  })
  it('unknown oldest row on a capped fetch counts as truncated', () => {
    expect(windowTruncated(true, null, 30, now)).toBe(true)
  })
})

describe('insights privacy', () => {
  const now = new Date(2026, 9, 12, 12, 0, 0)
  const iso = (d: number) => new Date(2026, 9, 12 - d, 9, 0, 0).toISOString()
  const statuses = [
    { id: '1', createdAt: iso(0), visibility: 'public', favouritesCount: 1 },
    { id: '2', createdAt: iso(1), visibility: 'private', favouritesCount: 2 },
    { id: '3', createdAt: iso(1), visibility: 'direct', favouritesCount: 4 },
  ]
  const run = (includePrivate?: boolean) =>
    buildInsightsReport({ account: { id: 'me', acct: 'me' } as never, statuses: statuses as never, windowDays: 7, now, includePrivate })

  it('exports exclude followers-only and direct posts', () => {
    const report = run()
    expect(JSON.stringify(report)).not.toContain('"id":"2"')
    expect(report.totals.posts).toBe(1)
  })
  it('on-screen insights may include followers-only, never direct messages', () => {
    const report = run(true)
    expect(report.totals.posts).toBe(2)
  })
})
