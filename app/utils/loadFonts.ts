/**
 * Load only the self-hosted font families needed for the active chrome + type face.
 * OpenDyslexic remains under /public/fonts (see _themes.scss).
 */

import type { NeoFontId, NeoUiId } from './appearance'

type FaceWeights = { regular: () => Promise<unknown>; bold: () => Promise<unknown> }

/** Dynamic imports — regular + intentional bold (600/700), not synthesized faux-bold */
const FONT_LOADERS: Record<string, FaceWeights> = {
  'Source Sans 3': {
    regular: () => import('@fontsource/source-sans-3/400.css'),
    bold: () => import('@fontsource/source-sans-3/600.css'),
  },
  'Source Serif 4': {
    regular: () => import('@fontsource/source-serif-4/400.css'),
    bold: () => import('@fontsource/source-serif-4/600.css'),
  },
  'Source Code Pro': {
    regular: () => import('@fontsource/source-code-pro/400.css'),
    bold: () => import('@fontsource/source-code-pro/600.css'),
  },
  'Josefin Sans': {
    regular: () => import('@fontsource/josefin-sans/400.css'),
    bold: () => import('@fontsource/josefin-sans/600.css'),
  },
  'Josefin Slab': {
    regular: () => import('@fontsource/josefin-slab/400.css'),
    bold: () => import('@fontsource/josefin-slab/600.css'),
  },
  'Cormorant Garamond': {
    regular: () => import('@fontsource/cormorant-garamond/400.css'),
    bold: () => import('@fontsource/cormorant-garamond/600.css'),
  },
  'Space Mono': {
    regular: () => import('@fontsource/space-mono/400.css'),
    bold: () => import('@fontsource/space-mono/700.css'),
  },
  'IBM Plex Sans': {
    regular: () => import('@fontsource/ibm-plex-sans/400.css'),
    bold: () => import('@fontsource/ibm-plex-sans/600.css'),
  },
  'IBM Plex Serif': {
    regular: () => import('@fontsource/ibm-plex-serif/400.css'),
    bold: () => import('@fontsource/ibm-plex-serif/600.css'),
  },
  'IBM Plex Mono': {
    regular: () => import('@fontsource/ibm-plex-mono/400.css'),
    bold: () => import('@fontsource/ibm-plex-mono/600.css'),
  },
  Oswald: {
    regular: () => import('@fontsource/oswald/400.css'),
    bold: () => import('@fontsource/oswald/600.css'),
  },
  'Roboto Slab': {
    regular: () => import('@fontsource/roboto-slab/400.css'),
    bold: () => import('@fontsource/roboto-slab/600.css'),
  },
  'Share Tech Mono': {
    regular: () => import('@fontsource/share-tech-mono/400.css'),
    bold: () => import('@fontsource/share-tech-mono/400.css'),
  },
  'Libre Franklin': {
    regular: () => import('@fontsource/libre-franklin/400.css'),
    bold: () => import('@fontsource/libre-franklin/600.css'),
  },
  Newsreader: {
    regular: () => import('@fontsource/newsreader/400.css'),
    bold: () => import('@fontsource/newsreader/600.css'),
  },
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
const failed = new Set<string>()
let retryHooked = false
const MAX_FONT_RETRIES = 2

function loadFamily(name: string, weights: FaceWeights): Promise<void> {
  return Promise.all([weights.regular(), weights.bold()]).then(() => undefined)
}

function scheduleFamilyLoad(name: string, defer: boolean) {
  if (loaded.has(name) || typeof document === 'undefined') return
  const weights = FONT_LOADERS[name]
  if (!weights) return

  const run = () => {
    if (loaded.has(name)) return
    loaded.add(name)
    void loadFamily(name, weights)
      .then(() => {
        failed.delete(name)
      })
      .catch(() => {
        loaded.delete(name)
        failed.add(name)
        ensureFontRetryHook()
      })
  }

  if (defer && typeof requestIdleCallback === 'function') requestIdleCallback(run)
  else if (defer) queueMicrotask(run)
  else run()
}

/** Retry failed faces after connectivity returns — no theme toggle required */
function ensureFontRetryHook() {
  if (retryHooked || typeof window === 'undefined') return
  retryHooked = true
  let retries = 0
  const tryAgain = () => {
    if (!failed.size || retries >= MAX_FONT_RETRIES) return
    retries += 1
    const pending = [...failed]
    failed.clear()
    for (const name of pending) {
      if (loaded.has(name)) continue
      const weights = FONT_LOADERS[name]
      if (!weights) continue
      loaded.add(name)
      void loadFamily(name, weights)
        .then(() => failed.delete(name))
        .catch(() => {
          loaded.delete(name)
          failed.add(name)
        })
    }
  }
  window.addEventListener('online', tryAgain)
  window.addEventListener('focus', tryAgain)
}

/** Active UI family first; content family loads when different (idle when possible) */
export function resolveFontFamilies(ui: NeoUiId, font: NeoFontId): { critical: string[]; deferred: string[] } {
  const map = UI_FAMILIES[ui] || {}
  const uiNames = map.ui || []
  const bodyNames = map[font] || []
  const critical = [...new Set(uiNames.length ? uiNames : bodyNames)]
  const deferred = bodyNames.filter((n) => !critical.includes(n))
  return { critical, deferred }
}

export function ensureFontsLoaded(ui: NeoUiId, font: NeoFontId) {
  if (typeof document === 'undefined') return
  const { critical, deferred } = resolveFontFamilies(ui, font)
  for (const name of critical) scheduleFamilyLoad(name, false)
  for (const name of deferred) scheduleFamilyLoad(name, true)
}

/** Families covered by local loaders (for tests / CSP verification) */
export const SELF_HOSTED_FONT_FAMILIES = Object.keys(FONT_LOADERS)
