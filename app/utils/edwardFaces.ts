/**
 * Radical Edward–style emoticoin faces for the thought stream.
 * 90s anime OS energy: thick outlines, big eyes, candy colors.
 */

import type { EdwardBadge, EdwardKind } from '~/utils/edwardSemantics'

export type EdwardFaceMood =
  | 'curious' // original thought
  | 'yapping' // reply
  | 'starry' // boost
  | 'sparkle' // media
  | 'hmm' // poll
  | 'shy' // cw
  | 'manic' // high engagement

export type EdwardFaceSpec = {
  mood: EdwardFaceMood
  /** Coin face fill */
  fill: string
  rim: string
  /** Tiny status glyph under the face */
  tag: string
}

const FILL: Record<EdwardFaceMood, { fill: string; rim: string }> = {
  curious: { fill: '#ffe566', rim: '#59d1e0' },
  yapping: { fill: '#ffc078', rim: '#f2ad52' },
  starry: { fill: '#e8c4ff', rim: '#b794f6' },
  sparkle: { fill: '#ffd6e8', rim: '#ff7eb3' },
  hmm: { fill: '#d4f5c8', rim: '#8fd17a' },
  shy: { fill: '#c8d0dc', rim: '#7a8494' },
  manic: { fill: '#fff1a8', rim: '#ff6b6b' },
}

export function faceMoodFor(opts: {
  kind: EdwardKind
  badges: EdwardBadge[]
  engagement: number
}): EdwardFaceMood {
  if (opts.badges.includes('cw')) return 'shy'
  if (opts.engagement >= 40) return 'manic'
  if (opts.badges.includes('media')) return 'sparkle'
  if (opts.badges.includes('poll')) return 'hmm'
  if (opts.kind === 'boost') return 'starry'
  if (opts.kind === 'reply') return 'yapping'
  return 'curious'
}

export function faceSpecFor(opts: {
  kind: EdwardKind
  badges: EdwardBadge[]
  engagement: number
}): EdwardFaceSpec {
  const mood = faceMoodFor(opts)
  const { fill, rim } = FILL[mood]
  const tag =
    opts.badges.includes('cw')
      ? 'shh'
      : opts.badges.includes('media')
        ? 'pic'
        : opts.badges.includes('poll')
          ? '??'
          : opts.kind === 'boost'
            ? '↑↑'
            : opts.kind === 'reply'
              ? '>>'
              : '··'
  return { mood, fill, rim, tag }
}

