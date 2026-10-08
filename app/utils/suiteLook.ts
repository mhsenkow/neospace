/**
 * Shared look across the ibm.io suite (`ibm.tools.shared`).
 * Same key as wordcount/lib/suite.js and bruh/src/suite/look.ts —
 * theme / chrome / type follow you when hopping bruh → loom → neospace.
 */

import type { NeoFontId, NeoThemeId, NeoUiId } from '~/utils/appearance'
import {
  FONT_OPTIONS,
  THEME_OPTIONS,
  UI_OPTIONS,
  normalizeFont,
  normalizeTheme,
  normalizeUi,
} from '~/utils/appearance'

export const SUITE_SHARED_KEY = 'ibm.tools.shared'

export type SuiteLookSlice = {
  theme?: NeoThemeId
  ui?: NeoUiId
  font?: NeoFontId
}

type SharedBlob = Record<string, unknown>

function readBlob(): SharedBlob {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SUITE_SHARED_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as SharedBlob) : {}
  } catch {
    return {}
  }
}

function writeBlob(partial: SharedBlob) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SUITE_SHARED_KEY, JSON.stringify({ ...readBlob(), ...partial }))
  } catch {
    /* quota / private */
  }
}

const THEME_IDS = THEME_OPTIONS.map((t) => t.id)
const UI_IDS = UI_OPTIONS.map((u) => u.id)
const FONT_IDS = FONT_OPTIONS.map((f) => f.id)

/** Read suite-shared theme/ui/font when present and valid. */
export function readSuiteLook(): SuiteLookSlice {
  const blob = readBlob()
  const out: SuiteLookSlice = {}
  if (typeof blob.theme === 'string') {
    const theme = normalizeTheme(blob.theme)
    if (theme === 'auto' || THEME_IDS.includes(theme as (typeof THEME_IDS)[number])) {
      out.theme = theme
    }
  }
  if (typeof blob.ui === 'string' && UI_IDS.includes(blob.ui as (typeof UI_IDS)[number])) {
    out.ui = normalizeUi(blob.ui)
  }
  if (typeof blob.font === 'string' && FONT_IDS.includes(blob.font as (typeof FONT_IDS)[number])) {
    out.font = normalizeFont(blob.font)
  }
  return out
}

/** Publish NeoSpace look into the suite blob (other tools pick it up). */
export function writeSuiteLook(slice: SuiteLookSlice) {
  const partial: SharedBlob = {}
  if (slice.theme !== undefined) partial.theme = slice.theme
  if (slice.ui !== undefined) partial.ui = slice.ui
  if (slice.font !== undefined) partial.font = slice.font
  if (!Object.keys(partial).length) return
  writeBlob(partial)
}

/** Surface NeoSpace in wordcount's recent-tools list. */
export function rememberSuiteVisit(id = 'neospace') {
  const blob = readBlob()
  const recent = Array.isArray(blob.recent)
    ? (blob.recent as unknown[]).filter((x) => x !== id)
    : []
  recent.unshift(id)
  writeBlob({ recent: recent.slice(0, 8) })
}

/** Follow sibling tabs/tools editing the shared look. */
export function listenSuiteLook(onChange: (slice: SuiteLookSlice) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => {
    if (e.key !== SUITE_SHARED_KEY) return
    onChange(readSuiteLook())
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
