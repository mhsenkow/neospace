import { describe, expect, it } from 'vitest'
import { DEFAULT_READING_PREFS, mediaIsHidden, readingPrefsFrom } from '../app/utils/readingPrefs'

describe('readingPrefsFrom', () => {
  it('falls back to Mastodon defaults when prefs are missing', () => {
    expect(readingPrefsFrom(null)).toEqual(DEFAULT_READING_PREFS)
    expect(readingPrefsFrom({ 'reading:expand:media': 'bogus' })).toEqual(DEFAULT_READING_PREFS)
  })
  it('reads the three server prefs', () => {
    expect(
      readingPrefsFrom({
        'reading:expand:media': 'hide_all',
        'reading:expand:spoilers': true,
        'reading:autoplay:gifs': false,
      }),
    ).toEqual({ expandMedia: 'hide_all', expandSpoilers: true, autoplayGifs: false })
  })
})

describe('mediaIsHidden', () => {
  const base = { hasMedia: true, hasSpoiler: false, isSensitive: false, cwOpen: false, mediaRevealed: false, expandMedia: 'default' as const }
  it('never hides when there is no media', () => {
    expect(mediaIsHidden({ ...base, hasMedia: false, isSensitive: true })).toBe(false)
  })
  it('default hides only sensitive media', () => {
    expect(mediaIsHidden(base)).toBe(false)
    expect(mediaIsHidden({ ...base, isSensitive: true })).toBe(true)
    expect(mediaIsHidden({ ...base, isSensitive: true, mediaRevealed: true })).toBe(false)
  })
  it('show_all reveals sensitive media but a collapsed CW still hides it', () => {
    expect(mediaIsHidden({ ...base, expandMedia: 'show_all', isSensitive: true })).toBe(false)
    expect(mediaIsHidden({ ...base, expandMedia: 'show_all', hasSpoiler: true })).toBe(true)
  })
  it('hide_all hides everything until revealed', () => {
    expect(mediaIsHidden({ ...base, expandMedia: 'hide_all' })).toBe(true)
    expect(mediaIsHidden({ ...base, expandMedia: 'hide_all', mediaRevealed: true })).toBe(false)
  })
})
