import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  applyAppearance,
  MOTION_CYCLE,
  MOTION_OPTIONS,
  nextMotion,
  normalizeMotion,
  resolveMotionPersonality,
} from '../app/utils/appearance'
import { useSettingsStore } from '../app/stores/settings'

describe('Motion Personalities & 12-Principles Engine', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.unstubAllGlobals()
  })

  it('defines Match + 4 explicit motion personalities in cycle order', () => {
    expect(MOTION_OPTIONS.map((m) => m.id)).toEqual([
      'match',
      'lively',
      'crisp',
      'editorial',
      'still',
    ])
    expect(MOTION_CYCLE).toEqual(['match', 'lively', 'crisp', 'editorial', 'still'])
  })

  it('normalizes and cycles motion personalities cleanly', () => {
    expect(normalizeMotion(undefined)).toBe('match')
    expect(normalizeMotion('unknown')).toBe('match')
    expect(normalizeMotion(undefined, true)).toBe('still')
    expect(normalizeMotion('lively', true)).toBe('lively')

    expect(nextMotion('match')).toBe('lively')
    expect(nextMotion('lively')).toBe('crisp')
    expect(nextMotion('crisp')).toBe('editorial')
    expect(nextMotion('editorial')).toBe('still')
    expect(nextMotion('still')).toBe('match')
  })

  it('resolves Match personality from chrome, corners, and reduced-motion', () => {
    // Default expressive 12-Principles energy
    expect(resolveMotionPersonality({ motion: 'match', ui: 'braun', radius: 'match' })).toBe('lively')
    // Editorial chromes resolve to editorial unless softened by rounded corners
    expect(resolveMotionPersonality({ motion: 'match', ui: 'monocle', radius: 'match' })).toBe('editorial')
    expect(resolveMotionPersonality({ motion: 'match', ui: 'nyt', radius: 'match' })).toBe('editorial')
    expect(resolveMotionPersonality({ motion: 'match', ui: 'monocle', radius: 'bubble' })).toBe('lively')
    // Instrument / terminal chromes resolve to crisp
    expect(resolveMotionPersonality({ motion: 'match', ui: 'noyes', radius: 'match' })).toBe('crisp')
    expect(resolveMotionPersonality({ motion: 'match', ui: 'terminal', radius: 'match' })).toBe('crisp')
    // Reduced motion always resolves to still
    expect(
      resolveMotionPersonality({ motion: 'lively', ui: 'braun', reduceMotion: true }),
    ).toBe('still')
  })

  it('sets data-motion and syncs html.reduce-motion in applyAppearance', () => {
    const attrs = new Map<string, string>()
    const classes = new Set<string>()
    vi.stubGlobal('document', {
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        classList: {
          toggle: (c: string, force?: boolean) => {
            if (force) classes.add(c)
            else classes.delete(c)
          },
          add: (c: string) => classes.add(c),
          remove: (c: string) => classes.delete(c),
          contains: (c: string) => classes.has(c),
        },
        style: { setProperty: () => {} },
      },
      querySelectorAll: () => [],
    })

    applyAppearance({ theme: 'light', motion: 'lively', reduceMotion: false })
    expect(attrs.get('data-motion')).toBe('lively')
    expect(classes.has('reduce-motion')).toBe(false)

    applyAppearance({ theme: 'light', motion: 'still', reduceMotion: false })
    expect(attrs.get('data-motion')).toBe('still')
    expect(classes.has('reduce-motion')).toBe(true)

    applyAppearance({ theme: 'light', motion: 'crisp', reduceMotion: false })
    expect(attrs.get('data-motion')).toBe('crisp')
    expect(classes.has('reduce-motion')).toBe(false)
  })

  it('cycles motion in settingsStore and round-trips through JSON export/import', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    })

    const settings = useSettingsStore()
    expect(settings.localPreferences.motion).toBe('match')

    expect(settings.cycleMotion()).toBe('lively')
    expect(settings.localPreferences.motion).toBe('lively')
    expect(settings.localPreferences.reduceMotion).toBe(false)

    // Cycling to 'still' turns on reduceMotion; cycling past 'still' turns it off
    settings.updateAppearance({ motion: 'still' })
    expect(settings.localPreferences.motion).toBe('still')
    expect(settings.localPreferences.reduceMotion).toBe(true)

    expect(settings.cycleMotion()).toBe('match')
    expect(settings.localPreferences.motion).toBe('match')
    expect(settings.localPreferences.reduceMotion).toBe(false)

    // Export / import JSON round-trip
    settings.updateAppearance({ motion: 'editorial' })
    const exported = settings.exportAppearanceJson()
    expect(JSON.parse(exported).motion).toBe('editorial')

    settings.resetAppearance()
    expect(settings.localPreferences.motion).toBe('match')

    settings.importAppearanceJson(exported)
    expect(settings.localPreferences.motion).toBe('editorial')
  })

  it('keeps prepaint.js and SCSS tokens in sync with data-motion and still overrides', () => {
    const root = resolve(__dirname, '..')
    const prepaint = readFileSync(resolve(root, 'public/boot/prepaint.js'), 'utf8')
    expect(prepaint).toContain("root.setAttribute('data-motion'")
    expect(prepaint).toContain('"lively"')
    expect(prepaint).toContain('"crisp"')
    expect(prepaint).toContain('"editorial"')
    expect(prepaint).toContain('"still"')

    const structural = readFileSync(resolve(root, 'app/assets/css/_structural.scss'), 'utf8')
    expect(structural).toContain('--neo-press-squash-x:')
    expect(structural).toContain('--neo-press-squash-y:')
    expect(structural).toContain('--neo-overshoot-scale:')
    expect(structural).toContain('--neo-delay-secondary:')
    expect(structural).toContain('--neo-stagger-step:')
    expect(structural).toContain("html[data-motion='still']")

    const themes = readFileSync(resolve(root, 'app/assets/css/_themes.scss'), 'utf8')
    expect(themes).toContain("html[data-motion='lively']")
    expect(themes).toContain("html[data-motion='crisp']")
    expect(themes).toContain("html[data-motion='editorial']")
  })
})
