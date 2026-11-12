/**
 * Edward canvas bubble physics — springs, buoyancy, soft collisions.
 * Pure step; the WebGL host owns ball runtime state and when to call this.
 */

export const EDWARD_STREAM_BOTTOM = -18
export const EDWARD_STREAM_TOP = 18
export const EDWARD_STREAM_SPAN = EDWARD_STREAM_TOP - EDWARD_STREAM_BOTTOM

export type EdwardPhysicsBall = {
  identity: string
  x: number
  y: number
  z: number
  homeX: number
  homeZ: number
  vx: number
  vy: number
  vz: number
  speed: number
  phase: number
  size: number
}

const TOUR_PULL = 9

export type EdwardPhysicsStep = {
  balls: EdwardPhysicsBall[]
  physicsTick: number
  reducedMotion: boolean
  tourId: string | null
  tourTarget: { x: number; y: number; z: number }
  camera: { x: number; y: number; z: number } | null
  t: number
  dt: number
  realDt: number
  hash01: (s: string) => number
}

/** Returns the next physicsTick (incremented once per call). */
export function integrateEdwardBubblePhysics(step: EdwardPhysicsStep): number {
  const {
    balls,
    reducedMotion,
    tourId,
    tourTarget,
    camera,
    t,
    dt,
    realDt,
    hash01,
  } = step
  let { physicsTick } = step
  const n = balls.length
  if (!n) return physicsTick

  physicsTick++
  if (tourId && camera) {
    const len = Math.hypot(camera.x, camera.y, camera.z) || 1
    tourTarget.x = (camera.x / len) * 4
    tourTarget.y = (camera.y / len) * 4
    tourTarget.z = (camera.z / len) * 4
  }

  if (reducedMotion) {
    for (const b of balls) {
      b.x += (b.homeX - b.x) * 0.12
      b.z += (b.homeZ - b.z) * 0.12
      b.vx = 0
      b.vy = 0
      b.vz = 0
      if (b.y < EDWARD_STREAM_BOTTOM || b.y > EDWARD_STREAM_TOP) {
        b.y = EDWARD_STREAM_BOTTOM + 1 + hash01(b.identity + ':still') * (EDWARD_STREAM_SPAN - 2)
      }
    }
    return physicsTick
  }

  const damp = Math.exp(-2.2 * dt)
  const tourDamp = Math.exp(-6 * realDt)
  for (let i = 0; i < n; i++) {
    const b = balls[i]!
    if (b.identity === tourId) {
      b.vx = (b.vx + (tourTarget.x - b.x) * TOUR_PULL * realDt) * tourDamp
      b.vy = (b.vy + (tourTarget.y - b.y) * TOUR_PULL * realDt) * tourDamp
      b.vz = (b.vz + (tourTarget.z - b.z) * TOUR_PULL * realDt) * tourDamp
      b.x += b.vx * realDt
      b.y += b.vy * realDt
      b.z += b.vz * realDt
      continue
    }
    const ax =
      (b.homeX - b.x) * 2.1 + Math.sin(t * b.speed * 0.85 + b.phase) * 0.28
    const az =
      (b.homeZ - b.z) * 2.1 + Math.cos(t * b.speed * 0.7 + b.phase * 1.2) * 0.22
    const ay = 0.85 + b.speed * 0.5 - b.size * 0.06 + Math.sin(t * 1.5 + b.phase) * 0.12
    b.vx = (b.vx + ax * dt) * damp
    b.vy = (b.vy + ay * dt) * damp
    b.vz = (b.vz + az * dt) * damp
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.z += b.vz * dt
    if (b.y > EDWARD_STREAM_TOP + 2) {
      b.y = EDWARD_STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2.2
      b.vy = 0.5 + hash01(b.identity + ':re') * 0.35
      b.x = b.homeX + (hash01(b.identity + ':rx') - 0.5)
      b.z = b.homeZ + (hash01(b.identity + ':rz') - 0.5)
    }
  }

  if (physicsTick % 3 !== 0) return physicsTick
  for (let i = 0; i < n; i++) {
    const A = balls[i]!
    const rA = A.size * 0.95
    for (let j = i + 1; j < n; j++) {
      const B = balls[j]!
      const dx = B.x - A.x
      const dy = B.y - A.y
      const dz = B.z - A.z
      const minDist = rA + B.size * 0.95
      const distSq = dx * dx + dy * dy + dz * dz
      if (distSq >= minDist * minDist || distSq < 1e-6) continue
      const dist = Math.sqrt(distSq)
      const push = ((minDist - dist) / dist) * 0.32
      A.x -= dx * push
      A.y -= dy * push
      A.z -= dz * push
      B.x += dx * push
      B.y += dy * push
      B.z += dz * push
      A.vx *= 0.9
      A.vy *= 0.9
      A.vz *= 0.9
      B.vx *= 0.9
      B.vy *= 0.9
      B.vz *= 0.9
    }
  }
  return physicsTick
}
