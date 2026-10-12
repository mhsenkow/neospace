/**
 * Load only the self-hosted font families needed for the active chrome + type face.
 * OpenDyslexic remains under /public/fonts (see _themes.scss).
 */

import type { NeoFontId, NeoUiId } from './appearance'

/** Dynamic imports — only the active chrome + face are fetched */
const FONT_LOADERS: Record<string, () => Promise<unknown>> = {
  'Source Sans 3': () =>
    Promise.all([
      import('@fontsource/source-sans-3/400.css'),
      import('@fontsource/source-sans-3/500.css'),
    ]),
  'Source Serif 4': () =>
    Promise.all([
      import('@fontsource/source-serif-4/400.css'),
      import('@fontsource/source-serif-4/500.css'),
    ]),
  'Source Code Pro': () =>
    Promise.all([
      import('@fontsource/source-code-pro/400.css'),
      import('@fontsource/source-code-pro/500.css'),
    ]),
  'Josefin Sans': () =>
    Promise.all([
      import('@fontsource/josefin-sans/400.css'),
      import('@fontsource/josefin-sans/500.css'),
    ]),
  'Josefin Slab': () =>
    Promise.all([
      import('@fontsource/josefin-slab/400.css'),
      import('@fontsource/josefin-slab/500.css'),
    ]),
  'Cormorant Garamond': () =>
    Promise.all([
      import('@fontsource/cormorant-garamond/400.css'),
      import('@fontsource/cormorant-garamond/500.css'),
    ]),
  'Space Mono': () =>
    Promise.all([
      import('@fontsource/space-mono/400.css'),
      import('@fontsource/space-mono/700.css'),
    ]),
  'IBM Plex Sans': () =>
    Promise.all([
      import('@fontsource/ibm-plex-sans/400.css'),
      import('@fontsource/ibm-plex-sans/500.css'),
    ]),
  'IBM Plex Serif': () =>
    Promise.all([
      import('@fontsource/ibm-plex-serif/400.css'),
      import('@fontsource/ibm-plex-serif/500.css'),
    ]),
  'IBM Plex Mono': () =>
    Promise.all([
      import('@fontsource/ibm-plex-mono/400.css'),
      import('@fontsource/ibm-plex-mono/500.css'),
    ]),
  Oswald: () =>
    Promise.all([
      import('@fontsource/oswald/400.css'),
      import('@fontsource/oswald/500.css'),
    ]),
  'Roboto Slab': () =>
    Promise.all([
      import('@fontsource/roboto-slab/400.css'),
      import('@fontsource/roboto-slab/500.css'),
    ]),
  'Share Tech Mono': () => import('@fontsource/share-tech-mono/400.css'),
  'Libre Franklin': () =>
    Promise.all([
      import('@fontsource/libre-franklin/400.css'),
      import('@fontsource/libre-franklin/500.css'),
    ]),
  Newsreader: () =>
    Promise.all([
      import('@fontsource/newsreader/400.css'),
      import('@fontsource/newsreader/500.css'),
    ]),
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
  // Mono is only fetched when the active face is mono (lazy), via map[font]
  const names = new Set<string>([...(map.ui || []), ...(map[font] || [])])

  for (const name of names) {
    if (loaded.has(name)) continue
    const loader = FONT_LOADERS[name]
    if (!loader) continue
    loaded.add(name)
    void loader().catch(() => {
      loaded.delete(name)
    })
  }
}

/** Families covered by local loaders (for tests / CSP verification) */
export const SELF_HOSTED_FONT_FAMILIES = Object.keys(FONT_LOADERS)
