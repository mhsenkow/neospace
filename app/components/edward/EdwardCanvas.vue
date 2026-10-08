<script setup lang="ts">
/**
 * Edward Mode WebGL — vertical bottom→top thought stream.
 * Each ball carries a canvas texture (author + snippet); nearer = bigger.
 * three.js is dynamically imported so the main bundle stays clean.
 */

import { useEdwardStore } from '~/stores/edward'
import type { EdwardBallDescriptor } from '~/utils/edwardSemantics'

const emit = defineEmits<{
  pick: [identity: string]
}>()

const edward = useEdwardStore()
const hostEl = ref<HTMLElement | null>(null)
const hoverCard = ref<{
  name: string
  preview: string
  kind: string
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
  /** Horizontal lane */
  x: number
  /** Depth — smaller z = closer to camera */
  z: number
  /** Vertical position along stream */
  y: number
  kind: EdwardBallDescriptor['kind']
  badges: EdwardBallDescriptor['badges']
  label: string
  preview: string
  authorKey: string
  inReplyToId: string | null
  statusId: string
  color: [number, number, number]
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
let sphereGeo: InstanceType<ThreeMod['SphereGeometry']> | null = null
let torusGeo: InstanceType<ThreeMod['TorusGeometry']> | null = null
let raycaster: InstanceType<ThreeMod['Raycaster']> | null = null
let pointerNdc = { x: 0, y: 0 }
let dragging = false
let dragMoved = false
let lastPtr = { x: 0, y: 0 }
/** Camera orbit around the vertical stream */
let camYaw = 0.15
let camPitch = 0.08
let camDist = 26
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

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) => {
  const words = text.split(/\s+/).filter(Boolean)
  let line = ''
  let ly = y
  let lines = 0
  for (let n = 0; n < words.length; n++) {
    const test = line ? `${line} ${words[n]}` : words[n]!
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, ly)
      line = words[n]!
      ly += lineHeight
      lines++
      if (lines >= maxLines - 1) {
        let rest = words.slice(n).join(' ')
        while (ctx.measureText(rest + '…').width > maxWidth && rest.length > 1) {
          rest = rest.slice(0, -1)
        }
        ctx.fillText(rest + (rest.length < words.slice(n).join(' ').length ? '…' : ''), x, ly)
        return
      }
    } else {
      line = test
    }
  }
  if (line) ctx.fillText(line, x, ly)
}

