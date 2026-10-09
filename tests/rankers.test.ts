import { describe, expect, it } from 'vitest'
import {
  emptyRankContext,
  interestScore,
  rankFeed,
  tasteFrom,
  X_WEIGHTS,
  FB_MSI,
  FB_CLOSENESS,
  type RankStatus,
} from '../app/utils/rankers'
import {
  builtinRecipes,
  decodeAlgorithmShare,
  encodeAlgorithmShare,
  sharePayloadToRecipe,
} from '../app/utils/algorithms'

const NOW = Date.parse('2026-10-09T12:00:00Z')
let n = 0
const post = (p: Partial<RankStatus> & { acct?: string; followers?: number; ageH?: number } = {}): RankStatus => {
  const { acct = `u${n}@ex.social`, followers = 100, ageH = 1, ...rest } = p
  n++
  return {
    id: String(n),
    createdAt: new Date(NOW - ageH * 3_600_000).toISOString(),
    content: '<p>a perfectly ordinary post about gardens and tomatoes</p>',
    favouritesCount: 0,
    reblogsCount: 0,
    repliesCount: 0,
    mediaAttachments: [],
    tags: [],
    mentions: [],
    account: { acct, followersCount: followers },
    _rankSource: 'home',
    ...rest,
  }
}

const ctx = () => {
  const c = emptyRankContext(NOW)
  c.selfAcct = 'me@home.social'
  c.viewerLang = 'en'
  return c
}

describe('published weights', () => {
  it('keeps the numbers the sources state', () => {
    expect(X_WEIGHTS.reply / X_WEIGHTS.fav).toBe(27)
    expect(X_WEIGHTS.replyEngagedByAuthor).toBe(75)
    expect(FB_MSI).toEqual({ like: 1, reshare: 5, significantComment: 30 })
    expect(FB_CLOSENESS.group).toBe(0.5)
    expect(FB_CLOSENESS.stranger).toBe(0.3)
  })
})

describe('X-style', () => {
  it('ranks a reply-heavy post above a like-heavy one with equal reach', () => {
    const c = ctx()
    c.following.add('a@ex.social').add('b@ex.social')
    const liked = post({ acct: 'a@ex.social', favouritesCount: 20 })
    const talked = post({ acct: 'b@ex.social', repliesCount: 8 })
    const out = rankFeed('x', [liked, talked], c)
    expect(out[0]!.status).toBe(talked)
    expect(out[0]!.why).toContain('reply-heavy')
  })

  it('drops out-of-network posts with no social proof', () => {
    const c = ctx()
    const stranger = post({ acct: 'stranger@far.away', _rankSource: 'federated', favouritesCount: 50 })
    expect(rankFeed('x', [stranger], c)).toHaveLength(0)
    const trending = post({ acct: 'stranger@far.away', _rankSource: 'trend', favouritesCount: 50 })
    expect(rankFeed('x', [trending], c)).toHaveLength(1)
  })

  it('discounts repeat authors and balances in/out of network', () => {
    const c = ctx()
    c.following.add('fav@ex.social')
    const mine = [1, 2, 3].map(() => post({ acct: 'fav@ex.social', repliesCount: 10 }))
    const out = Array.from({ length: 3 }, () => post({ acct: 'x@trend.social', _rankSource: 'trend', repliesCount: 2 }))
    const ranked = rankFeed('x', [...mine, ...out], c)
    const firstFour = ranked.slice(0, 4).map((r) => r.status.account!.acct)
    expect(firstFour.filter((a) => a === 'fav@ex.social')).toHaveLength(2)
    expect(ranked.some((r) => r.why.includes('author diversity'))).toBe(true)
  })
})

