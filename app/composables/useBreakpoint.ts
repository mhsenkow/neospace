/**
 * Shared reactive viewport breakpoints — one matchMedia listener per query.
 *
 * Surface model:
 * - Phone portrait: narrow + tall → header + bottom tabs + carousel board
 * - Phone landscape: short height → left rail, compact chrome
 * - Tablet portrait: 768–1023 + tall → sidebar rail + multi-column board
 * - Desk / tablet landscape: ≥1024 → desktop sidebar + board
 */

import { getCurrentScope, onScopeDispose, ref } from 'vue'

/** Legacy: any viewport that used the phone shell (≤1023). Prefer finer surfaces. */
export const DESK_MQ = '(min-width: 1024px)'
export const MOBILE_MQ = '(max-width: 1023px)'

/** Phone-width carousel shell (edge portals + full-bleed slides) */
export const CAROUSEL_SHELL_MQ = '(max-width: 767px)'

/** Phone portrait: narrow and not short */
export const PHONE_PORTRAIT_MQ =
  '(max-width: 767px) and (min-height: 501px)'

/** Phone landscape: short height, landscape, still under desk width */
export const PHONE_LANDSCAPE_MQ =
  '(max-height: 500px) and (orientation: landscape) and (max-width: 1023px)'

/** Tablet portrait: mid width, not phone-landscape short */
export const TABLET_PORTRAIT_MQ =
  '(min-width: 768px) and (max-width: 1023px) and (min-height: 501px)'

/** Tablet / coarse pointer from mid width up (iPad class) */
export const TABLET_TOUCH_MQ = '(min-width: 768px) and (pointer: coarse)'

/** Compact rail default band (tablet portrait + 11" landscape) */
export const TABLET_RAIL_DEFAULT_MQ = '(min-width: 768px) and (max-width: 1180px)'

/** Bottom-docked tab bar (phone portrait only — not landscape rail) */
export const BOTTOM_TAB_SHELL_MQ =
  '(max-width: 767px) and (min-height: 501px), (max-width: 767px) and (orientation: portrait)'

/** Sidebar / desk chrome from tablet portrait up */
export const SIDEBAR_SHELL_MQ = '(min-width: 768px)'

export type SurfaceKind =
  | 'phonePortrait'
  | 'phoneLandscape'
  | 'tabletPortrait'
  | 'tabletLandscape'
  | 'desk'

/** Pure classifier for tests and one-shot checks (no listeners). */
export function classifySurface(width: number, height: number, coarse = false): SurfaceKind {
  const landscape = width > height
  if (height <= 500 && landscape && width <= 1023) return 'phoneLandscape'
  if (width <= 767) return 'phonePortrait'
  if (width <= 1023) return 'tabletPortrait'
  if (coarse || width <= 1366) return width >= 1024 ? 'tabletLandscape' : 'tabletPortrait'
  return 'desk'
}

/**
 * Bottom-docked tab auto-hide only applies on phone portrait.
 * Phone landscape uses a left rail; tablet+ uses DesktopSidebar.
 */
export function allowsBottomNavAutoHide(width: number, height: number): boolean {
  return classifySurface(width, height) === 'phonePortrait'
}

/** Default collapsed sidebar rail when no localStorage preference is set. */
export function defaultSidebarRailForWidth(width: number): boolean {
  return width >= 768 && width <= 1180
}

function createMediaRef(query: string, defaultValue = false) {
  const matches = ref(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : defaultValue,
  )
  let listeners = 0
  let mq: MediaQueryList | null = null
  let onChange: ((e: MediaQueryListEvent) => void) | null = null

  const subscribe = () => {
    if (typeof window === 'undefined') return
    if (!mq) {
      mq = window.matchMedia(query)
      matches.value = mq.matches
      onChange = (e) => {
        matches.value = e.matches
      }
      mq.addEventListener?.('change', onChange)
    }
    listeners += 1
  }

  const unsubscribe = () => {
    listeners = Math.max(0, listeners - 1)
    if (listeners === 0 && mq && onChange) {
      mq.removeEventListener?.('change', onChange)
      mq = null
      onChange = null
    }
  }

  return { matches, subscribe, unsubscribe }
}

/** Subscribe for the lifetime of the caller's effect scope (component / store). */
function track(media: ReturnType<typeof createMediaRef>) {
  media.subscribe()
  if (getCurrentScope()) onScopeDispose(media.unsubscribe)
  return media.matches
}

const mobileRef = createMediaRef(MOBILE_MQ)
const deskRef = createMediaRef(DESK_MQ)
const carouselRef = createMediaRef(CAROUSEL_SHELL_MQ)
const phonePortraitRef = createMediaRef(PHONE_PORTRAIT_MQ)
const phoneLandscapeRef = createMediaRef(PHONE_LANDSCAPE_MQ)
const tabletPortraitRef = createMediaRef(TABLET_PORTRAIT_MQ)
const tabletTouchRef = createMediaRef(TABLET_TOUCH_MQ)
const tabletRailDefaultRef = createMediaRef(TABLET_RAIL_DEFAULT_MQ)
const bottomTabRef = createMediaRef(BOTTOM_TAB_SHELL_MQ)
const sidebarShellRef = createMediaRef(SIDEBAR_SHELL_MQ)

/** True at viewport widths ≤1023px (legacy phone+tablet-portrait shell). */
export function useMobileViewport() {
  return track(mobileRef)
}

/** True at viewport widths ≥1024px. */
export function useDeskViewport() {
  return track(deskRef)
}

/** Full-bleed swipe carousel + edge portals (phone widths). */
export function useCarouselShell() {
  return track(carouselRef)
}

/** Phone portrait (narrow + tall enough for bottom tabs). */
export function usePhonePortrait() {
  return track(phonePortraitRef)
}

/** Phone landscape short shell — left nav rail. */
export function usePhoneLandscape() {
  return track(phoneLandscapeRef)
}

/** Tablet portrait — rail + multi-column board. */
export function useTabletPortrait() {
  return track(tabletPortraitRef)
}

/** Coarse pointer at tablet+ widths. */
export function useTabletTouch() {
  return track(tabletTouchRef)
}

/** Prefer collapsed sidebar rail by default (768–1180). */
export function useTabletRailDefault() {
  return track(tabletRailDefaultRef)
}

/** Bottom-docked MobileTabBar (not landscape left rail). */
export function useBottomTabShell() {
  return track(bottomTabRef)
}

/** DesktopSidebar visible (tablet portrait and up). */
export function useSidebarShell() {
  return track(sidebarShellRef)
}

/** Reactive matchMedia result for an arbitrary media query. */
export function useMediaQuery(query: string, defaultValue = false) {
  return track(createMediaRef(query, defaultValue))
}
