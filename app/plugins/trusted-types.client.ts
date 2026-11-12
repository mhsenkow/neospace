/**
 * Bootstrap Trusted Types policies before any app code assigns to script sinks.
 * Policies:
 *  - default: pass-through for Nuxt/Vite runtime
 *  - dompurify: used by DOMPurify RETURN_TRUSTED_TYPE
 *  - loomspace: explicit app policy alias
 *
 * CSP `require-trusted-types-for 'script'` forces script sinks through these policies.
 * Script `unsafe-inline` remains in CSP for Nuxt SPA + Turnstile bootstraps; boot
 * scripts themselves are external (`/boot/*.js`).
 */

export default defineNuxtPlugin({
  name: 'trusted-types',
  enforce: 'pre',
  setup() {
    if (typeof window === 'undefined') return
    const tt = (
      window as Window & {
        trustedTypes?: {
          createPolicy: (
            name: string,
            rules: {
              createHTML?: (s: string) => string
              createScript?: (s: string) => string
              createScriptURL?: (s: string) => string
            },
          ) => unknown
          defaultPolicy?: unknown
        }
      }
    ).trustedTypes
    if (!tt?.createPolicy) return

    const passthrough = {
      createHTML: (s: string) => s,
      createScript: (s: string) => s,
      createScriptURL: (s: string) => s,
    }

    try {
      if (!tt.defaultPolicy) tt.createPolicy('default', passthrough)
    } catch {
      /* already created (HMR) */
    }
    try {
      tt.createPolicy('dompurify', { createHTML: (s: string) => s })
    } catch {
      /* already created */
    }
    try {
      tt.createPolicy('loomspace', passthrough)
    } catch {
      /* already created */
    }
  },
})
