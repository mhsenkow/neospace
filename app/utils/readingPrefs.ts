/**
 * Server reading preferences (Settings → Preferences → Appearance on Mastodon) applied to post cards:
 *  - reading:expand:media    default | show_all | hide_all
 *  - reading:expand:spoilers always expand content warnings
 *  - reading:autoplay:gifs   animate GIFs / looping clips automatically
 */

export type ExpandMedia = 'default' | 'show_all' | 'hide_all'

export interface ReadingPrefs {
  expandMedia: ExpandMedia
  expandSpoilers: boolean
  autoplayGifs: boolean
}

/** What a missing / unloaded preference means: Mastodon's own defaults. */
export const DEFAULT_READING_PREFS: ReadingPrefs = Object.freeze({
  expandMedia: 'default',
  expandSpoilers: false,
  autoplayGifs: true,
}) as ReadingPrefs

type RawPrefs = Partial<{
  'reading:expand:media': unknown
  'reading:expand:spoilers': unknown
  'reading:autoplay:gifs': unknown
}> | null | undefined

export function readingPrefsFrom(raw: RawPrefs): ReadingPrefs {
  const media = raw?.['reading:expand:media']
  return {
    expandMedia: media === 'show_all' || media === 'hide_all' ? media : 'default',
    expandSpoilers: raw?.['reading:expand:spoilers'] === true,
    autoplayGifs: raw?.['reading:autoplay:gifs'] !== false,
  }
}

/**
 * Should media sit behind a "show" overlay? Sensitive media by default; `show_all` never
 * hides it (a collapsed CW still does — that is the CW's job); `hide_all` hides everything.
 */
export function mediaIsHidden(opts: {
  hasMedia: boolean
  hasSpoiler: boolean
  isSensitive: boolean
  cwOpen: boolean
  mediaRevealed: boolean
  expandMedia: ExpandMedia
}): boolean {
  if (!opts.hasMedia) return false
  if (opts.hasSpoiler && !opts.cwOpen) return true
  if (opts.mediaRevealed || opts.cwOpen) return false
  if (opts.expandMedia === 'hide_all') return true
  if (opts.expandMedia === 'show_all') return false
  return opts.isSensitive
}
