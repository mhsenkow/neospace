// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  // Generate as static site (SPA mode) - works great for hosting
  ssr: false,
  
  // Enable Pinia for state management
  modules: ['@pinia/nuxt'],

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

  // App metadata
  app: {
    head: {
      title: 'NeoSpace',
      htmlAttrs: {
        lang: 'en'
      },
      meta: [
        { name: 'description', content: 'Dual-Mode Social Media - Mom Mode or Chaos Mode, you decide.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#000000', media: '(prefers-color-scheme: dark)' },
        { name: 'theme-color', content: '#f8f9fa', media: '(prefers-color-scheme: light)' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }
      ],
      script: [
        {
          // Prevent flash of unstyled content by applying theme before render
          innerHTML: `(function(){try{var t=localStorage.getItem('neospace_local_prefs');if(t){var p=JSON.parse(t);if(p.theme==='dark'){document.documentElement.setAttribute('data-theme','dark')}else if(p.theme==='light'){document.documentElement.setAttribute('data-theme','light')}}}catch(e){}})()`,
          type: 'text/javascript'
        }
      ]
    }
  }
})
