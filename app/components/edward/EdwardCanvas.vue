<script setup lang="ts">
/**
 * Edward Mode WebGL — grown-up Radical Edward Session OS.
 * True 3D candy-glass emoticoin bubbles. Lexx / Tank Girl / faces-OS energy.
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
  x: number
  z: number
  y: number
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
  drawEmoticoin(ctx, spec, hash01(d.identity))
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
      drawEmoticoin(ctx, spec, hash01(d.identity))
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

const laneFor = (identity: string, affinity = 0) => {
  const a = hash01(identity)
  const b = hash01(identity + ':z')
  const pull = Math.min(1, Math.max(0, affinity))
  const xScatter = 8 - pull * 4.5
  return {
    x: (a - 0.5) * xScatter,
    z: 4 - b * 10 - pull * 3.2,
  }
}

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
  const lane = laneFor(d.identity, d.affinity)
  const nearBoost = 1 + Math.max(0, (-lane.z) / 10) * 1.1
  const affBoost = 1 + d.affinity * 0.55
  const size = (0.95 + d.size * 1.55) * nearBoost * affBoost
  const tint = d.affinity > 0.45 ? '#ff7eb3' : spec.rim

  const root = new THREE.Group()
  root.userData.identity = d.identity

  // Soap-bubble glass — transmission + clearcoat + iridescence
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tint),
    metalness: 0.02,
    roughness: 0.08,
    transmission: 0.78,
    thickness: 0.9,
    ior: 1.48,
    transparent: true,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    iridescence: 1,
    iridescenceIOR: 1.7,
    iridescenceThicknessRange: [160, 640],
    envMapIntensity: 1.5,
    attenuationColor: new THREE.Color(spec.fill),
    attenuationDistance: 1.6,
    side: THREE.FrontSide,
    depthWrite: false,
  })
  if (envMap) shellMat.envMap = envMap
  const shell = new THREE.Mesh(sphereGeo, shellMat)
  shell.userData.identity = d.identity

  // Smiley face nestled inside — stays readable, billboards to camera
  const faceMat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: Math.max(0.9, d.opacity),
    roughness: 0.32,
    metalness: 0.05,
    emissive: new THREE.Color(spec.fill),
    emissiveIntensity: 0.22 + d.affinity * 0.25,
    side: THREE.DoubleSide,
    depthWrite: true,
  })
  const face = new THREE.Mesh(faceGeo, faceMat)
  face.scale.setScalar(0.76)
  face.position.z = 0.08
  face.userData.identity = d.identity

  const halo = new THREE.Mesh(sphereGeo, sharedHaloMat)
  halo.scale.setScalar(1.28)
  halo.raycast = () => {}

  // Catch-light — that glossy tank-girl magazine shine
  const spark = new THREE.Mesh(sparkGeo, sharedSparkMat)
  spark.position.set(0.38, 0.44, 0.62)
  spark.scale.setScalar(0.16)
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
    spin: (hash01(d.identity + ':spin') - 0.5) * 1.6,
    x: lane.x,
    z: lane.z,
    y: ySeed,
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
  const lane = laneFor(d.identity, d.affinity)
  b.x = lane.x
  b.z = lane.z
  b.affinity = d.affinity
  b.isShort = d.isShort
  b.shortText = d.shortText
  b.moodWhy = d.moodWhy
  const nearBoost = 1 + Math.max(0, (-lane.z) / 10) * 1.1
  const affBoost = 1 + d.affinity * 0.55
  const size = (0.95 + d.size * 1.55) * nearBoost * affBoost
  b.size = size
  b.root.scale.setScalar(size)
}

const syncBallsFromStore = () => {
  if (!THREE || !ballGroup) return
  const descriptors = edward.balls.slice(0, MAX_BALLS)
  const keep = new Set(descriptors.map((d) => d.identity))
  const byId = new Map(descriptors.map((d) => [d.identity, d]))

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

  balls = [...identityToBall.values()]
  rebuildFilaments()
}

const ballWorldPos = (b: BallRuntime, t: number) => {
  const wobbleX = reducedMotion ? 0 : Math.sin(t * b.speed * 0.9 + b.phase) * 0.55
  const wobbleZ = reducedMotion ? 0 : Math.cos(t * b.speed * 0.7 + b.phase * 1.3) * 0.4
  const hop = reducedMotion ? 0 : Math.abs(Math.sin(t * b.speed * 1.4 + b.phase)) * 0.22
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
  return { x0: 0.08, y0: 0.38, x1: 0.92, y1: 0.62 }
}

const updateBalls = (t: number, dt: number) => {
  if (!camera || !THREE || !hostEl.value) return
  const rect = hostEl.value.getBoundingClientRect()
  const focus = focusNormRect()
  let bestFocus: { id: string; score: number } | null = null
  const nextBubbles: { id: string; text: string; x: number; y: number; scale: number }[] = []

  for (const b of balls) {
    if (!reducedMotion) {
      b.y += b.speed * dt * 1.35
      if (b.y > STREAM_TOP + 2) {
        b.y = STREAM_BOTTOM - hash01(b.identity + String(Math.floor(t))) * 2
      }
    }
    const p = ballWorldPos(b, t)
    b.root.position.set(p.x, p.y, p.z)

    // Shell tumbles in 3D so you feel the volume
    if (!reducedMotion) {
      b.shell.rotation.y = t * b.spin * 0.35 + b.phase
      b.shell.rotation.x = Math.sin(t * 0.4 + b.phase) * 0.25
      b.shell.rotation.z = Math.cos(t * 0.33 + b.phase) * 0.15
    }

    // Face stays readable — always toward camera, slight playful tilt
    b.face.quaternion.copy(camera.quaternion)
    if (!reducedMotion) {
      const tumble = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, Math.sin(t * b.spin + b.phase) * 0.14),
      )
      b.face.quaternion.multiply(tumble)
    }

    // Spark follows camera-facing highlight
    b.spark.quaternion.copy(camera.quaternion)

    if (b.ring) {
      b.ring.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.5 + b.phase) * 0.2
      b.ring.rotation.z = t * 0.9 + b.phase
    }

    const screen = projectScreen(p.x, p.y, p.z)
    if (!screen || screen.behind) continue
    const nx = screen.x / Math.max(1, rect.width)
    const ny = screen.y / Math.max(1, rect.height)

    if (focus && nx >= focus.x0 && nx <= focus.x1 && ny >= focus.y0 && ny <= focus.y1) {
      const cx = (focus.x0 + focus.x1) / 2
      const cy = (focus.y0 + focus.y1) / 2
      const dist = Math.hypot(nx - cx, ny - cy)
      const score = 1 - dist + b.affinity * 0.35 + -b.z * 0.02
      if (!bestFocus || score > bestFocus.score) {
        bestFocus = { id: b.identity, score }
      }
      b.root.scale.setScalar(b.size * 1.14)
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
  const pmrem = new THREE.PMREMGenerator(renderer)

  // Punk candy studio — pink / cyan / yellow softboxes for glass reflections
  const envScene = new THREE.Scene()
  envScene.background = new THREE.Color(0x1a0e22)

  const softbox = (color: number, x: number, y: number, z: number, s: number) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 16),
      new THREE.MeshBasicMaterial({ color }),
    )
    mesh.position.set(x, y, z)
    mesh.scale.setScalar(s)
    envScene.add(mesh)
    return mesh
  }
  softbox(0xff7eb3, 4, 5, 2, 3.2)
  softbox(0x59d1e0, -5, 1, -3, 2.8)
  softbox(0xffe566, 0, -4, 5, 2.4)
  softbox(0xffffff, 2, 6, -2, 1.4)

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
  renderer.toneMappingExposure = 1.15
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  hostEl.value.appendChild(renderer.domElement)

  buildEnvMap()

  // Tank Girl stage lights — magenta key, cyan fill, yellow rim
  scene.add(new THREE.AmbientLight(0xffe8f4, 0.35))
  const key = new THREE.DirectionalLight(0xff7eb3, 2.2)
  key.position.set(6, 10, 4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0x59d1e0, 1.4)
  fill.position.set(-8, 2, -4)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffe566, 1.1)
  rim.position.set(0, -4, 8)
  scene.add(rim)
  const point = new THREE.PointLight(0xff9ad5, 18, 40, 2)
  point.position.set(0, 4, 6)
  scene.add(point)

  raycaster = new THREE.Raycaster()
  // Dense enough to read as glass orbs; not so dense that transmission melts the GPU
  sphereGeo = new THREE.SphereGeometry(1, 36, 28)
  faceGeo = new THREE.CircleGeometry(1, 40)
  sparkGeo = new THREE.SphereGeometry(1, 12, 10)
  torusGeo = new THREE.TorusGeometry(1.05, 0.055, 8, 48)

  sharedHaloMat = new THREE.MeshBasicMaterial({
    color: 0xff7eb3,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.BackSide,
  })
  sharedSparkMat = new THREE.MeshBasicMaterial({
    color: 0xfff8e8,
    transparent: true,
    opacity: 0.9,
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
  () => edward.balls,
  () => syncBallsFromStore(),
  { deep: false },
)

watch(
  () => edward.affinity,
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
