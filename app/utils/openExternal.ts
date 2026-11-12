/**
 * Open http(s) URLs outside the Capacitor WebView.
 * On web, keeps the normal new-tab behavior.
 */

import { Browser } from '@capacitor/browser'
import { isNativeShell } from '~/utils/nativeShell'

export function isSameAppOrigin(url: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const u = new URL(url, window.location.href)
    if (u.protocol === 'loomspace:' || u.protocol === 'neospace:') return true
    return u.origin === window.location.origin
  } catch {
    return false
  }
}

/** External http(s) → Cap Browser on native; otherwise window.open. */
export async function openExternalUrl(url: string): Promise<void> {
  const href = (url || '').trim()
  if (!href) return

  if (!isNativeShell() || isSameAppOrigin(href)) {
    window.open(href, '_blank', 'noopener,noreferrer')
    return
  }

  try {
    const abs = new URL(href, window.location.href)
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') {
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    await Browser.open({ url: abs.href })
  } catch {
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}
