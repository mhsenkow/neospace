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
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

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
const MAX_BALLS = 72
/** Phones: fewer, readable faces (and far less GPU) than the desktop swarm */
const MAX_BALLS_COMPACT = 38
const isCompact = () =>
  typeof window !== 'undefined' &&
  (window.innerWidth < 640 || window.matchMedia('(pointer: coarse)').matches)
const maxBalls = () => (isCompact() ? MAX_BALLS_COMPACT : MAX_BALLS)
/** DPR 2 + transmission glass melts phone GPUs — 1.5 still looks crisp */
const pixelRatio = () => Math.min(window.devicePixelRatio || 1, isCompact() ? 1.5 : 2)

let disposed = false
let contextLost = false
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
/** Normalized pointer 0–1 in host (for edge zones) */
let pointerUv = { x: 0.5, y: 0.5 }
let pointerInside = false
let dragging = false
let dragMoved = false
/** Edge rails scrub the stream; middle orbits the camera */
let dragMode: 'orbit' | 'scroll' = 'orbit'
let lastPtr = { x: 0, y: 0 }
let camYaw = 0.18
let camPitch = 0.08
/** User zoom (wheel / pinch) as a multiplier on the fitted distance */
let camZoom = 1
let camDist = 26
/**
 * Fit the stream's width, not just its height: on a tall phone a fixed
 * distance shows a narrow sliver at huge scale — a wall of bubbles.
 */
const fittedDist = () => {
  const aspect = camera?.aspect || 1
  // Lanes span ~8–10 world units; frame ~13 across so a phone shows the
  // swarm with breathing room (tan(26°) ≈ 0.4877 for the 52° FOV)
  const forWidth = 13 / (2 * 0.4877 * Math.max(0.3, aspect))
  return Math.min(46, Math.max(26, forWidth))
}
/** Soft edge bands — L/R rails + thin T/B */
const EDGE_X = 0.13
const EDGE_Y = 0.11
/** OS setting OR in-app html.reduce-motion — kept live for the frame loop */
const prefersReducedMotion = usePrefersReducedMotion()
let reducedMotion = prefersReducedMotion.value
watch(prefersReducedMotion, (v) => {
  reducedMotion = v
})
let balls: BallRuntime[] = []
let identityToBall = new Map<string, BallRuntime>()
let clockStart = 0
let hoverIdentity: string | null = null
let sharedHaloMat: InstanceType<ThreeMod['MeshBasicMaterial']> | null = null
let sharedSparkMat: InstanceType<ThreeMod['MeshBasicMaterial']> | null = null
/** Single roaming caustic — updated sparsely */
let causticLight: InstanceType<ThreeMod['PointLight']> | null = null
let physicsTick = 0
const _tmpV = { x: 0, y: 0, z: 0 }

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

  // Candy glass — lighter than full soap transmission (that melts mobile GPUs)
  const atten = new THREE.Color(spec.fill)
  const tintColor = new THREE.Color(tint)
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: tintColor.clone().lerp(new THREE.Color('#fff8f0'), 0.28),
    metalness: 0.05,
    roughness: 0.12,
    transmission: 0.42,
    thickness: 0.55,
    ior: 1.4,
    transparent: true,
    opacity: 0.92,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
    iridescence: 0.65,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 480],
    envMapIntensity: 1.35,
    attenuationColor: atten.clone(),
    attenuationDistance: 1.4,
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
  halo.scale.setScalar(1.18)
  halo.raycast = () => {}

  // Specular catch-light — camera-facing, cheap
  const spark = new THREE.Mesh(sparkGeo, sharedSparkMat)
  spark.position.set(0.4, 0.46, 0.68)
  spark.scale.setScalar(0.13)
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
  const descriptors = edward.visibleBalls.slice(0, maxBalls())
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
 * Light bubble dynamics — springs + buoyancy every frame,
 * soft collide only every few ticks (keeps foam feel without melting the CPU).
 */