describe('Facebook-style', () => {
  it('puts a friend ahead of a stranger with the same engagement', () => {
    const c = ctx()
    c.following.add('friend@ex.social')
    c.mutuals.add('friend@ex.social')
    const friend = post({ acct: 'friend@ex.social', favouritesCount: 3 })
    const stranger = post({ acct: 'nobody@far.away', favouritesCount: 3, _rankSource: 'trend' })
    const out = rankFeed('facebook', [stranger, friend], c)
    expect(out[0]!.status).toBe(friend)
    expect(out[0]!.why[0]).toBe('a friend')
  })

  it('demotes engagement bait', () => {
    const c = ctx()
    c.following.add('a@ex.social').add('b@ex.social')
    const bait = post({ acct: 'a@ex.social', favouritesCount: 10, content: '<p>Like if you agree and share this with everyone</p>' })
    const honest = post({ acct: 'b@ex.social', favouritesCount: 6 })
    const out = rankFeed('facebook', [bait, honest], c)
    expect(out[0]!.status).toBe(honest)
    expect(out[1]!.why).toContain('engagement bait (demoted)')
  })

  it('never shows three in a row from one person', () => {
    const c = ctx()
    c.following.add('loud@ex.social')
    c.mutuals.add('loud@ex.social')
    const loud = [1, 2, 3, 4].map(() => post({ acct: 'loud@ex.social', repliesCount: 9 }))
    const other = post({ acct: 'quiet@ex.social', _rankSource: 'trend' })
    const authors = rankFeed('facebook', [...loud, other], c).map((r) => r.status.account!.acct)
    for (let i = 2; i < authors.length - 1; i++) {
      expect(authors[i] === authors[i - 1] && authors[i] === authors[i - 2]).toBe(false)
    }
  })
})

describe('TikTok-style', () => {
  it('ignores follower count (a small account can win)', () => {
    const c = ctx()
    const big = post({ acct: 'celeb@ex.social', followers: 1_000_000, favouritesCount: 5, _rankSource: 'federated' })
    const small = post({ acct: 'small@ex.social', followers: 10, favouritesCount: 5, _rankSource: 'federated' })
    const out = rankFeed('tiktok', [big, small], c, () => 0)
    // Same counts → same score regardless of followers
    expect(Math.abs(out[0]!.score - out[1]!.score)).toBeLessThan(1e-9)
  })

  it('prefers video, then pictures, then text', () => {
    const c = ctx()
    const text = post({ _rankSource: 'federated', favouritesCount: 3 })
    const pic = post({ _rankSource: 'federated', favouritesCount: 3, mediaAttachments: [{ type: 'image' }] })
    const vid = post({ _rankSource: 'federated', favouritesCount: 3, mediaAttachments: [{ type: 'video', meta: { original: { duration: 30 } } }] })
    const out = rankFeed('tiktok', [text, pic, vid], c, () => 0).map((r) => r.status)
    expect(out).toEqual([vid, pic, text])
  })

  it('boosts what matches your taste and never repeats a creator back to back', () => {
    const c = ctx()
    const taste = tasteFrom([post({ tags: [{ name: 'gardening' }] }), post({ tags: [{ name: 'gardening' }] })])
    Object.assign(c, taste)
    expect(interestScore({ tags: ['gardening'], words: [] }, c)).toBeGreaterThan(0.3)
    const same = [1, 2, 3].map(() => post({ acct: 'one@ex.social', _rankSource: 'federated', favouritesCount: 4, mediaAttachments: [{ type: 'image' }] }))
    const others = [1, 2].map(() => post({ _rankSource: 'federated', favouritesCount: 1 }))
    const authors = rankFeed('tiktok', [...same, ...others], c, () => 0).map((r) => r.status.account!.acct)
    for (let i = 1; i < 4; i++) expect(authors[i] === authors[i - 1] && authors[i] === 'one@ex.social' && i < 4).toBe(false)
  })

  it('gives fresh posts exploration slots', () => {
    const c = ctx()
    const proven = Array.from({ length: 8 }, () => post({ _rankSource: 'federated', favouritesCount: 20, ageH: 3 }))
    const fresh = post({ _rankSource: 'federated', ageH: 0.5 })
    const out = rankFeed('tiktok', [...proven, fresh], c, () => 0)
    const idx = out.findIndex((r) => r.status === fresh)
    expect(idx).toBeLessThanOrEqual(5)
    expect(out[idx]!.why[0]).toBe('new — giving it a chance')
  })
})

describe('ranked recipes', () => {
  it('ships the three as built-ins', () => {
    const ids = builtinRecipes().filter((r) => r.ranker).map((r) => r.ranker)
    expect(ids).toEqual(['x', 'facebook', 'tiktok'])
  })

  it('round-trips the ranker through share links and rejects bad ones', () => {
    const r = builtinRecipes().find((x) => x.ranker === 'tiktok')!
    const back = sharePayloadToRecipe(decodeAlgorithmShare(encodeAlgorithmShare(r))!)
    expect(back.ranker).toBe('tiktok')
    const forged = btoa(JSON.stringify({ v: 1, n: 'x', s: 'home', r: 'evil' })).replace(/=+$/, '')
    expect(decodeAlgorithmShare(forged)?.r).toBeUndefined()
  })
})
