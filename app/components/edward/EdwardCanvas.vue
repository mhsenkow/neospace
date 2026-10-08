<script setup lang="ts">
/**
 * Edward Mode WebGL — Radical Edward faces-OS thought stream.
 * Emoticoin discs rise bottom→top; nearer = bigger. 90s Session energy.
 * three.js is dynamically imported so the main bundle stays clean.
 */

import { useEdwardStore } from '~/stores/edward'
import type { EdwardBallDescriptor } from '~/utils/edwardSemantics'
import {
  drawEmoticoin,
  faceSpecFor,
  type EdwardFaceMood,
} from '~/utils/edwardFaces'

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
  glyph: string
  x: number
  y: number
} | null>(null)

type ThreeMod = typeof import('three')

type BallRuntime = {
  identity: string
  mesh: InstanceType<ThreeMod['Mesh']>
  halo: InstanceType<ThreeMod['Mesh']>
  ring: InstanceType<ThreeMod['Mesh']> | null
  texture: InstanceType<ThreeMod['CanvasTexture']>
  phase: number
  speed: number
  size: number
  spin: number
  /** Horizontal lane */
  x: number
  /** Depth — smaller z = closer to camera */
  z: number
  /** Vertical position along stream */
  y: number
  kind: EdwardBallDescriptor['kind']
  badges: EdwardBallDescriptor['badges']
  mood: EdwardFaceMood
  label: string
  preview: string
  authorKey: string
  inReplyToId: string | null
  statusId: string
  color: [number, number, number]
}

const MOOD_GLYPH: Record<EdwardFaceMood, string> = {
  curious: '◉‿◉',
  yapping: 'ᕕ(ᐛ)',
  starry: '★◇★',
  sparkle: '♥‿♥',
  hmm: '·_·?',
  shy: '(⁄⁄)',
  manic: '✧ヮ✧',
}

const STREAM_BOTTOM = -18
const STREAM_TOP = 18
const STREAM_SPAN = STREAM_TOP - STREAM_BOTTOM
const MAX_BALLS = 90

let disposed = false
let raf = 0
let THREE: ThreeMod | null = null
let renderer: InstanceType<ThreeMod['WebGLRenderer']> | null = null
let scene: InstanceType<ThreeMod['Scene']> | null = null
let camera: InstanceType<ThreeMod['PerspectiveCamera']> | null = null
let ballGroup: InstanceType<ThreeMod['Group']> | null = null
let filamentLines: InstanceType<ThreeMod['LineSegments']> | null = null
let stars: InstanceType<ThreeMod['Points']> | null = null
let coinGeo: InstanceType<ThreeMod['CircleGeometry']> | null = null
let torusGeo: InstanceType<ThreeMod['TorusGeometry']> | null = null
let raycaster: InstanceType<ThreeMod['Raycaster']> | null = null
let pointerNdc = { x: 0, y: 0 }
let dragging = false
let dragMoved = false
let lastPtr = { x: 0, y: 0 }
/** Camera orbit around the vertical stream */
let camYaw = 0.12
let camPitch = 0.06
let camDist = 24
let reducedMotion = false
let balls: BallRuntime[] = []
let identityToBall = new Map<string, BallRuntime>()
let clockStart = 0
let hoverIdentity: string | null = null
let sharedHaloMat: InstanceType<ThreeMod['MeshBasicMaterial']> | null = null

const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
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
  })
  drawEmoticoin(ctx, spec, hash01(d.identity))

  // Tiny author sticker under the chin — still readable on hover-sized coins
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

  const tex = new THREE!.CanvasTexture(canvas)
  tex.colorSpace = THREE!.SRGBColorSpace
  tex.needsUpdate = true
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

const laneFor = (identity: string) => {
  const a = hash01(identity)
  const b = hash01(identity + ':z')
  // x: ±4 lane scatter; z: 4 (far) → -6 (near / bigger)
  return {
    x: (a - 0.5) * 8,
    z: 4 - b * 10,
  }
}

