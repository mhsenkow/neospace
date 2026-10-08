/**
 * PWA install helpers — native beforeinstallprompt when Chrome offers it,
 * otherwise a manual “Add to Home screen” path (we can’t force Chrome’s ⋮ menu).
 */

const DISMISS_KEY = 'neo-install-dismissed'

export function useInstallApp() {
  const { $pwa } = useNuxtApp()
  const isStandalone = useMediaQuery('(display-mode: standalone)')

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

  const dismissed = ref(false)
  onMounted(() => {
    try {
      dismissed.value = localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      dismissed.value = false
    }
  })

  const isAndroid = computed(() => {
    if (typeof navigator === 'undefined') return false
    return /Android/i.test(navigator.userAgent)
  })

  const isIos = computed(() => {
    if (typeof navigator === 'undefined') return false
    return /iPhone|iPad|iPod/i.test(navigator.userAgent)
  })

  const alreadyInstalled = computed(
    () => !!pwa.value?.isPWAInstalled || isStandalone.value,
  )

  const canNativeInstall = computed(() => !!pwa.value?.showInstallPrompt)

  /** Show promo on Android (and iOS tips) when not already installed / dismissed. */
  const showPromo = computed(() => {
    if (alreadyInstalled.value || dismissed.value) return false
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
    dismissed.value = true
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
    pwa.value?.cancelInstall?.()
  }

  const clearDismiss = () => {
    dismissed.value = false
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
