import { describe, expect, it } from 'vitest'
import {
  ballMatchesExplore,
  parseEdwardExplore,
} from '../app/utils/edwardExplore'
import { accountLooksBot } from '../app/utils/edwardSemantics'
import type { EdwardBallDescriptor } from '../app/utils/edwardSemantics'

const ball = (
  partial: Partial<EdwardBallDescriptor> & { identity: string },
): EdwardBallDescriptor => ({
  statusId: partial.identity,
  kind: 'original',
  color: [1, 1, 1],
  size: 1,
  opacity: 1,
  badges: [],
  mood: 'curious',
  moodWhy: 'thought',
  label: 'someone',
  preview: 'hello',
  authorKey: 'someone',
  acct: 'someone',
  inReplyToId: null,
  mediaUrl: null,
  engagement: 0,
  createdAt: Date.now(),
  topTag: null,
  hasCard: false,
  isBot: false,
  instanceHost: 'example.social',
  affinity: 0,
  isShort: true,
  shortText: 'hello',
  exploreRank: -1,
  exploreRankNorm: 0,
  ...partial,
})

describe('accountLooksBot', () => {
  it('trusts the Mastodon bot flag', () => {
    expect(accountLooksBot({ bot: true, acct: 'alice' })).toBe(true)
  })

  it('catches obvious handle / name marks', () => {
    expect(accountLooksBot({ acct: 'weather_bot' })).toBe(true)
    expect(accountLooksBot({ acct: 'bot_news' })).toBe(true)
    expect(accountLooksBot({ displayName: 'News [bot]' })).toBe(true)
    expect(accountLooksBot({ acct: 'alice', displayName: 'Alice' })).toBe(false)
    expect(accountLooksBot({ acct: 'robotics', displayName: 'both of us' })).toBe(
      false,
    )
  })
})

describe('edward explore bot filter', () => {
  it('parses -bot / nobot / humans as exclude', () => {
    for (const q of ['-bot', 'nobot', 'humans']) {
      const parsed = parseEdwardExplore(q)
      expect(parsed.excludeBadges.has('bot')).toBe(true)
      expect(parsed.badges.has('bot')).toBe(false)
    }
  })

  it('hides bot balls with -bot', () => {
    const q = parseEdwardExplore('-bot')
    expect(
      ballMatchesExplore(ball({ identity: '1', isBot: true, badges: ['bot'] }), q),
    ).toBe(false)
    expect(ballMatchesExplore(ball({ identity: '2', isBot: false }), q)).toBe(
      true,
    )
  })

  it('shows only bots with bot', () => {
    const q = parseEdwardExplore('bot')
    expect(
      ballMatchesExplore(ball({ identity: '1', isBot: true, badges: ['bot'] }), q),
    ).toBe(true)
    expect(ballMatchesExplore(ball({ identity: '2', isBot: false }), q)).toBe(
      false,
    )
  })
})
