import { test, expect } from '../helpers/test'
import { seedAuthenticatedSession } from '../helpers/mockApi'

/**
 * Font privacy, proven on the wire: for each chrome × type face the app must fetch its
 * fonts from its own origin — never Google Fonts or any other font CDN. A list of loader
 * names (tests/loadFonts.test.ts) can't show that; recorded network requests can.
 *
 * Chromes whose family comes from @fontsource (and the slug of the file it must request)
 * are asserted to actually load a same-origin .woff2, so the test can't pass by loading nothing.
 */
const FIXTURE_HOSTS = new Set(['mastodon.test'])
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])
const FONT_CDN = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.adobe\.com)$/i

type Case = { ui: string; font: string; slug?: string }

const CASES: Case[] = [
  { ui: 'braun', font: 'sans' },
  { ui: 'ikea', font: 'serif' },
  { ui: 'monocle', font: 'sans', slug: 'source-sans-3' },
  { ui: 'monocle', font: 'book', slug: 'source-serif-4' },
  { ui: 'monocle', font: 'mono', slug: 'source-code-pro' },
  { ui: 'bauhaus', font: 'sans', slug: 'josefin-sans' },
  { ui: 'bauhaus', font: 'book', slug: 'cormorant-garamond' },
  { ui: 'bauhaus', font: 'mono', slug: 'space-mono' },
  { ui: 'noyes', font: 'sans', slug: 'ibm-plex-sans' },
  { ui: 'noyes', font: 'mono', slug: 'ibm-plex-mono' },
  { ui: 'military', font: 'sans', slug: 'oswald' },
  { ui: 'military', font: 'book', slug: 'roboto-slab' },
  { ui: 'terminal', font: 'sans', slug: 'ibm-plex-sans' },
  { ui: 'nyt', font: 'sans', slug: 'libre-franklin' },
  { ui: 'nyt', font: 'book', slug: 'newsreader' },
  { ui: 'braun', font: 'dyslexic' },
]

test.describe('fonts never leave the origin', () => {
  for (const c of CASES) {
    test(`${c.ui} chrome, ${c.font} face`, async ({ page }) => {
      // Signed in, so the only remote host is the fixture server (a guest feed would contact a public one)
      await seedAuthenticatedSession(page)
      await page.addInitScript(
        ({ ui, font }) => {
          if (localStorage.getItem('neospace_local_prefs') !== null) return
          localStorage.setItem('neospace_local_prefs', JSON.stringify({ v: 1, ui, font }))
        },
        { ui: c.ui, font: c.font },
      )

      const urls: string[] = []
      page.on('request', (req) => urls.push(req.url()))

      await page.goto('/')
      await expect(page.getByRole('feed').getByRole('article').first()).toBeVisible({ timeout: 20_000 })
      // Fonts are lazy: wait until the browser has finished every face it decided to use
      await page.evaluate(() => document.fonts.ready)
      await page.waitForLoadState('networkidle')

      const hosts = new Set(urls.map((u) => new URL(u).hostname))
      const fontCdn = [...hosts].filter((h) => FONT_CDN.test(h))
      expect(fontCdn, 'font CDN contacted').toEqual([])

      const foreign = [...hosts].filter((h) => !LOCAL_HOSTS.has(h) && !FIXTURE_HOSTS.has(h))
      expect(foreign, 'undeclared origin contacted').toEqual([])

      const fontFiles = urls.filter((u) => /\.(woff2?|ttf|otf)(\?|$)/i.test(u))
      for (const u of fontFiles) expect(LOCAL_HOSTS.has(new URL(u).hostname), `font from ${u}`).toBe(true)

      if (c.slug) {
        expect(
          fontFiles.some((u) => u.includes(c.slug!)),
          `${c.ui}/${c.font} should load ${c.slug} from the app origin`,
        ).toBe(true)
      }
    })
  }
})
