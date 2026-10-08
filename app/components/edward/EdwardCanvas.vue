<script setup lang="ts">
/**
 * Edward Mode WebGL scene — instanced thought-spheres in a drifting field.
 * three.js is dynamically imported so the main bundle stays clean.
 */

import { useEdwardStore } from '~/stores/edward'
import type { EdwardBallDescriptor } from '~/utils/edwardSemantics'

const emit = defineEmits<{
  pick: [identity: string]
}>()

const edward = useEdwardStore()
const hostEl = ref<HTMLElement | null>(null)
const hoverLabel = ref<{ text: string; x: number; y: number } | null>(null)

type ThreeMod = typeof import('three')

type BallRuntime = {
  identity: string
  base: { x: number; y: number; z: number }
  phase: number
  speed: number
  size: number
  kind: EdwardBallDescriptor['kind']
  badges: EdwardBallDescriptor['badges']
  authorKey: string
  inReplyToId: string | null
  statusId: string
  label: string
  preview: string
  opacity: number
  color: [number, number, number]
}

let disposed = false
let raf = 0
let THREE: ThreeMod | null = null
let renderer: InstanceType<ThreeMod['WebGLRenderer']> | null = null
let scene: InstanceType<ThreeMod['Scene']> | null = null
let camera: InstanceType<ThreeMod['PerspectiveCamera']> | null = null
let coreMesh: InstanceType<ThreeMod['InstancedMesh']> | null = null
let haloMesh: InstanceType<ThreeMod['InstancedMesh']> | null = null
let ringMesh: InstanceType<ThreeMod['InstancedMesh']> | null = null
let stars: InstanceType<ThreeMod['Points']> | null = null
let filaments: InstanceType<ThreeMod['LineSegments']> | null = null
let raycaster: InstanceType<ThreeMod['Raycaster']> | null = null
let pointer = { x: 0, y: 0 }
let pointerNdc = { x: 0, y: 0 }
let dragging = false
let dragMoved = false
let lastPtr = { x: 0, y: 0 }
let spherical = { theta: 0.35, phi: 1.15, radius: 28 }
let reducedMotion = false
let balls: BallRuntime[] = []
let identityToIndex = new Map<string, number>()
let dummy: InstanceType<ThreeMod['Object3D']> | null = null
let colorTmp: InstanceType<ThreeMod['Color']> | null = null
let clockStart = 0
let maxInstances = 220

const hash01 = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967295
}

const spawnPos = (identity: string, i: number) => {
  const a = hash01(identity)
  const b = hash01(identity + ':y')
  const c = hash01(identity + ':z')
  // Spread in a soft ellipsoid; newer (lower i) slightly upstream (+z flow)
  const r = 6 + a * 14
  const theta = b * Math.PI * 2
  const y = (c - 0.5) * 12
  return {
    x: Math.cos(theta) * r * (0.7 + a * 0.5),
    y,
    z: Math.sin(theta) * r - i * 0.08,
  }
}

const syncBallsFromStore = () => {
  if (!THREE || !coreMesh || !haloMesh || !ringMesh || !dummy || !colorTmp) return
  const descriptors = edward.balls
  const next: BallRuntime[] = []
  const nextMap = new Map<string, number>()

  for (let i = 0; i < descriptors.length && i < maxInstances; i++) {
    const d = descriptors[i]!
    const prev = identityToIndex.has(d.identity) ? balls[identityToIndex.get(d.identity)!] : null
    const base = prev?.base ?? spawnPos(d.identity, i)
    next.push({
      identity: d.identity,
      base,
      phase: prev?.phase ?? hash01(d.identity) * Math.PI * 2,
      speed: prev?.speed ?? 0.15 + hash01(d.identity + ':s') * 0.35,
      size: d.size,
      kind: d.kind,
      badges: d.badges,
      authorKey: d.authorKey,
      inReplyToId: d.inReplyToId,
      statusId: d.statusId,
      label: d.label,
      preview: d.preview,
      opacity: d.opacity,
      color: d.color,
    })
    nextMap.set(d.identity, i)
  }

  balls = next
  identityToIndex = nextMap

  coreMesh.count = balls.length
  haloMesh.count = balls.length
  // Rings only for poll / reply elongation cue — show for poll badges
  let ringCount = 0
  for (const b of balls) {
    if (b.badges.includes('poll') || b.kind === 'reply') ringCount++
  }
  ringMesh.count = Math.min(ringCount, maxInstances)

  rebuildFilaments()
}

