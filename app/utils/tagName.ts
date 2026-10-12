/**
 * Readable group names from hashtags.
 *
 * Most real tags are camelCase compounds (`CatsOfMastodon`) but many are names
 * that merely contain a capital in the middle (`JavaScript`, `NixOS`, `TikTok`,
 * `iPhone`, `macOS`). Splitting those reads wrong, so camelCase is only split
 * when the tag isn't a known name and every piece is a plausible word.
 */

/** Brand / product names whose internal capital is part of the name */
const KEEP = new Set(
  [
    'javascript', 'typescript', 'tiktok', 'youtube', 'github', 'gitlab', 'linkedin', 'wordpress',
    'openstreetmap', 'postgresql', 'mysql', 'nixos', 'macos', 'ios', 'ipados', 'iphone', 'ipad',
    'airpods', 'playstation', 'xbox', 'photoshop', 'powershell', 'freebsd', 'openbsd', 'netbsd',
    'lgbtq', 'peertube', 'pixelfed', 'mastodon', 'fediverse', 'activitypub', 'duckduckgo',
    'openai', 'chatgpt', 'devops', 'nodejs', 'vuejs', 'reactjs', 'webassembly', 'stackoverflow',
  ],
)

/** Short connectors that are real words inside a compound (CatsOfMastodon) */
const CONNECTORS = new Set(['of', 'in', 'on', 'to', 'by', 'at', 'is', 'or', 'vs', 'my', 'the', 'and', 'for'])

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

export function formatTagAsName(tag: string): string {
  const out: string[] = []
  for (const part of tag.split('_').filter(Boolean)) {
    const hump = part.split(/(?<=[a-z])(?=[A-Z])/)
    const splittable = hump.length > 1 && !KEEP.has(part.toLowerCase()) && hump.every((w) => w.length >= 3 || CONNECTORS.has(w.toLowerCase()))
    for (const word of splittable ? hump : [part]) {
      // Keep all-caps tokens (LGBTQ) and mixed-case names (NixOS, iPhone) exactly as typed
      const mixed = word.length > 1 && word !== word.toLowerCase() && word !== capitalize(word.toLowerCase())
      out.push(mixed ? word : capitalize(word.toLowerCase()))
    }
  }
  return out.join(' ')
}
