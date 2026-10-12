/**
 * PWA install helpers — native beforeinstallprompt when Chrome offers it,
 * otherwise a manual “Add to Home screen” path (we can’t force Chrome’s ⋮ menu).
 */

import type { Ref } from 'vue'
import { STANDALONE_MQ, isStandaloneNow } from '~/composables/useStandaloneShell'

const DISMISS_KEY = 'neo-install-dismissed'

const readDismissed = () => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Shared + read synchronously (client-only SPA). Set per-instance onMounted, the
 * promo rendered and animated out on every boot for people who had dismissed it,
 * and a dismiss / clearDismiss from one caller never reached the others.
 */
let dismissed: Ref<boolean> | null = null

export function useInstallApp() {
  const { $pwa } = useNuxtApp()
  dismissed ??= ref(readDismissed())
  const dismissedRef = dismissed
  // Same definition as the shell: standalone, minimal-ui, fullscreen or iOS home-screen
  const isStandalone = useMediaQuery(STANDALONE_MQ)

  const pwa = computed(
    () =>
      $pwa as
        | {
            showInstallPrompt?: boolean
            isPWAInstalled?: boolean
            install?: () => Promise<unknown>
            cancelInstall?: () => void
          }
        | undefined,
  )

  const isAndroid = computed(() => {
    if (typeof navigator === 'undefined') return false
    return /Android/i.test(navigator.userAgent)
  })

  const isIos = computed(() => {
    if (typeof navigator === 'undefined') return false
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return true
    // iPadOS 13+ reports a Mac user agent — a touch screen tells it apart from a real Mac
    return /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1
  })

  const alreadyInstalled = computed(
    () => !!pwa.value?.isPWAInstalled || isStandalone.value || isStandaloneNow(),
  )

  const canNativeInstall = computed(() => !!pwa.value?.showInstallPrompt)

  /** Show promo on Android (and iOS tips) when not already installed / dismissed. */
  const showPromo = computed(() => {
    if (alreadyInstalled.value || dismissedRef.value) return false
    return isAndroid.value || isIos.value || canNativeInstall.value
  })

  const installNative = async () => {
    try {
      await pwa.value?.install?.()
    } catch {
      /* user cancelled */
    }
  }

  const dismissPromo = () => {
    dismissedRef.value = true
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    pwa.value?.cancelInstall?.()
  }

  const clearDismiss = () => {
    dismissedRef.value = false
    try {
      localStorage.removeItem(DISMISS_KEY)
    } catch {
      /* ignore */
    }
  }

  return {
    pwa,
    isAndroid,
    isIos,
    alreadyInstalled,
    canNativeInstall,
    showPromo,
    installNative,
    dismissPromo,
    clearDismiss,
  }
}
