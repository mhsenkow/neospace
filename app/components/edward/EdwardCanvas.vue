<script setup lang="ts">
/**
 * Edward Mode WebGL — grown-up Radical Edward Session OS.
 * Flat readable faces in soap-bubble glass — buoyancy, soft collisions,
 * and neighbor light interplay. Lexx / Tank Girl / faces-OS energy.
 * three.js is dynamically imported so the main bundle stays clean.
 */

import { useEdwardStore } from '~/stores/edward'
import type { EdwardBallDescriptor } from '~/utils/edwardSemantics'
import {
  drawEmoticoin,
  faceSpecFor,
  MOOD_GLYPH,
  type EdwardFaceMood,
} from '~/utils/edwardFaces'
import { dialectForHost, paintServerDialect } from '~/utils/edwardServers'

const emit = defineEmits<{
  pick: [identity: string]
}>()

const edward = useEdwardStore()
const hostEl = ref<HTMLElement | null>(null)
const hoverCard = ref<{
  name: string
  preview: string
  kind: string
  mood: EdwardFaceMood
  why: string
  glyph: string
  tag: string | null
  affinity: number
  x: number
  y: number
} | null>(null)

const bubbles = ref<
  { id: string; text: string; x: number; y: number; scale: number }[]
>([])
const focusFrame = computed(() => edward.focusMode)

type ThreeMod = typeof import('three')

type BallRuntime = {
  identity: string
  root: InstanceType<ThreeMod['Group']>
  face: InstanceType<ThreeMod['Mesh']>
  shell: InstanceType<ThreeMod['Mesh']>
  halo: InstanceType<ThreeMod['Mesh']>
  spark: InstanceType<ThreeMod['Mesh']>
  ring: InstanceType<ThreeMod['Mesh']> | null
  texture: InstanceType<ThreeMod['CanvasTexture']>
  phase: number
  speed: number
  size: number
  spin: number
  /** Live world position (physics integrates these) */
  x: number
  y: number
  z: number
  /** Soft spring home (lane / affinity pack) */
  homeX: number
  homeZ: number
  vx: number
  vy: number
  vz: number
  /** Resting soap-film tint for neighbor lerp */
  baseAtten: InstanceType<ThreeMod['Color']>
  tintColor: InstanceType<ThreeMod['Color']>
  kind: EdwardBallDescriptor['kind']
  badges: EdwardBallDescriptor['badges']
  mood: EdwardFaceMood
  moodWhy: string
  label: string
  preview: string
  authorKey: string
  topTag: string | null
  inReplyToId: string | null
  statusId: string
  color: [number, number, number]
  affinity: number
  isShort: boolean
  shortText: string | null
  mediaUrl: string | null
}

const STREAM_BOTTOM = -18
const STREAM_TOP = 18
const STREAM_SPAN = STREAM_TOP - STREAM_BOTTOM
const MAX_BALLS = 96

let disposed = false
let raf = 0
let THREE: ThreeMod | null = null
let renderer: InstanceType<ThreeMod['WebGLRenderer']> | null = null
let scene: InstanceType<ThreeMod['Scene']> | null = null
let camera: InstanceType<ThreeMod['PerspectiveCamera']> | null = null
let ballGroup: InstanceType<ThreeMod['Group']> | null = null
let filamentLines: InstanceType<ThreeMod['LineSegments']> | null = null
let stars: InstanceType<ThreeMod['Points']> | null = null
let sphereGeo: InstanceType<ThreeMod['SphereGeometry']> | null = null
let faceGeo: InstanceType<ThreeMod['CircleGeometry']> | null = null
let sparkGeo: InstanceType<ThreeMod['SphereGeometry']> | null = null
let torusGeo: InstanceType<ThreeMod['TorusGeometry']> | null = null
let raycaster: InstanceType<ThreeMod['Raycaster']> | null = null
let envMap: InstanceType<ThreeMod['Texture']> | null = null
let pointerNdc = { x: 0, y: 0 }
let dragging = false
let dragMoved = false
let lastPtr = { x: 0, y: 0 }
let camYaw = 0.18
let camPitch = 0.08
let camDist = 26
let reducedMotion = false
let balls: BallRuntime[] = []
let identityToBall = new Map<string, BallRuntime>()
let clockStart = 0
let hoverIdentity: string | null = null
let sharedHaloMat: InstanceType<ThreeMod['MeshBasicMaterial']> | null = null
let sharedSparkMat: InstanceType<ThreeMod['MeshBasicMaterial']> | null = null
/** Roaming caustic lights that hitch to bright clusters */
let causticLights: InstanceType<ThreeMod['PointLight']>[] = []
const _tmpV = { x: 0, y: 0, z: 0 }
const _tmpV2 = { x: 0, y: 0, z: 0 }

const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

const paintAuthorChip = (
  ctx: CanvasRenderingContext2D,
  d: EdwardBallDescriptor,
) => {
  ctx.fillStyle = 'rgba(26,20,32,0.82)'
  ctx.beginPath()
  roundChip(ctx, 256, 455, Math.min(200, 28 + d.label.length * 7), 28)
  ctx.fill()
  ctx.fillStyle = '#fff8d6'
  ctx.font = '700 22px "Courier New", ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const name = d.label.length > 16 ? d.label.slice(0, 14) + '…' : d.label
  ctx.fillText(name, 256, 455)

  if (d.affinity > 0.35) {
    ctx.fillStyle = '#ff7eb3'
    ctx.beginPath()
    ctx.arc(420, 92, 18, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1a1420'
    ctx.font = '700 18px "Courier New", ui-monospace, monospace'
    ctx.fillText('★', 420, 93)
  }
}

const paintMediaPeek = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
) => {
  ctx.save()
  ctx.beginPath()
  ctx.arc(340, 340, 110, 0, Math.PI * 2)
  ctx.clip()
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight)
  let dw = 220
  let dh = 220
  if (aspect > 1) dh = 220 / aspect
  else dw = 220 * aspect
  ctx.globalAlpha = 0.88
  ctx.drawImage(img, 340 - dw / 2, 340 - dh / 2, dw, dh)
  ctx.restore()
  ctx.strokeStyle = '#ffe566'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(340, 340, 110, 0, Math.PI * 2)
  ctx.stroke()
}

