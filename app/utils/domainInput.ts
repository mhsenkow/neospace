/**
 * Turn whatever someone pastes into a blockable domain: `https://mastodon.social/`,
 * `mastodon.social/@bob`, `@bob@host`, `Host.Example:443`. Returns null when no valid
 * hostname can be found, so the server never gets (and echoes back) a raw 422.
 */

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/

export function normalizeDomainInput(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null

  if (value.includes('://')) {
    try {
      value = new URL(value).hostname
    } catch {
      return null
    }
  } else {
    // Drop any path / query / fragment first, then a handle's local part (after the last @)
    value = value.split(/[/?#]/)[0] || ''
    value = value.slice(value.lastIndexOf('@') + 1)
    // Port
    value = value.replace(/:\d+$/, '')
  }

  value = value.replace(/\.$/, '').toLowerCase()
  if (!value) return null

  // IDN → punycode, the form servers store
  try {
    value = new URL(`http://${value}`).hostname
  } catch {
    return null
  }
  return HOSTNAME_RE.test(value) ? value : null
}
