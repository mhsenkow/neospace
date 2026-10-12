import { describe, expect, it } from 'vitest'
import {
  EDGE_CUE_S,
  EDGE_DWELL_S,
  THROTTLED_FRAME_MS,
  edgeCueVisible,
  edgeDwellStep,
  edgeScrubGain,
  renderIntervalMs,
} from '../app/utils/edwardRender'

const load = {
  recessed: false,
  selected: false,
  reducedMotion: false,
  interacting: false,
  speedMul: 1,
}

describe('renderIntervalMs', () => {
  it('renders at display rate while the scene is live', () => {
    expect(renderIntervalMs(load)).toBe(0)
  })
  it('throttles at still speed when nothing is being touched', () => {
    expect(renderIntervalMs({ ...load, speedMul: 0 })).toBe(THROTTLED_FRAME_MS)
    expect(renderIntervalMs({ ...load, speedMul: 0, interacting: true })).toBe(0)
  })
  it('throttles behind the compose sheet, the peek modal, and idle reduced motion', () => {
    expect(renderIntervalMs({ ...load, recessed: true })).toBe(THROTTLED_FRAME_MS)
    expect(renderIntervalMs({ ...load, selected: true })).toBe(THROTTLED_FRAME_MS)
    expect(renderIntervalMs({ ...load, reducedMotion: true })).toBe(THROTTLED_FRAME_MS)
  })
  it('never throttles while the user is dragging or hovering a bubble', () => {
    expect(renderIntervalMs({ ...load, reducedMotion: true, interacting: true })).toBe(0)
  })
})

describe('edge hover scrub', () => {
  it('needs a dwell before anything scrubs, and resets when the pointer leaves', () => {
    let dwell = 0
    dwell = edgeDwellStep(dwell, 0.3, true)
    expect(edgeScrubGain(dwell)).toBe(0)
    expect(edgeCueVisible(dwell)).toBe(true) // cue first, scrub after
    dwell = edgeDwellStep(dwell, 0.2, false)
    expect(dwell).toBe(0)
    expect(edgeCueVisible(dwell)).toBe(false)
  })
  it('eases in after the dwell and caps at 1', () => {
    expect(edgeScrubGain(EDGE_DWELL_S)).toBe(0)
    expect(edgeScrubGain(EDGE_DWELL_S + 0.25)).toBeGreaterThan(0)
    expect(edgeScrubGain(EDGE_DWELL_S + 0.25)).toBeLessThan(1)
    expect(edgeScrubGain(10)).toBe(1)
  })
  it('shows the cue before the scrub starts', () => {
    expect(EDGE_CUE_S).toBeLessThan(EDGE_DWELL_S)
  })
})
