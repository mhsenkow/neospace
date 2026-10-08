/**
 * Per-server visual dialects — chaos with a readable accent.
 * Same face moods everywhere; each host gets a color + stamp so you can
 * feel which server a bubble is from without a spreadsheet.
 */

export type EdwardServerStyle = 'neon' | 'crt' | 'candy' | 'ink' | 'chrome' | 'lava'

export type EdwardServerDialect = {
  host: string
  /** Short stamp on the coin, e.g. mas.to */
  short: string
  accent: string
  style: EdwardServerStyle
  /** Explore chip token */
  token: string
}

const STYLE_CYCLE: EdwardServerStyle[] = [
  'neon',
  'crt',
  'candy',
  'ink',
  'chrome',
  'lava',
]

const ACCENTS = [
  '#ff7eb3',
  '#59d1e0',
  '#ffe566',
  '#b794f6',
  '#8fd17a',
  '#ff8a7a',
  '#f2ad52',
  '#7ec8ff',
]

const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

export function shortHost(host: string | null | undefined): string {
  if (!host) return '?'
  const h = host.replace(/^www\./, '').toLowerCase()
  if (h.length <= 10) return h
  const parts = h.split('.')
  if (parts.length >= 2) {
    const tail = parts.slice(-2).join('.')
    return tail.length <= 12 ? tail : h.slice(0, 10)
  }
  return h.slice(0, 10)
}

export function dialectForHost(host: string | null | undefined): EdwardServerDialect {
  const h = (host || 'unknown').replace(/^www\./, '').toLowerCase()
  const n = hash01(h)
  const style = STYLE_CYCLE[Math.floor(n * STYLE_CYCLE.length) % STYLE_CYCLE.length]!
  const accent = ACCENTS[Math.floor(n * 97) % ACCENTS.length]!
  const short = shortHost(h)
  return {
    host: h,
    short,
    accent,
    style,
    token: `srv:${h}`,
  }
}

/** Paint dialect chrome onto an already-drawn emoticoin canvas. */
export function paintServerDialect(
  ctx: CanvasRenderingContext2D,
  dialect: EdwardServerDialect,
  seed: number,
): void {
  const accent = dialect.accent
  // Outer accent ring — server identity at a glance
  ctx.strokeStyle = accent
  ctx.lineWidth = dialect.style === 'ink' ? 6 : 9
  ctx.beginPath()
  ctx.arc(256, 248, dialect.style === 'chrome' ? 208 : 214, 0, Math.PI * 2)
  ctx.stroke()

  // Style flourishes
  if (dialect.style === 'neon' || dialect.style === 'lava') {
    ctx.strokeStyle = accent + '55'
    ctx.lineWidth = 16
    ctx.beginPath()
    ctx.arc(256, 248, 222, 0, Math.PI * 2)
    ctx.stroke()
  }
  if (dialect.style === 'crt') {
    ctx.strokeStyle = 'rgba(26,20,32,0.35)'
    ctx.lineWidth = 2
    for (let y = 40; y < 470; y += 7) {
      ctx.beginPath()
      ctx.moveTo(50, y)
      ctx.lineTo(462, y)
      ctx.stroke()
    }
  }
  if (dialect.style === 'candy') {
    ctx.fillStyle = accent
    for (let i = 0; i < 6; i++) {
      const a = seed * Math.PI * 2 + (i / 6) * Math.PI * 2
      const x = 256 + Math.cos(a) * 195
      const y = 248 + Math.sin(a) * 195
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  if (dialect.style === 'ink') {
    ctx.strokeStyle = '#1a1420'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(256, 248, 200, 0.15, Math.PI * 1.7)
    ctx.stroke()
  }

  // Host stamp — top-left badge
  const label = dialect.short
  ctx.fillStyle = accent
  const w = Math.min(150, 28 + label.length * 9)
  roundRect(ctx, 36, 36, w, 28, 6)
  ctx.fill()
  ctx.fillStyle = '#1a1420'
  ctx.font = '700 16px "Courier New", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 36 + w / 2, 51)
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
}
