/**
 * Edward pacing + lean-back helpers — pure, shared by the store, canvas and HUD.
 *
 * Speed presets scale the bubble simulation's clock (still → rush). Tour mode
 * floats one post at a time into the lens on a timer, so you can just watch.
 * Deck sizing lives here too so the canvas reserves exactly the column the
 * deck draws in.
 */

import type { EdwardBallDescriptor } from '~/utils/edwardSemantics'

export type EdwardSpeed = 'still' | 'drift' | 'flow' | 'rush'

export const EDWARD_SPEEDS: {
  id: EdwardSpeed
  label: string
  hint: string
  /** Multiplier on the simulation clock */
  mul: number
  /** Tour: how long each post holds the lens */
  tourMs: number
}[] = [
  { id: 'still', label: 'still', hint: 'freeze the stream — hover and read', mul: 0, tourMs: 9000 },
  { id: 'drift', label: 'drift', hint: 'slow float — easy watching', mul: 0.32, tourMs: 8000 },
  { id: 'flow', label: 'flow', hint: 'the usual current', mul: 1, tourMs: 6500 },
  { id: 'rush', label: 'rush', hint: 'firehose', mul: 1.9, tourMs: 4500 },
]

export const speedMeta = (id: EdwardSpeed) => EDWARD_SPEEDS.find((s) => s.id === id) ?? EDWARD_SPEEDS[2]!

export function stepSpeed(current: EdwardSpeed, dir: 1 | -1): EdwardSpeed {
  const i = EDWARD_SPEEDS.findIndex((s) => s.id === current)
  const next = Math.min(EDWARD_SPEEDS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))
  return EDWARD_SPEEDS[next]!.id
}

// ── Preferences (device-local) ─────────────────────────────────────────────

const PREFS_KEY = 'neospace_edward_prefs_v1'

export type EdwardPrefs = { speed: EdwardSpeed; touring: boolean; captions: boolean }

export function readEdwardPrefs(): EdwardPrefs {
  const fallback: EdwardPrefs = { speed: 'flow', touring: false, captions: true }
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as Partial<EdwardPrefs> | null
    return {
      speed: EDWARD_SPEEDS.some((s) => s.id === raw?.speed) ? raw!.speed! : fallback.speed,
      touring: raw?.touring === true,
      captions: raw?.captions !== false,
    }
  } catch {
    return fallback
  }
}

export function writeEdwardPrefs(prefs: EdwardPrefs) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // private mode / quota — prefs are a convenience
  }
}

// ── Tour ───────────────────────────────────────────────────────────────────

/**
 * Next post for tour mode: weighted-random over what the current filter /
 * sort shows, skipping recent picks. Media, substance, affinity and sort rank
 * raise the odds; bots and content warnings lower them — serendipity with taste.
 */
export function pickTourCandidate(
  balls: readonly EdwardBallDescriptor[],
  recent: ReadonlySet<string>,
  current: string | null,
  rand: () => number = Math.random,
): string | null {
  const usable = (b: EdwardBallDescriptor) => b.identity !== current && (b.preview || b.mediaUrl)
  let pool = balls.filter((b) => usable(b) && !recent.has(b.identity))
  if (!pool.length) pool = balls.filter(usable)
  if (!pool.length) return null

  const weights = pool.map((b) => {
    let w = 1
    if (b.mediaUrl && !b.badges.includes('cw')) w += 0.6
    w += Math.min(1, b.preview.length / 140) * 0.6
    w += b.affinity * 0.8
    w += b.exploreRankNorm * 1.2
    if (b.isBot) w -= 0.7
    if (b.badges.includes('cw')) w -= 0.5
    return Math.max(0.15, w)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!
    if (r <= 0) return pool[i]!.identity
  }
  return pool[pool.length - 1]!.identity
}

// ── Layout ─────────────────────────────────────────────────────────────────

/** Bubbles drawn at once — phones get fewer, readable faces (and far less GPU) */
export const EDWARD_BALLS_DESK = 72
export const EDWARD_BALLS_COMPACT = 38

export const edwardIsCompact = () =>
  typeof window !== 'undefined' &&
  (window.innerWidth < 640 || window.matchMedia('(pointer: coarse)').matches)

export const edwardBallCap = () => (edwardIsCompact() ? EDWARD_BALLS_COMPACT : EDWARD_BALLS_DESK)

/** ≥ this width the deck is a left column and actions/speed get a right rail */
export const EDWARD_WIDE_MIN = 1100
/** Right rail (actions + speed) column, px incl. margins */
export const EDWARD_RAIL_COLUMN = 204

/** Desktop deck column width (px, incl. margins) — grows with the screen */
export function edwardDeckColumn(viewportW: number): number {
  return Math.round(Math.min(560, Math.max(400, viewportW * 0.27)))
}