const disposeBall = (b: BallRuntime) => {
  ballGroup?.remove(b.mesh)
  ballGroup?.remove(b.halo)
  if (b.ring) ballGroup?.remove(b.ring)
  ;(b.mesh.material as { dispose: () => void }).dispose()
  b.texture.dispose()
  if (b.ring) {
    ;(b.ring.material as { dispose: () => void }).dispose()
  }
}

const createBall = (d: EdwardBallDescriptor, ySeed: number): BallRuntime | null => {
  if (!THREE || !ballGroup || !coinGeo || !sharedHaloMat) return null
  const texture = buildTexture(d)
  const spec = faceSpecFor({
    kind: d.kind,
    badges: d.badges,
    engagement: d.engagement,
  })
  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: Math.max(0.75, d.opacity),
    side: THREE.DoubleSide,
    depthWrite: true,
  })
  const mesh = new THREE.Mesh(coinGeo, mat)
  // Bigger coins — nearer depth lanes read even larger
  const nearBoost = 1 + Math.max(0, (-laneFor(d.identity).z) / 10) * 1.1
  const size = (0.9 + d.size * 1.6) * nearBoost
  mesh.scale.setScalar(size)
  mesh.userData.identity = d.identity

  const halo = new THREE.Mesh(coinGeo, sharedHaloMat)
  halo.scale.setScalar(size * 1.28)
  halo.raycast = () => {}

  let ring: InstanceType<ThreeMod['Mesh']> | null = null
  if (torusGeo && (d.badges.includes('poll') || d.kind === 'reply' || d.kind === 'boost')) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(spec.rim),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    })
    ring = new THREE.Mesh(torusGeo, ringMat)
    ring.scale.setScalar(size * 0.95)
    ring.raycast = () => {}
    ballGroup.add(ring)
  }

  ballGroup.add(mesh)
  ballGroup.add(halo)

  const lane = laneFor(d.identity)
  return {
    identity: d.identity,
    mesh,
    halo,
    ring,
    texture,
    phase: hash01(d.identity) * Math.PI * 2,
    speed: 0.65 + hash01(d.identity + ':s') * 0.95,
    size,
    spin: (hash01(d.identity + ':spin') - 0.5) * 1.4,
    x: lane.x,
    z: lane.z,
    y: ySeed,
    kind: d.kind,
    badges: d.badges,
    mood: spec.mood,
    label: d.label,
    preview: d.preview,
    authorKey: d.authorKey,
    inReplyToId: d.inReplyToId,
    statusId: d.statusId,
    color: d.color,
  }
}

