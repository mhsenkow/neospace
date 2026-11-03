import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  rankServers,
  suggestTwinHost,
  hostSearchText,
  detectIntent,
} from '../app/utils/searchQuery'
import {
  accountCanonicalKey,
  mergeAccountsByCanonical,
  mergeHashtagsByName,
  mergeStatusesByIdentity,
} from '../app/utils/searchMerge'
import { parseStoredLayout, useColumnsStore } from '../app/stores/columns'
import type { CuratedInstance } from '../app/composables/useCuratedInstances'
import type { mastodon } from 'masto'

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

describe('swapped-domain ranking', () => {
  const list = [
    inst('tech.lgbt', 'Tech LGBT', { tags: ['lgbt', 'tech'], featured: true }),
    inst('mastodon.art', 'Mastodon.art', { tags: ['art'] }),
    inst('lgbt.io', 'LGBT.io'),
  ]

  it('ranks tech.lgbt highly for lgbt.tech (swapped labels)', () => {
    const ranked = rankServers(list, 'lgbt.tech')
    expect(ranked[0]?.domain).toBe('tech.lgbt')
  })

  it('ranks tech.lgbt for spaced tokens', () => {
    expect(rankServers(list, 'tech lgbt')[0]?.domain).toBe('tech.lgbt')
  })

  it('suggests twin host when typed domain is absent from catalog', () => {
    expect(suggestTwinHost(list, 'lgbt.tech')?.domain).toBe('tech.lgbt')
    expect(suggestTwinHost(list, 'tech.lgbt')).toBeNull()
  })

  it('turns a host query into searchable domain tokens', () => {
    expect(hostSearchText('lgbt.tech')).toBe('lgbt tech')
    expect(detectIntent('lgbt.tech')).toEqual({ kind: 'host', host: 'lgbt.tech' })
  })
})

describe('multi-server search deduplication', () => {
  const acct = (
    id: string,
    handle: string,
    url: string,
  ): mastodon.v1.Account =>
    ({
      id,
      acct: handle,
      username: handle.split('@')[0],
      url,
      displayName: handle,
      note: '',
      avatar: '',
      header: '',
    }) as mastodon.v1.Account

  it('canonicalizes local accts with the source host', () => {
    expect(accountCanonicalKey({ acct: 'alice', username: 'alice', url: 'https://a.example/@alice' }, 'tech.lgbt')).toBe(
      'alice@tech.lgbt',
    )
    expect(accountCanonicalKey({ acct: 'alice@tech.lgbt', username: 'alice', url: 'https://tech.lgbt/@alice' })).toBe(
      'alice@tech.lgbt',
    )
  })

  it('merges the same person across servers, preferring the active host copy', () => {
    const a = acct('1', 'alice', 'https://hachyderm.io/@alice')
    const b = acct('99', 'alice@hachyderm.io', 'https://tech.lgbt/@alice')
    const merged = mergeAccountsByCanonical(
      [
        { accounts: [b], sourceUrl: 'https://tech.lgbt', prefer: false },
        { accounts: [a], sourceUrl: 'https://hachyderm.io', prefer: true },
      ],
      'hachyderm.io',
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.id).toBe('1')
    expect(merged[0]?._sourceUrl).toBe('https://hachyderm.io')
  })

  it('merges hashtags by lowercase name and keeps denser history', () => {
    const short = { name: 'Cats', history: [{ day: '1', accounts: '1', uses: '1' }] } as mastodon.v1.Tag
    const long = {
      name: 'cats',
      history: [
        { day: '1', accounts: '1', uses: '1' },
        { day: '2', accounts: '2', uses: '2' },
      ],
      following: true,
    } as mastodon.v1.Tag
    const merged = mergeHashtagsByName([[short], [long]])
    expect(merged).toHaveLength(1)
    expect(merged[0]?.history?.length).toBe(2)
    expect(merged[0]?.following).toBe(true)
  })

  it('dedupes statuses that share uri/url across servers', () => {
    const a = {
      id: '1',
      uri: 'https://a.example/users/x/statuses/1',
      url: 'https://a.example/@x/1',
      _instanceUrl: 'https://a.example',
    } as any
    const b = {
      id: '999',
      uri: 'https://a.example/users/x/statuses/1',
      url: 'https://a.example/@x/1',
      _instanceUrl: 'https://b.example',
    } as any
    expect(mergeStatusesByIdentity([[a], [b]])).toHaveLength(1)
  })
})

describe('cross-account follow resolution helpers', () => {
  it('builds a full handle from a local acct + source host', () => {
    expect(
      accountCanonicalKey({ acct: 'bob', username: 'bob', url: 'https://tech.lgbt/@bob' }, 'tech.lgbt'),
    ).toBe('bob@tech.lgbt')
  })

  it('keeps remote handles intact for lookup', () => {
    expect(
      accountCanonicalKey({
        acct: 'bob@tech.lgbt',
        username: 'bob',
        url: 'https://hachyderm.io/@bob',
      }),
    ).toBe('bob@tech.lgbt')
  })
})

describe('per-column server pinning', () => {
  it('round-trips serverHost / instanceId through stored layout', () => {
    const parsed = parseStoredLayout({
      columns: [
        { id: 'a', feedType: 'local', serverHost: 'Tech.LGBT' },
        { id: 'b', feedType: 'home', instanceId: 'all' },
        { id: 'c', feedType: 'federated', instanceId: 'acct_1' },
      ],
    })
    expect(parsed?.columns[0]).toMatchObject({ feedType: 'local', serverHost: 'tech.lgbt' })
    expect(parsed?.columns[1]).toMatchObject({ feedType: 'home', instanceId: 'all' })
    expect(parsed?.columns[2]).toMatchObject({ feedType: 'federated', instanceId: 'acct_1' })
  })

  it('keeps distinct local columns when pinned to different hosts', () => {
    setActivePinia(createPinia())
    const store = useColumnsStore()
    store.$patch({
      columns: [{ id: 'home', feedType: 'home', viewMode: 'flow' }],
      focusedColumnId: 'home',
      maxColumns: 8,
    })
    const a = store.ensureFocusedView('local', 'host:tech.lgbt')
    const b = store.ensureFocusedView('local', 'host:mastodon.art')
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
    expect(store.columns.filter((c) => c.feedType === 'local')).toHaveLength(2)
    expect(store.findColumn('local', 'host:tech.lgbt')?.serverHost).toBe('tech.lgbt')
    expect(store.findColumn('local', 'host:mastodon.art')?.serverHost).toBe('mastodon.art')
  })
})