const integrateBubblePhysics = (t: number, dt: number) => {
  const n = balls.length
  if (!n) return
  physicsTick++

  // Reduced motion: a still field — no rising, no drift. Bubbles settle into
  // their lane; ones spawned off-stage get a fixed slot. Only user scrubs move them.
  if (reducedMotion) {
    for (const b of balls) {
      b.x += (b.homeX - b.x) * 0.12
      b.z += (b.homeZ - b.z) * 0.12
      b.vx = 0
      b.vy = 0
      b.vz = 0
      if (b.y < STREAM_BOTTOM || b.y > STREAM_TOP) {
        b.y = STREAM_BOTTOM + 1 + hash01(b.identity + ':still') * (STREAM_SPAN - 2)
      }
    }
    return
  }

  // Integrate motion cheaply
  const damp = Math.exp(-2.2 * dt)
  for (let i = 0; i < n; i++) {
    const b = balls[i]!
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
    if (b.y > STREAM_TOP + 2) {
      b.y = STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2.2
      b.vy = 0.5 + hash01(b.identity + ':re') * 0.35
      b.x = b.homeX + (hash01(b.identity + ':rx') - 0.5)
      b.z = b.homeZ + (hash01(b.identity + ':rz') - 0.5)
    }
  }

  // Soft collide every 3rd frame — positional push only
  if (physicsTick % 3 !== 0) return
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
}

