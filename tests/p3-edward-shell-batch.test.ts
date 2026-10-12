import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const memoryStorage = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
  }
}
import {
  isAuthGatedPublicHost,
  notePublicTimelineAuthFailure,
  rememberAuthGatedPublicHost,
} from '../app/utils/instances'
import { collapseDuplicateReblogs } from '../app/utils/statusIdentity'
import { ballMatchesExplore, parseEdwardExplore } from '../app/utils/edwardExplore'
import { faceMoodFor, MOOD_GLYPH } from '../app/utils/edwardFaces'
import { edQuip } from '../app/utils/edwardVoice'
import type { EdwardBallDescriptor } from '../app/utils/edwardSemantics'

describe('runtime auth-gated public hosts (NS-138)', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('learns a host from 422 on public timelines', () => {
    expect(isAuthGatedPublicHost('https://example.social')).toBe(false)
    notePublicTimelineAuthFailure('https://example.social', { status: 422 })
    expect(isAuthGatedPublicHost('example.social')).toBe(true)
  })

  it('ignores failures when authenticated', () => {
    notePublicTimelineAuthFailure('https://example.social', { status: 401 }, { authenticated: true })
    expect(isAuthGatedPublicHost('example.social')).toBe(false)
  })

  it('expires learned hosts after TTL', () => {
    vi.useFakeTimers()
    rememberAuthGatedPublicHost('learned.social')
    expect(isAuthGatedPublicHost('learned.social')).toBe(true)
    vi.advanceTimersByTime(91 * 24 * 60 * 60 * 1000)
    expect(isAuthGatedPublicHost('learned.social')).toBe(false)
    vi.useRealTimers()
  })
})

describe('collapseDuplicateReblogs window (NS-316)', () => {
  it('merges reblogs within 20 rows, keeping the first slot', () => {
    const original = { id: '1', uri: 'https://mastodon.social/users/x/statuses/1' }
    const statuses = [
      { id: '10', reblog: original, account: { username: 'alice' } },
      { id: '20', content: 'noise' },
      { id: '11', reblog: original, account: { username: 'bob' } },
    ]
    const out = collapseDuplicateReblogs(statuses)
    expect(out).toHaveLength(2)
    expect(out[0]?._collapsedRebloggers?.length).toBe(2)
    expect(out[0]?.id).toBe('10')
  })
})

describe('edward explore far channel (NS-345)', () => {
  const ball = (language: string | null): EdwardBallDescriptor =>
    ({
      language,
      affinity: 0.2,
      engagement: 0,
      preview: 'hello',
      mood: 'curious',
      kind: 'post',
      badges: [],
      isThread: false,
      readMinutes: 0,
      isBot: false,
      topTag: null,
      source: 'firehose',
    }) as EdwardBallDescriptor

  it('excludes untagged posts when -lang is set', () => {
    const q = parseEdwardExplore('-lang:en')
    expect(ballMatchesExplore(ball('en'), q)).toBe(false)
    expect(ballMatchesExplore(ball('es'), q)).toBe(true)
    expect(ballMatchesExplore(ball(null), q)).toBe(false)
  })
})

describe('edward face cues (NS-343, NS-346)', () => {
  it('does not laugh-match www inside URLs', () => {
    expect(faceMoodFor({ text: 'see https://www.example.com/foo', badges: [], engagement: 0, kind: 'post' })).not.toBe('giggle')
  })

  it('matches JP-style wwww laughter', () => {
    expect(faceMoodFor({ text: 'that was funny wwww', badges: [], engagement: 0, kind: 'post' })).toBe('giggle')
  })

  it('does not ask-match ? in URLs', () => {
    expect(faceMoodFor({ text: 'link https://x.test/?foo=1', badges: [], engagement: 0, kind: 'post' })).not.toBe('ask')
  })

  it('gives rage its own glyph', () => {
    expect(MOOD_GLYPH.rage).toBe('ಠ益ಠ')
    expect(MOOD_GLYPH.rage).not.toBe(MOOD_GLYPH.manic)
  })
})

describe('edQuip loading/error (NS-347)', () => {
  const base = {
    speed: 'flow' as const,
    touring: false,
    scrubbing: false,
    filtered: false,
    matched: 0,
    total: 0,
    backpack: 0,
    fromHome: 0,
    visible: [],
    watching: null,
  }

  it('mentions the net when there is an error', () => {
    expect(edQuip({ ...base, error: 'offline' }, () => 0)).toMatch(/can't reach the net|wires are tangled/i)
  })

  it('mentions hacking while loading an empty stream', () => {
    expect(edQuip({ ...base, loading: true, total: 0 }, () => 0)).toMatch(/hacking|fetch fetch/i)
  })
})
