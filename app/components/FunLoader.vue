<script setup lang="ts">
/**
 * Square-mark L-system branching pulse — inspired by
 * https://mhsenkow.github.io/fun-loaders/ (L-System · Loader · Square)
 * Each mount rolls a new grammar / orientation / pulse so it never loops the same.
 *
 * Variants grow into different loading habitats:
 * - mark: fixed square (size prop)
 * - region / fill: dominate the parent loading region
 * - pull: sprout in a short pull-to-refresh strip
 * - seed: tiny mark for send buttons / inline chips
 */

const props = withDefaults(
  defineProps<{
    size?: number
    /** @deprecated use variant="region" */
    fill?: boolean
    variant?: 'mark' | 'region' | 'pull' | 'seed'
    label?: string
  }>(),
  {
    size: 160,
    fill: false,
    variant: 'mark',
  },
)

const mode = computed(() => {
  if (props.variant && props.variant !== 'mark') return props.variant
  if (props.fill) return 'region'
  return 'mark'
})

const isFluid = computed(() => mode.value === 'region' || mode.value === 'pull')

type Segment = { x1: number; y1: number; x2: number; y2: number; depth: number }

type RunConfig = {
  rule: string
  iterations: number
  step: number
  startDir: number
  angle: number
  cycleMs: number
  trail: number
  phase: number
  reverse: boolean
  spatialWeight: number
  headSize: number
}

const RULES = [
  'FF+[+F-F-F]-[-F+F+F]',
  'F[+F]F[-F]F',
  'F[+F]F[-F][F]',
  'FF-[-F+F+F]+[+F-F-F]',
  'F[+FF][-FF]F[+F][-F]F',
  'F[+F[+F]-F]-F[+F]F',
]

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const renderSize = ref(props.variant === 'seed' ? Math.min(props.size, 56) : props.size)
let raf = 0
let start = 0
let segments: Segment[] = []
let layout = { scale: 1, ox: 0, oy: 0 }
let run: RunConfig = {
  rule: RULES[0]!,
  iterations: 5,
  step: 3,
  startDir: -Math.PI / 2,
  angle: Math.PI / 2,
  cycleMs: 4500,
  trail: 0.13,
  phase: 0,
  reverse: false,
  spatialWeight: 0.65,
  headSize: 3.6,
}
let resizeObserver: ResizeObserver | null = null

const MAX_SEGMENTS = 2800

const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)]!

const rollRun = (): RunConfig => {
  const m = mode.value
  const compact = m === 'seed' || m === 'pull'
  return {
    rule: pick(RULES),
    iterations: compact ? 3 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 2),
    step: compact ? 2 + Math.random() * 1.2 : 2.5 + Math.random() * 1.5,
    startDir:
      m === 'pull'
        ? pick([-Math.PI / 2, -Math.PI / 2 + 0.35, -Math.PI / 2 - 0.35])
        : pick([-Math.PI / 2, 0, Math.PI / 2, Math.PI]),
    angle: Math.PI / 2,
    cycleMs: compact ? 2400 + Math.random() * 1600 : 3200 + Math.random() * 2800,
    trail: compact ? 0.12 + Math.random() * 0.1 : 0.09 + Math.random() * 0.12,
    phase: Math.random(),
    reverse: Math.random() < 0.45,
    spatialWeight: 0.45 + Math.random() * 0.4,
    headSize: compact ? 2.2 + Math.random() * 1.1 : 2.8 + Math.random() * 1.6,
  }
}

const expandCapped = (axiom: string, rules: Record<string, string>, iterations: number) => {
  let current = axiom || 'F'
  for (let i = 0; i < iterations; i++) {
    let next = ''
    for (let j = 0; j < current.length; j++) {
      next += rules[current[j]!] ?? current[j]
      if (next.length >= 32_000) return next
    }
    current = next
  }
  return current
}

const parseToSegments = (
  instructions: string,
  angle: number,
  step: number,
  startDir: number,
): Segment[] => {
  const out: Segment[] = []
  const stack: { x: number; y: number; angle: number; depth: number }[] = []
  let x = 0
  let y = 0
  let dir = startDir
  let depth = 0

  for (let i = 0; i < instructions.length; i++) {
    if (out.length >= MAX_SEGMENTS) break
    const ch = instructions[i]
    if (ch === 'F') {
      const nx = x + Math.cos(dir) * step
      const ny = y + Math.sin(dir) * step
      out.push({ x1: x, y1: y, x2: nx, y2: ny, depth })
      x = nx
      y = ny
    } else if (ch === '+') {
      dir += angle
    } else if (ch === '-') {
      dir -= angle
    } else if (ch === '[') {
      stack.push({ x, y, angle: dir, depth })
      depth++
    } else if (ch === ']') {
      const state = stack.pop()
      if (state) {
        x = state.x
        y = state.y
        dir = state.angle
        depth = state.depth
      }
    }
  }
  return out
}

