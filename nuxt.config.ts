// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: process.env.NODE_ENV === 'development' },

  runtimeConfig: {
    public: {
      /** Cloudflare Turnstile site key — optional; pairs with TURNSTILE_SECRET_KEY on Pages */
      turnstileSiteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY || '',
    },
  },

  // Generate as static site (SPA mode) - works great for hosting
  ssr: false,
  
  // Enable Pinia for state management + installable PWA
  modules: ['@pinia/nuxt', '@vite-pwa/nuxt'],

  // Use the app directory structure
  srcDir: 'app/',

  // Global CSS
  css: ['~/assets/css/main.scss'],

  // Vite config for SCSS
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `@use "~/assets/css/_variables.scss" as *;`
        }
      }
    },
    build: {
      chunkSizeWarningLimit: 120,
    },
  },

  // Installable app for Pixel / iOS home screen
  pwa: {
    // New SW waits instead of reloading tabs mid-use (lost drafts, threads, scroll). The old
    // 'prompt' setup left Android home-screen installs on stale shells because nothing ever
    // applied the update — app/plugins/pwa-update.client.ts now offers "Update ready · Reload"
    // and applies it automatically when the tab is hidden with nothing open.
    registerType: 'prompt',
    includeAssets: [
      'favicon.ico',
      'icons/apple-touch-icon.png',
      'icons/icon.svg',
    ],
    manifest: {
      name: 'NeoSpace',
      short_name: 'NeoSpace',
      description: 'A multi-column Fediverse client — feeds, groups, and multi-server logins.',
      theme_color: '#1a1a18',
      background_color: '#1a1a18',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: 'any',
      start_url: '/',
      scope: '/',
      id: '/',
      lang: 'en',
      categories: ['social', 'news'],
      icons: [
        {
          src: '/icons/icon-192.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/icons/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/icons/icon-192-maskable.png',
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        },
        {
          src: '/icons/icon-512-maskable.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      navigateFallback: '/',
      navigateFallbackDenylist: [/^\/auth/, /^\/api\//],
      // App shell only — Mastodon API / media stay network-first by default
      // Fonts are deliberately NOT precached: every chrome × face ships ~260 optional woff2 files
      // (3.6 MB) and first install used to download them all. They're cached on first use instead.
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,webmanifest}'],
      globIgnores: ['**/200.html', '**/404.html', '**/auth/**'],
      runtimeCaching: [
        {
          // Only the faces (and subsets) a reader actually uses get cached — still offline-capable afterwards
          urlPattern: /\/(?:_nuxt|fonts)\/.*\.woff2$/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'neo-fonts',
            expiration: { maxEntries: 48, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [200] },
          },
        },
      ],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      // Update waits for pwa-update.client.ts to send SKIP_WAITING
      skipWaiting: false,
    },
    client: {
      installPrompt: true,
      periodicSyncForUpdates: 1800,
    },
    devOptions: {
      enabled: false,
    },
  },

  // App metadata
  app: {
    head: {
      title: 'NeoSpace',
      htmlAttrs: {
        lang: 'en'
      },
      meta: [
        { name: 'description', content: 'NeoSpace — a multi-column Fediverse client.' },
        // Link unfurls (Mastodon cards etc.) — absolute image URL, 1200×630 under public/
        { property: 'og:site_name', content: 'NeoSpace' },
        { property: 'og:type', content: 'website' },
        { property: 'og:title', content: 'NeoSpace' },
        { property: 'og:description', content: 'A multi-column Fediverse client — feeds, groups, and multi-server logins.' },
        { property: 'og:image', content: 'https://neospace.ibm.io/og-image.png' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: 'NeoSpace — a multi-column Fediverse client' },
        { name: 'twitter:card', content: 'summary_large_image' },
        // interactive-widget: Android Chrome resizes the layout when the soft
        // keyboard opens so fixed composers (DMs / reply dock) stay visible.
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
        // Match the light / dark themes' --neo-bg-primary (prepaint.js refines this per theme)
        { name: 'theme-color', content: '#f2f2f0', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#161616', media: '(prefers-color-scheme: dark)' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'NeoSpace' },
        { name: 'format-detection', content: 'telephone=no' },
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icons/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
        { rel: 'manifest', href: '/manifest.webmanifest' },
      ],
      script: [
        // External boot scripts (no unsafe-inline for these). Generated/static under public/boot/.
        { src: '/boot/rescue.js', tagPriority: -20 },
        { src: '/boot/prepaint.js', tagPriority: -19 },
      ]
    }
  }
})
