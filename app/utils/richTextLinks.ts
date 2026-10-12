/**
 * In-app routing for links inside server-rendered rich text (bios, post bodies):
 * #hashtags open the group, @mentions open the in-app profile, everything else is left alone.
 */

export type InAppLink =
  | { kind: 'tag'; tag: string }
  | { kind: 'profile'; acct: string }

type AnchorLike = {
  getAttribute(name: string): string | null
  className?: string
  textContent?: string | null
  closest?(selector: string): { className?: string } | null
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export function inAppLinkFor(anchor: AnchorLike): InAppLink | null {
  const href = anchor.getAttribute('href') || ''
  const classes = `${anchor.className || ''} ${anchor.closest?.('.h-card')?.className || ''}`
  const text = (anchor.textContent || '').trim()

  if (/\bhashtag\b/i.test(classes) || /\/tags\//i.test(href)) {
    const fromHref = href.match(/\/tags\/([^/?#]+)/i)?.[1]
    const tag = fromHref ? safeDecode(fromHref) : text.replace(/^#/, '').trim()
    return tag ? { kind: 'tag', tag } : null
  }

  if (/\bmention\b/i.test(classes) || /\bu-url\b/i.test(classes) || /\/@[^/]+/.test(href)) {
    let acct = text.replace(/^@/, '').trim()
    const m = href.match(/\/@([^/?#]+)/)
    if (m?.[1]) {
      const user = safeDecode(m[1])
      try {
        acct = user.includes('@') ? user : `${user}@${new URL(href).hostname}`
      } catch {
        acct = user
      }
    }
    return acct ? { kind: 'profile', acct } : null
  }

  return null
}