const buildTexture = (d: EdwardBallDescriptor): InstanceType<ThreeMod['CanvasTexture']> => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const spec = faceSpecFor({
    kind: d.kind,
    badges: d.badges,
    engagement: d.engagement,
    text: d.preview,
    hasCard: d.hasCard,
    isBot: d.isBot,
  })
  const dialect = dialectForHost(d.instanceHost)
  const seed = hash01(d.identity)
  drawEmoticoin(ctx, spec, seed)
  paintServerDialect(ctx, dialect, seed)
  paintAuthorChip(ctx, d)

  const tex = new THREE!.CanvasTexture(canvas)
  tex.colorSpace = THREE!.SRGBColorSpace
  tex.anisotropy = 4
  tex.needsUpdate = true

  if (d.mediaUrl && !d.badges.includes('cw')) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (disposed) return
      drawEmoticoin(ctx, spec, seed)
      paintServerDialect(ctx, dialect, seed)
      paintMediaPeek(ctx, img)
      paintAuthorChip(ctx, d)
      tex.needsUpdate = true
    }
    img.src = d.mediaUrl
  }

  return tex
}

const roundChip = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
) => {
  const x = cx - w / 2
  const y = cy - h / 2
  const r = 8
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * Lane layout — affinity + explore-sort rank pull bubbles closer / center.
 * rankNorm 1 = top of current sort (loud/near/new/you).
 */
const laneFor = (identity: string, affinity = 0, rankNorm = 0) => {
  const a = hash01(identity)
  const b = hash01(identity + ':z')
  const pull = Math.min(1, Math.max(0, affinity, rankNorm * 0.92))
  const xScatter = 8 - pull * 5.2
  return {
    x: (a - 0.5) * xScatter,
    z: 4 - b * 10 - pull * 4.2,
  }
}

let lastExploreKey = ''

const disposeBall = (b: BallRuntime) => {
  ballGroup?.remove(b.root)
  ;(b.face.material as { dispose: () => void }).dispose()
  ;(b.shell.material as { dispose: () => void }).dispose()
  b.texture.dispose()
  if (b.ring) {
    ;(b.ring.material as { dispose: () => void }).dispose()
  }
}

const createBall = (d: EdwardBallDescriptor, ySeed: number): BallRuntime | null => {
  if (
    !THREE ||
    !ballGroup ||
    !sphereGeo ||
    !faceGeo ||
    !sparkGeo ||
    !sharedHaloMat ||
    !sharedSparkMat
  ) {
    return null
  }

  const texture = buildTexture(d)
  const spec = faceSpecFor({
    kind: d.kind,
    badges: d.badges,
    engagement: d.engagement,
    text: d.preview,
    hasCard: d.hasCard,
    isBot: d.isBot,
  })
  const lane = laneFor(d.identity, d.affinity, d.exploreRankNorm)
  const nearBoost = 1 + Math.max(0, (-lane.z) / 10) * 1.1
  const affBoost = 1 + d.affinity * 0.55 + d.exploreRankNorm * 0.65
  const size = (0.95 + d.size * 1.55) * nearBoost * affBoost
  const dialect = dialectForHost(d.instanceHost)
  const tint =
    d.affinity > 0.45 || d.exploreRankNorm > 0.7 ? '#ff7eb3' : dialect.accent || spec.rim

  const root = new THREE.Group()
  root.userData.identity = d.identity

  // Thin soap film — water IOR, high transmission, iridescent skin
  const atten = new THREE.Color(spec.fill)
  const tintColor = new THREE.Color(tint)
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: tintColor.clone().lerp(new THREE.Color('#fff8f0'), 0.35),
    metalness: 0,
    roughness: 0.035,
    transmission: 0.94,
    thickness: 0.28,
    ior: 1.33,
    transparent: true,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: 1,
    iridescenceIOR: 1.85,
    iridescenceThicknessRange: [140, 720],
    specularIntensity: 1,
    envMapIntensity: 1.85,
    attenuationColor: atten.clone(),
    attenuationDistance: 0.85,
    sheen: 0.55,
    sheenRoughness: 0.28,
    sheenColor: new THREE.Color(tint),
    side: THREE.FrontSide,
    depthWrite: false,
  })
  if (envMap) shellMat.envMap = envMap
  const shell = new THREE.Mesh(sphereGeo, shellMat)
  shell.userData.identity = d.identity

  // Flat face card inside the orb — always billboards; readable, not tumbling
  const faceMat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: Math.max(0.92, d.opacity),
    roughness: 0.45,
    metalness: 0.02,
    emissive: new THREE.Color(spec.fill),
    emissiveIntensity: 0.18 + d.affinity * 0.22,
    side: THREE.DoubleSide,
    depthWrite: true,
  })
  const face = new THREE.Mesh(faceGeo, faceMat)
  face.scale.setScalar(0.78)
  face.position.z = 0.02
  face.userData.identity = d.identity

  const halo = new THREE.Mesh(sphereGeo, sharedHaloMat)
  halo.scale.setScalar(1.22)
  halo.raycast = () => {}

  // Specular catch-light — steered by camera + neighbor bounce each frame
  const spark = new THREE.Mesh(sparkGeo, sharedSparkMat)
  spark.position.set(0.42, 0.48, 0.72)
  spark.scale.setScalar(0.14)
  spark.raycast = () => {}

  let ring: InstanceType<ThreeMod['Mesh']> | null = null
  const wantRing =
    torusGeo &&
    (d.affinity > 0.4 ||
      d.badges.includes('poll') ||
      d.kind === 'reply' ||
      d.kind === 'boost')
  if (wantRing && torusGeo) {
    const ringMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(d.affinity > 0.4 ? '#ff7eb3' : tint),
      metalness: 0.55,
      roughness: 0.22,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.9,
      emissive: new THREE.Color(d.affinity > 0.4 ? '#ff7eb3' : tint),
      emissiveIntensity: 0.4,
      envMapIntensity: 1.2,
    })
    if (envMap) ringMat.envMap = envMap
    ring = new THREE.Mesh(torusGeo, ringMat)
    ring.scale.setScalar(1.08)
    ring.raycast = () => {}
    root.add(ring)
  }

  root.add(halo)
  root.add(shell)
  root.add(face)
  root.add(spark)
  root.scale.setScalar(size)
  ballGroup.add(root)

  return {
    identity: d.identity,
    root,
    face,
    shell,
    halo,
    spark,
    ring,
    texture,
    phase: hash01(d.identity) * Math.PI * 2,
    speed: 0.65 + hash01(d.identity + ':s') * 0.95 - d.affinity * 0.12,
    size,
    spin: (hash01(d.identity + ':spin') - 0.5) * 0.45,
    x: lane.x,
    y: ySeed,
    z: lane.z,
    homeX: lane.x,
    homeZ: lane.z,
    vx: (hash01(d.identity + ':vx') - 0.5) * 0.4,
    vy: 0.35 + hash01(d.identity + ':vy') * 0.55,
    vz: (hash01(d.identity + ':vz') - 0.5) * 0.35,
    baseAtten: atten,
    tintColor,
    kind: d.kind,
    badges: d.badges,
    mood: d.mood || spec.mood,
    moodWhy: d.moodWhy || spec.why,
    label: d.label,
    preview: d.preview,
    authorKey: d.authorKey,
    topTag: d.topTag,
    inReplyToId: d.inReplyToId,
    statusId: d.statusId,
    color: d.color,
    affinity: d.affinity,
    isShort: d.isShort,
    shortText: d.shortText,
    mediaUrl: d.mediaUrl,
  }
}

