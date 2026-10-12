import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { mastodon } from 'masto'
import {
  decodeEntities,
  keywordMatches,
  normalizeTagList,
  parseAlgorithmSentence,
  recipeSummary,
  sharePayloadToRecipe,
  statusMatchesRecipe,
  type AlgorithmRecipe,
  type AlgorithmSharePayload,
} from '../app/utils/algorithms'
import { MAX_CUSTOM, useAlgorithmsStore } from '../app/stores/algorithms'

const status = (over: Record<string, unknown> = {}) =>
  ({
    id: '1',
    content: '<p>hello</p>',
    spoilerText: '',
    tags: [],
    mediaAttachments: [],
    ...over,
  }) as unknown as mastodon.v1.Status

const rules = (over: Partial<AlgorithmRecipe> = {}) => ({
  mediaOnly: false,
  noReblogs: false,
  noReplies: false,
  includeTags: [],
  excludeTags: [],
  includeKeywords: [],
  excludeKeywords: [],
  ...over,
})

describe('decodeEntities', () => {
  it('decodes numeric, hex and named entities', () => {
    expect(decodeEntities('don&#39;t &quot;stop&quot; &#x27;x&#x27; &amp; &hellip;')).toBe('don\'t "stop" \'x\' & …')
  })

  it('leaves unknown or invalid entities alone', () => {
    expect(decodeEntities('&bogus; &#0; &#xD800; &#99999999;')).toBe('&bogus; &#0; &#xD800; &#99999999;')
  })
})

describe('keywordMatches', () => {
  it('matches whole words only', () => {
    expect(keywordMatches('he said it again in the rain', 'ai')).toBe(false)
    expect(keywordMatches('the start of the party', 'art')).toBe(false)
    expect(keywordMatches('ai is everywhere', 'ai')).toBe(true)
    expect(keywordMatches('so much art!', 'art')).toBe(true)
  })

  it('supports phrases, Unicode and punctuation edges', () => {
    expect(keywordMatches('cats and dogs', 'cats and dogs')).toBe(true)
    expect(keywordMatches('日本 の ニュース', '日本')).toBe(true)
    expect(keywordMatches('straße im café', 'café')).toBe(true)
    expect(keywordMatches('learning c++ today', 'c++')).toBe(true)
  })

  it('opts into prefix matching with a trailing *', () => {
    expect(keywordMatches('politics and politicians', 'polit*')).toBe(true)
    expect(keywordMatches('geopolitics', 'polit*')).toBe(false)
  })
})

describe('statusMatchesRecipe', () => {
  it('matches keywords the server encoded as entities', () => {
    const s = status({ content: '<p>I don&#39;t care, &quot;breaking&quot; news</p>' })
    expect(statusMatchesRecipe(s, rules({ includeKeywords: ["don't"] }))).toBe(true)
    expect(statusMatchesRecipe(s, rules({ includeKeywords: ['breaking'] }))).toBe(true)
  })

  it('does not exclude on a substring of another word', () => {
    const s = status({ content: '<p>he said it again</p>' })
    expect(statusMatchesRecipe(s, rules({ excludeKeywords: ['ai'] }))).toBe(true)
  })

  it('looks at the content warning, alt text and poll options', () => {
    const cw = status({ spoilerText: 'politics', content: '<p>my day</p>' })
    expect(statusMatchesRecipe(cw, rules({ excludeKeywords: ['politics'] }))).toBe(false)
    const alt = status({ mediaAttachments: [{ type: 'image', description: 'a sunset over the bay' }] })
    expect(statusMatchesRecipe(alt, rules({ includeKeywords: ['sunset'] }))).toBe(true)
    const poll = status({ poll: { options: [{ title: 'giveaway' }, { title: 'other' }] } })
    expect(statusMatchesRecipe(poll, rules({ excludeKeywords: ['giveaway'] }))).toBe(false)
  })

  it('still applies tag rules', () => {
    const s = status({ tags: [{ name: 'Cats' }] })
    expect(statusMatchesRecipe(s, rules({ includeTags: ['cats'] }))).toBe(true)
    expect(statusMatchesRecipe(s, rules({ excludeTags: ['cats'] }))).toBe(false)
  })
})

