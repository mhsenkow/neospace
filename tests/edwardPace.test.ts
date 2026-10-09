import { describe, expect, it } from 'vitest'
import {
  edwardDeckColumn,
  edwardDeckTrailCount,
  pickTourCandidate,
  stepSpeed,
} from '../app/utils/edwardPace'
import { filterAndSortBalls, gemScore, parseEdwardExplore } from '../app/utils/edwardExplore'
import type { EdwardBallDescriptor } from '../app/utils/edwardSemantics'

const ball = (p: Partial<EdwardBallDescriptor> & { identity: string }): EdwardBallDescriptor => ({
  statusId: p.identity,
  kind: 'original',
  color: [1, 1, 1],
  size: 0.5,
  opacity: 1,
  badges: [],
  mood: 'curious',
  moodWhy: 'thought',
  label: p.identity,
  preview: 'a reasonably long thought about something interesting',
  authorKey: p.identity,
  acct: p.identity,
  inReplyToId: null,
  mediaUrl: null,
  engagement: 0,
  createdAt: 0,
  topTag: null,
  hasCard: false,
  isBot: false,
  instanceHost: 'example.social',
  affinity: 0,
  isShort: false,
  shortText: null,
  exploreRank: -1,
  exploreRankNorm: 0,
  ...p,
})

describe('stepSpeed', () => {
  it('steps within still → rush and clamps at the ends', () => {
    expect(stepSpeed('flow', -1)).toBe('drift')
    expect(stepSpeed('drift', -1)).toBe('still')
    expect(stepSpeed('still', -1)).toBe('still')
    expect(stepSpeed('flow', 1)).toBe('rush')
    expect(stepSpeed('rush', 1)).toBe('rush')
  })
})

describe('pickTourCandidate', () => {
  const balls = [ball({ identity: 'a' }), ball({ identity: 'b' }), ball({ identity: 'c' })]

  it('skips the current post and recent picks', () => {
    expect(pickTourCandidate(balls, new Set(['b']), 'a', () => 0)).toBe('c')
  })

  it('falls back to recent picks when everything was seen', () => {
    expect(pickTourCandidate(balls, new Set(['a', 'b', 'c']), 'a', () => 0)).toBe('b')
  })

  it('returns null with nothing to show', () => {
    expect(pickTourCandidate([ball({ identity: 'a', preview: '' })], new Set(), null)).toBeNull()
  })

  it('favours posts with substance over bots', () => {
    const pool = [ball({ identity: 'bot', isBot: true, preview: 'x' }), ball({ identity: 'pic', mediaUrl: 'u' })]
    // r just past the bot's small slice lands on the picture
    expect(pickTourCandidate(pool, new Set(), null, () => 0.3)).toBe('pic')
  })
})

describe('deck sizing', () => {
  it('grows the deck column with the viewport, within bounds', () => {
    expect(edwardDeckColumn(1100)).toBe(400)
    expect(edwardDeckColumn(1800)).toBe(486)
    expect(edwardDeckColumn(4000)).toBe(560)
  })

  it('stacks up to four earlier posts on tall screens', () => {
    expect(edwardDeckTrailCount(700)).toBe(1)
    expect(edwardDeckTrailCount(900)).toBe(3)
    expect(edwardDeckTrailCount(1200)).toBe(4)
  })
})

describe('serendipity sorts', () => {
  it('ranks quiet, substantial originals above loud ones and bots as gems', () => {
    const quiet = ball({ identity: 'quiet', engagement: 0 })
    const loud = ball({ identity: 'loud', engagement: 400 })
    const bot = ball({ identity: 'bot', isBot: true })
    expect(gemScore(quiet)).toBeGreaterThan(gemScore(loud))
    const { balls } = filterAndSortBalls([bot, loud, quiet], '', 'gems')
    expect(balls.map((b) => b.identity)).toEqual(['quiet', 'loud', 'bot'])
  })

  it('shuffles stably per seed', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f'].map((identity) => ball({ identity }))
    const one = filterAndSortBalls(list, '', 'shuffle', 7).balls.map((b) => b.identity)
    const again = filterAndSortBalls(list, '', 'shuffle', 7).balls.map((b) => b.identity)
    const other = filterAndSortBalls(list, '', 'shuffle', 8).balls.map((b) => b.identity)
    expect(again).toEqual(one)
    expect(other).not.toEqual(one)
  })

  it('parses quiet and the new sort aliases', () => {
    const q = parseEdwardExplore('quiet sort:gems')
    expect(q.maxEngagement).toBe(2)
    expect(q.sort).toBe('gems')
    expect(parseEdwardExplore('surprise').sort).toBe('shuffle')
    const { balls } = filterAndSortBalls(
      [ball({ identity: 'new', engagement: 1 }), ball({ identity: 'big', engagement: 50 })],
      'quiet',
      'stream',
    )
    expect(balls.map((b) => b.identity)).toEqual(['new'])
  })
})
