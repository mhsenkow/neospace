import { describe, expect, it } from 'vitest'
import {
  EDGE_CUE_S,
  EDGE_DWELL_S,
  FrameGate,
  IDLE_HEARTBEAT_MS,
  THROTTLED_FRAME_MS,
  edgeCueVisible,
  edgeDwellStep,
  edgeScrubGain,
  hashToNumber,
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

describe('FrameGate (skip identical frames)', () => {
  it('draws the first frame, then skips while the signature is bitwise identical', () => {
    const gate = new FrameGate()
    expect(gate.shouldDraw([1, 2, 3], 0)).toBe(true)
    expect(gate.shouldDraw([1, 2, 3], 16)).toBe(false)
    expect(gate.shouldDraw([1, 2, 3], 32)).toBe(false)
  })
  it('draws again the moment anything in the signature moves', () => {
    const gate = new FrameGate()
    gate.shouldDraw([1, 2, 3], 0)
    expect(gate.shouldDraw([1, 2, 3.0000001], 16)).toBe(true)
    expect(gate.shouldDraw([1, 2, 3.0000001], 32)).toBe(false)
    expect(gate.shouldDraw([1, 2], 48)).toBe(true) // shape change counts too
  })
  it('invalidate() forces exactly one redraw', () => {
    const gate = new FrameGate()
    gate.shouldDraw([5], 0)
    gate.invalidate()
    expect(gate.shouldDraw([5], 16)).toBe(true)
    expect(gate.shouldDraw([5], 32)).toBe(false)
  })
  it('redraws an unchanged scene at the idle heartbeat as a safety net', () => {
    const gate = new FrameGate()
    gate.shouldDraw([5], 0)
    expect(gate.shouldDraw([5], IDLE_HEARTBEAT_MS - 1)).toBe(false)
    expect(gate.shouldDraw([5], IDLE_HEARTBEAT_MS)).toBe(true)
    expect(gate.shouldDraw([5], IDLE_HEARTBEAT_MS + 1)).toBe(false)
  })
  it('does not alias the caller\'s reused signature buffer', () => {
    const gate = new FrameGate()
    const buf = [1]
    gate.shouldDraw(buf, 0)
    buf[0] = 2
    expect(gate.shouldDraw(buf, 16)).toBe(true)
  })
})

describe('hashToNumber', () => {
  it('is stable, distinguishes ids, and maps empty to 0', () => {
    expect(hashToNumber('a')).toBe(hashToNumber('a'))
    expect(hashToNumber('a')).not.toBe(hashToNumber('b'))
    expect(hashToNumber(null)).toBe(0)
    expect(hashToNumber('')).toBe(0)
  })
})