const applyAffinityLayout = (b: BallRuntime, d: EdwardBallDescriptor) => {
  const lane = laneFor(d.identity, d.affinity, d.exploreRankNorm)
  // Retarget spring home — don't teleport, let physics drift over
  b.homeX = lane.x
  b.homeZ = lane.z
  b.affinity = d.affinity
  b.isShort = d.isShort
  b.shortText = d.shortText
  b.moodWhy = d.moodWhy
  const nearBoost = 1 + Math.max(0, (-lane.z) / 10) * 1.1
  const affBoost = 1 + d.affinity * 0.55 + d.exploreRankNorm * 0.65
  const size = (0.95 + d.size * 1.55) * nearBoost * affBoost
  b.size = size
  b.root.scale.setScalar(size)
}

/** Pack top-ranked results into the mid band so sort is visibly felt */
const packByExploreRank = (descriptors: EdwardBallDescriptor[]) => {
  const ranked = descriptors.filter((d) => d.exploreRank >= 0)
  if (!ranked.length) return
  const packN = Math.min(ranked.length, 28)
  for (let i = 0; i < packN; i++) {
    const d = ranked[i]!
    const b = identityToBall.get(d.identity)
    if (!b) continue
    const t = i / Math.max(1, packN - 1)
    b.y = -6 + t * 14 + hash01(d.identity + ':pack') * 0.4
    b.vy *= 0.35
    applyAffinityLayout(b, d)
  }
}

const syncBallsFromStore = () => {
  if (!THREE || !ballGroup) return
  const descriptors = edward.visibleBalls.slice(0, MAX_BALLS)
  const keep = new Set(descriptors.map((d) => d.identity))
  const byId = new Map(descriptors.map((d) => [d.identity, d]))
  const exploreKey = `${edward.exploreSort}|${edward.exploreQuery}|${descriptors.length}`
  const resort = exploreKey !== lastExploreKey
  lastExploreKey = exploreKey

  for (const [id, b] of [...identityToBall.entries()]) {
    if (!keep.has(id)) {
      disposeBall(b)
      identityToBall.delete(id)
    }
  }

  for (const [id, b] of identityToBall) {
    const d = byId.get(id)
    if (d) applyAffinityLayout(b, d)
  }

  const existingCount = identityToBall.size
  let spawnI = 0
  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i]!
    if (identityToBall.has(d.identity)) continue
    const y =
      existingCount === 0
        ? STREAM_BOTTOM + (i / Math.max(1, descriptors.length - 1)) * STREAM_SPAN
        : STREAM_BOTTOM - spawnI * 0.85 - hash01(d.identity) * 1.2
    const ball = createBall(d, y)
    if (ball) {
      identityToBall.set(d.identity, ball)
      spawnI++
    }
  }

  if (resort) packByExploreRank(descriptors)

  balls = [...identityToBall.values()]
  rebuildFilaments()
}

const ballWorldPos = (b: BallRuntime, _t?: number) => ({
  x: b.x,
  y: b.y,
  z: b.z,
})

/**
 * Soap-bubble dynamics — buoyancy, lane springs, soft collisions,
 * and short-range surface tension so clusters cling like real foam.
 */
