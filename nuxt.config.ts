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
        { name: 'description', content: 'NeoSpace — a multi-column Fediverse client.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#f2f2f0' }
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Serif:wght@400;500&family=Josefin+Sans:wght@400;500&family=Josefin+Slab:wght@400;500&family=Libre+Franklin:wght@400;500&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Oswald:wght@400;500&family=Roboto+Slab:wght@400;500&family=Share+Tech+Mono&family=Source+Code+Pro:wght@400;500&family=Source+Sans+3:wght@400;500&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=Space+Mono:wght@400;700&display=swap'
        }
      ],
      script: [
        {
          // Apply theme + chrome + font before paint
          innerHTML: `(function(){try{var raw=localStorage.getItem('neospace_local_prefs');var p=raw?JSON.parse(raw):{};var map={hc:'contrast',electric:'frost',forest:'tank'};var t=p.theme||'auto';if(map[t])t=map[t];var ok=['light','dark','contrast','paper','glass','frost','brutal','loom','tank','nes'];if(t==='auto'||ok.indexOf(t)<0){t=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}document.documentElement.setAttribute('data-theme',t);var uis=['braun','monocle','bauhaus','noyes','ikea','military','terminal','nyt'];var u=uis.indexOf(p.ui)>=0?p.ui:'braun';document.documentElement.setAttribute('data-ui',u);var fonts=['sans','serif','book','mono','dyslexic'];var f=fonts.indexOf(p.font)>=0?p.font:'sans';document.documentElement.setAttribute('data-font',f);var sizes=['small','medium','large'];var s=sizes.indexOf(p.fontSize)>=0?p.fontSize:'medium';document.documentElement.setAttribute('data-font-size',s);}catch(e){document.documentElement.setAttribute('data-theme','light');document.documentElement.setAttribute('data-ui','braun');document.documentElement.setAttribute('data-font','sans');}})()`,
          type: 'text/javascript'
        }
      ]
    }
  }
})