const syncBallsFromStore = () => {
  if (!THREE || !ballGroup) return
  const descriptors = edward.balls.slice(0, MAX_BALLS)
  const keep = new Set(descriptors.map((d) => d.identity))

  // Remove gone
  for (const [id, b] of [...identityToBall.entries()]) {
    if (!keep.has(id)) {
      disposeBall(b)
      identityToBall.delete(id)
    }
  }

  // Add new — spawn at bottom; existing keep their y
  const existingCount = identityToBall.size
  let spawnI = 0
  for (let i = 0; i < descriptors.length; i++) {
    const d = descriptors[i]!
    if (identityToBall.has(d.identity)) continue
    // Stagger new arrivals along the lower third so the stream fills
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

  balls = [...identityToBall.values()]
  rebuildFilaments()
}

const ballWorldPos = (b: BallRuntime, t: number) => {
  // Playful Edward bob — a little chaotic, not solemn
  const wobbleX = reducedMotion ? 0 : Math.sin(t * b.speed * 0.9 + b.phase) * 0.55
  const wobbleZ = reducedMotion ? 0 : Math.cos(t * b.speed * 0.7 + b.phase * 1.3) * 0.4
  const hop = reducedMotion ? 0 : Math.abs(Math.sin(t * b.speed * 1.4 + b.phase)) * 0.2
  return {
    x: b.x + wobbleX,
    y: b.y + hop,
    z: b.z + wobbleZ,
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

const updateBalls = (t: number, dt: number) => {
  if (!camera || !THREE) return
  for (const b of balls) {
    if (!reducedMotion) {
      b.y += b.speed * dt * 1.35
      if (b.y > STREAM_TOP + 2) {
        b.y = STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2
      }
    }
    const p = ballWorldPos(b, t)
    b.mesh.position.set(p.x, p.y, p.z)
    b.halo.position.set(p.x, p.y, p.z)
    // Billboard face toward camera, with a little tumble for coin energy
    b.mesh.quaternion.copy(camera.quaternion)
    if (!reducedMotion) {
      const tumble = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, Math.sin(t * b.spin + b.phase) * 0.18),
      )
      b.mesh.quaternion.multiply(tumble)
    }
    b.halo.quaternion.copy(b.mesh.quaternion)
    if (b.ring) {
      b.ring.position.set(p.x, p.y, p.z)
      b.ring.quaternion.copy(camera.quaternion)
      b.ring.rotateZ(t * 1.2 + b.phase)
    }
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
    glyph: MOOD_GLYPH[b.mood],
    x: (v.x * 0.5 + 0.5) * rect.width,
    y: (-v.y * 0.5 + 0.5) * rect.height,
  }
}

const hitTest = (): BallRuntime | null => {
  if (!raycaster || !camera || !ballGroup || !THREE) return null
  raycaster.setFromCamera(new THREE.Vector2(pointerNdc.x, pointerNdc.y), camera)
  const meshes = balls.map((b) => b.mesh)
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
    camYaw += 0.00012
    applyCamera()
  }
  updateBalls(t, dt)

  if (++filamentTick % 30 === 0) rebuildFilaments()

  if (hoverIdentity) {
    const b = identityToBall.get(hoverIdentity)
    if (b) projectHover(b)
    else hoverCard.value = null
  }

  if (stars) stars.rotation.y = reducedMotion ? 0 : t * 0.006

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

  sharedHaloMat = null
  coinGeo = null
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
  // Deep CRT void with a hint of Session purple-teal — still candy, not brooding
  scene.fog = new THREE.FogExp2(0x06040e, 0.02)
  scene.background = new THREE.Color(0x06040e)

  camera = new THREE.PerspectiveCamera(52, w / Math.max(1, h), 0.1, 200)
  applyCamera()

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  })
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  hostEl.value.appendChild(renderer.domElement)

  // Flat unlit coins — MeshBasic — but keep a soft ambient for any rings
  scene.add(new THREE.AmbientLight(0xffffff, 0.9))

  raycaster = new THREE.Raycaster()
  coinGeo = new THREE.CircleGeometry(1, 48)
  torusGeo = new THREE.TorusGeometry(1.12, 0.06, 8, 48)
  sharedHaloMat = new THREE.MeshBasicMaterial({
    color: 0xffe566,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

  ballGroup = new THREE.Group()
  scene.add(ballGroup)

  // Stars
  const starCount = 700
  const starPos = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3] = (Math.random() - 0.5) * 80
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 80
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 80
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0x7a90a8,
      size: 0.1,
      transparent: true,
      opacity: 0.65,
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
      color: 0x3a5068,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  )
  scene.add(filamentLines)

  const nebGeo = new THREE.SphereGeometry(95, 24, 16)
  scene.add(
    new THREE.Mesh(
      nebGeo,
      new THREE.MeshBasicMaterial({
        color: 0x0a101c,
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
  () => edward.balls,
  () => syncBallsFromStore(),
  { deep: false },
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
      v-if="hoverCard"
      class="edward-canvas__hover"
      :style="{ transform: `translate(${hoverCard.x}px, ${hoverCard.y}px)` }"
    >
      <div class="edward-canvas__hover-top">
        <span class="edward-canvas__hover-glyph" aria-hidden="true">{{ hoverCard.glyph }}</span>
        <span class="edward-canvas__hover-kind">{{ hoverCard.mood }} · {{ hoverCard.kind }}</span>
      </div>
      <strong class="edward-canvas__hover-name">{{ hoverCard.name }}</strong>
      <p class="edward-canvas__hover-preview">{{ hoverCard.preview }}</p>
      <span class="edward-canvas__hover-go">click!! open thread ≫</span>
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
  background: #06040e;

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

.edward-canvas__hover-go {
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  color: #59d1e0;
}
</style>