const integrateBubblePhysics = (t: number, dt: number) => {
  const n = balls.length
  if (!n) return

  if (reducedMotion) {
    for (const b of balls) {
      b.x += (b.homeX - b.x) * 0.12
      b.z += (b.homeZ - b.z) * 0.12
      b.y += b.speed * dt * 0.55
      if (b.y > STREAM_TOP + 2) {
        b.y = STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2
        b.vy = 0.4
      }
    }
    return
  }

  const ax = new Float32Array(n)
  const ay = new Float32Array(n)
  const az = new Float32Array(n)

  for (let i = 0; i < n; i++) {
    const b = balls[i]!
    // Spring toward affinity / sort lane
    ax[i] = (b.homeX - b.x) * 2.4
    az[i] = (b.homeZ - b.z) * 2.4
    // Buoyancy — bigger films rise a bit slower, denser bobble
    ay[i] = 0.9 + b.speed * 0.55 - b.size * 0.08
    // Tiny thermal drift so they never freeze into a grid
    ax[i]! += Math.sin(t * b.speed * 0.85 + b.phase) * 0.35
    az[i]! += Math.cos(t * b.speed * 0.7 + b.phase * 1.2) * 0.28
    ay[i]! += Math.sin(t * 1.6 + b.phase) * 0.18
  }

  // Pairwise soft collide + surface tension (n ≤ 96 → fine)
  for (let i = 0; i < n; i++) {
    const A = balls[i]!
    const rA = A.size * 0.98
    for (let j = i + 1; j < n; j++) {
      const B = balls[j]!
      const dx = B.x - A.x
      const dy = B.y - A.y
      const dz = B.z - A.z
      const distSq = dx * dx + dy * dy + dz * dz
      const minDist = rA + B.size * 0.98
      const tensionR = minDist * 1.45
      if (distSq > tensionR * tensionR || distSq < 1e-6) continue
      const dist = Math.sqrt(distSq)
      const nx = dx / dist
      const ny = dy / dist
      const nz = dz / dist
      const invMassA = 1 / (0.6 + A.size)
      const invMassB = 1 / (0.6 + B.size)

      if (dist < minDist) {
        // Soft overlap — push apart (foam packing)
        const overlap = minDist - dist
        const push = overlap * 36
        ax[i]! -= nx * push * invMassA
        ay[i]! -= ny * push * invMassA
        az[i]! -= nz * push * invMassA
        ax[j]! += nx * push * invMassB
        ay[j]! += ny * push * invMassB
        az[j]! += nz * push * invMassB
        // Exchange a little velocity on contact (jiggle)
        const dvx = B.vx - A.vx
        const dvy = B.vy - A.vy
        const dvz = B.vz - A.vz
        const vn = dvx * nx + dvy * ny + dvz * nz
        if (vn < 0) {
          const bounce = vn * 0.35
          A.vx += bounce * nx
          A.vy += bounce * ny
          A.vz += bounce * nz
          B.vx -= bounce * nx
          B.vy -= bounce * ny
          B.vz -= bounce * nz
        }
      } else {
        // Surface tension — cling when almost touching
        const cling = (1 - dist / tensionR) * 3.2
        ax[i]! += nx * cling * invMassA
        ay[i]! += ny * cling * invMassA
        az[i]! += nz * cling * invMassA
        ax[j]! -= nx * cling * invMassB
        ay[j]! -= ny * cling * invMassB
        az[j]! -= nz * cling * invMassB
      }
    }
  }

  const damp = Math.exp(-2.8 * dt)
  for (let i = 0; i < n; i++) {
    const b = balls[i]!
    b.vx = (b.vx + ax[i]! * dt) * damp
    b.vy = (b.vy + ay[i]! * dt) * damp
    b.vz = (b.vz + az[i]! * dt) * damp
    // Cap so a pile-up doesn't launch coins into orbit
    const sp = Math.hypot(b.vx, b.vy, b.vz)
    if (sp > 4.5) {
      const s = 4.5 / sp
      b.vx *= s
      b.vy *= s
      b.vz *= s
    }
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.z += b.vz * dt
    if (b.y > STREAM_TOP + 2) {
      b.y = STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2.2
      b.vy = 0.5 + hash01(b.identity + ':re') * 0.4
      b.x = b.homeX + (hash01(b.identity + ':rx') - 0.5) * 1.2
      b.z = b.homeZ + (hash01(b.identity + ':rz') - 0.5) * 1.2
    }
  }
}

/**
 * Neighbor light interplay — iridescence + catch-lights borrow from nearby films,
 * caustic point lights hitch to bright clusters.
 */
const updateBubbleOptics = (t: number) => {
  if (!THREE || !camera) return
  const n = balls.length
  const cam = camera.position

  for (let i = 0; i < n; i++) {
    const b = balls[i]!
    let nearDist = Infinity
    let near: BallRuntime | null = null
    const searchR = b.size * 4.2
    const searchR2 = searchR * searchR
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const o = balls[j]!
      const dx = o.x - b.x
      const dy = o.y - b.y
      const dz = o.z - b.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < nearDist && d2 < searchR2) {
        nearDist = d2
        near = o
      }
    }

    const mat = b.shell.material as InstanceType<ThreeMod['MeshPhysicalMaterial']>
    const mix = near ? Math.max(0, 1 - Math.sqrt(nearDist) / searchR) : 0
    mat.envMapIntensity = 1.55 + mix * 1.65 + b.affinity * 0.35
    mat.iridescenceThicknessRange = [
      120 + mix * 220 + Math.sin(t * 0.7 + b.phase) * 40,
      480 + mix * 520 + Math.cos(t * 0.55 + b.phase) * 80,
    ]
    mat.thickness = 0.22 + mix * 0.2
    mat.sheen = 0.4 + mix * 0.45
    if (near) {
      mat.attenuationColor.copy(b.baseAtten).lerp(near.tintColor, mix * 0.55)
      mat.sheenColor.copy(b.tintColor).lerp(near.tintColor, mix * 0.7)
    } else {
      mat.attenuationColor.copy(b.baseAtten)
      mat.sheenColor.copy(b.tintColor)
    }

    // Specular spark: half-vector of camera + bounce from neighbor
    _tmpV.x = cam.x - b.x
    _tmpV.y = cam.y - b.y
    _tmpV.z = cam.z - b.z
    let len = Math.hypot(_tmpV.x, _tmpV.y, _tmpV.z) || 1
    _tmpV.x /= len
    _tmpV.y /= len
    _tmpV.z /= len
    if (near) {
      _tmpV2.x = near.x - b.x
      _tmpV2.y = near.y - b.y
      _tmpV2.z = near.z - b.z
      len = Math.hypot(_tmpV2.x, _tmpV2.y, _tmpV2.z) || 1
      _tmpV2.x /= len
      _tmpV2.y /= len
      _tmpV2.z /= len
      _tmpV.x = _tmpV.x * 0.65 + _tmpV2.x * 0.35 * mix
      _tmpV.y = _tmpV.y * 0.65 + _tmpV2.y * 0.35 * mix
      _tmpV.z = _tmpV.z * 0.65 + _tmpV2.z * 0.35 * mix
      len = Math.hypot(_tmpV.x, _tmpV.y, _tmpV.z) || 1
      _tmpV.x /= len
      _tmpV.y /= len
      _tmpV.z /= len
    }
    // Local-ish offset on the front hemisphere
    b.spark.position.set(
      _tmpV.x * 0.55 + 0.12,
      _tmpV.y * 0.55 + 0.18,
      Math.max(0.45, _tmpV.z * 0.55 + 0.55),
    )
    b.spark.scale.setScalar(0.11 + mix * 0.1 + Math.sin(t * 3 + b.phase) * 0.02)

  }

  // Hitch caustic lights to the densest / brightest nearby pairs
  if (causticLights.length && n) {
    const scored: { b: BallRuntime; s: number }[] = []
    for (const b of balls) {
      let neighbors = 0
      for (const o of balls) {
        if (o === b) continue
        const d2 = (o.x - b.x) ** 2 + (o.y - b.y) ** 2 + (o.z - b.z) ** 2
        if (d2 < (b.size * 3.5) ** 2) neighbors++
      }
      scored.push({ b, s: neighbors + b.affinity * 2 + (b.mood === 'swoon' ? 0.5 : 0) })
    }
    scored.sort((a, c) => c.s - a.s)
    for (let i = 0; i < causticLights.length; i++) {
      const light = causticLights[i]!
      const pick = scored[i]?.b || scored[0]?.b
      if (!pick) continue
      light.position.set(pick.x, pick.y, pick.z)
      light.color.copy(pick.tintColor)
      light.intensity = 10 + Math.min(22, (scored[i]?.s || 0) * 4)
      light.distance = 6 + pick.size * 3
    }
  }
}

