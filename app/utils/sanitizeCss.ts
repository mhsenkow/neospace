/**
 * Sanitize Mastodon profile CSS before injecting into NeoSpace.
 * Profile fields are attacker-controlled; raw injection is XSS → token theft.
 */

const MAX_CSS_CHARS = 50_000

/** Decode common CSS escape sequences so blocklists can't be bypassed with `\75\72\6c` etc. */
function decodeCssEscapes(input: string): string {
  return input
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch {
        return ''
      }
    })
    .replace(/\\(.)/g, '$1')
}

export function sanitizeProfileCss(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  let css = decodeCssEscapes(raw.slice(0, MAX_CSS_CHARS))

  // Break out of <style> / inject markup
  css = css.replace(/<\/?style\b[^>]*>/gi, '')
  css = css.replace(/<\/?[a-z][^>]*>/gi, '')
  css = css.replace(/</g, '')

  // Classic CSS XSS / exfil vectors
  css = css.replace(/@import\b[^;{]*[;{]?/gi, '/* blocked @import */')
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
  css = css.replace(/image-set\s*\([^)]*\)/gi, '/* blocked image-set() */')
  css = css.replace(/-webkit-image-set\s*\([^)]*\)/gi, '/* blocked image-set() */')

  // Attribute-selector exfiltration (e.g. input[value^="a"] { background: url(...) })
  // Already stripped remote urls; also neutralize attribute selectors on sensitive nodes
  css = css.replace(
    /\[\s*(?:value|href|src|action|formaction|xlink:href)[^\]]*\]/gi,
    '/* blocked attr selector */',
  )

  return css.trim()
}
