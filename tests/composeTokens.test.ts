import { describe, expect, it, vi } from 'vitest'
import {
  applyToken,
  createKeyedCache,
  filterEmojis,
  findComposeToken,
  insertionFor,
  type ComposeSuggestion,
} from '../app/utils/composeTokens'

const at = (text: string, caret = text.length) => findComposeToken(text, caret)

describe('findComposeToken', () => {
  it.each([
    ['hi @ali', { kind: 'mention', start: 3, query: 'ali' }],
    ['@bob@remote.example', { kind: 'mention', start: 0, query: 'bob@remote.example' }],
    ['look #cat', { kind: 'hashtag', start: 5, query: 'cat' }],
    ['(#café', { kind: 'hashtag', start: 1, query: 'café' }],
    ['so :blob', { kind: 'emoji', start: 3, query: 'blob' }],
    ['"@x', { kind: 'mention', start: 1, query: 'x' }],
  ] as const)('%s', (text, want) => {
    expect(at(text)).toMatchObject(want)
  })

  it.each([
    'mail me@example.com', // @ after a word char
    'issue a#1', // # after a word char
    'https://example.com', // : after a word char
    'at 10:30', // digits, and preceded by a word char
    'smile :)', // < 2 chars
    'just a # sign', // empty hashtag query
    'plain text',
  ])('ignores %j', (text) => {
    expect(at(text)).toBeNull()
  })

  it('only considers the text before the caret', () => {
    const text = 'hello @ali and #cats'
    expect(at(text, 10)).toMatchObject({ kind: 'mention', query: 'ali' })
    expect(at(text, 6)).toBeNull() // caret right after "hello " — no token
    expect(at(text)).toMatchObject({ kind: 'hashtag', query: 'cats' })
  })

  it('respects the enabled kinds', () => {
    expect(findComposeToken('#cats', 5, ['mention', 'emoji'])).toBeNull()
  })
})

describe('applyToken', () => {
  it('replaces only the active token and keeps surrounding text', () => {
    const text = 'hi @ali and #cats tail'
    const token = findComposeToken(text, 7)! // caret after "@ali"
    expect(token).toMatchObject({ kind: 'mention', query: 'ali', start: 3, end: 7 })
    const out = applyToken(text, token, '@alice@x.example')
    expect(out.text).toBe('hi @alice@x.example and #cats tail')
    expect(out.caret).toBe('hi @alice@x.example '.length)
  })

  it('does not double the space when one already follows', () => {
    const text = 'a #ca b'
    const token = findComposeToken(text, 5)!
    expect(applyToken(text, token, '#cats').text).toBe('a #cats b')
  })

  it('leaves earlier lookalike tokens untouched', () => {
    const text = '#cat and #cat'
    const token = findComposeToken(text, text.length)!
    const out = applyToken(text, token, '#catnip')
    expect(out.text).toBe('#cat and #catnip ')
  })
})

describe('insertionFor', () => {
  it('formats each kind', () => {
    const items: ComposeSuggestion[] = [
      { kind: 'mention', key: '1', account: { acct: 'a@b.c' } as never },
      { kind: 'hashtag', key: 'cats', name: 'cats', uses: null },
      { kind: 'emoji', key: 'blob', shortcode: 'blob', url: 'u' },
    ]
    expect(items.map(insertionFor)).toEqual(['@a@b.c', '#cats', ':blob:'])
  })
})

describe('filterEmojis', () => {
  const list = [
    { shortcode: 'blobcat', url: 'u1', staticUrl: 's1', visibleInPicker: true },
    { shortcode: 'cat_blob', url: 'u2', staticUrl: 's2', visibleInPicker: true },
    { shortcode: 'blobhidden', url: 'u3', staticUrl: 's3', visibleInPicker: false },
    { shortcode: 'dog', url: 'u4', staticUrl: 's4', visibleInPicker: true },
  ]
  it('ranks prefix matches first, skips unlisted, caps results', () => {
    const out = filterEmojis(list as never, 'blob')
    expect(out.map((e) => e.key)).toEqual(['blobcat', 'cat_blob'])
    expect(filterEmojis(list as never, 'blob', 1)).toHaveLength(1)
    expect(filterEmojis(list as never, '')).toEqual([])
  })
})

describe('createKeyedCache', () => {
  it('shares in-flight loads per key and expires by TTL', async () => {
    const cache = createKeyedCache<number>(1000)
    const load = vi.fn(async () => 1)
    const [a, b] = await Promise.all([cache.get('x', load, 0), cache.get('x', load, 10)])
    expect([a, b]).toEqual([1, 1])
    expect(load).toHaveBeenCalledTimes(1)
    await cache.get('y', load, 20) // other instance → own load
    expect(load).toHaveBeenCalledTimes(2)
    await cache.get('x', load, 2000) // expired
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('does not cache failures', async () => {
    const cache = createKeyedCache<number>(1000)
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(7)
    await expect(cache.get('x', load, 0)).rejects.toThrow('boom')
    await expect(cache.get('x', load, 1)).resolves.toBe(7)
  })
})
