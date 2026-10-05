// ============================================
// Appearance catalog — themes + chrome + type from ibm.io / wordcount
// ============================================

export type NeoThemeId =
  | 'auto'
  | 'light'
  | 'dark'
  | 'contrast'
  | 'paper'
  | 'glass'
  | 'frost'
  | 'brutal'
  | 'loom'
  | 'tank'
  | 'nes'

export type NeoUiId =
  | 'braun'
  | 'monocle'
  | 'bauhaus'
  | 'noyes'
  | 'ikea'
  | 'military'
  | 'terminal'
  | 'nyt'

export type NeoFontId = 'sans' | 'serif' | 'book' | 'mono' | 'dyslexic'
export type NeoFontSizeId = 'small' | 'medium' | 'large'

export interface ThemeOption {
  id: Exclude<NeoThemeId, 'auto'>
  label: string
  desc: string
  swatch: string
  ink: string
}

export interface UiOption {
  id: NeoUiId
  label: string
  desc: string
  sample: string
}

/** Cycle order matches wordcount theme button */
export const THEME_CYCLE: Exclude<NeoThemeId, 'auto'>[] = [
  'light',
  'dark',
  'contrast',
  'paper',
  'glass',
  'frost',
  'brutal',
  'loom',
  'tank',
  'nes',
]

/** Cycle order matches wordcount chrome radios */
export const UI_CYCLE: NeoUiId[] = [
  'braun',
  'monocle',
  'bauhaus',
  'noyes',
  'ikea',
  'military',
  'terminal',
  'nyt',
]

export const THEME_OPTIONS: ThemeOption[] = [
  { id: 'light', label: 'Light', desc: 'Warm Braun neutrals', swatch: '#f2f2f0', ink: '#c45c26' },
  { id: 'dark', label: 'Dark', desc: 'Quiet instrument night', swatch: '#161616', ink: '#e07a45' },
  { id: 'contrast', label: 'Contrast', desc: 'Max contrast, yellow marks', swatch: '#000000', ink: '#ffff00' },
  { id: 'paper', label: 'Paper', desc: 'Cream page, ink brown', swatch: '#e8e2d6', ink: '#8b4510' },
  { id: 'glass', label: 'Glass', desc: 'Cool lilac glass', swatch: '#e8eef8', ink: '#7c3aed' },
  { id: 'frost', label: 'Frost', desc: 'Deep night frost', swatch: '#070b16', ink: '#a78bfa' },
  { id: 'brutal', label: 'Brutal', desc: 'Hard edges, primary red', swatch: '#ffffff', ink: '#ff0000' },
  { id: 'loom', label: 'Loom', desc: 'Gold on near-black', swatch: '#0a0a0f', ink: '#d4a84b' },
  { id: 'tank', label: 'Tank', desc: 'CRT green field', swatch: '#0b1a22', ink: '#57a253' },
  { id: 'nes', label: 'NES', desc: 'Blue sky, pixel red', swatch: '#209cee', ink: '#e4002b' },
]

export const UI_OPTIONS: UiOption[] = [
  { id: 'braun', label: 'Braun', desc: 'Instrument · Helvetica · soft corners', sample: 'Aa' },
  { id: 'monocle', label: 'Monocle', desc: 'Editorial · Source Sans · open leading', sample: 'Aa' },
  { id: 'bauhaus', label: 'Bauhaus', desc: 'Geometric · square · wide tracking', sample: 'Aa' },
  { id: 'noyes', label: 'Noyes', desc: 'IBM Plex · precise 2px system', sample: 'Aa' },
  { id: 'ikea', label: 'Ikea', desc: 'Catalog · Verdana · heavy borders', sample: 'Aa' },
  { id: 'military', label: 'Military', desc: 'Condensed · uppercase chrome', sample: 'Aa' },
  { id: 'terminal', label: 'Terminal', desc: 'Mono UI · dashed panels', sample: '>_ ' },
  { id: 'nyt', label: 'NYT', desc: 'Broadsheet · serif masthead', sample: 'Aa' },
]

export const FONT_OPTIONS: { id: NeoFontId; label: string; desc: string; sample: string }[] = [
  { id: 'sans', label: 'Sans', desc: 'Mapped to chrome sans', sample: 'Aa' },
  { id: 'serif', label: 'Serif', desc: 'Mapped to chrome serif', sample: 'Aa' },
  { id: 'book', label: 'Book', desc: 'Long-form · wider leading', sample: 'Aa' },
  { id: 'mono', label: 'Mono', desc: 'Mapped to chrome mono', sample: 'Aa' },
  { id: 'dyslexic', label: 'Dyslexic', desc: 'OpenDyslexic · open spacing', sample: 'Aa' },
]

export const FONT_SIZE_OPTIONS: { id: NeoFontSizeId; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
]

