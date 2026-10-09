import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { mastodon } from 'masto'
import { guessCategory } from '../app/utils/guessCategory'
import { appendUnique, nextSearchPage } from '../app/composables/useFediverseSearch'
import { isGroupTagName, useGroupsStore } from '../app/stores/groups'

describe('isGroupTagName', () => {
  it('accepts hashtags in any script', () => {
    expect(isGroupTagName('fediverse')).toBe(true)
    expect(isGroupTagName('Mental_Health')).toBe(true)
    expect(isGroupTagName('café')).toBe(true)
    expect(isGroupTagName('日本語')).toBe(true)
    expect(isGroupTagName('2024')).toBe(true)
  })

  it('rejects anything that could reshape an API path', () => {
    expect(isGroupTagName('')).toBe(false)
    expect(isGroupTagName('../accounts/1/follow?')).toBe(false)
    expect(isGroupTagName('a/b')).toBe(false)
    expect(isGroupTagName('a?b')).toBe(false)
    expect(isGroupTagName('a#b')).toBe(false)
    expect(isGroupTagName('a.b')).toBe(false)
    expect(isGroupTagName('a%2Fb')).toBe(false)
    expect(isGroupTagName('two words')).toBe(false)
    expect(isGroupTagName('x'.repeat(101))).toBe(false)
  })
})

describe('nextSearchPage', () => {
  it('advances the mixed tab by the fullest type, not the sum', () => {
    expect(nextSearchPage('all', 0, { accounts: 16, statuses: 3, hashtags: 0 })).toEqual({
      offset: 16,
      hasMore: true,
    })
    // 11 + 5 = 16 used to claim "more" although no type filled a page
    expect(nextSearchPage('all', 16, { accounts: 11, statuses: 5, hashtags: 0 })).toEqual({
      offset: 27,
      hasMore: false,
    })
  })

  it('counts only the tab’s own type', () => {
    expect(nextSearchPage('people', 16, { accounts: 16, statuses: 16, hashtags: 0 })).toEqual({
      offset: 32,
      hasMore: true,
    })
    expect(nextSearchPage('tags', 0, { accounts: 16, statuses: 0, hashtags: 4 })).toEqual({
      offset: 4,
      hasMore: false,
    })
  })
})

describe('appendUnique', () => {
  it('drops items repeated across a page boundary', () => {
    const prev = [{ id: '1' }, { id: '2' }]
    const next = [{ id: '2' }, { id: '3' }, { id: '3' }]
    expect(appendUnique(prev, next, (x) => x.id).map((x) => x.id)).toEqual(['1', '2', '3'])
  })

  it('returns the same array when nothing is added', () => {
    const prev = [{ id: '1' }]
    expect(appendUnique(prev, [], (x) => x.id)).toBe(prev)
  })
})

describe('guessCategory plurals', () => {
  it('buckets everyday plural / -ing tags', () => {
    expect(guessCategory('cats')).toBe('social')
    expect(guessCategory('dogs')).toBe('social')
    expect(guessCategory('cooking')).toBe('social')
    expect(guessCategory('gardening')).toBe('social')
    expect(guessCategory('books')).toBe('creative')
    expect(guessCategory('writing')).toBe('creative')
    expect(guessCategory('photography')).toBe('creative')
    expect(guessCategory('games')).toBe('gaming')
  })

  it('keeps short keywords exact', () => {
    expect(guessCategory('ais')).toBe('other')
    expect(guessCategory('rain')).toBe('other')
    expect(guessCategory('education')).toBe('other')
  })
})

describe('groups timeline cache', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const status = (id: string) => ({ id }) as unknown as mastodon.v1.Status

  it('does not snapshot a still-loading (empty) feed', () => {
    const groups = useGroupsStore()
    groups.currentGroupTag = 'art'
    groups.groupTimeline = []
    groups.cacheTimeline('art', 120)
    expect(groups.restoreTimeline('art')).toBeNull()
  })

  it('does not file another tag’s posts under this tag', () => {
    const groups = useGroupsStore()
    groups.currentGroupTag = 'music'
    groups.groupTimeline = [status('9')]
    groups.cacheTimeline('art', 0)
    expect(groups.restoreTimeline('art')).toBeNull()
  })

  it('restores a loaded feed and clears stale loading flags', () => {
    const groups = useGroupsStore()
    groups.currentGroupTag = 'Art'
    groups.groupTimeline = [status('2'), status('1')]
    groups.maxId = '1'
    groups.cacheTimeline('art', 300)
    groups.clearTimeline()
    groups.isLoadingTimeline = true
    expect(groups.restoreTimeline('art')).toBe(300)
    expect(groups.groupTimeline.map((s) => s.id)).toEqual(['2', '1'])
    expect(groups.isLoadingTimeline).toBe(false)
  })
})
