/**
 * Lightweight client error reporting — console + ring buffer (no SaaS).
 * Attach recent logs via formatLogRingForFeedback() in feedback notes.
 */
import { logError } from '~/utils/log'

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.config.errorHandler = (err, _instance, info) => {
    logError('[vue:error]', info, err)
  }

  nuxtApp.hook('vue:error', (err, _instance, info) => {
    logError('[vue:error]', info, err)
  })

  nuxtApp.hook('app:error', (err) => {
    logError('[app:error]', err)
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('unhandledrejection', (e) => {
      logError('[unhandledrejection]', e.reason)
    })
  }
})
