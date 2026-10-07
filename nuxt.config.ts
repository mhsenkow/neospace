// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

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
    }
  },

  // Installable app for Pixel / iOS home screen
  pwa: {
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
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#1a1a18' },
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
        {
          // Recover from stuck PWA caches after deploys (blank phone screens).
          // Only chunk-load failures — not every /_nuxt/ script error (avoids wipe loops).
          innerHTML: `(function(){try{var K='neospace_sw_rescue';function rescue(){try{if(sessionStorage.getItem(K))return;sessionStorage.setItem(K,'1');var done=function(){location.reload()};if(!('serviceWorker'in navigator)){done();return}navigator.serviceWorker.getRegistrations().then(function(rs){return Promise.all(rs.map(function(r){return r.unregister()}))}).then(function(){if(!window.caches)return;return caches.keys().then(function(keys){return Promise.all(keys.map(function(k){return caches.delete(k)}))})}).finally(done)}catch(e){location.reload()}}function bad(msg){return/Loading chunk|Failed to fetch dynamically|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(String(msg||''))}window.addEventListener('error',function(e){var msg=(e&&e.message)||'';if(bad(msg))rescue()});window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;bad((r&&r.message)||r)&&rescue()});setTimeout(function(){var el=document.getElementById('__nuxt');if(el&&!el.querySelector('.neo-layout')&&!sessionStorage.getItem(K))rescue()},12000)}catch(e){}})()`,
          type: 'text/javascript',
        },
        {
          // Apply theme + chrome + font before paint
          innerHTML: `(function(){try{var raw=localStorage.getItem('neospace_local_prefs');var p=raw?JSON.parse(raw):{};var map={hc:'contrast',electric:'frost',forest:'tank'};var t=p.theme||'auto';if(map[t])t=map[t];var ok=['light','dark','contrast','paper','glass','frost','brutal','loom','tank','nes'];if(t==='auto'||ok.indexOf(t)<0){if(window.matchMedia&&window.matchMedia('(prefers-contrast: more)').matches)t='contrast';else t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}document.documentElement.setAttribute('data-theme',t);var uis=['braun','monocle','bauhaus','noyes','ikea','military','terminal','nyt'];var u=uis.indexOf(p.ui)>=0?p.ui:'braun';document.documentElement.setAttribute('data-ui',u);var fonts=['sans','serif','book','mono','dyslexic'];var f=fonts.indexOf(p.font)>=0?p.font:'sans';document.documentElement.setAttribute('data-font',f);var sizes=['small','medium','large'];var s=sizes.indexOf(p.fontSize)>=0?p.fontSize:'medium';document.documentElement.setAttribute('data-font-size',s);var radii=['match','sharp','business','soft','bubble','jagged'];var r=radii.indexOf(p.radius)>=0?p.radius:'match';document.documentElement.setAttribute('data-radius',r);var dens=['roomy','cozy','dense'];var d=dens.indexOf(p.density)>=0?p.density:(p.compactMode?'dense':'cozy');document.documentElement.setAttribute('data-density',d);if(d==='dense')document.documentElement.classList.add('compact-mode');var lines=['clean','ink','crayon','dashed'];var ln=lines.indexOf(p.line)>=0?p.line:'clean';document.documentElement.setAttribute('data-line',ln);if(p.reduceMotion)document.documentElement.classList.add('reduce-motion');if(localStorage.getItem('neospace_sidebar_rail')==='1'){document.documentElement.setAttribute('data-rail','');document.documentElement.style.setProperty('--neo-sidebar-w','68px');}}catch(e){document.documentElement.setAttribute('data-theme','light');document.documentElement.setAttribute('data-ui','braun');document.documentElement.setAttribute('data-font','sans');document.documentElement.setAttribute('data-radius','match');document.documentElement.setAttribute('data-density','cozy');document.documentElement.setAttribute('data-line','clean');}})()`,
          type: 'text/javascript'
        }
      ]
    }
  }
})
