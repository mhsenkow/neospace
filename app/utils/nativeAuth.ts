/**
 * Open Mastodon OAuth authorize in the system browser and return via Universal Link / scheme.
 */

import { Browser } from '@capacitor/browser'
import { isNativeShell } from '~/utils/nativeShell'

/** Start OAuth: native → in-app browser; web → full navigation. */
export async function openOAuthAuthorize(authUrl: string): Promise<void> {
  if (!isNativeShell()) {
    window.location.href = authUrl
    return
  }
  await Browser.open({ url: authUrl, presentationStyle: 'popover' })
}

export async function closeOAuthBrowser(): Promise<void> {
  if (!isNativeShell()) return
  try {
    await Browser.close()
  } catch {
    /* already closed */
  }
}
