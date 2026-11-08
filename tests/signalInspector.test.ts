import { describe, expect, it } from 'vitest'
import {
  decodeMastodonSnowflake,
  inspectAccountSignals,
  inspectStatusSignals,
  signalsToJsonSummary,
} from '../app/utils/signalInspector'

describe('decodeMastodonSnowflake', () => {
  it('decodes a plausible Mastodon snowflake to ms since epoch', () => {
    // Construct: ((Date.UTC(2024, 0, 15) - MASTODON_EPOCH) << 16)
    const MASTODON_EPOCH = Date.UTC(2015, 0, 1)
    const target = Date.UTC(2024, 0, 15, 12, 0, 0)
    const id = String((BigInt(target - MASTODON_EPOCH) << 16n) + 42n)
    const ms = decodeMastodonSnowflake(id)
    expect(ms).toBe(target)
  })

  it('rejects non-numeric ids', () => {
    expect(decodeMastodonSnowflake('abc')).toBeNull()
    expect(decodeMastodonSnowflake('12')).toBeNull()
  })
})

describe('inspectStatusSignals', () => {
  it('extracts length, density, and origin', () => {
    const MASTODON_EPOCH = Date.UTC(2015, 0, 1)
    const created = Date.UTC(2024, 5, 1, 8, 0, 0)
    const id = String(BigInt(created - MASTODON_EPOCH) << 16n)
    const signals = inspectStatusSignals(
      {
        id,
        uri: 'https://origin.social/users/a/statuses/1',
        url: 'https://origin.social/@a/1',
        createdAt: new Date(created).toISOString(),
        content: '<p>Hello <a href="https://x.test">world</a>? #cats</p>',
        language: 'en-US',
        visibility: 'public',
        favouritesCount: 3,
        reblogsCount: 1,
        repliesCount: 2,
        application: { name: 'LoomSpace' },
        tags: [{ name: 'cats' }],
        mentions: [{ acct: 'bob@other.social' }],
        mediaAttachments: [{ type: 'image' }],
        account: { acct: 'a@origin.social', url: 'https://origin.social/@a' },
      },
      { browsingHost: 'home.social' },
    )
    expect(signals.originHost).toBe('origin.social')
    expect(signals.browsingHint).toBe('home.social')
    expect(signals.application).toBe('LoomSpace')
    expect(signals.language).toBe('en')
    expect(signals.tagCount).toBe(1)
    expect(signals.mentionCount).toBe(1)
    expect(signals.linkCount).toBe(1)
    expect(signals.charCount).toBeGreaterThan(5)
    expect(signals.wordCount).toBeGreaterThan(0)
    expect(signals.snowflakeMs).toBe(created)
    expect(signals.snowflakeDeltaMs).toBe(0)
    expect(signals.media).toEqual([{ type: 'image', count: 1 }])
  })
})

describe('inspectAccountSignals', () => {
  it('computes cadence and observed ratios from loaded statuses', () => {
    const account = {
      acct: 'me@home.social',
      createdAt: '2024-01-01T00:00:00Z',
      followersCount: 100,
      followingCount: 50,
      statusesCount: 200,
      fields: [{ name: 'Site', value: 'https://x.test', verifiedAt: '2024-02-01T00:00:00Z' }],
      emojis: [{ shortcode: 'blob' }],
    }
    const statuses = [
      {
        id: '1',
        createdAt: '2026-01-01T10:00:00Z',
        content: '<p>hi</p>',
        application: { name: 'LoomSpace' },
        mediaAttachments: [{ type: 'image' }],
      },
      {
        id: '2',
        createdAt: '2026-01-01T14:00:00Z',
        content: '<p>reply</p>',
        inReplyToId: '1',
        application: { name: 'LoomSpace' },
      },
      {
        id: '3',
        createdAt: '2026-01-01T18:00:00Z',
        content: '',
        reblog: { id: 'x' },
        application: { name: 'Tusky' },
      },
    ]
    const signals = inspectAccountSignals(account, statuses)
    expect(signals.followerFollowingRatio).toBe(2)
    expect(signals.verifiedFieldCount).toBe(1)
    expect(signals.customEmojiCount).toBe(1)
    expect(signals.observed?.sampleSize).toBe(3)
    expect(signals.observed?.replyRatio).toBeCloseTo(1 / 3)
    expect(signals.observed?.boostRatio).toBeCloseTo(1 / 3)
    expect(signals.observed?.mediaRatio).toBeCloseTo(1 / 3)
    expect(signals.observed?.medianHoursBetweenPosts).toBe(4)
    expect(signals.observed?.clients[0]!.name).toBe('LoomSpace')
    expect(JSON.parse(signalsToJsonSummary('account', signals)).kind).toBe('account')
  })
})