const rebuildFilaments = () => {
  if (!THREE || !filamentLines) return
  const t = (performance.now() - clockStart) / 1000
  const positions: number[] = []
  const byAuthor = new Map<string, BallRuntime[]>()
  const byStatusId = new Map<string, BallRuntime>()

  for (const b of balls) {
    byStatusId.set(b.statusId, b)
    const list = byAuthor.get(b.authorKey) || []
    if (list.length < 3) list.push(b)
    byAuthor.set(b.authorKey, list)
  }

  for (const b of balls) {
    if (!b.inReplyToId) continue
    const parent = byStatusId.get(b.inReplyToId)
    if (!parent) continue
    const A = ballWorldPos(b, t)
    const B = ballWorldPos(parent, t)
    positions.push(A.x, A.y, A.z, B.x, B.y, B.z)
  }

  for (const list of byAuthor.values()) {
    if (list.length < 2) continue
    const A = ballWorldPos(list[0]!, t)
    const B = ballWorldPos(list[1]!, t)
    positions.push(A.x, A.y, A.z, B.x, B.y, B.z)
  }

  const sliced = positions.slice(0, 180 * 6)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sliced, 3))
  const old = filamentLines.geometry
  filamentLines.geometry = geo
  old.dispose()
}

const projectScreen = (
  x: number,
  y: number,
  z: number,
): { x: number; y: number; behind: boolean } | null => {
  if (!camera || !hostEl.value || !THREE) return null
  const v = new THREE.Vector3(x, y, z)
  v.project(camera)
  if (v.z > 1) return { x: 0, y: 0, behind: true }
  const rect = hostEl.value.getBoundingClientRect()
  return {
    x: (v.x * 0.5 + 0.5) * rect.width,
    y: (-v.y * 0.5 + 0.5) * rect.height,
    behind: false,
  }
}

const focusNormRect = (): { x0: number; y0: number; x1: number; y1: number } | null => {
  const mode = edward.focusMode
  if (mode === 'off') return null
  if (mode === 'square') return { x0: 0.28, y0: 0.28, x1: 0.72, y1: 0.72 }
  if (mode === 'circle') return { x0: 0.32, y0: 0.28, x1: 0.68, y1: 0.72 }
  return { x0: 0.08, y0: 0.38, x1: 0.92, y1: 0.62 }
}

/** Circle focus uses radial distance from viewport center */
const inFocusZone = (nx: number, ny: number): boolean => {
  const mode = edward.focusMode
  if (mode === 'off') return false
  if (mode === 'circle') {
    const dx = nx - 0.5
    const dy = ny - 0.5
    return Math.hypot(dx, dy / 0.85) < 0.22
  }
  const r = focusNormRect()
  if (!r) return false
  return nx >= r.x0 && nx <= r.x1 && ny >= r.y0 && ny <= r.y1
}

