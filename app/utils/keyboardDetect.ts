/**
 * Soft-keyboard detection shared by sheets (vv pin) and docks (bottom inset).
 *
 * Two regimes:
 * - Overlay (iOS / some Android): layout height stays large; visualViewport shrinks → inset ≥ 100.
 * - resizes-content (Android Chrome): layout + vv shrink together → inset ≈ 0; detect via
 *   focused text field + vv height vs screen / pre-focus baseline.
 */

export type KeyboardMeasure = {
  /** Overlay lift for fixed docks (0 when resizes-content already shrank layout). */
  inset: number
  /** Soft keyboard likely covering the lower screen. */
  open: boolean
}

let baselineVvHeight = 0

const TEXT_FOCUS_SEL =
  'textarea, input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="hidden"]), select, [contenteditable="true"]'

export function hasTextFocus(): boolean {
  if (typeof document === 'undefined') return false
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return !!el.closest?.(TEXT_FOCUS_SEL) || el.matches?.(TEXT_FOCUS_SEL)
}

/** Call when no text field is focused so resizes-content drops can be measured. */
export function captureKeyboardBaseline() {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  if (!vv || hasTextFocus()) return
  baselineVvHeight = vv.height
}

export function measureKeyboard(): KeyboardMeasure {
  if (typeof window === 'undefined') return { inset: 0, open: false }
  const vv = window.visualViewport
  if (!vv) return { inset: 0, open: false }

  const inset = Math.max(
    0,
    Math.round(window.innerHeight - vv.height - vv.offsetTop),
    Math.round(document.documentElement.clientHeight - vv.height - vv.offsetTop),
  )

  // Overlay keyboards
  if (inset >= 100) return { inset, open: true }

  // resizes-content / layout already shrunk — only while a text field is focused
  if (!hasTextFocus()) return { inset: 0, open: false }

  // Don't treat small desktop / split windows as a soft keyboard
  const touchish =
    window.matchMedia('(max-width: 1023px)').matches ||
    window.matchMedia('(pointer: coarse)').matches
  if (!touchish) return { inset: 0, open: false }

  const screenH = window.screen?.availHeight || window.outerHeight || 0
  if (screenH > 0 && vv.height < screenH * 0.72 && screenH - vv.height >= 140) {
    return { inset: 0, open: true }
  }
  if (baselineVvHeight > 0 && baselineVvHeight - vv.height >= 120) {
    return { inset: 0, open: true }
  }

  return { inset: 0, open: false }
}
