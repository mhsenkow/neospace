/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useThemeStore } from '../app/stores/theme'

describe('theme store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    document.body.className = ''
    document.head
      .querySelectorAll('#neospace-chaos-styles, #neospace-chaos-dynamic')
      .forEach((n) => n.remove())
    localStorage.clear()
  })

  it('sanitizes custom CSS on set', () => {
    const theme = useThemeStore()
    theme.setUserCustomCSS('@font-face { src: url(https://e.x/f) } .z { color: red; }')
    expect(theme.userCustomCSS).toContain('blocked font face')
    expect(theme.userCustomCSS).toContain('color: red')
    expect(theme.safeCustomCSS).toBe(theme.userCustomCSS)
  })

  it('toggles chaos mode and injects a style element', () => {
    const theme = useThemeStore()
    theme.setUserCustomCSS('.z { color: blue; }')
    theme.enableChaosMode()
    expect(theme.isChaosMode).toBe(true)
    expect(document.body.classList.contains('chaos-active')).toBe(true)
    expect(document.getElementById('neospace-chaos-styles')?.textContent).toContain('color: blue')

    theme.disableChaosMode()
    expect(theme.isChaosMode).toBe(false)
    expect(document.body.classList.contains('chaos-active')).toBe(false)
    expect(document.getElementById('neospace-chaos-styles')).toBeNull()
  })

  it('honors the profile-css escape hatch', () => {
    const theme = useThemeStore()
    theme.setUserCustomCSS('.z { color: green; }')
    theme.enableChaosMode()
    theme.setProfileCssDisabled(true)
    expect(localStorage.getItem('neospace_disable_profile_css')).toBe('1')
    expect(theme.isChaosMode).toBe(false)
    expect(theme.isSafeMode()).toBe(true)
  })
})