const buildSegments = (cfg: RunConfig) => {
  const instructions = expandCapped('F', { F: cfg.rule, '+': '+', '-': '-' }, cfg.iterations)
  return parseToSegments(instructions, cfg.angle, cfg.step, cfg.startDir)
}

const computeLayout = (segs: Segment[], size: number) => {
  if (!segs.length) return { scale: 1, ox: size / 2, oy: size / 2 }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const s of segs) {
    minX = Math.min(minX, s.x1, s.x2)
    maxX = Math.max(maxX, s.x1, s.x2)
    minY = Math.min(minY, s.y1, s.y2)
    maxY = Math.max(maxY, s.y1, s.y2)
  }
  // Tight inset so the mark owns the square
  const margin = size * 0.015
  const w = Math.max(1, maxX - minX)
  const h = Math.max(1, maxY - minY)
  const scale = Math.min((size - margin * 2) / w, (size - margin * 2) / h)
  return {
    scale,
    ox: size / 2 - ((minX + maxX) / 2) * scale,
    oy: size / 2 - ((minY + maxY) / 2) * scale,
  }
}

const loopT = (t: number, duration: number) => (((t % duration) + duration) % duration) / duration

const loopWindow = (x: number, center: number, half: number) => {
  let d = Math.abs(x - center)
  d = Math.min(d, 1 - d)
  if (d >= half) return 0
  const u = 1 - d / half
  return u * u * (3 - 2 * u)
}

const strokeSeg = (
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width: number,
  alpha: number,
) => {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineCap = 'square'
  ctx.lineJoin = 'miter'
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.restore()
}

const inkColor = () => {
  const el = rootRef.value
  if (!el || typeof getComputedStyle === 'undefined') return 'currentColor'
  return getComputedStyle(el).color || 'currentColor'
}

const prefersReducedMotion = () => {
  if (typeof window === 'undefined') return false
  if (document.documentElement.classList.contains('reduce-motion')) return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const drawFrame = (ctx: CanvasRenderingContext2D, size: number, t: number) => {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1
  const px = Math.round(size * dpr)
  if (ctx.canvas.width !== px || ctx.canvas.height !== px) {
    ctx.canvas.width = px
    ctx.canvas.height = px
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)

  const { scale, ox, oy } = layout
  const total = segments.length
  if (!total) return

  const ink = inkColor()
  // Keep stroke weight proportional so large region fills don't look spindly
  const strokeScale = Math.max(0.85, Math.min(2.4, size / 160))

  ctx.beginPath()
  for (const s of segments) {
    ctx.moveTo(s.x1 * scale + ox, s.y1 * scale + oy)
    ctx.lineTo(s.x2 * scale + ox, s.y2 * scale + oy)
  }
  ctx.strokeStyle = ink
  ctx.globalAlpha = 0.12
  ctx.lineWidth = 1.15 * strokeScale
  ctx.lineCap = 'square'
  ctx.stroke()
  ctx.globalAlpha = 1

  let progress = (loopT(t, run.cycleMs) + run.phase) % 1
  if (run.reverse) progress = 1 - progress
  const halfW = run.trail * 0.5

  for (let i = 0; i < total; i++) {
    const s = segments[i]!
    const mx = (s.x1 + s.x2) * 0.5 * scale + ox
    const my = (s.y1 + s.y2) * 0.5 * scale + oy
    const spatial = loopWindow((mx / size + my / size) * 0.5, progress, halfW)
    const segBright = loopWindow(i / total, progress, halfW)
    const combined = Math.max(spatial * run.spatialWeight, segBright)
    if (combined < 0.04) continue

    const lit = combined > 0.12
    strokeSeg(
      ctx,
      s.x1 * scale + ox,
      s.y1 * scale + oy,
      s.x2 * scale + ox,
      s.y2 * scale + oy,
      ink,
      Math.max(0.7, 1.7 - s.depth * 0.22 + combined * 1.35) * strokeScale,
      lit ? 0.55 + combined * 0.4 : 0.18,
    )
  }

  const headIdx = Math.min(total - 1, Math.floor(progress * total))
  const head = segments[headIdx]
  if (head) {
    const frac = progress * total - headIdx
    const hx = (head.x1 + (head.x2 - head.x1) * frac) * scale + ox
    const hy = (head.y1 + (head.y2 - head.y1) * frac) * scale + oy
    const r = run.headSize * strokeScale
    ctx.fillStyle = ink
    ctx.globalAlpha = 0.95
    ctx.fillRect(hx - r, hy - r, r * 2, r * 2)
    ctx.globalAlpha = 1
  }
}

const tick = (now: number) => {
  raf = 0
  if (!start) start = now
  if (typeof document !== 'undefined') {
    if (document.hidden) return
    if (prefersReducedMotion()) {
      const canvas = canvasRef.value
      const ctx = canvas?.getContext('2d')
      if (ctx) drawFrame(ctx, renderSize.value, 0)
      return
    }
  }
  const canvas = canvasRef.value
  const ctx = canvas?.getContext('2d')
  if (ctx) drawFrame(ctx, renderSize.value, now - start)
  raf = requestAnimationFrame(tick)
}

const onVis = () => {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    return
  }
  if (prefersReducedMotion()) {
    const canvas = canvasRef.value
    const ctx = canvas?.getContext('2d')
    if (ctx) drawFrame(ctx, renderSize.value, 0)
    return
  }
  if (!raf) {
    start = performance.now()
    raf = requestAnimationFrame(tick)
  }
}

