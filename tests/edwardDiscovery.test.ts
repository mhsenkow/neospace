import { describe, expect, it } from 'vitest'
import { statusToEdwardBall, reasonsFor, type EdwardStatusLike } from '../app/utils/edwardSemantics'
import { emptyAffinityContext } from '../app/utils/edwardAffinity'
import { filterAndSortBalls, EDWARD_CHANNELS } from '../app/utils/edwardExplore'
import { edQuip, hotTag } from '../app/utils/edwardVoice'

const status = (p: Partial<EdwardStatusLike> & { id: string }): EdwardStatusLike => ({
  createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  content: '<p>hello there friends of the fediverse</p>',
  account: { acct: 'ann@ex.social', displayName: 'Ann', username: 'ann' },
  mediaAttachments: [],
  tags: [],
  mentions: [],
  favouritesCount: 0,
  reblogsCount: 0,
  repliesCount: 0,
  _instanceUrl: 'https://ex.social',
  ...p,
})

const ctx = () => {
  const c = emptyAffinityContext()
  c.viewerLang = 'en'
  c.following.add('ann@ex.social')
  c.tags.add('art')
  return c
}

describe('reasons', () => {
  it('leads with personal links, then source, then nuance', () => {
    const b = statusToEdwardBall(
      status({ id: '1', tags: [{ name: 'art' }], _edSource: 'tag', _edTag: 'art', language: 'es' }),
      ctx(),
    )
    expect(b.reasons.map((r) => r.text)).toEqual([
      'you follow @ann',
      'you follow #art',
      'nobody has noticed yet',
      'in Spanish',
    ])
    expect(b.source).toBe('tag')
    expect(b.language).toBe('es')
  })

  it('names the feed when nothing personal applies', () => {
    const b = statusToEdwardBall(
      status({ id: '2', account: { acct: 'zed@far.away', username: 'zed' }, _edSource: 'trend', repliesCount: 5 }),
      ctx(),
    )
    expect(b.reasons[0]).toMatchObject({ kind: 'source', text: 'trending on ex.social' })
    expect(b.reasons[1]?.text).toBe('sparks talk · 5 replies')
  })

  it('flags threads and long reads', () => {
    const long = Array.from({ length: 260 }, () => 'word').join(' ')
    const thread = statusToEdwardBall(status({ id: '3', content: `<p>🧵 ${long}</p>` }), ctx())
    expect(thread.isThread).toBe(true)
    const read = statusToEdwardBall(status({ id: '4', content: `<p>${long}</p>` }), ctx())
    expect(read.readMinutes).toBe(1)
    expect(read.reasons.some((r) => r.text.startsWith('long read'))).toBe(true)
  })

  it('caps at four', () => {
    const r = reasonsFor({
      aff: { score: 1, self: true, mentionsYou: true, followsAuthor: true, homeAuthor: false, tagHits: ['a', 'b'] },
      acct: 'me',
      source: 'home',
      sourceTag: null,
      instanceHost: null,
      counts: { fav: 0, boost: 0, reply: 0 },
      kind: 'original',
      isBot: false,
      mood: 'curious',
      language: null,
      viewerLang: 'en',
      readMinutes: 0,
      isThread: false,
      createdAt: 0,
    })
    expect(r).toHaveLength(4)
  })
})

describe('discovery filters', () => {
  const balls = [
    statusToEdwardBall(status({ id: 'h', _edSource: 'home', language: 'en' }), ctx()),
    statusToEdwardBall(status({ id: 't', _edSource: 'trend', language: 'de', repliesCount: 4 }), ctx()),
    statusToEdwardBall(status({ id: 'f', language: 'en', content: '<p>so angry, furious, rage!!</p>' }), ctx()),
  ]
  const ids = (q: string) => filterAndSortBalls(balls, q, 'stream').balls.map((b) => b.statusId)

  it('filters by source, language, and conversation', () => {
    expect(ids('src:home')).toEqual(['h'])
    expect(ids('src:trending')).toEqual(['t'])
    expect(ids('src:firehose')).toEqual(['f'])
    expect(ids('lang:de')).toEqual(['t'])
    expect(ids('-lang:en')).toEqual(['t'])
    expect(ids('talk')).toEqual(['t'])
  })

  it('hides excluded moods', () => {
    const angry = balls[2]!.mood
    expect(ids(`-mood:${angry}`)).not.toContain('f')
  })

  it('ships channels with a filter and a sort each', () => {
    for (const ch of EDWARD_CHANNELS) {
      expect(ch.query.length).toBeGreaterThan(0)
      expect(ch.sort).toBeTruthy()
    }
  })
})

describe("Ed's voice", () => {
  const base = {
    speed: 'flow' as const,
    touring: false,
    scrubbing: false,
    filtered: false,
    matched: 3,
    total: 3,
    backpack: 0,
    fromHome: 0,
    visible: [],
    watching: null,
  }

  it('owns up to an empty filter', () => {
    expect(edQuip({ ...base, filtered: true, matched: 0 }, () => 0.5)).toMatch(/nothing here|empty/)
  })

  it('talks about what is on stage', () => {
    const b = statusToEdwardBall(status({ id: 'x', tags: [{ name: 'cats' }] }), ctx())
    const visible = [b, { ...b, identity: 'y' }, { ...b, identity: 'z' }]
    expect(hotTag(visible)).toEqual({ tag: 'cats', n: 3 })
    const lines = new Set(Array.from({ length: 60 }, (_, i) => edQuip({ ...base, visible }, () => ((i * 37) % 100) / 100 + 0.05)))
    expect([...lines].some((l) => l.includes('#cats'))).toBe(true)
  })
})
