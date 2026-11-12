/**
 * Keep http(s) outbound links in Cap Browser instead of navigating the WebView away.
 */
import { isNativeShell } from '~/utils/nativeShell'
import { isSameAppOrigin, openExternalUrl } from '~/utils/openExternal'

export default defineNuxtPlugin(() => {
  if (!isNativeShell()) return

  const router = useRouter()

  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return

      let abs: URL
      try {
        abs = new URL(href, window.location.href)
      } catch {
        return
      }

      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return
      if (isSameAppOrigin(abs.href)) {
        // target=_blank same-origin would spawn a second WebView — stay in-app
        if (anchor.target === '_blank') {
          event.preventDefault()
          void router.push(`${abs.pathname}${abs.search}${abs.hash}`)
        }
        return
      }

      event.preventDefault()
      void openExternalUrl(abs.href)
    },
    true,
  )

  const originalOpen = window.open.bind(window)
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = typeof url === 'string' ? url : url?.toString()
    if (href && /^https?:/i.test(href) && !isSameAppOrigin(href)) {
      void openExternalUrl(href)
      return null
    }
    return originalOpen(url, target, features)
  }) as typeof window.open
})
