import { describe, expect, it } from 'vitest'
import {
  buildPostQuery,
  detectIntent,
  emptyPostFilters,
  hasPostOperators,
  highlightTerms,
  rankServers,
  splitHighlight,
  tagFromQuery,
} from '../app/utils/searchQuery'
import type { CuratedInstance } from '../app/composables/useCuratedInstances'

describe('detectIntent', () => {
  it('recognises pasted links', () => {
    expect(detectIntent('https://fosstodon.org/@alice/1234')).toEqual({
      kind: 'url',
      url: 'https://fosstodon.org/@alice/1234',
    })
  })

  it('recognises remote handles with or without the leading @', () => {
    expect(detectIntent('@Alice@Mastodon.Social')).toEqual({ kind: 'handle', acct: 'Alice@mastodon.social', remote: true })
    expect(detectIntent('bob@fosstodon.org')).toEqual({ kind: 'handle', acct: 'bob@fosstodon.org', remote: true })
  })

  it('recognises local handles, tags, and hostnames', () => {
    expect(detectIntent('@carol')).toEqual({ kind: 'handle', acct: 'carol', remote: false })
    expect(detectIntent('#Linux')).toEqual({ kind: 'tag', tag: 'Linux' })
    expect(detectIntent('#café')).toEqual({ kind: 'tag', tag: 'café' })
    expect(detectIntent('hachyderm.io')).toEqual({ kind: 'host', host: 'hachyderm.io' })
  })

  it('treats everything else as text', () => {
    expect(detectIntent('open source')).toEqual({ kind: 'text' })
    expect(detectIntent('carol')).toEqual({ kind: 'text' })
  })
})

describe('tagFromQuery', () => {
  it('accepts #tags and single words, not phrases or handles', () => {
    expect(tagFromQuery('#linux')).toBe('linux')
    expect(tagFromQuery('linux')).toBe('linux')
    expect(tagFromQuery('open source')).toBeNull()
    expect(tagFromQuery('@carol')).toBeNull()
    expect(tagFromQuery('123')).toBeNull()
  })
})

describe('buildPostQuery', () => {
  const now = new Date('2026-10-09T12:00:00Z')

  it('folds filters into Mastodon operators', () => {
    const q = buildPostQuery('rust', { ...emptyPostFilters(), fromMe: true, media: true, noReplies: true, since: 'week' }, now)
    expect(q).toBe('rust from:me has:media -is:reply after:2026-10-02')
  })

  it('does not duplicate operators already typed', () => {
    const q = buildPostQuery('rust from:alice has:media', { ...emptyPostFilters(), fromMe: true, media: true }, now)
    expect(q).toBe('rust from:alice has:media')
  })

  it('leaves the query alone without filters', () => {
    expect(buildPostQuery('  rust  ', emptyPostFilters(), now)).toBe('rust')
  })

  it('detects typed operators', () => {
    expect(hasPostOperators('cats has:media')).toBe(true)
    expect(hasPostOperators('-is:reply cats')).toBe(true)
    expect(hasPostOperators('cats and dogs')).toBe(false)
  })
})

describe('highlighting', () => {
  it('drops operators, sigils, and short noise', () => {
    expect(highlightTerms('#rust from:me a lang')).toEqual(['rust', 'lang'])
    expect(highlightTerms('@alice@example.com')).toEqual(['alice'])
  })

  it('splits text into hit/miss runs, case-insensitively', () => {
    expect(splitHighlight('Rustaceans love rust', ['rust'])).toEqual([
      { text: 'Rust', hit: true },
      { text: 'aceans love ', hit: false },
      { text: 'rust', hit: true },
    ])
  })

  it('escapes regex characters in terms', () => {
    expect(splitHighlight('c++ and c', ['c++'])).toEqual([
      { text: 'c++', hit: true },
      { text: ' and c', hit: false },
    ])
  })
})

describe('rankServers', () => {
  const inst = (domain: string, name: string, extra: Partial<CuratedInstance> = {}): CuratedInstance => ({
    domain,
    name,
    vibe: '',
    category: 'general',
    description: '',
    blurb: '',
    color: '#000',
    emoji: '',
    ...extra,
  })

  const list = [
    inst('mastodon.art', 'Mastodon.art', { description: 'For artists', tags: ['art'] }),
    inst('fosstodon.org', 'Fosstodon', { description: 'Linux and open source', tags: ['linux', 'foss'] }),
    inst('art.example', 'Art Place'),
  ]

  it('puts name/domain hits above tag and description hits', () => {
    expect(rankServers(list, 'art').map((i) => i.domain)).toEqual(['art.example', 'mastodon.art'])
  })

  it('requires every word to match', () => {
    expect(rankServers(list, 'linux open').map((i) => i.domain)).toEqual(['fosstodon.org'])
    expect(rankServers(list, 'linux art')).toEqual([])
  })
})