const updateBalls = (t: number, dt: number) => {
  if (!camera || !THREE || !hostEl.value) return
  const rect = hostEl.value.getBoundingClientRect()
  const focus = focusNormRect()
  let bestFocus: { id: string; score: number } | null = null
  const nextBubbles: { id: string; text: string; x: number; y: number; scale: number }[] = []

  integrateBubblePhysics(t, dt)
  updateBubbleOptics(t)

  for (const b of balls) {
    const p = ballWorldPos(b, t)
    b.root.position.set(p.x, p.y, p.z)

    // Shell barely breathes — keep the orb round; light does the work
    if (!reducedMotion) {
      const breathe = 1 + Math.sin(t * 1.1 + b.phase) * 0.018
      b.shell.scale.setScalar(breathe)
      b.shell.rotation.y = t * b.spin * 0.12 + b.phase * 0.2
    }

    // Face stays flat + readable — always toward camera
    b.face.quaternion.copy(camera.quaternion)
    if (!reducedMotion) {
      const wobble = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, Math.sin(t * b.spin * 0.8 + b.phase) * 0.08),
      )
      b.face.quaternion.multiply(wobble)
    }

    b.spark.quaternion.copy(camera.quaternion)

    if (b.ring) {
      b.ring.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.5 + b.phase) * 0.12
      b.ring.rotation.z = t * 0.55 + b.phase
    }

    const screen = projectScreen(p.x, p.y, p.z)
    if (!screen || screen.behind) continue
    const nx = screen.x / Math.max(1, rect.width)
    const ny = screen.y / Math.max(1, rect.height)

    const isWatched = edward.focusedIdentity === b.identity && edward.watchScrubbing

    if (focus && inFocusZone(nx, ny)) {
      const dist = Math.hypot(nx - 0.5, ny - 0.5)
      const score = 1 - dist + b.affinity * 0.35 + -b.z * 0.02
      if (!bestFocus || score > bestFocus.score) {
        bestFocus = { id: b.identity, score }
      }
      b.root.scale.setScalar(b.size * 1.14)
    } else if (isWatched) {
      b.root.scale.setScalar(b.size * 1.2)
    } else {
      b.root.scale.setScalar(b.size)
    }

    if (
      b.isShort &&
      b.shortText &&
      !b.badges.includes('cw') &&
      nextBubbles.length < 5 &&
      nx > 0.05 &&
      nx < 0.95 &&
      ny > 0.08 &&
      ny < 0.9
    ) {
      nextBubbles.push({
        id: b.identity,
        text: b.shortText,
        x: screen.x,
        y: screen.y - 36 - b.size * 10,
        scale: 0.85 + Math.min(0.4, b.affinity * 0.3),
      })
    }
  }

  bubbles.value = nextBubbles

  const focusedId = bestFocus?.id || null
  if (focusedId !== edward.focusedIdentity) {
    edward.setFocusedIdentity(focusedId)
  }
}

const applyCamera = () => {
  if (!camera) return
  const x = Math.sin(camYaw) * Math.cos(camPitch) * camDist
  const y = Math.sin(camPitch) * camDist * 0.35
  const z = Math.cos(camYaw) * Math.cos(camPitch) * camDist
  camera.position.set(x, y, z)
  camera.lookAt(0, 0, 0)
}

const projectHover = (b: BallRuntime) => {
  if (!camera || !hostEl.value || !THREE) return
  const t = (performance.now() - clockStart) / 1000
  const p = ballWorldPos(b, t)
  const v = new THREE.Vector3(p.x, p.y, p.z)
  v.project(camera)
  if (v.z > 1) {
    hoverCard.value = null
    return
  }
  const rect = hostEl.value.getBoundingClientRect()
  hoverCard.value = {
    name: b.label,
    preview: b.badges.includes('cw') ? '··· content warning ···' : b.preview || '…',
    kind: b.kind,
    mood: b.mood,
    why: b.moodWhy,
    glyph: MOOD_GLYPH[b.mood] || '◉‿◉',
    tag: b.topTag,
    affinity: b.affinity,
    x: (v.x * 0.5 + 0.5) * rect.width,
    y: (-v.y * 0.5 + 0.5) * rect.height,
  }
}

const hitTest = (): BallRuntime | null => {
  if (!raycaster || !camera || !ballGroup || !THREE) return null
  raycaster.setFromCamera(new THREE.Vector2(pointerNdc.x, pointerNdc.y), camera)
  const meshes = balls.flatMap((b) => [b.shell, b.face])
  const hits = raycaster.intersectObjects(meshes, false)
  if (!hits.length) return null
  const id = hits[0]!.object.userData.identity as string
  return identityToBall.get(id) || null
}

const onPointerDown = (e: PointerEvent) => {
  dragging = true
  dragMoved = false
  lastPtr = { x: e.clientX, y: e.clientY }
  hostEl.value?.setPointerCapture?.(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!hostEl.value) return
  const rect = hostEl.value.getBoundingClientRect()
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

  if (dragging) {
    const dx = e.clientX - lastPtr.x
    const dy = e.clientY - lastPtr.y
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
    camYaw -= dx * 0.005
    camPitch = Math.min(0.55, Math.max(-0.35, camPitch + dy * 0.004))
    lastPtr = { x: e.clientX, y: e.clientY }
    applyCamera()
    hoverCard.value = null
    hoverIdentity = null
    return
  }

  const hit = hitTest()
  if (hit) {
    hoverIdentity = hit.identity
    projectHover(hit)
    hostEl.value.style.cursor = 'pointer'
  } else {
    hoverIdentity = null
    hoverCard.value = null
    hostEl.value.style.cursor = 'grab'
  }
}

const onPointerUp = (e: PointerEvent) => {
  if (!dragging) return
  dragging = false
  try {
    hostEl.value?.releasePointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
  if (dragMoved) return
  const hit = hitTest()
  if (hit) emit('pick', hit.identity)
}

const onPointerLeave = () => {
  if (dragging) return
  hoverIdentity = null
  hoverCard.value = null
}

const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  camDist = Math.min(42, Math.max(14, camDist + e.deltaY * 0.02))
  applyCamera()
}

const onResize = () => {
  if (!hostEl.value || !renderer || !camera) return
  const w = hostEl.value.clientWidth
  const h = hostEl.value.clientHeight
  camera.aspect = w / Math.max(1, h)
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
}

let lastFrameT = 0
let filamentTick = 0

const frame = () => {
  if (disposed || !renderer || !scene || !camera) return
  const now = performance.now()
  const t = (now - clockStart) / 1000
  const dt = Math.min(0.05, (now - lastFrameT) / 1000 || 0.016)
  lastFrameT = now

  if (!reducedMotion) {
    camYaw += 0.00015
    applyCamera()
  }
  updateBalls(t, dt)

  if (++filamentTick % 30 === 0) rebuildFilaments()

  if (hoverIdentity) {
    const b = identityToBall.get(hoverIdentity)
    if (b) projectHover(b)
    else hoverCard.value = null
  }

  if (stars) stars.rotation.y = reducedMotion ? 0 : t * 0.008

  renderer.render(scene, camera)
  raf = requestAnimationFrame(frame)
}

