/**
 * Load only the Google Fonts needed for the active chrome + type face.
 * Avoids the previous ~15-family megabundle on every page.
 */

import type { NeoFontId, NeoUiId } from './appearance'

const FAMILY_QUERY: Record<string, string> = {
  'Source Sans 3': 'family=Source+Sans+3:wght@400;500',
  'Source Serif 4': 'family=Source+Serif+4:opsz,wght@8..60,400;8..60,500',
  'Source Code Pro': 'family=Source+Code+Pro:wght@400;500',
  'Josefin Sans': 'family=Josefin+Sans:wght@400;500',
  'Josefin Slab': 'family=Josefin+Slab:wght@400;500',
  'Cormorant Garamond': 'family=Cormorant+Garamond:wght@400;500',
  'Space Mono': 'family=Space+Mono:wght@400;700',
  'IBM Plex Sans': 'family=IBM+Plex+Sans:wght@400;500',
  'IBM Plex Serif': 'family=IBM+Plex+Serif:wght@400;500',
  'IBM Plex Mono': 'family=IBM+Plex+Mono:wght@400;500',
  Oswald: 'family=Oswald:wght@400;500',
  'Roboto Slab': 'family=Roboto+Slab:wght@400;500',
  'Share Tech Mono': 'family=Share+Tech+Mono',
  'Libre Franklin': 'family=Libre+Franklin:wght@400;500',
  Newsreader: 'family=Newsreader:opsz,wght@6..72,400;6..72,500',
}

/** Which remote families each chrome uses for body + UI */
const UI_FAMILIES: Record<NeoUiId, Partial<Record<NeoFontId | 'ui', string[]>>> = {
  braun: {}, // system fonts
  monocle: {
    ui: ['Source Sans 3'],
    sans: ['Source Sans 3'],
    serif: ['Source Serif 4'],
    book: ['Source Serif 4'],
    mono: ['Source Code Pro'],
  },
  bauhaus: {
    ui: ['Josefin Sans'],
    sans: ['Josefin Sans'],
    serif: ['Josefin Slab'],
    book: ['Cormorant Garamond'],
    mono: ['Space Mono'],
  },
  noyes: {
    ui: ['IBM Plex Sans'],
    sans: ['IBM Plex Sans'],
    serif: ['IBM Plex Serif'],
    book: ['IBM Plex Serif'],
    mono: ['IBM Plex Mono'],
  },
  ikea: {},
  military: {
    ui: ['Oswald'],
    sans: ['Oswald'],
    serif: ['Roboto Slab'],
    book: ['Roboto Slab'],
    mono: ['Share Tech Mono'],
  },
  terminal: {
    sans: ['IBM Plex Sans'],
    serif: ['IBM Plex Serif'],
  },
  nyt: {
    sans: ['Libre Franklin'],
    book: ['Newsreader'],
    mono: ['IBM Plex Mono'],
  },
}

const loaded = new Set<string>()

export function ensureFontsLoaded(ui: NeoUiId, font: NeoFontId) {
  if (typeof document === 'undefined') return

  const map = UI_FAMILIES[ui] || {}
  const names = new Set<string>([
    ...(map.ui || []),
    ...(map[font] || []),
    ...(map.mono || []),
  ])

  const queries: string[] = []
  for (const name of names) {
    if (loaded.has(name)) continue
    const q = FAMILY_QUERY[name]
    if (!q) continue
    loaded.add(name)
    queries.push(q)
  }
  if (!queries.length) return

  // Ensure preconnect once
  if (!document.querySelector('link[data-neo-font-preconnect]')) {
    const pre1 = document.createElement('link')
    pre1.rel = 'preconnect'
    pre1.href = 'https://fonts.googleapis.com'
    pre1.dataset.neoFontPreconnect = '1'
    document.head.appendChild(pre1)
    const pre2 = document.createElement('link')
    pre2.rel = 'preconnect'
    pre2.href = 'https://fonts.gstatic.com'
    pre2.crossOrigin = ''
    pre2.dataset.neoFontPreconnect = '1'
    document.head.appendChild(pre2)
  }

  const href = `https://fonts.googleapis.com/css2?${queries.join('&')}&display=swap`
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.neoFont = queries.join(',')
  document.head.appendChild(link)
}
