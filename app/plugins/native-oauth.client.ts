/**
 * Capacitor deep-link handler: Mastodon redirects to https://neospace.ibm.io/auth/callback
 * (Universal Link) or neospace://auth/callback — route into the existing callback page.
 */
import { App } from '@capacitor/app'
import { closeOAuthBrowser } from '~/utils/nativeAuth'
import {
  isNativeShell,
  isOAuthCallbackUrl,
  oauthCallbackRouteFromUrl,
} from '~/utils/nativeShell'

export default defineNuxtPlugin(() => {
  if (!isNativeShell()) return

  const router = useRouter()

  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!isOAuthCallbackUrl(url)) return
    await closeOAuthBrowser()
    const path = oauthCallbackRouteFromUrl(url)
    await router.replace(path)
  })
})
