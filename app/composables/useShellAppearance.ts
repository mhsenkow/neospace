/**
 * Shell-specific appearance: sidebar rail, Look cycles, density labels.
 * Uses settingsStore for theme application — does not own the theme store.
 */

import { useSettingsStore } from '~/stores/settings'
import { useColumnsStore } from '~/stores/columns'
import {
  THEME_OPTIONS,
  UI_OPTIONS,
  RADIUS_OPTIONS,
  DENSITY_OPTIONS,
  LINE_OPTIONS,
  resolveTheme,
} from '~/utils/appearance'

const SIDEBAR_RAIL_KEY = 'neospace_sidebar_rail'

/** Shared across layout + DesktopSidebar so rail class / data-rail stay in sync. */
const sidebarRail = ref(false)
const lookOpen = ref(false)
const lookAnnounce = ref('')

export function useShellAppearance() {
  const settingsStore = useSettingsStore()
  const columnsStore = useColumnsStore()

  const syncRailAttr = (on: boolean) => {
    if (typeof document === 'undefined') return
    document.documentElement.toggleAttribute('data-rail', on)
  }

  const loadSidebarRail = () => {
    if (typeof window === 'undefined') return
    try {
      sidebarRail.value = localStorage.getItem(SIDEBAR_RAIL_KEY) === '1'
      if (sidebarRail.value) lookOpen.value = true
    } catch {
      sidebarRail.value = false
    }
    syncRailAttr(sidebarRail.value)
  }

  const toggleSidebarRail = () => {
    sidebarRail.value = !sidebarRail.value
    // Rail hides text labels — keep Look cycles reachable as icon buttons
    if (sidebarRail.value) lookOpen.value = true
    syncRailAttr(sidebarRail.value)
    try {
      localStorage.setItem(SIDEBAR_RAIL_KEY, sidebarRail.value ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

  const applyTheme = () => {
    settingsStore.applyLocalAppearance()
  }

  const announceLook = (kind: string, label: string) => {
    lookAnnounce.value = `${kind}: ${label}`
  }

  const currentThemeLabel = computed(() => {
    const theme = settingsStore.localPreferences.theme
    if (theme === 'auto') {
      const resolved = resolveTheme('auto')
      const name = THEME_OPTIONS.find((t) => t.id === resolved)?.label || resolved
      return `Auto · ${name}`
    }
    return THEME_OPTIONS.find((t) => t.id === theme)?.label || theme
  })
  const currentUiLabel = computed(
    () =>
      UI_OPTIONS.find((u) => u.id === settingsStore.localPreferences.ui)?.label
      || settingsStore.localPreferences.ui,
  )
  const currentRadiusLabel = computed(
    () =>
      RADIUS_OPTIONS.find((r) => r.id === settingsStore.localPreferences.radius)?.label
      || settingsStore.localPreferences.radius,
  )
  const currentDensityLabel = computed(
    () =>
      DENSITY_OPTIONS.find((d) => d.id === settingsStore.localPreferences.density)?.label
      || settingsStore.localPreferences.density,
  )
  const currentLineLabel = computed(
    () =>
      LINE_OPTIONS.find((l) => l.id === settingsStore.localPreferences.line)?.label
      || settingsStore.localPreferences.line,
  )

  const cycleTheme = () => {
    settingsStore.cycleTheme()
    nextTick(() => announceLook('Theme', currentThemeLabel.value))
  }

  const cycleUi = () => {
    settingsStore.cycleUi()
    nextTick(() => announceLook('Chrome', currentUiLabel.value))
  }

  const cycleRadius = () => {
    settingsStore.cycleRadius()
    nextTick(() => announceLook('Corners', currentRadiusLabel.value))
  }

  const cycleDensity = () => {
    settingsStore.cycleDensity()
    nextTick(() => announceLook('Density', currentDensityLabel.value))
  }

  const cycleLine = () => {
    settingsStore.cycleLine()
    nextTick(() => announceLook('Lines', currentLineLabel.value))
  }

  const densityTitle = computed(() => {
    switch (columnsStore.deskDensity) {
      case 'tabs':
        return 'Focused tab — one wider feed at a time, with tabs for each column.'
      case 'roomy':
        return 'Roomy — about three to four views, scroll for the rest.'
      default:
        return 'Packed — up to six across (four on smaller desks), then scroll.'
    }
  })

  const densityLabel = computed(() => {
    switch (columnsStore.deskDensity) {
      case 'tabs':
        return 'Focused'
      case 'roomy':
        return 'Roomy'
      default:
        return 'Packed'
    }
  })

  return {
    sidebarRail,
    lookOpen,
    lookAnnounce,
    loadSidebarRail,
    toggleSidebarRail,
    syncRailAttr,
    applyTheme,
    announceLook,
    currentThemeLabel,
    currentUiLabel,
    currentRadiusLabel,
    currentDensityLabel,
    currentLineLabel,
    cycleTheme,
    cycleUi,
    cycleRadius,
    cycleDensity,
    cycleLine,
    densityTitle,
    densityLabel,
  }
}

export function categoryColor(category: string) {
  const key = ['tech', 'creative', 'gaming', 'social', 'news', 'trending', 'local', 'other'].includes(category)
    ? category
    : 'other'
  return `var(--neo-cat-${key})`
}

export function categoryTint(category: string) {
  return `color-mix(in srgb, ${categoryColor(category)} 13%, transparent)`
}
