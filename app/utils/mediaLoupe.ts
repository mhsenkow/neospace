/**
 * Pure helpers for the lightbox loupe HUD: aspect ratios, blurhash palette,
 * and media meta extraction from Mastodon attachments.
 */

export type MediaFocus = { x: number; y: number }

export type MediaLoupeMeta = {
  width?: number | null
  height?: number | null
  aspect?: number | null
  focus?: MediaFocus | null
  blurhash?: string | null
  mediaId?: string
}

type MediaSize = { width?: number | null; height?: number | null; aspect?: number | null }

/** Pull loupe fields from a Mastodon MediaAttachment-like object */
export function mediaAttachmentLoupeMeta(media: {
  id?: string
  blurhash?: string | null
  meta?: {
    original?: MediaSize | null
    small?: MediaSize | null
    focus?: MediaFocus | null
  } | null
}): MediaLoupeMeta {
  const blob = media.meta || null
  const original = blob?.original || null
  const small = blob?.small || null
  const width = original?.width ?? small?.width ?? null
  const height = original?.height ?? small?.height ?? null
  let aspect = original?.aspect ?? small?.aspect ?? null
  if ((aspect == null || !Number.isFinite(aspect)) && width && height && height > 0) {
    aspect = width / height
  }
  const focus = blob?.focus
  return {
    width,
    height,
    aspect: aspect != null && Number.isFinite(aspect) ? aspect : null,
    focus:
      focus && typeof focus.x === 'number' && typeof focus.y === 'number'
        ? { x: focus.x, y: focus.y }
        : null,
    blurhash: media.blurhash || null,
    mediaId: media.id,
  }
}

/** Greatest common divisor for simplifying aspect ratios */
const gcd = (a: number, b: number): number => {
  a = Math.abs(Math.round(a))
  b = Math.abs(Math.round(b))
  while (b) {
    const t = b
    b = a % b
    a = t
  }
  return a || 1
}

/** Human aspect label — prefer common cinema ratios, else reduce w:h */
export function simplifyAspectRatio(width: number, height: number): string {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return '—'
  const r = width / height
  const known: [number, string][] = [
    [1, '1:1'],
    [4 / 3, '4:3'],
    [3 / 2, '3:2'],
    [16 / 9, '16:9'],
    [16 / 10, '16:10'],
    [21 / 9, '21:9'],
    [9 / 16, '9:16'],
    [2 / 3, '2:3'],
    [3 / 4, '3:4'],
  ]
  for (const [ratio, label] of known) {
    if (Math.abs(r - ratio) < 0.02) return label
  }
  const g = gcd(width, height)
  return `${Math.round(width / g)}:${Math.round(height / g)}`
}

export function formatMegapixels(width: number, height: number): string {
  if (!width || !height) return ''
  const mp = (width * height) / 1_000_000
  if (mp < 0.1) return `${(width * height / 1000).toFixed(0)}K px`
  return `${mp.toFixed(mp >= 10 ? 1 : 2)} MP`
}

// ── Minimal blurhash decode (DC + a few AC samples → palette swatches) ─────

const BLURHASH_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~'

const blurDecode83 = (str: string) => {
  let value = 0
  for (const c of str) {
    const i = BLURHASH_CHARS.indexOf(c)
    if (i < 0) return null
    value = value * 83 + i
  }
  return value
}

const srgbToLinear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

const linearToSrgb = (v: number) => {
  const c = Math.max(0, Math.min(1, v))
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return Math.round(s * 255)
}

const decodeDc = (value: number): [number, number, number] => {
  const r = value >> 16
  const g = (value >> 8) & 255
  const b = value & 255
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]
}

const signPow = (v: number, exp: number) => Math.sign(v) * Math.pow(Math.abs(v), exp)

const decodeAc = (value: number, maxAc: number): [number, number, number] => {
  const quantR = Math.floor(value / (19 * 19))
  const quantG = Math.floor(value / 19) % 19
  const quantB = value % 19
  return [
    signPow((quantR - 9) / 9, 2) * maxAc,
    signPow((quantG - 9) / 9, 2) * maxAc,
    signPow((quantB - 9) / 9, 2) * maxAc,
  ]
}

const rgbCss = (r: number, g: number, b: number) =>
  `rgb(${linearToSrgb(r)}, ${linearToSrgb(g)}, ${linearToSrgb(b)})`

/**
 * Decode a blurhash into up to `count` CSS color swatches (DC + sampled AC
 * mixes). Returns [] for invalid / short hashes — callers should hide the strip.
 */
export function blurhashPalette(hash: string | null | undefined, count = 5): string[] {
  if (!hash || hash.length < 6) return []
  const sizeFlag = blurDecode83(hash[0]!)
  if (sizeFlag == null) return []
  const numY = Math.floor(sizeFlag / 9) + 1
  const numX = (sizeFlag % 9) + 1
  const quantMax = blurDecode83(hash[1]!)
  if (quantMax == null) return []
  const maxAc = (quantMax + 1) / 166

  const colors: [number, number, number][] = []
  const dc = blurDecode83(hash.slice(2, 6))
  if (dc == null) return []
  colors.push(decodeDc(dc))

  let pos = 6
  for (let i = 1; i < numX * numY; i++) {
    if (pos + 2 >= hash.length) break
    const ac = blurDecode83(hash.slice(pos, pos + 2))
    pos += 2
    if (ac == null) break
    colors.push(decodeAc(ac, maxAc))
  }

  const out: string[] = [rgbCss(...colors[0]!)]
  const mixes = Math.min(count - 1, Math.max(0, colors.length - 1))
  for (let i = 0; i < mixes; i++) {
    const ac = colors[1 + (i % (colors.length - 1))]!
    const dcC = colors[0]!
    // Mix DC with AC so swatches stay in a readable range
    out.push(rgbCss(dcC[0] + ac[0] * 0.55, dcC[1] + ac[1] * 0.55, dcC[2] + ac[2] * 0.55))
  }
  while (out.length < count && colors.length) {
    out.push(out[out.length - 1]!)
  }
  return out.slice(0, count)
}

/** Focal point (−1…1) → CSS % for a crosshair (0% = left/top, 100% = right/bottom) */
export function focusToCssPercent(focus: MediaFocus | null | undefined): { left: string; top: string } | null {
  if (!focus) return null
  const left = ((focus.x + 1) / 2) * 100
  const top = ((1 - focus.y) / 2) * 100
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null
  return { left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` }
}