/** Catch-lights + one caustic hitch — no per-frame material thrash */
const updateBubbleOptics = (t: number) => {
  if (!THREE || !camera) return
  const n = balls.length
  if (!n) return
  const cam = camera.position

  // Sparks only — cheap, reads as bounce light
  for (let i = 0; i < n; i++) {
    const b = balls[i]!
    _tmpV.x = cam.x - b.x
    _tmpV.y = cam.y - b.y + 0.4
    _tmpV.z = cam.z - b.z
    const len = Math.hypot(_tmpV.x, _tmpV.y, _tmpV.z) || 1
    b.spark.position.set(
      (_tmpV.x / len) * 0.5 + 0.1,
      (_tmpV.y / len) * 0.5 + 0.15,
      Math.max(0.5, (_tmpV.z / len) * 0.45 + 0.55),
    )
    b.spark.scale.setScalar(0.12 + Math.sin(t * 2.4 + b.phase) * 0.015)
  }

  // Caustic follows highest-affinity ball every ~12 frames
  if (causticLight && physicsTick % 12 === 0) {
    let best: BallRuntime | null = null
    let bestScore = -1
    for (const b of balls) {
      const s = b.affinity * 2 + b.size * 0.3
      if (s > bestScore) {
        bestScore = s
        best = b
      }
    }
    if (best) {
      causticLight.position.set(best.x, best.y, best.z)
      causticLight.color.copy(best.tintColor)
      causticLight.intensity = 8 + best.affinity * 10
      causticLight.distance = 7 + best.size * 2
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

/** Scratch vector — projection runs for every ball, every frame */
let _projV: InstanceType<ThreeMod['Vector3']> | null = null
/** Host size, read once per frame (was one layout read per ball) */
let hostW = 1
let hostH = 1

const projectScreen = (
  x: number,
  y: number,
  z: number,
): { x: number; y: number; behind: boolean } | null => {
  if (!camera || !THREE) return null
  const v = (_projV ||= new THREE.Vector3())
  v.set(x, y, z).project(camera)
  if (v.z > 1) return { x: 0, y: 0, behind: true }
  return {
    x: (v.x * 0.5 + 0.5) * hostW,
    y: (-v.y * 0.5 + 0.5) * hostH,
    behind: false,
  }
}

/**
 * Focus lens geometry in host pixels — one source of truth for drawing the
 * lens and for deciding what's "in" it. Sits in the open stage: below the
 * header, above the explore console and (on phones) a fixed reserve for the
 * watch deck, so the deck never covers the thing it describes. The reserve is
 * constant on purpose — measuring the deck itself would make the lens jump
 * whenever the deck appears.
 */
type Lens = { mode: 'bar' | 'square' | 'circle'; cx: number; cy: number; w: number; h: number }
const PHONE_MAX_W = 640
/** Below this the watch deck docks on the console (EdwardMode CSS) */
const DOCKED_DECK_MAX_W = 1100
const PHONE_DECK_RESERVE = 188
/** Keep in sync with EdwardMode's (max-height: 519px) deck */
const SHORT_DECK_RESERVE = 84
/** Wide screens: the deck is a fixed left column — keep the lens right of it */
const DESK_DECK_COLUMN = 452
/** …and the action rail on the right (EdwardMode .edward-mode__actions-rail) */
const DESK_RAIL_COLUMN = 204
const lens = ref<Lens | null>(null)
let lensTick = 0
/** Open stage (px) between header and console — speech bubbles stay inside it */
let stageTop = 0
let stageBottom = Number.POSITIVE_INFINITY

const measureLens = () => {
  const mode = edward.focusMode
  if (!hostEl.value) {
    lens.value = null
    return
  }
  const host = hostEl.value.getBoundingClientRect()
  const W = host.width
  const H = host.height
  const header = document.querySelector('.edward-mode__header')
  const explore = document.querySelector('.edward-mode__explore')
  let top = (header ? header.getBoundingClientRect().bottom - host.top : 0) + 12
  let bottom = (explore ? explore.getBoundingClientRect().top - host.top : H) - 12
  stageTop = top
  stageBottom = bottom
  if (mode === 'off') {
    lens.value = null
    centerSwarmOn(
      W / 2 + (W >= DOCKED_DECK_MAX_W ? (DESK_DECK_COLUMN - DESK_RAIL_COLUMN) / 2 : 0),
      top + (bottom - top) / 2,
      W,
      H,
    )
    return
  }
  // Short screens (landscape phones) get a one-line deck — reserve less
  if (W < DOCKED_DECK_MAX_W) bottom -= H < 520 ? SHORT_DECK_RESERVE : PHONE_DECK_RESERVE
  // With a lens on, the phone deck owns that band — keep bubbles above it too
  stageBottom = bottom
  // Squeezed (landscape phone, soft keyboard up) — fall back to the middle
  if (bottom - top < Math.min(150, H * 0.28)) {
    top = H * 0.22
    bottom = H * 0.7
  }
  const stageH = bottom - top
  // Horizontal stage: full width, or right of the desktop deck column
  const left = W >= DOCKED_DECK_MAX_W ? DESK_DECK_COLUMN : 0
  const right = W >= DOCKED_DECK_MAX_W ? DESK_RAIL_COLUMN : 0
  const stageW = W - left - right
  const cx = left + stageW / 2
  const cy = top + stageH / 2
  let w: number
  let h: number
  if (mode === 'bar') {
    w = stageW * (W < PHONE_MAX_W ? 0.9 : 0.86)
    h = Math.min(220, Math.max(96, stageH * 0.3))
  } else {
    const side = Math.min(stageW * (W < PHONE_MAX_W ? 0.7 : 0.5), stageH * 0.82, mode === 'circle' ? 380 : 440)
    w = side
    h = side
  }
  centerSwarmOn(cx, cy, W, H)
  const prev = lens.value
  // Only touch reactive state when it actually moved (template re-renders)
  if (
    !prev ||
    prev.mode !== mode ||
    Math.abs(prev.cx - cx) > 1 ||
    Math.abs(prev.cy - cy) > 1 ||
    Math.abs(prev.w - w) > 1 ||
    Math.abs(prev.h - h) > 1
  ) {
    lens.value = { mode, cx, cy, w, h }
  }
}

/**
 * Slide the rendered scene so the swarm's center sits on the open stage
 * (above the phone deck, right of the desktop deck) — lens and swarm line up
 * on every screen. setViewOffset keeps projection + raycasting consistent.
 */
let viewShift = { x: 0, y: 0, w: 0, h: 0 }
const centerSwarmOn = (cx: number, cy: number, W: number, H: number) => {
  if (!camera) return
  const dx = Math.round(cx - W / 2)
  const dy = Math.round(cy - H / 2)
  if (viewShift.x === dx && viewShift.y === dy && viewShift.w === W && viewShift.h === H) return
  viewShift = { x: dx, y: dy, w: W, h: H }
  camera.setViewOffset(W, H, -dx, -dy, W, H)
}

const lensStyle = computed(() => {
  const l = lens.value
  if (!l) return undefined
  return {
    left: `${l.cx - l.w / 2}px`,
    top: `${l.cy - l.h / 2}px`,
    width: `${l.w}px`,
    height: `${l.h}px`,
  }
})

/** Same geometry the lens is drawn with — circle is a true circle */
const inFocusZone = (px: number, py: number): boolean => {
  const l = lens.value
  if (!l) return false
  if (l.mode === 'circle') return Math.hypot(px - l.cx, py - l.cy) <= l.w / 2
  return Math.abs(px - l.cx) <= l.w / 2 && Math.abs(py - l.cy) <= l.h / 2
}

const _wobbleQ: { q: InstanceType<ThreeMod['Quaternion']> | null; e: InstanceType<ThreeMod['Euler']> | null } = {
  q: null,
  e: null,
}

const updateBalls = (t: number, dt: number) => {
  if (!camera || !THREE || !hostEl.value) return
  hostW = Math.max(1, hostEl.value.clientWidth)
  hostH = Math.max(1, hostEl.value.clientHeight)
  // Header / console sizes rarely change — re-measure the lens a few times a second
  if (lensTick++ % 20 === 0 || (edward.focusMode === 'off') !== !lens.value) measureLens()
  const maxBubbles = hostW < PHONE_MAX_W ? 3 : 5
  const focus = lens.value
  /** Current watch subject still inside the lens? Then it keeps the deck. */
  let currentStillInLens = false
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
      const e = (_wobbleQ.e ||= new THREE.Euler())
      const q = (_wobbleQ.q ||= new THREE.Quaternion())
      e.set(0, 0, Math.sin(t * b.spin * 0.8 + b.phase) * 0.08)
      b.face.quaternion.multiply(q.setFromEuler(e))
    }

    b.spark.quaternion.copy(camera.quaternion)

    if (b.ring) {
      b.ring.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.5 + b.phase) * 0.12
      b.ring.rotation.z = t * 0.55 + b.phase
    }

    const screen = projectScreen(p.x, p.y, p.z)
    if (!screen || screen.behind) continue
    const nx = screen.x / hostW

    const isWatched = edward.focusedIdentity === b.identity && edward.watchScrubbing

    if (focus && inFocusZone(screen.x, screen.y)) {
      if (b.identity === edward.focusedIdentity) currentStillInLens = true
      // Closest to the lens center wins; affinity + nearness break ties
      const dist = Math.hypot(screen.x - focus.cx, screen.y - focus.cy) / Math.max(focus.w, focus.h)
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

    const bubbleY = screen.y - 36 - b.size * 10
    if (
      b.isShort &&
      b.shortText &&
      !b.badges.includes('cw') &&
      nextBubbles.length < maxBubbles &&
      nx > 0.05 &&
      nx < 0.95 &&
      // Inside the open stage only — not under the header / deck / console
      bubbleY > stageTop &&
      screen.y < stageBottom &&
      // The lens subject is already in the watch deck; don't bury it in text
      !(focus && inFocusZone(screen.x, screen.y))
    ) {
      // Keep the whole speech bubble on screen (max-width min(200px, 42vw))
      const bubbleW = Math.min(200, hostW * 0.42) + 12
      nextBubbles.push({
        id: b.identity,
        text: b.shortText,
        x: Math.min(Math.max(8, screen.x), hostW - bubbleW - 8),
        y: bubbleY,
        scale: 0.85 + Math.min(0.4, b.affinity * 0.3),
      })
    }
  }

  bubbles.value = nextBubbles

  // Sticky focus: let the reader finish — swap only once the watched post
  // drifts out of the lens (it used to flip to every slightly-closer ball)
  const focusedId = currentStillInLens ? edward.focusedIdentity : bestFocus?.id || null
  if (focusedId !== edward.focusedIdentity) {
    edward.setFocusedIdentity(focusedId)
  }
}

const applyCamera = () => {
  if (!camera) return
  camDist = fittedDist() * camZoom
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

const syncPointerUv = (clientX: number, clientY: number) => {
  if (!hostEl.value) return
  const rect = hostEl.value.getBoundingClientRect()
  const w = Math.max(1, rect.width)
  const h = Math.max(1, rect.height)
  pointerUv.x = (clientX - rect.left) / w
  pointerUv.y = (clientY - rect.top) / h
  pointerNdc.x = pointerUv.x * 2 - 1
  pointerNdc.y = -(pointerUv.y * 2 - 1)
}

/** Near the rim → stream scroll; open middle → full 3D orbit */
const pointerInScrollEdge = (nx = pointerUv.x, ny = pointerUv.y) =>
  nx < EDGE_X || nx > 1 - EDGE_X || ny < EDGE_Y || ny > 1 - EDGE_Y

const setHostCursor = (kind: 'grab' | 'grabbing' | 'pointer' | 'scroll') => {
  if (!hostEl.value) return
  if (kind === 'scroll') hostEl.value.style.cursor = 'ns-resize'
  else hostEl.value.style.cursor = kind
}

/** Nudge every bubble along the stream (positive dy = content moves down / rewind) */
const scrubStream = (dyWorld: number) => {
  if (!dyWorld || !balls.length) return
  for (const b of balls) {
    b.y += dyWorld
    // Keep a little velocity so they don't look glued after a scrub
    b.vy += dyWorld * 2.5
    if (b.y > STREAM_TOP + 3) {
      b.y = STREAM_BOTTOM + (b.y - STREAM_TOP)
    } else if (b.y < STREAM_BOTTOM - 3) {
      b.y = STREAM_TOP - (STREAM_BOTTOM - b.y)
    }
  }
}

/** Two-finger pinch zooms (touch has no wheel) */
const activePtrs = new Map<number, { x: number; y: number }>()
let pinch: { dist: number; zoom: number } | null = null
const pinchDist = () => {
  const [a, b] = [...activePtrs.values()]
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
}

const onPointerDown = (e: PointerEvent) => {
  activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (activePtrs.size === 2) {
    // Second finger: switch from orbit/scroll to pinch, and never "tap" a face
    pinch = { dist: Math.max(1, pinchDist()), zoom: camZoom }
    dragMoved = true
    hoverCard.value = null
    hoverIdentity = null
    return
  }
  syncPointerUv(e.clientX, e.clientY)
  dragging = true
  dragMoved = false
  dragMode = pointerInScrollEdge() ? 'scroll' : 'orbit'
  lastPtr = { x: e.clientX, y: e.clientY }
  setHostCursor(dragMode === 'scroll' ? 'scroll' : 'grabbing')
  hostEl.value?.setPointerCapture?.(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!hostEl.value) return
  if (activePtrs.has(e.pointerId)) activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && activePtrs.size >= 2) {
    const d = pinchDist()
    if (d > 0) {
      // Fingers apart → closer (smaller multiplier)
      camZoom = Math.min(1.6, Math.max(0.55, pinch.zoom * (pinch.dist / d)))
      applyCamera()
    }
    return
  }
  pointerInside = true
  syncPointerUv(e.clientX, e.clientY)

  if (dragging) {
    const dx = e.clientX - lastPtr.x
    const dy = e.clientY - lastPtr.y
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
    lastPtr = { x: e.clientX, y: e.clientY }
    hoverCard.value = null
    hoverIdentity = null

    if (dragMode === 'scroll') {
      // Pixel drag → world stream scrub (up drag = go forward in time / rise)
      scrubStream(-dy * 0.045)
      setHostCursor('scroll')
    } else {
      camYaw -= dx * 0.005
      camPitch = Math.min(0.55, Math.max(-0.35, camPitch + dy * 0.004))
      applyCamera()
      setHostCursor('grabbing')
    }
    return
  }

  if (pointerInScrollEdge()) {
    hoverIdentity = null
    hoverCard.value = null
    setHostCursor('scroll')
    return
  }

  const hit = hitTest()
  if (hit) {
    hoverIdentity = hit.identity
    projectHover(hit)
    setHostCursor('pointer')
  } else {
    hoverIdentity = null
    hoverCard.value = null
    setHostCursor('grab')
  }
}

const onPointerUp = (e: PointerEvent) => {
  activePtrs.delete(e.pointerId)
  if (pinch) {
    if (activePtrs.size < 2) pinch = null
    // Lifting one finger of a pinch ends the gesture outright
    dragging = false
    return
  }
  if (!dragging) return
  const wasScroll = dragMode === 'scroll'
  dragging = false
  try {
    hostEl.value?.releasePointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
  syncPointerUv(e.clientX, e.clientY)
  setHostCursor(pointerInScrollEdge() ? 'scroll' : 'grab')
  // Edge scrubs never pick a face — middle clicks still do
  if (dragMoved || wasScroll) return
  const hit = hitTest()
  if (hit) emit('pick', hit.identity)
}

/** OS took the gesture (scroll, system swipe) — clean up, never open a post */
const onPointerCancel = (e: PointerEvent) => {
  activePtrs.delete(e.pointerId)
  if (activePtrs.size < 2) pinch = null
  dragging = false
  try {
    hostEl.value?.releasePointerCapture?.(e.pointerId)
  } catch {
    /* ignore */
  }
}

const onPointerLeave = () => {
  pointerInside = false
  if (dragging) return
  hoverIdentity = null
  hoverCard.value = null
}

const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  syncPointerUv(e.clientX, e.clientY)
  if (pointerInScrollEdge()) {
    scrubStream(-e.deltaY * 0.018)
    return
  }
  // Middle: dolly the camera in 3D
  camZoom = Math.min(1.6, Math.max(0.55, camZoom + e.deltaY * 0.0008))
  applyCamera()
}

/** Hovering the rim gently feeds the stream — invisible scroll */
const applyEdgeHoverScroll = (dt: number) => {
  if (!pointerInside || dragging || reducedMotion) return
  const { x: nx, y: ny } = pointerUv
  let scrub = 0
  // Top / bottom bands — stronger the closer to the rim
  if (ny < EDGE_Y) scrub = (1 - ny / EDGE_Y) * 2.8
  else if (ny > 1 - EDGE_Y) scrub = -((ny - (1 - EDGE_Y)) / EDGE_Y) * 2.8
  // Side rails: vertical position still drives direction
  if (nx < EDGE_X || nx > 1 - EDGE_X) {
    const side = nx < EDGE_X ? 1 - nx / EDGE_X : (nx - (1 - EDGE_X)) / EDGE_X
    const fromY = (0.5 - ny) * 3.2
    scrub += fromY * Math.min(1, side)
  }
  if (Math.abs(scrub) > 0.05) scrubStream(scrub * dt)
}

const onResize = () => {
  if (!hostEl.value || !renderer || !camera) return
  const w = hostEl.value.clientWidth
  const h = hostEl.value.clientHeight
  camera.aspect = w / Math.max(1, h)
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(pixelRatio())
  // Rotation / fold: refit the stream, move the lens, re-apply the ball budget
  applyCamera()
  measureLens()
  syncBallsFromStore()
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
  applyEdgeHoverScroll(dt)
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
  if (!raf && !contextLost && renderer && scene && camera) {
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
  softbox(0x59d1e0, 6, -2, -5, 0.8)
  softbox(0xffe566, -4, 3, 6, 0.7)

  const rt = pmrem.fromScene(envScene, 0.04)
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
    hostEl.value.removeEventListener('pointercancel', onPointerCancel)
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
  causticLight = null
  physicsTick = 0
  sphereGeo = null
  faceGeo = null
  sparkGeo = null
  torusGeo = null
  filamentLines = null
  stars = null
  ballGroup = null
  renderer?.dispose()
  // Hand the GL context back now — browsers cap live contexts (~16) and kill the
  // oldest, which used to take down a fresh Edward session after a few re-opens
  renderer?.forceContextLoss()
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

  reducedMotion = prefersReducedMotion.value

  const w = hostEl.value.clientWidth
  const h = hostEl.value.clientHeight

  scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x0a0614, 0.018)
  scene.background = new THREE.Color(0x0a0614)

  camera = new THREE.PerspectiveCamera(52, w / Math.max(1, h), 0.1, 200)
  applyCamera()

  try {
    renderer = new THREE.WebGLRenderer({
      // MSAA is costly on phone GPUs at DPR 1.5 — the glass hides the jaggies
      antialias: !isCompact(),
      alpha: false,
      powerPreference: 'high-performance',
    })
  } catch {
    edward.setError('Edward needs WebGL, and this browser/device won’t start it.')
    return
  }
  // Phones drop GPU contexts under memory pressure / backgrounding — say so
  // instead of freezing on the last frame.
  renderer.domElement.addEventListener('webglcontextlost', (ev) => {
    // A previous (disposed) canvas being reclaimed isn't this session's problem
    if (disposed) return
    ev.preventDefault()
    contextLost = true
    cancelAnimationFrame(raf)
    raf = 0
    edward.setError('Your device paused the 3D view. Exit and reopen Edward to restart it.')
  })
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(pixelRatio())
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

  causticLight = new THREE.PointLight(0xff7eb3, 10, 8, 2)
  scene.add(causticLight)

  raycaster = new THREE.Raycaster()
  sphereGeo = new THREE.SphereGeometry(1, 28, 22)
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
  hostEl.value.addEventListener('pointercancel', onPointerCancel)
  hostEl.value.addEventListener('pointerleave', onPointerLeave)
  hostEl.value.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  // Starts the loop when the tab is visible. (A second unconditional rAF here
  // used to run two loops at once: double-speed physics, every frame drawn twice.)
  onVisibility()
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
  contextLost = false
  void init()
})

