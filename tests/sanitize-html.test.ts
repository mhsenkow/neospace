/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import {
  sanitizeDisplayName,
  sanitizeFieldHtml,
  sanitizeStatusHtml,
} from '../app/utils/sanitizeHtml'

describe('sanitizeStatusHtml', () => {
  it('keeps safe formatting and forces safe link attrs', () => {
    const out = sanitizeStatusHtml(
      '<p>Hello <strong>world</strong> <a href="https://example.social/@a">@a</a></p>',
    )
    expect(out).toContain('<strong>world</strong>')
    expect(out).toContain('href="https://example.social/@a"')
    expect(out).toMatch(/target="_blank"/)
    expect(out).toMatch(/rel="[^"]*noopener/)
    expect(out).toMatch(/nofollow/)
  })

  it('strips scripts, event handlers, and javascript: urls', () => {
    const out = sanitizeStatusHtml(
      '<p onclick="alert(1)">x<script>alert(2)</script><a href="javascript:alert(3)">y</a><img src=x onerror=alert(4)></p>',
    )
    expect(out).not.toMatch(/<script/i)
    expect(out).not.toMatch(/onclick/i)
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/javascript:/i)
    expect(out).not.toMatch(/<img/i)
  })

  it('drops chrome-spoofing classes but keeps Mastodon emoji/mention classes', () => {
    const out = sanitizeStatusHtml(
      '<span class="mention h-card neo-dialog overlay">@alice</span><span class="evil-toast">x</span>',
    )
    expect(out).toContain('mention')
    expect(out).toContain('h-card')
    expect(out).not.toContain('neo-dialog')
    expect(out).not.toContain('overlay')
    expect(out).not.toContain('evil-toast')
  })

  it('returns empty for non-strings', () => {
    expect(sanitizeStatusHtml('')).toBe('')
    expect(sanitizeStatusHtml(null as unknown as string)).toBe('')
  })
})

describe('sanitizeDisplayName', () => {
  it('strips all images without an emoji allowlist', () => {
    const out = sanitizeDisplayName(
      'Neo <img class="emoji" src="https://cdn.example/e.png" alt=":wave:">',
    )
    expect(out).not.toMatch(/<img/i)
    expect(out).toContain('Neo')
  })

  it('keeps only allowlisted emoji imgs', () => {
    const ok = 'https://cdn.example/ok.png'
    const out = sanitizeDisplayName(
      `<img class="emoji custom-emoji" src="${ok}" alt=":ok:"><img class="emoji" src="https://evil.example/x.png" alt=":x:">`,
      [ok],
    )
    expect(out).toContain(ok)
    expect(out).not.toContain('evil.example')
  })

  it('rejects non-emoji imgs even when src is allowlisted', () => {
    const src = 'https://cdn.example/tracker.png'
    const out = sanitizeDisplayName(`<img class="avatar" src="${src}">`, [src])
    expect(out).not.toMatch(/<img/i)
  })
})

describe('sanitizeFieldHtml', () => {
  it('sanitizes profile field values like status HTML', () => {
    const out = sanitizeFieldHtml('<a href="https://ibm.io">site</a><script>x</script>')
    expect(out).toContain('https://ibm.io')
    expect(out).not.toMatch(/<script/i)
  })
})
