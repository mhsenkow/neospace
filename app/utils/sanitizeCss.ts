/**
 * Sanitize Mastodon profile CSS before injecting into NeoSpace.
 * Profile fields are attacker-controlled; raw injection is XSS → token theft.
 */

const MAX_CSS_CHARS = 50_000

export function sanitizeProfileCss(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  let css = raw.slice(0, MAX_CSS_CHARS)

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
  // Remote url() can exfiltrate via background/font requests — strip all http(s) urls
  css = css.replace(/url\s*\(\s*(['"]?)\s*https?:[^)]+\)/gi, '/* blocked remote url() */')

  return css.trim()
}
