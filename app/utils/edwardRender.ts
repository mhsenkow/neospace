/**
 * Pure policy for Edward's canvas: how often to render, and when rim-hover may scrub the stream.
 * Kept free of three.js / DOM so it can be unit-tested.
 */

/** ~10 fps while the scene is behind something or has nothing moving the user cares about */
export const THROTTLED_FRAME_MS = 100

export interface RenderLoad {
  /** Compose sheet is open on top of Edward */
  recessed: boolean
  /** A post is open in the peek modal (the canvas is behind it) */
  selected: boolean
  reducedMotion: boolean
  /** Dragging, or hovering a bubble — the user is looking at the canvas right now */
  interacting: boolean
  /** Simulation clock multiplier (0 = still speed — scene barely moves) */
  speedMul: number
}

/**
 * Minimum ms between rendered frames (0 = every display frame).
 * Transmission glass is the expensive part, so it only runs at full rate while someone can see
 * and is acting on the scene; behind the compose sheet / peek modal, or under reduced motion with
 * nothing being touched (the scene barely changes), it ticks at ~10 fps.
 */
export function renderIntervalMs(load: RenderLoad): number {
  if (load.interacting) return 0
  if (load.recessed || load.selected || load.reducedMotion) return THROTTLED_FRAME_MS
  if (load.speedMul <= 0) return THROTTLED_FRAME_MS
  return 0
}

/** The pointer must rest in the rim this long before it scrubs anything */
export const EDGE_DWELL_S = 0.6
/** …then the scrub eases in over this long */
export const EDGE_RAMP_S = 0.5
/** The chevron cue appears a beat before the scrub starts, so it explains what is about to happen */
export const EDGE_CUE_S = 0.25

/** Seconds the pointer has rested in the rim: grows while inside, resets the moment it leaves */
export function edgeDwellStep(dwell: number, dt: number, inEdge: boolean): number {
  return inEdge ? dwell + Math.max(0, dt) : 0
}

/** 0 until the dwell passes, then eases to 1 — a parked cursor never makes the stream run away */
export function edgeScrubGain(dwell: number): number {
  if (dwell <= EDGE_DWELL_S) return 0
  return Math.min(1, (dwell - EDGE_DWELL_S) / EDGE_RAMP_S)
}

export const edgeCueVisible = (dwell: number): boolean => dwell >= EDGE_CUE_S
