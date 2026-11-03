import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  allowsBottomNavAutoHide,
  classifySurface,
  defaultSidebarRailForWidth,
} from '../app/composables/useBreakpoint'
import { measureKeyboard } from '../app/utils/keyboardDetect'

describe('classifySurface', () => {
  it('maps representative phone / tablet / desk viewports', () => {
    expect(classifySurface(375, 812)).toBe('phonePortrait')
    expect(classifySurface(844, 390)).toBe('phoneLandscape')
    expect(classifySurface(768, 1024)).toBe('tabletPortrait')
    expect(classifySurface(820, 1180)).toBe('tabletPortrait')
    expect(classifySurface(1024, 768)).toBe('tabletLandscape')
    expect(classifySurface(1366, 1024)).toBe('tabletLandscape')
    expect(classifySurface(1440, 900)).toBe('desk')
  })

  it('treats coarse pointer at ≥1024 as tablet landscape', () => {
    expect(classifySurface(1280, 800, true)).toBe('tabletLandscape')
  })

  it('keeps short landscape under desk width as phone landscape', () => {
    expect(classifySurface(667, 375)).toBe('phoneLandscape')
    expect(classifySurface(1024, 400)).toBe('tabletLandscape')
  })
})

describe('defaultSidebarRailForWidth', () => {
  it('defaults rail on for tablet portrait and mid tablet landscape', () => {
    expect(defaultSidebarRailForWidth(768)).toBe(true)
    expect(defaultSidebarRailForWidth(1024)).toBe(true)
    expect(defaultSidebarRailForWidth(1180)).toBe(true)
  })

  it('defaults rail off on phones and wide desks', () => {
    expect(defaultSidebarRailForWidth(375)).toBe(false)
    expect(defaultSidebarRailForWidth(767)).toBe(false)
    expect(defaultSidebarRailForWidth(1181)).toBe(false)
    expect(defaultSidebarRailForWidth(1440)).toBe(false)
  })
})

describe('allowsBottomNavAutoHide', () => {
  it('only enables vertical auto-hide for phone portrait bottom tabs', () => {
    expect(allowsBottomNavAutoHide(375, 812)).toBe(true)
    expect(allowsBottomNavAutoHide(844, 390)).toBe(false)
    expect(allowsBottomNavAutoHide(768, 1024)).toBe(false)
    expect(allowsBottomNavAutoHide(1024, 768)).toBe(false)
  })
})

function stubKeyboardViewport(opts: {
  innerHeight: number
  vvHeight: number
  focused?: boolean
  matchMedia?: (query: string) => boolean
  offsetTop?: number
  scale?: number
}) {
  const focused = opts.focused ?? false
  const activeElement = focused
    ? { closest: () => ({}), matches: () => true }
    : { closest: () => null, matches: () => false }

  vi.stubGlobal('document', {
    activeElement,
    documentElement: { clientHeight: opts.innerHeight },
  })
  vi.stubGlobal('window', {
    innerHeight: opts.innerHeight,
    outerHeight: opts.innerHeight,
    screen: { availHeight: opts.innerHeight },
    visualViewport: {
      height: opts.vvHeight,
      offsetTop: opts.offsetTop ?? 0,
      scale: opts.scale ?? 1,
    },
    matchMedia: (query: string) => ({
      matches: opts.matchMedia ? opts.matchMedia(query) : true,
    }),
  })
}

describe('measureKeyboard across surfaces', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects overlay keyboard on phone landscape (844×390)', () => {
    stubKeyboardViewport({
      innerHeight: 390,
      vvHeight: 220,
      focused: true,
      matchMedia: (q) => q.includes('max-width: 1023px') || q.includes('pointer: coarse'),
    })
    expect(measureKeyboard()).toEqual({ inset: 170, open: true })
  })

  it('detects overlay keyboard on tablet portrait (768×1024)', () => {
    stubKeyboardViewport({
      innerHeight: 1024,
      vvHeight: 620,
      focused: true,
      matchMedia: (q) => q.includes('max-width: 1023px') || q.includes('pointer: coarse'),
    })
    expect(measureKeyboard()).toEqual({ inset: 404, open: true })
  })

  it('treats large overlay inset as open even without focus', () => {
    stubKeyboardViewport({
      innerHeight: 1024,
      vvHeight: 620,
      focused: false,
      matchMedia: (q) => q.includes('max-width: 1023px'),
    })
    expect(measureKeyboard()).toEqual({ inset: 404, open: true })
  })

  it('does not treat desk mouse windows as a soft keyboard without overlay inset', () => {
    stubKeyboardViewport({
      innerHeight: 900,
      vvHeight: 880,
      focused: true,
      matchMedia: () => false,
    })
    expect(measureKeyboard()).toEqual({ inset: 0, open: false })
  })
})