const rebuildFilaments = () => {
  if (!THREE || !scene || !filaments) return
  const positions: number[] = []
  const byAuthor = new Map<string, number[]>()
  const byStatusId = new Map<string, number>()

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!
    byStatusId.set(b.statusId, i)
    const list = byAuthor.get(b.authorKey) || []
    if (list.length < 4) list.push(i)
    byAuthor.set(b.authorKey, list)
  }

  // Reply → parent when both live
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!
    if (!b.inReplyToId) continue
    const j = byStatusId.get(b.inReplyToId)
    if (j == null) continue
    const A = balls[i]!
    const B = balls[j]!
    positions.push(A.base.x, A.base.y, A.base.z, B.base.x, B.base.y, B.base.z)
  }

  // Sparse same-author links (at most one per author cluster edge)
  for (const idxs of byAuthor.values()) {
    if (idxs.length < 2) continue
    for (let k = 0; k < idxs.length - 1 && k < 2; k++) {
      const A = balls[idxs[k]!]!
      const B = balls[idxs[k + 1]!]!
      positions.push(A.base.x, A.base.y, A.base.z, B.base.x, B.base.y, B.base.z)
    }
  }

  // Cap filaments
  const maxFloats = 240 * 6
  const sliced = positions.slice(0, maxFloats)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(sliced, 3))
  const old = filaments.geometry
  filaments.geometry = geo
  old.dispose()
}

const updateInstances = (t: number) => {
  if (!THREE || !coreMesh || !haloMesh || !ringMesh || !dummy || !colorTmp) return

  let ringIdx = 0
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i]!
    const drift = reducedMotion
      ? 0
      : Math.sin(t * b.speed + b.phase) * 0.55
    const driftY = reducedMotion ? 0 : Math.cos(t * b.speed * 0.7 + b.phase) * 0.4
    const flow = reducedMotion ? 0 : (t * 0.12) % 40
    const x = b.base.x + drift
    const y = b.base.y + driftY
    const z = b.base.z - flow * 0.15 + Math.sin(b.phase + t * 0.05) * 0.3

    dummy.position.set(x, y, z)
    const sx = b.kind === 'reply' ? b.size * 0.85 : b.size
    const sy = b.kind === 'reply' ? b.size * 1.15 : b.size
    const sz = b.size
    dummy.scale.set(sx, sy, sz)
    dummy.updateMatrix()
    coreMesh.setMatrixAt(i, dummy.matrix)

    colorTmp.setRGB(b.color[0], b.color[1], b.color[2])
    coreMesh.setColorAt(i, colorTmp)

    // Halo — larger soft shell, boosts get extra
    const haloScale = b.kind === 'boost' ? 1.85 : b.badges.includes('media') ? 1.55 : 1.35
    dummy.scale.set(sx * haloScale, sy * haloScale, sz * haloScale)
    dummy.updateMatrix()
    haloMesh.setMatrixAt(i, dummy.matrix)
    colorTmp.setRGB(b.color[0], b.color[1], b.color[2])
    haloMesh.setColorAt(i, colorTmp)

    if (b.badges.includes('poll') || b.kind === 'reply') {
      dummy.scale.set(sx * 1.45, sy * 1.45, sz * 1.45)
      dummy.rotation.set(Math.PI / 2, t * 0.2 + b.phase, 0)
      dummy.updateMatrix()
      ringMesh.setMatrixAt(ringIdx, dummy.matrix)
      colorTmp.setRGB(b.color[0] * 1.1, b.color[1] * 1.1, b.color[2] * 1.1)
      ringMesh.setColorAt(ringIdx, colorTmp)
      ringIdx++
      dummy.rotation.set(0, 0, 0)
    }
  }

  coreMesh.instanceMatrix.needsUpdate = true
  haloMesh.instanceMatrix.needsUpdate = true
  ringMesh.instanceMatrix.needsUpdate = true
  ringMesh.count = ringIdx
  if (coreMesh.instanceColor) coreMesh.instanceColor.needsUpdate = true
  if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true
  if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true

  // Update filament endpoints roughly with first/last ball drift (cheap: rebuild occasionally)
  if (!reducedMotion && Math.floor(t * 2) % 5 === 0) {
    // skip heavy rebuild every frame — filaments use base positions (intentional soft lag)
  }
}

