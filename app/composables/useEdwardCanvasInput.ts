/**
 * Pointer, wheel, and hover-card input for the Edward WebGL canvas.
 *
 * The render loop, FrameGate, and face-texture cache stay in EdwardCanvas.
 * That loop calls `applyEdgeHoverScroll` and `followHover` at the same points
 * it used to run this work inline, so rim scrub and the hover card stay on
 * the render clock.
 */

import { ref, watch, type Ref, type ShallowRef } from 'vue'
import { MOOD_GLYPH, type EdwardFaceMood } from '~/utils/edwardFaces'
import { dialectForHost } from '~/utils/edwardServers'
import type { EdwardBadge, EdwardKind, EdwardReason } from '~/utils/edwardSemantics'
import { edgeCueVisible, edgeDwellStep, edgeScrubGain } from '~/utils/edwardRender'

type ThreeMod = typeof import('three')

/** Hover card content. Position is a transform on the card element, not part of this object. */
export type EdwardHoverCard = {
  name: string
  preview: string
  kind: EdwardKind
  mood: EdwardFaceMood
  why: string
  glyph: string
  tag: string | null
  affinity: number
  media: string | null
  handle: string
  age: string
  counts: { fav: number; boost: number; reply: number } | null
  accent: string
  reasons: EdwardReason[]
  /** Flip the card left / up when it would leave the screen */
  flipX: boolean
  flipY: boolean
}

/** Fields the hover card and raycast need from a live ball. */
export type EdwardHoverTarget = {
  identity: string
  x: number
  y: number
  z: number
  label: string
  preview: string
  kind: EdwardKind
  badges: readonly EdwardBadge[]
  mood: EdwardFaceMood
  moodWhy: string
  topTag: string | null
  affinity: number
  mediaUrl: string | null
  acct: string
  host: string | null
  createdAt: number
  counts: { fav: number; boost: number; reply: number } | null
  reasons: EdwardReason[]
}

/**
 * Drag / hover flags the canvas frame loop reads (signature, throttle, captions).
 * Handlers here write them; the canvas keeps the object so those reads stay direct.
 */
export type EdwardCanvasPointerState = {
  pointerInside: boolean
  dragging: boolean
  hoverIdentity: string | null
}

/** Soft edge bands — L/R rails + thin T/B */
const EDGE_X = 0.13
const EDGE_Y = 0.11