/** Body type stacks — chrome × font (wordcount TYPE_FACES_WEB) */
export const TYPE_FACES: Record<NeoUiId, Record<NeoFontId, string>> = {
  braun: {
    sans: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
    serif: 'Times, "Times New Roman", serif',
    book: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
    mono: '"SF Mono", Menlo, Consolas, "Courier New", monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  monocle: {
    sans: '"Source Sans 3", "Avenir Next", "Gill Sans", "Gill Sans MT", sans-serif',
    serif: '"Source Serif 4", Georgia, "Times New Roman", serif',
    book: '"Source Serif 4", Palatino, Georgia, serif',
    mono: '"Source Code Pro", "SF Mono", Menlo, monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  bauhaus: {
    sans: '"Josefin Sans", Futura, "Century Gothic", "URW Gothic", sans-serif',
    serif: '"Josefin Slab", "Century Schoolbook", Georgia, serif',
    book: '"Cormorant Garamond", Didot, Georgia, serif',
    mono: '"Space Mono", "SF Mono", Menlo, monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  noyes: {
    sans: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
    serif: '"IBM Plex Serif", Georgia, serif',
    book: '"IBM Plex Serif", Palatino, Georgia, serif',
    mono: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  ikea: {
    sans: 'Verdana, Geneva, Tahoma, sans-serif',
    serif: 'Georgia, "Times New Roman", Times, serif',
    book: 'Palatino, "Palatino Linotype", Georgia, serif',
    mono: 'Consolas, "Lucida Console", "Courier New", monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  military: {
    sans: 'Oswald, "Arial Narrow", "Helvetica Neue Condensed", sans-serif',
    serif: '"Roboto Slab", "Courier New", serif',
    book: '"Roboto Slab", Georgia, serif',
    mono: '"Share Tech Mono", "Courier New", monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  terminal: {
    sans: '"IBM Plex Sans", Helvetica, Arial, sans-serif',
    serif: '"IBM Plex Serif", Georgia, serif',
    book: 'Georgia, "Times New Roman", Times, serif',
    mono: '"SF Mono", Menlo, Consolas, "Courier New", monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
  nyt: {
    sans: '"Libre Franklin", "Helvetica Neue", Helvetica, Arial, sans-serif',
    serif: 'Georgia, "Times New Roman", Times, serif',
    book: '"Newsreader", Georgia, "Times New Roman", serif',
    mono: '"IBM Plex Mono", Menlo, Consolas, monospace',
    dyslexic: 'OpenDyslexic, "Comic Sans MS", Arial, sans-serif',
  },
}

/** Chrome / chrome UI font (wordcount --ui) */
export const UI_FONTS: Record<NeoUiId, string> = {
  braun: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  monocle: '"Source Sans 3", "Avenir Next", "Gill Sans", "Gill Sans MT", sans-serif',
  bauhaus: '"Josefin Sans", Futura, "Century Gothic", "URW Gothic", sans-serif',
  noyes: '"IBM Plex Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
  ikea: 'Verdana, Geneva, Tahoma, sans-serif',
  military: 'Oswald, "Arial Narrow", "Helvetica Neue Condensed", sans-serif',
  terminal: '"SF Mono", Menlo, Consolas, "Courier New", monospace',
  nyt: 'Georgia, "Times New Roman", Times, serif',
}

const LEGACY_THEME: Record<string, NeoThemeId> = {
  hc: 'contrast',
  electric: 'frost',
  forest: 'tank',
  auto: 'auto',
}

export function normalizeTheme(raw: string | null | undefined): NeoThemeId {
  if (!raw) return 'auto'
  const mapped = LEGACY_THEME[raw] || raw
  if (mapped === 'auto') return 'auto'
  if (THEME_CYCLE.includes(mapped as Exclude<NeoThemeId, 'auto'>)) {
    return mapped as NeoThemeId
  }
  return 'auto'
}

export function normalizeUi(raw: string | null | undefined): NeoUiId {
  if (raw && UI_CYCLE.includes(raw as NeoUiId)) return raw as NeoUiId
  return 'braun'
}

export function normalizeFont(raw: string | null | undefined): NeoFontId {
  const ok: NeoFontId[] = ['sans', 'serif', 'book', 'mono', 'dyslexic']
  if (raw && ok.includes(raw as NeoFontId)) return raw as NeoFontId
  return 'sans'
}

export function resolveTheme(theme: NeoThemeId): Exclude<NeoThemeId, 'auto'> {
  if (theme !== 'auto') return theme
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

export function nextTheme(current: NeoThemeId): Exclude<NeoThemeId, 'auto'> {
  const resolved = resolveTheme(current)
  const idx = THEME_CYCLE.indexOf(resolved)
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]
}

export function nextUi(current: NeoUiId): NeoUiId {
  const idx = UI_CYCLE.indexOf(normalizeUi(current))
  return UI_CYCLE[(idx + 1) % UI_CYCLE.length]
}

export function applyAppearance(opts: {
  theme: NeoThemeId
  ui?: NeoUiId
  font?: NeoFontId
  fontSize?: NeoFontSizeId
}) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolved = resolveTheme(opts.theme)
  root.setAttribute('data-theme', resolved)

  const ui = normalizeUi(opts.ui)
  const font = normalizeFont(opts.font)
  root.setAttribute('data-ui', ui)
  root.setAttribute('data-font', font)
  if (opts.fontSize) root.setAttribute('data-font-size', opts.fontSize)

  const typeStack = TYPE_FACES[ui][font]
  const uiStack = UI_FONTS[ui]
  root.style.setProperty('--neo-font-family', typeStack)
  root.style.setProperty('--neo-font-family-heading', typeStack)
  root.style.setProperty('--neo-font-family-ui', uiStack)
  root.style.setProperty('--neo-font-family-mono', TYPE_FACES[ui].mono)

  // Reading measure / leading hints by face (CSS also sets per data-font)
  if (font === 'book') {
    root.style.setProperty('--neo-leading-body', '1.65')
    root.style.setProperty('--neo-measure', '52ch')
  } else if (font === 'dyslexic') {
    root.style.setProperty('--neo-leading-body', '1.7')
    root.style.setProperty('--neo-measure', '48ch')
  } else if (font === 'mono') {
    root.style.setProperty('--neo-leading-body', '1.45')
  } else {
    root.style.removeProperty('--neo-leading-body')
    root.style.removeProperty('--neo-measure')
  }

  // theme-color for mobile chrome
  const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    || document.querySelector('meta[name="theme-color"]')
  const swatch = THEME_OPTIONS.find((t) => t.id === resolved)?.swatch
  if (meta && swatch) meta.setAttribute('content', swatch)
}
