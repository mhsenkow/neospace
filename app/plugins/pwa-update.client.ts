/**
 * Service-worker updates never reload the page under the user. A new worker waits
 * (registerType: 'prompt'); we offer "Update ready · Reload" and also apply it
 * automatically when the tab is hidden with nothing open (see utils/pwaUpdate.ts).
 */
import { canApplyUpdateNow } from '~/utils/pwaUpdate'
import { useToastStore } from '~/stores/toast'
import { isNativeShell } from '~/utils/nativeShell'

type PwaHandle = {
  needRefresh?: boolean
  updateServiceWorker?: (reloadPage?: boolean) => Promise<void>
}

export default defineNuxtPlugin((nuxtApp) => {
  if (typeof window === 'undefined' || isNativeShell()) return
  const pwa = nuxtApp.$pwa as PwaHandle | undefined
  if (!pwa) return

  const modalOpen = () => !!document.querySelector('[aria-modal="true"]')
  const apply = () => {
    void pwa.updateServiceWorker?.(true)
  }

  let toasted = false
  const offer = () => {
    if (toasted) return
    toasted = true
    useToastStore().show({
      message: 'LoomSpace updated',
      kind: 'info',
      actionLabel: 'Refresh',
      onAction: apply,
      // Stay up until they refresh — a short toast is how the old build sticks around.
      duration: 0,
    })
  }

  watch(
    () => pwa.needRefresh,
    (need) => {
      if (!need) return
      if (canApplyUpdateNow({ hidden: document.hidden, modalOpen: modalOpen() })) apply()
      else offer()
    },
    { immediate: true },
  )

  document.addEventListener('visibilitychange', () => {
    if (!pwa.needRefresh) return
    if (canApplyUpdateNow({ hidden: document.hidden, modalOpen: modalOpen() })) apply()
  })
})