const applyCamera = () => {
  if (!camera) return
  const { theta, phi, radius } = spherical
  camera.position.set(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
  camera.lookAt(0, 0, 0)
}

const projectHover = (index: number) => {
  if (!camera || !hostEl.value || !THREE || !dummy) return
  const b = balls[index]
  if (!b) {
    hoverLabel.value = null
    return
  }
  const t = (performance.now() - clockStart) / 1000
  const drift = reducedMotion ? 0 : Math.sin(t * b.speed + b.phase) * 0.55
  const driftY = reducedMotion ? 0 : Math.cos(t * b.speed * 0.7 + b.phase) * 0.4
  const flow = reducedMotion ? 0 : (t * 0.12) % 40
  const v = new THREE.Vector3(
    b.base.x + drift,
    b.base.y + driftY,
    b.base.z - flow * 0.15,
  )
  v.project(camera)
  const rect = hostEl.value.getBoundingClientRect()
  const x = (v.x * 0.5 + 0.5) * rect.width
  const y = (-v.y * 0.5 + 0.5) * rect.height
  const snippet = b.preview ? ` · ${b.preview.slice(0, 64)}` : ''
  hoverLabel.value = {
    text: `${b.label}${snippet}`,
    x,
    y,
  }
}

const hitTest = (): number => {
  if (!raycaster || !camera || !coreMesh || !THREE) return -1
  raycaster.setFromCamera(
    new THREE.Vector2(pointerNdc.x, pointerNdc.y),
    camera,
  )
  const hits = raycaster.intersectObject(coreMesh)
  if (!hits.length) return -1
  return hits[0]!.instanceId ?? -1
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
  pointer.x = e.clientX - rect.left
  pointer.y = e.clientY - rect.top
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

  if (dragging) {
    const dx = e.clientX - lastPtr.x
    const dy = e.clientY - lastPtr.y
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
    spherical.theta -= dx * 0.005
    spherical.phi = Math.min(Math.PI - 0.2, Math.max(0.2, spherical.phi - dy * 0.005))
    lastPtr = { x: e.clientX, y: e.clientY }
    applyCamera()
    return
  }

  const idx = hitTest()
  if (idx >= 0) {
    projectHover(idx)
    if (hostEl.value) hostEl.value.style.cursor = 'pointer'
  } else {
    hoverLabel.value = null
    if (hostEl.value) hostEl.value.style.cursor = 'grab'
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
  const idx = hitTest()
  if (idx >= 0 && balls[idx]) {
    emit('pick', balls[idx]!.identity)
  }
}

const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  spherical.radius = Math.min(55, Math.max(12, spherical.radius + e.deltaY * 0.02))
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

const frame = () => {
  if (disposed || !renderer || !scene || !camera) return
  const t = (performance.now() - clockStart) / 1000
  if (!reducedMotion) {
    spherical.theta += 0.00035
    applyCamera()
  }
  updateInstances(t)
  if (stars) {
    stars.rotation.y = reducedMotion ? 0 : t * 0.008
  }
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
    hostEl.value.removeEventListener('wheel', onWheel)
  }
  window.removeEventListener('resize', onResize)
  document.removeEventListener('visibilitychange', onVisibility)

  const disposeMat = (mat: { dispose: () => void } | { dispose: () => void }[] | undefined) => {
    if (!mat) return
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
  }

  // Traverse + dispose (core/halo share sphere geo — track disposed geos)
  const disposedGeo = new Set<object>()
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

  renderer?.dispose()
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement)
  }

  coreMesh = null
  haloMesh = null
  ringMesh = null
  stars = null
  filaments = null
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
  scene.fog = new THREE.FogExp2(0x05060a, 0.018)
  scene.background = new THREE.Color(0x05060a)

  camera = new THREE.PerspectiveCamera(55, w / Math.max(1, h), 0.1, 200)
  applyCamera()

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setSize(w, h, false)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  hostEl.value.appendChild(renderer.domElement)

  // Soft ambient + key
  scene.add(new THREE.AmbientLight(0x6a7a8a, 0.55))
  const key = new THREE.DirectionalLight(0xa8d4e8, 0.85)
  key.position.set(8, 12, 6)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xc4a8f0, 0.35)
  rim.position.set(-10, -4, -8)
  scene.add(rim)

  dummy = new THREE.Object3D()
  colorTmp = new THREE.Color()
  raycaster = new THREE.Raycaster()
  // InstancedMesh raycast threshold
  ;(raycaster.params as { Mesh?: { threshold?: number } }).Mesh = { threshold: 0.1 }

  const geo = new THREE.SphereGeometry(1, 24, 18)
  const coreMat = new THREE.MeshStandardMaterial({
    roughness: 0.35,
    metalness: 0.15,
    transparent: true,
    opacity: 0.92,
    vertexColors: false,
  })
  coreMesh = new THREE.InstancedMesh(geo, coreMat, maxInstances)
  coreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  coreMesh.count = 0
  // Prime instanceColor buffer so setColorAt works from frame 0
  {
    const c = new THREE.Color(0x59d1e0)
    for (let i = 0; i < maxInstances; i++) coreMesh.setColorAt(i, c)
  }
  scene.add(coreMesh)

  const haloMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  })
  haloMesh = new THREE.InstancedMesh(geo, haloMat, maxInstances)
  haloMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  haloMesh.count = 0
  {
    const c = new THREE.Color(0x59d1e0)
    for (let i = 0; i < maxInstances; i++) haloMesh.setColorAt(i, c)
  }
  haloMesh.raycast = () => {}
  scene.add(haloMesh)

  const torus = new THREE.TorusGeometry(1, 0.06, 8, 48)
  const ringMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  })
  ringMesh = new THREE.InstancedMesh(torus, ringMat, maxInstances)
  ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  ringMesh.count = 0
  {
    const c = new THREE.Color(0xf2ad52)
    for (let i = 0; i < maxInstances; i++) ringMesh.setColorAt(i, c)
  }
  ringMesh.raycast = () => {}
  scene.add(ringMesh)

  // Star field
  const starCount = 900
  const starPos = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i++) {
    const r = 40 + Math.random() * 80
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    starPos[i * 3 + 2] = r * Math.cos(phi)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({
      color: 0x8aa0b8,
      size: 0.12,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  )
  scene.add(stars)

  // Filaments
  const filGeo = new THREE.BufferGeometry()
  filGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3))
  filaments = new THREE.LineSegments(
    filGeo,
    new THREE.LineBasicMaterial({
      color: 0x4a6078,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  )
  scene.add(filaments)

  // Nebula-ish backdrop plane
  const nebGeo = new THREE.SphereGeometry(90, 32, 24)
  const nebMat = new THREE.MeshBasicMaterial({
    color: 0x0c1220,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.9,
  })
  scene.add(new THREE.Mesh(nebGeo, nebMat))

  clockStart = performance.now()
  syncBallsFromStore()

  hostEl.value.addEventListener('pointerdown', onPointerDown)
  hostEl.value.addEventListener('pointermove', onPointerMove)
  hostEl.value.addEventListener('pointerup', onPointerUp)
  hostEl.value.addEventListener('pointercancel', onPointerUp)
  hostEl.value.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)
  onVisibility()

  raf = requestAnimationFrame(frame)
}

watch(
  () => edward.balls,
  () => {
    syncBallsFromStore()
  },
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
      v-if="hoverLabel"
      class="edward-canvas__hover"
      :style="{ transform: `translate(${hoverLabel.x}px, ${hoverLabel.y}px)` }"
    >
      {{ hoverLabel.text }}
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
  max-width: min(280px, 70vw);
  padding: 6px 10px;
  margin-top: -36px;
  margin-left: 12px;
  pointer-events: none;
  font-size: 0.6875rem;
  line-height: 1.35;
  letter-spacing: 0.02em;
  color: #d8e4f0;
  background: color-mix(in srgb, #0a1018 88%, transparent);
  border: 1px solid color-mix(in srgb, #6a90b0 40%, transparent);
  border-radius: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
