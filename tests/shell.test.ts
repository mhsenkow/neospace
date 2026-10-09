import { afterEach, describe, expect, it, vi } from 'vitest'
import { typeaheadMatch } from '../app/utils/typeahead'
import { measureKeyboard } from '../app/utils/keyboardDetect'
import { readSuiteLook, writeSuiteLook, SUITE_SHARED_KEY } from '../app/utils/suiteLook'

describe('menu typeahead', () => {
  const labels = ['Copy link', 'Bookmark', 'Block', ' Mute', 'Report']

  it('jumps to the next label starting with the key, wrapping', () => {
    expect(typeaheadMatch(labels, 'm', -1)).toBe(3)
    expect(typeaheadMatch(labels, 'r', 0)).toBe(4)
    expect(typeaheadMatch(labels, 'c', 2)).toBe(0)
  })

  it('cycles items on a repeated letter and extends multi-letter queries in place', () => {
    expect(typeaheadMatch(labels, 'b', 1)).toBe(2)
    expect(typeaheadMatch(labels, 'bb', 2)).toBe(1)
    expect(typeaheadMatch(labels, 'bl', 2)).toBe(2)
    expect(typeaheadMatch(labels, 'bo', 2)).toBe(1)
  })

  it('returns -1 for no match / empty input', () => {
    expect(typeaheadMatch(labels, 'z', 0)).toBe(-1)
    expect(typeaheadMatch(labels, ' ', 0)).toBe(-1)
    expect(typeaheadMatch([], 'a', 0)).toBe(-1)
  })
})

function stubViewport(vv: { height: number; offsetTop?: number; scale?: number }, focused = false) {
  const activeElement = focused
    ? { closest: () => ({}), matches: () => true }
    : { closest: () => null, matches: () => false }
  vi.stubGlobal('document', { activeElement, documentElement: { clientHeight: 800 } })
  vi.stubGlobal('window', {
    innerHeight: 800,
    outerHeight: 800,
    screen: { availHeight: 800 },
    visualViewport: { offsetTop: 0, scale: 1, ...vv },
    matchMedia: () => ({ matches: true }),
  })
}

describe('keyboard detect — pinch zoom', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('treats an overlay-sized viewport drop as a keyboard', () => {
    stubViewport({ height: 450 }, true)
    expect(measureKeyboard()).toEqual({ inset: 350, open: true })
  })

  it('ignores a zoomed-in visual viewport with no focused field', () => {
    stubViewport({ height: 400, offsetTop: 100, scale: 2 })
    expect(measureKeyboard()).toEqual({ inset: 0, open: false })
  })
})

describe('suite look blob', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ignores a non-object blob instead of spreading array indexes into it', () => {
    const store = new Map<string, string>([[SUITE_SHARED_KEY, '["dark","x"]']])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    })
    expect(readSuiteLook()).toEqual({})
    writeSuiteLook({ theme: 'dark' })
    expect(JSON.parse(store.get(SUITE_SHARED_KEY)!)).toEqual({ theme: 'dark' })
  })
})
