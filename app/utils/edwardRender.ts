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

/**
 * Even a visually identical scene is redrawn this often — a safety net for any change the
 * signature can't see (GPU upload landing late, compositor dropping the buffer, …).
 */
export const IDLE_HEARTBEAT_MS = 2000

/**
 * Skips `renderer.render` when nothing that can change a pixel has changed.
 *
 * The caller folds everything that drives the picture (camera, view offset, sim clock, ball
 * transforms, hover/drag flags, …) into a flat number signature once per frame. Identical
 * signatures (exact equality, i.e. bitwise for doubles) mean the last drawn frame is still correct.
 * Anything that changes the picture *without* touching the signature (texture upload, material
 * swap, resize, context restore) must call `invalidate()`.
 */
export class FrameGate {
  private last: number[] = []
  private dirty = true
  private lastDrawAt = Number.NEGATIVE_INFINITY

  /** Force the next `shouldDraw` to return true */
  invalidate() {
    this.dirty = true
  }

  /** True when the scene must be drawn; records the signature + time when it says yes */
  shouldDraw(signature: readonly number[], now: number): boolean {
    let same = !this.dirty && signature.length === this.last.length
    if (same) {
      for (let i = 0; i < signature.length; i++) {
        if (signature[i] !== this.last[i]) {
          same = false
          break
        }
      }
    }
    if (same && now - this.lastDrawAt < IDLE_HEARTBEAT_MS) return false
    this.last = signature.slice()
    this.dirty = false
    this.lastDrawAt = now
    return true
  }
}

/** Cheap string → number for folding ids (hover / focus) into a frame signature */
export function hashToNumber(s: string | null | undefined): number {
  if (!s) return 0
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
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