describe('normalizeTagList', () => {
  it('keeps non-ASCII tags', () => {
    expect(normalizeTagList('#café #日本 #straße #fine')).toEqual(['café', '日本', 'straße', 'fine'])
  })

  it('still rejects things that are not tags', () => {
    expect(normalizeTagList(['a/b', 'a b', '#', 'ok_1'])).toEqual(['ok_1'])
  })
})

describe('parseAlgorithmSentence', () => {
  it('does not read apostrophes as quotes', () => {
    const r = parseAlgorithmSentence("cat's pics and dog's pics")
    expect(r.includeKeywords.join(' ')).not.toContain('s pics and dog')
  })

  it('still reads quoted phrases', () => {
    expect(parseAlgorithmSentence('posts with "open source" please').includeKeywords).toContain('open source')
    expect(parseAlgorithmSentence("show 'rust lang' news").includeKeywords).toContain('rust lang')
  })

  it('reads non-ASCII hashtags', () => {
    expect(parseAlgorithmSentence('#café no #politics').includeTags).toContain('café')
  })

  it('does not treat bare “local” as the local timeline source', () => {
    expect(parseAlgorithmSentence('local news without replies').source).toBe('home')
    expect(parseAlgorithmSentence('cat photos on local timeline').source).toBe('local')
  })
})

describe('tryDecodeAlgorithmShare', () => {
  it('flags newer payload versions', async () => {
    const { tryDecodeAlgorithmShare } = await import('../app/utils/algorithms')
    const json = JSON.stringify({ v: 2, n: 'Future', s: 'home' })
    const raw = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    expect(tryDecodeAlgorithmShare(raw)).toEqual({ ok: false, reason: 'version' })
  })
})

describe('recipeSummary', () => {
  it('shows what a recipe hides', () => {
    const r = sharePayloadToRecipe({
      v: 1,
      n: 'Quiet',
      s: 'home',
      it: ['art'],
      ik: ['one', 'two', 'three'],
      et: ['politics'],
      ek: ['giveaway'],
    })
    const sum = recipeSummary(r)
    expect(sum).toContain('−#politics')
    expect(sum).toContain("−'giveaway'")
    expect(sum).toContain('+2 more')
  })
})

describe('importPayload', () => {
  const payload = (over: Partial<AlgorithmSharePayload> = {}): AlgorithmSharePayload => ({
    v: 1,
    n: 'Same',
    s: 'home',
    it: ['cats'],
    ...over,
  })

  beforeEach(() => setActivePinia(createPinia()))

  it('returns the existing recipe for a true twin', () => {
    const store = useAlgorithmsStore()
    const a = store.importPayload(payload())!.recipe
    const again = store.importPayload(payload())!
    expect(again.recipe.id).toBe(a.id)
    expect(again.alreadyHad).toBe(true)
    expect(store.customRecipes).toHaveLength(1)
  })

  it('does not treat a different ranker or description as a twin', () => {
    const store = useAlgorithmsStore()
    const x = store.importPayload(payload({ r: 'x' }))!.recipe
    const tiktok = store.importPayload(payload({ r: 'tiktok' }))!.recipe
    const described = store.importPayload(payload({ r: 'tiktok', d: 'other words' }))!.recipe
    expect(tiktok.id).not.toBe(x.id)
    expect(tiktok.ranker).toBe('tiktok')
    expect(described.id).not.toBe(tiktok.id)
  })

  it('refuses to evict when full, and keeps everything it had', () => {
    const store = useAlgorithmsStore()
    for (let i = 0; i < MAX_CUSTOM; i++) expect(store.importPayload(payload({ n: `r${i}` }))).not.toBeNull()
    expect(store.isFull).toBe(true)
    const before = store.customRecipes.map((r) => r.id)
    expect(store.importPayload(payload({ n: 'one too many' }))).toBeNull()
    expect(store.customRecipes.map((r) => r.id)).toEqual(before)
    // A twin of something already saved still resolves while full
    expect(store.importPayload(payload({ n: 'r0' }))).not.toBeNull()
  })
})