const ageLabel = (createdAt: number) => {
  const s = Math.max(0, (Date.now() - createdAt) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function useEdwardCanvasInput(opts: {
  hostEl: Ref<HTMLElement | null>
  hoverCard: ShallowRef<EdwardHoverCard | null>
  hoverEl: Ref<HTMLElement | null>
  /** Cached host size in CSS pixels (ResizeObserver) — flip thresholds, no layout read */
  hostSize: () => { w: number; h: number }
  /** World point → host pixels. Null when the camera isn't ready. */
  project: (x: number, y: number, z: number) => { x: number; y: number; behind: boolean } | null
  getRaycaster: () => InstanceType<ThreeMod['Raycaster']> | null
  getCamera: () => InstanceType<ThreeMod['Camera']> | null
  /** Readiness guard only — picking uses the shell/face meshes, not the group */
  getBallGroup: () => object | null
  getThree: () => ThreeMod | null
  getPickMeshes: () => InstanceType<ThreeMod['Object3D']>[]
  ballByIdentity: (identity: string) => EdwardHoverTarget | null
  /** Click a face without dragging — opens the post */
  openPost: (identity: string) => void
  readCamera: () => { yaw: number; pitch: number; zoom: number }
  /** Assigns whichever fields are present, then applies the camera */
  writeCamera: (next: { yaw?: number; pitch?: number; zoom?: number }) => void
  scrubStream: (dyWorld: number) => void
  reducedMotion: () => boolean
  pointer: EdwardCanvasPointerState
}) {
  const {
    hostEl,
    hoverCard,
    hoverEl,
    hostSize,
    project,
    getRaycaster,
    getCamera,
    getBallGroup,
    getThree,
    getPickMeshes,
    ballByIdentity,
    openPost,
    readCamera,
    writeCamera,
    scrubStream,
    reducedMotion,
    pointer,
  } = opts

  let hoverShownFor: string | null = null
  let hoverX = 0
  let hoverY = 0
  const placeHoverCard = () => {
    if (hoverEl.value) hoverEl.value.style.transform = `translate(${hoverX}px, ${hoverY}px)`
  }
  // The element mounts a tick after the card first appears — position it as soon as it exists
  watch(hoverEl, placeHoverCard, { flush: 'post' })

  let pointerNdc = { x: 0, y: 0 }
  /** Normalized pointer 0–1 in host (for edge zones) */
  let pointerUv = { x: 0.5, y: 0.5 }
  let dragMoved = false
  /** Edge rails scrub the stream; middle orbits the camera */
  let dragMode: 'orbit' | 'scroll' = 'orbit'
  let lastPtr = { x: 0, y: 0 }

  const projectHover = (b: EdwardHoverTarget) => {
    if (!hostEl.value) return
    const screen = project(b.x, b.y, b.z)
    if (!screen) return
    if (screen.behind) {
      hoverCard.value = null
      return
    }
    // Host size is cached from the ResizeObserver — no layout read per frame
    const { w: hostW, h: hostH } = hostSize()
    const x = screen.x
    const y = screen.y
    hoverX = x
    hoverY = y
    const flipX = x > hostW - 300
    const flipY = y > hostH - 260
    const shown = hoverCard.value
    if (shown && hoverShownFor === b.identity && shown.flipX === flipX && shown.flipY === flipY) {
      placeHoverCard()
      return
    }
    hoverShownFor = b.identity
    const cw = b.badges.includes('cw')
    hoverCard.value = {
      name: b.label,
      preview: cw ? '··· content warning ···' : b.preview || '…',
      kind: b.kind,
      mood: b.mood,
      why: b.moodWhy,
      glyph: MOOD_GLYPH[b.mood] || '◉‿◉',
      tag: b.topTag,
      affinity: b.affinity,
      media: cw ? null : b.mediaUrl,
      handle: b.acct ? `@${b.acct}${b.host && !b.acct.includes('@') ? `@${b.host}` : ''}` : b.host || '',
      age: ageLabel(b.createdAt),
      counts: b.counts,
      accent: dialectForHost(b.host).accent,
      reasons: b.reasons,
      flipX,
      flipY,
    }
  }

  let _ndcV: InstanceType<ThreeMod['Vector2']> | null = null
  const hitTest = (): EdwardHoverTarget | null => {
    const raycaster = getRaycaster()
    const camera = getCamera()
    const ballGroup = getBallGroup()
    const THREE = getThree()
    if (!raycaster || !camera || !ballGroup || !THREE) return null
    raycaster.setFromCamera((_ndcV ||= new THREE.Vector2()).set(pointerNdc.x, pointerNdc.y), camera)
    const hits = raycaster.intersectObjects(getPickMeshes(), false)
    if (!hits.length) return null
    const id = hits[0]!.object.userData.identity as string
    return ballByIdentity(id)
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

  /** Two-finger pinch zooms (touch has no wheel) */
  const activePtrs = new Map<number, { x: number; y: number }>()
  let pinch: { dist: number; zoom: number } | null = null
  const pinchDist = () => {
    const [a, b] = [...activePtrs.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const onPointerDown = (e: PointerEvent) => {
    // Right / middle click must not drag or "pick" — the context menu would open over the peek
    if (e.pointerType === 'mouse' && e.button !== 0) return
    activePtrs.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (activePtrs.size === 2) {
      // Second finger: switch from orbit/scroll to pinch, and never "tap" a face
      pinch = { dist: Math.max(1, pinchDist()), zoom: readCamera().zoom }
      dragMoved = true
      hoverCard.value = null
      pointer.hoverIdentity = null
      return
    }
    syncPointerUv(e.clientX, e.clientY)
    pointer.dragging = true
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
        writeCamera({
          zoom: Math.min(1.6, Math.max(0.55, pinch.zoom * (pinch.dist / d))),
        })
      }
      return
    }
    pointer.pointerInside = true
    syncPointerUv(e.clientX, e.clientY)

    if (pointer.dragging) {
      const dx = e.clientX - lastPtr.x
      const dy = e.clientY - lastPtr.y
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
      lastPtr = { x: e.clientX, y: e.clientY }
      hoverCard.value = null
      pointer.hoverIdentity = null

      if (dragMode === 'scroll') {
        // Pixel drag → world stream scrub (up drag = go forward in time / rise)
        scrubStream(-dy * 0.045)
        setHostCursor('scroll')
      } else {
        const cam = readCamera()
        writeCamera({
          yaw: cam.yaw - dx * 0.005,
          pitch: Math.min(0.55, Math.max(-0.35, cam.pitch + dy * 0.004)),
        })
        setHostCursor('grabbing')
      }
      return
    }

    if (pointerInScrollEdge()) {
      pointer.hoverIdentity = null
      hoverCard.value = null
      setHostCursor('scroll')
      return
    }

    const hit = hitTest()
    if (hit) {
      pointer.hoverIdentity = hit.identity
      projectHover(hit)
      setHostCursor('pointer')
    } else {
      pointer.hoverIdentity = null
      hoverCard.value = null
      setHostCursor('grab')
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    activePtrs.delete(e.pointerId)
    if (pinch) {
      if (activePtrs.size < 2) pinch = null
      // Lifting one finger of a pinch ends the gesture outright
      pointer.dragging = false
      return
    }
    if (!pointer.dragging) return
    const wasScroll = dragMode === 'scroll'
    pointer.dragging = false
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
    if (hit) openPost(hit.identity)
  }

  /** OS took the gesture (scroll, system swipe) — clean up, never open a post */
  const onPointerCancel = (e: PointerEvent) => {
    activePtrs.delete(e.pointerId)
    if (activePtrs.size < 2) pinch = null
    pointer.dragging = false
    try {
      hostEl.value?.releasePointerCapture?.(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onPointerLeave = () => {
    pointer.pointerInside = false
    if (pointer.dragging) return
    pointer.hoverIdentity = null
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
    const cam = readCamera()
    writeCamera({
      zoom: Math.min(1.6, Math.max(0.55, cam.zoom + e.deltaY * 0.0008)),
    })
  }

  /** Seconds the pointer has rested in the rim, and whether the chevron cue is showing */
  let edgeDwell = 0
  const edgeActive = ref(false)

  /**
   * Resting the pointer in the rim feeds the stream — but only after a short dwell, with a
   * visible chevron cue first, so a parked cursor can't make the stream run away unexplained.
   * Called from the canvas frame, before ball integration.
   */
  const applyEdgeHoverScroll = (dt: number) => {
    const inEdge = pointer.pointerInside && !pointer.dragging && !reducedMotion() && pointerInScrollEdge()
    edgeDwell = edgeDwellStep(edgeDwell, dt, inEdge)
    const cue = edgeCueVisible(edgeDwell)
    if (cue !== edgeActive.value) edgeActive.value = cue
    const gain = edgeScrubGain(edgeDwell)
    if (!inEdge || !gain) return
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
    if (Math.abs(scrub) > 0.05) scrubStream(scrub * gain * dt)
  }

  /**
   * Glue the hover card to its ball after this frame's positions are integrated.
   * A missing ball clears the card but keeps the identity, matching the old frame block.
   */
  const followHover = () => {
    if (!pointer.hoverIdentity) return
    const ball = ballByIdentity(pointer.hoverIdentity)
    if (ball) projectHover(ball)
    else hoverCard.value = null
  }

  const attach = () => {
    const el = hostEl.value
    if (!el) return
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('wheel', onWheel, { passive: false })
  }

  const detach = () => {
    const el = hostEl.value
    if (!el) return
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerCancel)
    el.removeEventListener('pointerleave', onPointerLeave)
    el.removeEventListener('wheel', onWheel)
  }

  return {
    edgeActive,
    attach,
    detach,
    applyEdgeHoverScroll,
    followHover,
  }
}