const onVisibility = () => {
  if (typeof document === 'undefined' || disposed) return
  if (document.visibilityState === 'hidden') {
    cancelAnimationFrame(raf)
    raf = 0
    return
  }
  if (!raf && renderer && scene && camera) {
    lastFrameT = performance.now()
    raf = requestAnimationFrame(frame)
  }
}

const buildEnvMap = () => {
  if (!THREE || !renderer || !scene) return
  const T = THREE
  const pmrem = new T.PMREMGenerator(renderer)

  // Bubble-field studio — softboxes + mirrored orbs so films catch each other
  const envScene = new T.Scene()
  envScene.background = new T.Color(0x120818)

  const softbox = (color: number, x: number, y: number, z: number, s: number) => {
    const mesh = new T.Mesh(
      new T.SphereGeometry(1, 20, 16),
      new T.MeshBasicMaterial({ color }),
    )
    mesh.position.set(x, y, z)
    mesh.scale.setScalar(s)
    envScene.add(mesh)
    return mesh
  }
  softbox(0xff7eb3, 5, 6, 2, 3.4)
  softbox(0x59d1e0, -6, 2, -3, 3.0)
  softbox(0xffe566, 0, -5, 6, 2.6)
  softbox(0xffffff, 2, 7, -2, 1.6)
  softbox(0xff9ad5, -2, 4, 5, 1.8)
  // Tiny mirror bubbles for high-frequency specular glitter
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2
    softbox(
      i % 2 ? 0xffe566 : 0x59d1e0,
      Math.cos(a) * 7,
      Math.sin(a * 1.7) * 3,
      Math.sin(a) * 7,
      0.35 + (i % 3) * 0.12,
    )
  }

  const rt = pmrem.fromScene(envScene, 0.035)
  envMap = rt.texture
  scene.environment = envMap
  pmrem.dispose()
  envScene.traverse((obj) => {
    const m = obj as {
      geometry?: { dispose: () => void }
      material?: { dispose: () => void }
    }
    m.geometry?.dispose()
    m.material?.dispose()
  })
}

const disposeScene = () => {
  disposed = true
  cancelAnimationFrame(raf)
  if (hostEl.value) {
    hostEl.value.removeEventListener('pointerdown', onPointerDown)
    hostEl.value.removeEventListener('pointermove', onPointerMove)
    hostEl.value.removeEventListener('pointerup', onPointerUp)
    hostEl.value.removeEventListener('pointercancel', onPointerUp)
    hostEl.value.removeEventListener('pointerleave', onPointerLeave)
    hostEl.value.removeEventListener('wheel', onWheel)
  }
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibility)

  for (const b of balls) disposeBall(b)
  balls = []
  identityToBall.clear()

  const disposedGeo = new Set<object>()
  const disposeMat = (mat: { dispose: () => void } | { dispose: () => void }[] | undefined) => {
    if (!mat) return
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
  }
  if (scene) {
    scene.traverse((obj) => {
      const mesh = obj as {
        geometry?: { dispose: () => void }
        material?: { dispose: () => void } | { dispose: () => void }[]
      }
      if (mesh.geometry && !disposedGeo.has(mesh.geometry)) {
        disposedGeo.add(mesh.geometry)
        mesh.geometry.dispose()
      }
      disposeMat(mesh.material)
    })
  }

  envMap?.dispose()
  envMap = null
  sharedHaloMat = null
  sharedSparkMat = null
  causticLights = []
  sphereGeo = null
  faceGeo = null
  sparkGeo = null
  torusGeo = null
  filamentLines = null
  stars = null
  ballGroup = null
  renderer?.dispose()
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement)
  }
  renderer = null
  scene = null
  camera = null
  THREE = null
}

const init = async () => {
  if (!hostEl.value) return
  THREE = await import('three')
  if (disposed || !hostEl.value) return

  reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const w = hostEl.value.clientWidth
  const h = hostEl.value.clientHeight

  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x0a0614, 0.018)
  scene.background = new THREE.Color(0x0a0614)

  camera = new THREE.PerspectiveCamera(52, w / Math.max(1, h), 0.1, 200)
  applyCamera()

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  hostEl.value.appendChild(renderer.domElement)

  buildEnvMap()

  // Soft volumetric stage — less hard directional, more candy bounce
  scene.add(new THREE.AmbientLight(0xffe8f4, 0.28))
  const key = new THREE.DirectionalLight(0xff7eb3, 1.6)
  key.position.set(6, 10, 4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x59d1e0, 1.15)
  fill.position.set(-8, 2, -4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffe566, 0.95)
  rim.position.set(0, -4, 8)
  scene.add(rim)
  const point = new THREE.PointLight(0xff9ad5, 14, 45, 2)
  point.position.set(0, 4, 6)
  scene.add(point)

  // Caustic hitchhikers — follow dense foam clusters each frame
  causticLights = []
  for (const color of [0xff7eb3, 0x59d1e0, 0xffe566]) {
    const c = new THREE.PointLight(color, 12, 8, 2)
    scene.add(c)
    causticLights.push(c)
  }

  raycaster = new THREE.Raycaster()
  // Smooth glass orbs — transmission reads better with denser mesh
  sphereGeo = new THREE.SphereGeometry(1, 40, 32)
  faceGeo = new THREE.CircleGeometry(1, 40)
  sparkGeo = new THREE.SphereGeometry(1, 12, 10)
  torusGeo = new THREE.TorusGeometry(1.05, 0.055, 8, 48)

  sharedHaloMat = new THREE.MeshBasicMaterial({
    color: 0xff7eb3,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.BackSide,
  })
  sharedSparkMat = new THREE.MeshBasicMaterial({
    color: 0xfff8e8,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  })

  ballGroup = new THREE.Group()
  scene.add(ballGroup)

  // Glitter field
  const starCount = 900
  const starPos = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 90
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 90
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 90
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0xffc8e8,
      size: 0.12,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  )
  scene.add(stars)

  const filGeo = new THREE.BufferGeometry()
  filGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  filamentLines = new THREE.LineSegments(
    filGeo,
    new THREE.LineBasicMaterial({
      color: 0xff7eb3,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  )
  scene.add(filamentLines)

  // Deep void shell with a hint of CRT purple
  scene.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(95, 24, 16),
      new THREE.MeshBasicMaterial({
        color: 0x080510,
        side: THREE.BackSide,
      }),
    ),
  )

  clockStart = performance.now()
  lastFrameT = clockStart
  syncBallsFromStore()

  hostEl.value.addEventListener('pointerdown', onPointerDown)
  hostEl.value.addEventListener('pointermove', onPointerMove)
  hostEl.value.addEventListener('pointerup', onPointerUp)
  hostEl.value.addEventListener('pointercancel', onPointerUp)
  hostEl.value.addEventListener('pointerleave', onPointerLeave)
  hostEl.value.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  onVisibility()

  raf = requestAnimationFrame(frame)
}