const applySize = (next: number) => {
  const min = mode.value === 'seed' ? 28 : mode.value === 'pull' ? 40 : 96
  const max = mode.value === 'seed' ? 64 : mode.value === 'pull' ? 112 : 640
  const clamped = Math.max(min, Math.min(max, Math.floor(next)))
  if (Math.abs(clamped - renderSize.value) < 4) return
  renderSize.value = clamped
  layout = computeLayout(segments, clamped)
}

const syncFluidSize = () => {
  const el = rootRef.value
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  if (mode.value === 'pull') {
    // Sprout into the pull strip — prefer height, grow a bit with pull width
    const next = Math.min(height * 0.98, Math.max(48, width * 0.24))
    applySize(next || 56)
    return
  }
  // Leave a slim band for the label; otherwise nearly fill the shorter axis
  const labelBand = props.label ? Math.min(40, height * 0.12) : 0
  const pad = Math.min(width, height) * 0.04
  const avail = Math.min(width - pad * 2, height - labelBand - pad * 2)
  applySize(Math.max(avail, 96) || props.size)
}

const markSize = computed(() => {
  if (mode.value === 'seed') return Math.min(props.size, 56)
  return props.size
})

onMounted(() => {
  run = rollRun()
  if (markSize.value < 120 && mode.value === 'mark') {
    run.iterations = Math.min(run.iterations, 3)
  }
  segments = buildSegments(run)
  if (segments.length > MAX_SEGMENTS) segments = segments.slice(0, MAX_SEGMENTS)

  if (isFluid.value && rootRef.value) {
    syncFluidSize()
    resizeObserver = new ResizeObserver(() => syncFluidSize())
    resizeObserver.observe(rootRef.value)
  } else {
    renderSize.value = markSize.value
    layout = computeLayout(segments, markSize.value)
  }

  start = 0
  if (prefersReducedMotion()) {
    const canvas = canvasRef.value
    const ctx = canvas?.getContext('2d')
    if (ctx) drawFrame(ctx, renderSize.value, 0)
  } else {
    raf = requestAnimationFrame(tick)
  }
  document.addEventListener('visibilitychange', onVis)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  raf = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  document.removeEventListener('visibilitychange', onVis)
})

watch(
  () => props.size,
  () => {
    if (isFluid.value) return
    applySize(markSize.value)
  },
)

const markBoxStyle = computed(() => {
  if (isFluid.value) return undefined
  // Seed stays a tight square; mark with a caption grows vertically for the label
  if (mode.value === 'seed' || !props.label) {
    return { width: `${markSize.value}px`, height: `${markSize.value}px` }
  }
  return { width: `${markSize.value}px` }
})
</script>

<template>
  <div
    ref="rootRef"
    class="fun-loader"
    :class="{
      'fun-loader--region': mode === 'region',
      'fun-loader--pull': mode === 'pull',
      'fun-loader--seed': mode === 'seed',
    }"
    role="status"
    :style="markBoxStyle"
  >
    <canvas
      ref="canvasRef"
      class="fun-loader__canvas"
      aria-hidden="true"
      :style="{ width: `${renderSize}px`, height: `${renderSize}px` }"
    />
    <span
      class="fun-loader__label"
      :class="{ 'fun-loader__label--sr': !label || mode === 'seed' || mode === 'pull' }"
    >
      {{ label || 'Loading' }}
    </span>
  </div>
</template>

<style lang="scss" scoped>
.fun-loader {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  flex-shrink: 0;
  box-sizing: border-box;
  color: var(--neo-text-primary);
}

.fun-loader--region {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: inherit;
  flex: 1 1 auto;
  align-self: stretch;
  padding: 0.25rem;
}

.fun-loader--pull {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: inherit;
  align-self: stretch;
  pointer-events: none;
}

.fun-loader--seed {
  flex-shrink: 0;
  gap: 0;
}

.fun-loader__canvas {
  display: block;
  flex-shrink: 0;
  max-width: 100%;
  max-height: 100%;
  margin: 0 auto;
}

.fun-loader__label {
  margin: 0;
  flex-shrink: 0;
  font-size: 0.875rem;
  line-height: 1.3;
  color: var(--neo-text-muted);
  text-align: center;

  &--sr {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
}
</style>
