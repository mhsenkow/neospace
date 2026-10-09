import { describe, expect, it } from 'vitest'
import { parseStoredLayout } from '../app/stores/columns'
import {
  decodeAlgorithmShare,
  normalizeKeywordList,
  normalizeTagList,
  sharePayloadToRecipe,
} from '../app/utils/algorithms'

const encode = (obj: unknown) =>
  Buffer.from(JSON.stringify(obj), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

describe('board column layout storage', () => {
  it('drops entries without a known feed type or required param', () => {
    const parsed = parseStoredLayout({
      columns: [
        null,
        'home',
        { id: 'a', feedType: 'home' },
        { id: 'b', feedType: 'nope' },
        { id: 'c', feedType: 'group' },
        { id: 'd', feedType: 'group', groupTag: 'cats' },
        { id: 'e', feedType: 'algorithm', algorithmId: 42 },
      ],
      updatedAt: 5,
      dirty: true,
    })
    expect(parsed?.columns.map((c) => c.id)).toEqual(['a', 'd'])
    expect(parsed?.columns[1]).toMatchObject({ feedType: 'group', groupTag: 'cats', viewMode: 'flow' })
    expect(parsed?.updatedAt).toBe(5)
    expect(parsed?.dirty).toBe(true)
  })

  it('gives duplicate or missing ids a fresh one (they are v-for keys)', () => {
    const parsed = parseStoredLayout([
      { id: 'x', feedType: 'local' },
      { id: 'x', feedType: 'federated' },
      { feedType: 'bookmarks', viewMode: 'flip' },
    ])
    const ids = parsed!.columns.map((c) => c.id)
    expect(ids[0]).toBe('x')
    expect(new Set(ids).size).toBe(3)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
    expect(parsed!.columns[2]!.viewMode).toBe('flip')
  })

  it('rejects layouts with nothing usable', () => {
    expect(parseStoredLayout([])).toBeNull()
    expect(parseStoredLayout([{ feedType: 'bogus' }])).toBeNull()
    expect(parseStoredLayout({ columns: 'home' })).toBeNull()
    expect(parseStoredLayout(null)).toBeNull()
  })

  it('does not carry group / algorithm params onto other feed types', () => {
    const parsed = parseStoredLayout([
      { id: 'a', feedType: 'local', groupTag: 'cats', algorithmId: 'algo_1' },
    ])
    expect(parsed!.columns[0]).toEqual({ id: 'a', feedType: 'local', viewMode: 'flow' })
  })
})

describe('algorithm share hardening', () => {
  it('ignores non-string list entries instead of throwing', () => {
    expect(normalizeTagList([1, '#Cats', null, 'dogs'] as unknown as string[])).toEqual([
      'cats',
      'dogs',
    ])
    expect(normalizeKeywordList([{}, ' climate '] as unknown as string[])).toEqual(['climate'])
    expect(normalizeTagList(42 as unknown as string)).toEqual([])
  })

  it('imports a crafted link with wrong-typed fields without crashing', () => {
    const raw = encode({ v: 1, n: 'Cats', s: 'local', d: 7, a: ['x'], it: [3, 'cats'] })
    const payload = decodeAlgorithmShare(raw)
    expect(payload).not.toBeNull()
    const recipe = sharePayloadToRecipe(payload!)
    expect(recipe.description).toBeUndefined()
    expect(recipe.authorAcct).toBeUndefined()
    expect(recipe.includeTags).toEqual(['cats'])
  })

  it('caps curator attribution from hand-built links', () => {
    const payload = decodeAlgorithmShare(
      encode({ v: 1, n: 'Cats', s: 'home', a: 'a'.repeat(500), an: 'b'.repeat(500) }),
    )
    const recipe = sharePayloadToRecipe(payload!)
    expect(recipe.authorAcct).toHaveLength(80)
    expect(recipe.authorName).toHaveLength(80)
  })
})
