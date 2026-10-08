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
    // Auto-activate new SW — Android/home-screen installs were stuck on stale shells
    // (missing tab bar + old carousel) when registerType stayed on 'prompt'.
    registerType: 'autoUpdate',
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
      globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,webmanifest}'],
      globIgnores: ['**/200.html', '**/404.html', '**/auth/**'],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: true,
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
        // interactive-widget: Android Chrome resizes the layout when the soft
        // keyboard opens so fixed composers (DMs / reply dock) stay visible.
        {
          name: 'viewport',
          content:
            'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
        { name: 'theme-color', content: '#faf9f7', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#1a1a18', media: '(prefers-color-scheme: dark)' },
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