const buildTexture = (d: EdwardBallDescriptor): InstanceType<ThreeMod['CanvasTexture']> => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')!
  const [r, g, b] = d.color
  const R = Math.round(r * 255)
  const G = Math.round(g * 255)
  const B = Math.round(b * 255)

  // Sphere-facing disc: dark rim → kind wash → readable text band
  const grad = ctx.createRadialGradient(256, 220, 40, 256, 256, 250)
  grad.addColorStop(0, `rgba(${Math.min(255, R + 40)},${Math.min(255, G + 40)},${Math.min(255, B + 40)},1)`)
  grad.addColorStop(0.45, `rgb(${R},${G},${B})`)
  grad.addColorStop(1, `rgb(${Math.round(R * 0.25)},${Math.round(G * 0.25)},${Math.round(B * 0.3)})`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 512, 512)

  // Soft vignette for CW
  if (d.badges.includes('cw')) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'
    ctx.fillRect(0, 0, 512, 512)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.font = '600 36px ui-sans-serif, system-ui, sans-serif'
  const name = d.label.length > 22 ? d.label.slice(0, 20) + '…' : d.label
  ctx.fillText(name, 256, 168)

  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = '400 28px ui-sans-serif, system-ui, sans-serif'
  const preview = d.badges.includes('cw')
    ? (d.preview ? '···· ····' : 'content warning')
    : d.preview || '…'
  wrapText(ctx, preview, 256, 230, 360, 34, 5)

  // Kind / badge chips at bottom of disc
  ctx.font = '600 22px ui-sans-serif, system-ui, sans-serif'
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  const chips: string[] = [d.kind]
  if (d.badges.includes('media')) chips.push('media')
  if (d.badges.includes('poll')) chips.push('poll')
  ctx.fillText(chips.join(' · '), 256, 420)

  const tex = new THREE!.CanvasTexture(canvas)
  tex.colorSpace = THREE!.SRGBColorSpace
  tex.needsUpdate = true
  return tex
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
  if (!THREE || !ballGroup || !sphereGeo || !sharedHaloMat) return null
  const texture = buildTexture(d)
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.45,
    metalness: 0.08,
    transparent: true,
    opacity: d.opacity,
  })
  const mesh = new THREE.Mesh(sphereGeo, mat)
  // Scale by engagement size AND proximity (closer z → larger)
  const nearBoost = 1 + Math.max(0, (-laneFor(d.identity).z) / 10) * 0.85
  const size = d.size * 1.35 * nearBoost
  mesh.scale.setScalar(size)
  mesh.userData.identity = d.identity

  const halo = new THREE.Mesh(sphereGeo, sharedHaloMat)
  halo.scale.setScalar(size * (d.kind === 'boost' ? 1.7 : 1.4))
  halo.raycast = () => {}

  let ring: InstanceType<ThreeMod['Mesh']> | null = null
  if (torusGeo && (d.badges.includes('poll') || d.kind === 'reply')) {
    const ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(d.color[0], d.color[1], d.color[2]),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    })
    ring = new THREE.Mesh(torusGeo, ringMat)
    ring.scale.setScalar(size * 1.35)
    ring.rotation.x = Math.PI / 2
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
    speed: 0.55 + hash01(d.identity + ':s') * 0.75,
    size,
    x: lane.x,
    z: lane.z,
    y: ySeed,
    kind: d.kind,
    badges: d.badges,
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
  const wobbleX = reducedMotion ? 0 : Math.sin(t * b.speed * 0.6 + b.phase) * 0.35
  const wobbleZ = reducedMotion ? 0 : Math.cos(t * b.speed * 0.5 + b.phase) * 0.25
  return {
    x: b.x + wobbleX,
    y: b.y,
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
  if (!camera) return
  for (const b of balls) {
    if (!reducedMotion) {
      b.y += b.speed * dt * 1.15
      if (b.y > STREAM_TOP + 2) {
        b.y = STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2
      }
    }
    const p = ballWorldPos(b, t)
    b.mesh.position.set(p.x, p.y, p.z)
    b.halo.position.set(p.x, p.y, p.z)
    // Billboard-ish: face camera so text stays readable
    b.mesh.quaternion.copy(camera.quaternion)
    if (b.ring) {
      b.ring.position.set(p.x, p.y, p.z)
      b.ring.rotation.z = t * 0.4 + b.phase
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
    preview: b.badges.includes('cw') ? 'content warning' : b.preview || '…',
    kind: b.kind,
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
  sphereGeo = null
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
  scene.fog = new THREE.FogExp2(0x05060a, 0.022)
  scene.background = new THREE.Color(0x05060a)

  camera = new THREE.PerspectiveCamera(50, w / Math.max(1, h), 0.1, 200)
  // Stronger perspective feel — closer near plane, FOV that exaggerates size
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

  scene.add(new THREE.AmbientLight(0x8899aa, 0.7))
  const key = new THREE.DirectionalLight(0xffffff, 0.95)
  key.position.set(4, 8, 12)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x88aacc, 0.35)
  fill.position.set(-6, -2, 4)
  scene.add(fill)

  raycaster = new THREE.Raycaster()
  sphereGeo = new THREE.SphereGeometry(1, 32, 24)
  torusGeo = new THREE.TorusGeometry(1.05, 0.05, 8, 48)
  sharedHaloMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
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
      <span class="edward-canvas__hover-kind">{{ hoverCard.kind }}</span>
      <strong class="edward-canvas__hover-name">{{ hoverCard.name }}</strong>
      <p class="edward-canvas__hover-preview">{{ hoverCard.preview }}</p>
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
  background: #05060a;

  &:active {
    cursor: grabbing;
  }
}

.edward-canvas__hover {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  width: min(280px, 72vw);
  padding: 10px 12px;
  margin-top: -12px;
  margin-left: 18px;
  pointer-events: none;
  color: #e8f0f8;
  background: color-mix(in srgb, #070c14 92%, transparent);
  border: 1px solid color-mix(in srgb, #6a90b0 50%, transparent);
  border-radius: 2px;
  box-shadow: 0 10px 28px color-mix(in srgb, #000 45%, transparent);
  backdrop-filter: blur(8px);
}

.edward-canvas__hover-kind {
  display: block;
  margin-bottom: 4px;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #59d1e0;
}

.edward-canvas__hover-name {
  display: block;
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  margin-bottom: 4px;
}

.edward-canvas__hover-preview {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: color-mix(in srgb, #e8f0f8 78%, transparent);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