/** Draw a fat 512×512 emoticoin face onto an existing 2d context. */
export function drawEmoticoin(
  ctx: CanvasRenderingContext2D,
  spec: EdwardFaceSpec,
  seed: number,
): void {
  const S = 512
  const cx = S / 2
  const cy = S / 2 - 8
  const R = 220

  ctx.clearRect(0, 0, S, S)

  // Soft glow disc behind coin
  const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.15)
  glow.addColorStop(0, spec.rim + '88')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2)
  ctx.fill()

  // Coin body
  const body = ctx.createRadialGradient(cx - 40, cy - 50, 20, cx, cy, R)
  body.addColorStop(0, '#fff8d6')
  body.addColorStop(0.35, spec.fill)
  body.addColorStop(1, shade(spec.fill, -35))
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()

  // Thick comic outline
  ctx.strokeStyle = '#1a1420'
  ctx.lineWidth = 14
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.stroke()

  // Rim ring (kind color)
  ctx.strokeStyle = spec.rim
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(cx, cy, R - 18, 0, Math.PI * 2)
  ctx.stroke()

  // Face features — slight seed jitter so coins aren't clones
  const jx = (seed % 1) * 10 - 5
  const jy = ((seed * 7) % 1) * 8 - 4

  drawFace(ctx, spec.mood, cx + jx, cy + jy, seed)

  // Tiny tag chip
  ctx.fillStyle = '#1a1420'
  ctx.font = '700 28px "Courier New", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(spec.tag, cx, cy + R - 48)
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + amt))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt))
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt))
  return `rgb(${r},${g},${b})`
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  mood: EdwardFaceMood,
  cx: number,
  cy: number,
  seed: number,
) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#1a1420'
  ctx.fillStyle = '#1a1420'

  const eyeY = cy - 28
  const leftX = cx - 58
  const rightX = cx + 58

  // Blush
  if (mood === 'shy' || mood === 'sparkle' || mood === 'curious') {
    ctx.fillStyle = 'rgba(255,110,140,0.35)'
    ctx.beginPath()
    ctx.ellipse(cx - 95, cy + 20, 28, 16, 0, 0, Math.PI * 2)
    ctx.ellipse(cx + 95, cy + 20, 28, 16, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1a1420'
  }

  switch (mood) {
    case 'curious': {
      // Dot eyes + soft smile
      dotEye(ctx, leftX, eyeY, 22)
      dotEye(ctx, rightX, eyeY, 22)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(cx, cy + 35, 48, 0.15 * Math.PI, 0.85 * Math.PI)
      ctx.stroke()
      break
    }
    case 'yapping': {
      // Open mouth mid-yap
      dotEye(ctx, leftX, eyeY, 18)
      dotEye(ctx, rightX, eyeY, 18)
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 10, eyeY - 28)
      ctx.quadraticCurveTo(leftX, eyeY - 42, leftX + 14, eyeY - 30)
      ctx.moveTo(rightX - 14, eyeY - 30)
      ctx.quadraticCurveTo(rightX, eyeY - 42, rightX + 10, eyeY - 28)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(cx, cy + 48, 36, 42, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ff6b8a'
      ctx.beginPath()
      ctx.ellipse(cx, cy + 58, 22, 18, 0, 0, Math.PI * 2)
      ctx.fill()
      break
    }
    case 'starry': {
      starEye(ctx, leftX, eyeY, 34)
      starEye(ctx, rightX, eyeY, 34)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.arc(cx, cy + 40, 55, 0.1 * Math.PI, 0.9 * Math.PI)
      ctx.stroke()
      // Tiny sparkles
      spark(ctx, cx - 120, cy - 90, 10)
      spark(ctx, cx + 125, cy - 70, 8)
      break
    }
    case 'sparkle': {
      // Heart-ish / glitter eyes
      heartEye(ctx, leftX, eyeY, 26)
      heartEye(ctx, rightX, eyeY, 26)
      ctx.lineWidth = 11
      ctx.beginPath()
      ctx.arc(cx, cy + 38, 50, 0.12 * Math.PI, 0.88 * Math.PI)
      ctx.stroke()
      spark(ctx, cx + 110, cy - 100, 12)
      spark(ctx, cx - 100, cy - 80, 9)
      break
    }
    case 'hmm': {
      // One raised brow, flat mouth, sweat
      ctx.lineWidth = 10
      ctx.beginPath()
      ctx.moveTo(leftX - 22, eyeY - 38)
      ctx.quadraticCurveTo(leftX, eyeY - 52, leftX + 22, eyeY - 36)
      ctx.stroke()
      dotEye(ctx, leftX, eyeY, 18)
      dotEye(ctx, rightX, eyeY + 4, 18)
      ctx.lineWidth = 12
      ctx.beginPath()
      ctx.moveTo(cx - 40, cy + 55)
      ctx.lineTo(cx + 40, cy + 48)
      ctx.stroke()
      // Sweat drop
      ctx.fillStyle = '#59d1e0'
      ctx.beginPath()
      ctx.moveTo(cx + 110, cy - 40)
      ctx.quadraticCurveTo(cx + 130, cy, cx + 110, cy + 30)
      ctx.quadraticCurveTo(cx + 90, cy, cx + 110, cy - 40)
      ctx.fill()
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 6
      ctx.stroke()
      break
    }
    case 'shy': {
      // Peeking — hands cover, eyes peek
      ctx.fillStyle = '#1a1420'
      ctx.globalAlpha = 0.15
      ctx.fillRect(cx - 160, cy - 40, 320, 160)
      ctx.globalAlpha = 1
      // Peek eyes
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.ellipse(leftX, eyeY + 10, 16, 10, 0, 0, Math.PI * 2)
      ctx.ellipse(rightX, eyeY + 10, 16, 10, 0, 0, Math.PI * 2)
      ctx.fill()
      // Hands (simple mittens)
      ctx.fillStyle = '#ffe566'
      ctx.strokeStyle = '#1a1420'
      ctx.lineWidth = 8
      roundRect(ctx, cx - 130, cy + 20, 90, 70, 20)
      roundRect(ctx, cx + 40, cy + 20, 90, 70, 20)
      break
    }
    case 'manic': {
      // Wild grin + swirl eyes
      swirlEye(ctx, leftX, eyeY, 28, seed)
      swirlEye(ctx, rightX, eyeY, 28, seed + 1)
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.moveTo(cx - 70, cy + 30)
      ctx.quadraticCurveTo(cx - 20, cy + 90, cx + 70, cy + 35)
      ctx.quadraticCurveTo(cx + 20, cy + 100, cx - 70, cy + 30)
      ctx.stroke()
      ctx.fillStyle = '#1a1420'
      ctx.beginPath()
      ctx.moveTo(cx - 55, cy + 42)
      ctx.quadraticCurveTo(cx, cy + 88, cx + 55, cy + 45)
      ctx.quadraticCurveTo(cx, cy + 70, cx - 55, cy + 42)
      ctx.fill()
      // Teeth
      ctx.strokeStyle = '#fff8d6'
      ctx.lineWidth = 4
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath()
        ctx.moveTo(cx + i * 18, cy + 48)
        ctx.lineTo(cx + i * 18, cy + 68)
        ctx.stroke()
      }
      spark(ctx, cx - 130, cy - 100, 14)
      spark(ctx, cx + 140, cy - 60, 11)
      break
    }
  }
}

function dotEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#1a1420'
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2)
  ctx.fill()
}

function starEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#1a1420'
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2
    const rad = i % 2 === 0 ? r : r * 0.4
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
}

function heartEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#ff4d6d'
  ctx.strokeStyle = '#1a1420'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(x, y + r * 0.55)
  ctx.bezierCurveTo(x - r * 1.2, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35)
  ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.2, y - r * 0.1, x, y + r * 0.55)
  ctx.fill()
  ctx.stroke()
}

function swirlEye(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  seed: number,
) {
  ctx.strokeStyle = '#1a1420'
  ctx.lineWidth = 8
  ctx.beginPath()
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 4 + seed
    const rad = (i / 24) * r
    const px = x + Math.cos(a) * rad
    const py = y + Math.sin(a) * rad
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.stroke()
}

function spark(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.strokeStyle = '#1a1420'
  ctx.fillStyle = '#fff8d6'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.lineTo(x, y + r)
  ctx.moveTo(x - r, y)
  ctx.lineTo(x + r, y)
  ctx.moveTo(x - r * 0.6, y - r * 0.6)
  ctx.lineTo(x + r * 0.6, y + r * 0.6)
  ctx.moveTo(x + r * 0.6, y - r * 0.6)
  ctx.lineTo(x - r * 0.6, y + r * 0.6)
  ctx.stroke()
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

export const EDWARD_FACE_LEGEND: { mood: EdwardFaceMood; label: string; glyph: string }[] = [
  { mood: 'curious', label: 'thought', glyph: '◉‿◉' },
  { mood: 'yapping', label: 'reply', glyph: 'ᕕ(ᐛ)' },
  { mood: 'starry', label: 'boost', glyph: '★◇★' },
  { mood: 'sparkle', label: 'media', glyph: '♥‿♥' },
  { mood: 'hmm', label: 'poll', glyph: '·_·?' },
  { mood: 'shy', label: 'cw', glyph: '(⁄⁄)' },
]