watch(
  () => edward.visibleBalls,
  () => syncBallsFromStore(),
  { deep: false },
)

watch(
  () => edward.affinity,
  () => syncBallsFromStore(),
  { deep: false },
)

watch(
  () => [edward.exploreQuery, edward.exploreSort] as const,
  () => syncBallsFromStore(),
)

onMounted(() => {
  disposed = false
  void init()
})

onUnmounted(() => {
  disposeScene()
})
</script>

<template>
  <div ref="hostEl" class="edward-canvas" aria-hidden="true">
    <div
      v-if="focusFrame !== 'off'"
      class="edward-canvas__focus"
      :class="`edward-canvas__focus--${focusFrame}`"
      aria-hidden="true"
    />

    <div
      v-for="b in bubbles"
      :key="b.id"
      class="edward-canvas__bubble"
      :style="{
        transform: `translate(${b.x}px, ${b.y}px) scale(${b.scale})`,
      }"
    >
      {{ b.text }}
    </div>

    <div
      v-if="hoverCard"
      class="edward-canvas__hover"
      :style="{ transform: `translate(${hoverCard.x}px, ${hoverCard.y}px)` }"
    >
      <div class="edward-canvas__hover-top">
        <span class="edward-canvas__hover-glyph" aria-hidden="true">{{ hoverCard.glyph }}</span>
        <span class="edward-canvas__hover-kind">{{ hoverCard.why }} · {{ hoverCard.mood }}</span>
      </div>
      <strong class="edward-canvas__hover-name">{{ hoverCard.name }}</strong>
      <p class="edward-canvas__hover-preview">{{ hoverCard.preview }}</p>
      <span v-if="hoverCard.tag" class="edward-canvas__hover-tag">#{{ hoverCard.tag }}</span>
      <span v-if="hoverCard.affinity > 0.35" class="edward-canvas__hover-you">related to you</span>
      <span class="edward-canvas__hover-go">click!! heart · reply · follow · thread</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.edward-canvas {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background: #0a0614;

  &:active {
    cursor: grabbing;
  }
}

.edward-canvas__hover {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: min(290px, 74vw);
  padding: 10px 12px 12px;
  margin-top: -12px;
  margin-left: 18px;
  pointer-events: none;
  color: #fff8d6;
  font-family: 'Courier New', ui-monospace, monospace;
  background: color-mix(in srgb, #12081c 94%, #ffe566 6%);
  border: 2px solid #ffe566;
  border-radius: 4px;
  box-shadow:
    4px 4px 0 #1a1420,
    0 0 24px color-mix(in srgb, #ff7eb3 35%, transparent);
}

.edward-canvas__hover-top {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-bottom: 4px;
}

.edward-canvas__hover-glyph {
  font-size: 0.95rem;
  color: #ffe566;
}

.edward-canvas__hover-kind {
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #ff7eb3;
}

.edward-canvas__hover-name {
  display: block;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 4px;
  color: #fff;
}

.edward-canvas__hover-preview {
  margin: 0 0 6px;
  font-size: 0.75rem;
  line-height: 1.4;
  color: color-mix(in srgb, #fff8d6 82%, transparent);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.edward-canvas__hover-tag {
  display: inline-block;
  margin-bottom: 4px;
  font-size: 0.625rem;
  letter-spacing: 0.06em;
  color: #ffe566;
}

.edward-canvas__hover-you {
  display: inline-block;
  margin: 0 0.4rem 4px 0;
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  color: #ff7eb3;
}

.edward-canvas__hover-go {
  display: block;
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  color: #59d1e0;
}

.edward-canvas__focus {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  border: 2px dashed color-mix(in srgb, #ffe566 55%, transparent);
  box-shadow:
    0 0 0 9999px color-mix(in srgb, #0a0614 55%, transparent),
    inset 0 0 40px color-mix(in srgb, #ff7eb3 12%, transparent);
  border-radius: 4px;

  &--bar {
    left: 8%;
    right: 8%;
    top: 38%;
    height: 24%;
  }

  &--square {
    left: 28%;
    top: 28%;
    width: 44%;
    height: 44%;
  }

  &--circle {
    left: 50%;
    top: 50%;
    width: min(42vmin, 380px);
    height: min(42vmin, 380px);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border-style: solid;
    border-width: 2px;
  }
}

.edward-canvas__bubble {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  max-width: min(200px, 42vw);
  padding: 6px 10px;
  margin-left: -8px;
  pointer-events: none;
  font-family: 'Courier New', ui-monospace, monospace;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: #1a1420;
  background: #fff8d6;
  border: 2px solid #1a1420;
  border-radius: 12px 12px 12px 4px;
  box-shadow: 3px 3px 0 #ff7eb3;
  transform-origin: bottom left;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
