/**
 * Sanitize Mastodon profile CSS before injecting into NeoSpace.
 * Profile fields are attacker-controlled (another user's skin applies while
 * viewing their profile); raw injection is exfil / UI spoofing.
 *
 * The output must parse in the browser exactly the way this module reads it,
 * so we canonicalize first (no escapes, no comments, no markup) and then
 * rebuild the sheet rule by rule, string- and url()-aware.
 */

const MAX_CSS_CHARS = 50_000
const SCOPE = '.chaos-active #main-content'

/**
 * Decode CSS escapes in ONE pass (so `\5c 75rl(` can't decode twice into
 * `url(`), then drop every backslash left: the browser must see exactly the
 * text the blocklists checked, with no escape processing of its own.
 */
function decodeCssEscapes(input: string): string {
  return input
    .replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|([^\n\r\f]))/g, (_, hex?: string, ch?: string) => {
      if (ch !== undefined) return ch
      const cp = parseInt(hex!, 16)
      if (!cp || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�'
      return String.fromCodePoint(cp)
    })
    .replace(/\\/g, '')
}

const SAFE_POSITION = /^\s*(?:static|relative|absolute|sticky|-webkit-sticky)\s*(?:!\s*important\s*)?$/i

export function sanitizeProfileCss(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  let css = decodeCssEscapes(raw.slice(0, MAX_CSS_CHARS))

  // Break out of <style> / inject markup (before comment stripping, so removing
  // a tag can't splice a new `/*` together)
  css = css.replace(/<\/?style\b[^>]*>/gi, '')
  css = css.replace(/<\/?[a-z][^>]*>/gi, '')
  css = css.replace(/</g, '')
  // Comments → a space (never '' — `/*/**/*` would re-form a comment opener)
  css = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ')

  // Classic CSS XSS / exfil vectors
  css = css.replace(/@import\b[^;{]*[;{]?/gi, '/* blocked @import */')
  // Drop @font-face blocks early (before url() mangling confuses the scoper)
  css = css.replace(/@font-face\b[^{]*\{[^}]*\}/gi, '/* blocked font face */')
  css = css.replace(/expression\s*\(/gi, '/* blocked expression( */')
  css = css.replace(/behavior\s*:/gi, '/* blocked behavior: */')
  css = css.replace(/-moz-binding\s*:/gi, '/* blocked -moz-binding: */')
  css = css.replace(/javascript\s*:/gi, '/* blocked javascript: */')
  css = css.replace(/vbscript\s*:/gi, '/* blocked vbscript: */')
  css = css.replace(/-o-link\s*:/gi, '/* blocked -o-link: */')
  css = css.replace(/data\s*:\s*text\/html/gi, '/* blocked data:text/html */')
  // data: URLs in url() can still be HTML/SVG; allow only image data URLs
  css = css.replace(/url\s*\(\s*(['"]?)\s*data\s*:(?!image\/)/gi, 'url($1/* blocked data: */')
  // Remote url() — protocol-relative, http(s), and image-set() can exfiltrate
  css = css.replace(/url\s*\(\s*(['"]?)\s*https?:/gi, '/* blocked remote url() */url($1')
  css = css.replace(/url\s*\(\s*(['"]?)\s*\/\//gi, '/* blocked protocol-relative url() */url($1')
  css = css.replace(/url\s*\(\s*(['"]?)\s*(?!data:image\/)[^)]+\)/gi, '/* blocked url() */')
  // image-set may nest url(); strip the whole function call greedily to the matching ')'
  css = css.replace(/-?webkit-?image-set\s*\(/gi, '/* blocked image-set() */(')
  css = css.replace(/image-set\s*\(/gi, '/* blocked image-set() */(')
  // Neutralize leftover image-set argument junk up to the closing paren
  css = css.replace(/\/\* blocked image-set\(\) \*\/\([^)]*\)/gi, '/* blocked image-set() */')

  // Attribute-selector exfiltration (e.g. input[value^="a"] { background: url(...) })
  // Already stripped remote urls; also neutralize attribute selectors on sensitive nodes
  css = css.replace(
    /\[\s*(?:value|href|src|action|formaction|xlink:href)[^\]]*\]/gi,
    '/* blocked attr selector */',
  )

  // position:fixed escapes #main-content and can overlay the sidebar / dialogs
  // (clickjacking). Anything but a known-safe keyword — incl. var(--p) — is
  // pinned to absolute.
  css = css.replace(/(^|[;{\s])position\s*:\s*([^;}]*)/gi, (m, pre: string, value: string) =>
    SAFE_POSITION.test(value) ? m : `${pre}position: absolute`,
  )

  css = css.trim()
  if (!css) return ''

  // Scope every rule under .chaos-active #main-content so profile CSS
  // cannot restyle the shell (sidebar, settings, overlays).
  return scopeCss(css, SCOPE)
}

const IDENT_CHAR = /[a-zA-Z0-9_\-\u0080-￿]/

/**
 * Index of the first char in `stops` at/after `from`, skipping string and
 * unquoted url() contents the way the CSS tokenizer does (escapes and
 * comments are already gone). Comments left are our fixed markers, which
 * contain no quotes or braces. -1 when none.
 */
function scanTo(css: string, from: number, stops: string): number {
  let quote = ''
  for (let i = from; i < css.length; i++) {
    const c = css[i]!
    if (quote) {
      if (c === quote || c === '\n' || c === '\r' || c === '\f') quote = ''
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      continue
    }
    // Unquoted url( … ) is one token — braces inside it don't count
    if (
      (c === 'u' || c === 'U') &&
      /^url\(\s*[^\s"']/i.test(css.slice(i, i + 64)) &&
      !(i > 0 && IDENT_CHAR.test(css[i - 1]!))
    ) {
      const close = css.indexOf(')', i)
      if (close === -1) return -1
      i = close
      continue
    }
    if (stops.includes(c)) return i
  }
  return -1
}

/** Index just past the `}` closing the block opened at `open` (or css.length). */
function blockEnd(css: string, open: number): number {
  let depth = 0
  let i = open
  while (i < css.length) {
    i = scanTo(css, i, '{}')
    if (i === -1) return css.length
    if (css[i] === '{') depth++
    else if (--depth === 0) return i + 1
    i++
  }
  return css.length
}

/** Scope each selector in a prelude; null when nothing safe remains. */
function scopeSelectors(prelude: string, scope: string): string | null {
  const parts: string[] = []
  for (const raw of prelude.split(',')) {
    let s = raw.trim()
    if (s.startsWith(scope)) s = s.slice(scope.length).trim()
    // `~ x` / `+ x` after the scope prefix would select the shell's siblings
    if (/^[~+]/.test(s)) continue
    parts.push(s ? `${scope} ${s}` : scope)
  }
  return parts.length ? parts.join(', ') : null
}

/**
 * Rebuild `css` as `selector{declarations}` rules, each selector prefixed with
 * `scope`. @media / @supports / @layer blocks are kept and scoped recursively;
 * every other at-rule, statement at-rule (`@layer a;`), stray `;`/`}` junk, and
 * any rule with a nested block (CSS nesting: `a { :is(&, body) {…} }` would
 * escape the scope) is dropped.
 */
function scopeCss(css: string, scope: string): string {
  let out = ''
  let i = 0
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i]!)) i++
    if (i >= css.length) break

    const stop = scanTo(css, i, '{;}')
    if (stop === -1) break // trailing prelude with no block — browsers drop it too
    if (css[stop] !== '{') {
      i = stop + 1 // junk / statement at-rule
      continue
    }

    const rawPrelude = css.slice(i, stop)
    const end = blockEnd(css, stop)
    const inner = css.slice(stop + 1, css[end - 1] === '}' ? end - 1 : end)
    i = end

    // Only our fixed `/* blocked … */` markers survive this far — keep them
    // (they explain missing styles) but outside any selector
    const markers = rawPrelude.match(/\/\*[\s\S]*?\*\//g)?.join(' ') ?? ''
    const prelude = rawPrelude.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
    if (markers) out += markers

    if (prelude.startsWith('@')) {
      if (/^@(media|supports|layer)\b/i.test(prelude)) {
        out += `${prelude}{${scopeCss(inner, scope)}}`
      }
      continue
    }

    if (scanTo(inner, 0, '{}') !== -1) continue
    const selectors = scopeSelectors(prelude, scope)
    if (selectors) out += `${selectors}{${inner}}`
  }
  return out
}