onUnmounted(() => {
  disposeScene()
})
</script>

<template>
  <div ref="hostEl" class="edward-canvas" aria-hidden="true">
    <!-- Invisible scroll rails — cursor ns-resize; middle stays 3D -->
    <div class="edward-canvas__edge edward-canvas__edge--l" aria-hidden="true" />
    <div class="edward-canvas__edge edward-canvas__edge--r" aria-hidden="true" />
    <div class="edward-canvas__edge edward-canvas__edge--t" aria-hidden="true" />
    <div class="edward-canvas__edge edward-canvas__edge--b" aria-hidden="true" />

    <div
      v-if="focusFrame !== 'off' && lensStyle"
      class="edward-canvas__focus"
      :class="`edward-canvas__focus--${focusFrame}`"
      :style="lensStyle"
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

/* Barely-there rim cue — reads as atmosphere, not UI chrome */
.edward-canvas__edge {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  opacity: 0.55;

  &--l,
  &--r {
    top: 0;
    bottom: 0;
    width: 13%;
  }

  &--l {
    left: 0;
    background: linear-gradient(
      90deg,
      color-mix(in srgb, #59d1e0 10%, transparent),
      transparent
    );
  }

  &--r {
    right: 0;
    background: linear-gradient(
      270deg,
      color-mix(in srgb, #ff7eb3 10%, transparent),
      transparent
    );
  }

  &--t,
  &--b {
    left: 0;
    right: 0;
    height: 11%;
  }

  &--t {
    top: 0;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, #ffe566 8%, transparent),
      transparent
    );
  }

  &--b {
    bottom: 0;
    background: linear-gradient(
      0deg,
      color-mix(in srgb, #ffe566 8%, transparent),
      transparent
    );
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

  // Position + size come from measureLens() (inline px) — same geometry as
  // the in-focus test, kept clear of the header / console / phone deck.
  transition:
    top 0.25s ease,
    height 0.25s ease,
    width 0.25s ease,
    left 0.25s ease;

  &--circle {
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
