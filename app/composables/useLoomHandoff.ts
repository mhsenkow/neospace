/**
 * Loom / bruh → NeoSpace postMessage / compose handoff.
 * Registers the message listener early (before auth init) so shares aren't lost.
 * bruh (the suite's writing room) rides the same channel as text-only shares.
 */

import {
  useComposeHandoffStore,
  LOOM_ORIGINS,
  persistLoomShare,
  readPersistedLoomShare,
} from '~/stores/composeHandoff'
import { BRUH_ORIGINS, bruhShareText, isBruhShare } from '~/utils/bruhHandoff'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useInstancesStore } from '~/stores/instances'

function bufferFromMessage(raw: unknown): ArrayBuffer | null {
  if (!raw) return null
  if (raw instanceof ArrayBuffer && raw.byteLength > 0) return raw
  if (ArrayBuffer.isView(raw) && raw.byteLength > 0) {
    const view = raw as ArrayBufferView
    // Copy into a plain ArrayBuffer (the view may sit on a SharedArrayBuffer)
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice().buffer
  }
  return null
}

export function useLoomHandoff() {
  const composeHandoff = useComposeHandoffStore()
  const composeSheet = useComposeSheetStore()
  const instancesStore = useInstancesStore()
  const router = useRouter()
  const route = useRoute()

  /**
   * Loom → compose: open the mobile sheet once.
   * Never call show() again while open — that remounts RealComposeBox after take()
   * and the draft vanishes (looks filled for a beat, then empty).
   */
  const openLoomCompose = async () => {
    const isMobile = window.matchMedia('(max-width: 1023px)').matches
    if (isMobile) {
      if (!composeSheet.open) {
        composeSheet.show({
          title: 'New post',
          // Survive layout/nav remounts after take() cleared pending
          initialText: composeHandoff.pending?.text || undefined,
        })
        await nextTick()
      }
      if (route.path !== '/') await router.replace('/')
    } else if (route.path !== '/') {
      await router.replace('/')
    }
  }

  let loomShareAccepted = false

  const ackLoom = (origin: string) => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'neospace-loom-ack', v: 1 }, origin)
      }
    } catch {
      /* opener may be gone */
    }
  }

  const pingLoomReady = () => {
    try {
      if (typeof window === 'undefined' || !window.opener || window.opener.closed) return
      for (const origin of LOOM_ORIGINS) {
        window.opener.postMessage({ type: 'neospace-loom-ready', v: 1 }, origin)
      }
      for (const origin of BRUH_ORIGINS) {
        window.opener.postMessage({ type: 'neospace-bruh-ready', v: 1 }, origin)
      }
    } catch {
      /* cross-origin opener may throw */
    }
  }

  const ackBruh = (origin: string) => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'neospace-bruh-ack', v: 1 }, origin)
      }
    } catch {
      /* opener may be gone */
    }
  }

  /** bruh → compose: text-only (page excerpt + share link). Always ack; upgrade draft if fuller text arrives. */
  const onBruhMessage = (e: MessageEvent) => {
    if (!BRUH_ORIGINS.has(e.origin) || !isBruhShare(e.data)) return
    ackBruh(e.origin)
    const text = bruhShareText(e.data)
    if (!text) return
    const already = loomShareAccepted
    loomShareAccepted = true
    void (async () => {
      const share = { story: '', text, source: 'bruh' as const }
      persistLoomShare(share)
      if (!instancesStore.isAuthenticated) {
        await router.replace('/login')
        return
      }
      await composeHandoff.ingestStored(share)
      // First delivery opens compose; later postMessage upgrades the pending draft quietly.
      if (!already) await openLoomCompose()
    })()
  }

  const onLoomMessage = (e: MessageEvent) => {
    if (BRUH_ORIGINS.has(e.origin)) {
      onBruhMessage(e)
      return
    }
    if (!LOOM_ORIGINS.has(e.origin)) return
    if (e.data?.type !== 'loom-neospace-share' || e.data?.v !== 1) return
    const buffer = bufferFromMessage(e.data.image?.buffer)
    // Always ACK so Loom stops retrying — even for duplicate deliveries
    ackLoom(e.origin)
    // Already opened from query / earlier message — still ingest image upgrades,
    // but never remount the sheet (that wipes a draft already taken into the box).
    if (loomShareAccepted && !buffer) return
    void (async () => {
      await composeHandoff.ingestFromMessage({
        text: typeof e.data.text === 'string' ? e.data.text : '',
        story: typeof e.data.story === 'string' ? e.data.story : '',
        image: buffer
          ? {
              name: typeof e.data.image?.name === 'string' ? e.data.image.name : undefined,
              type: typeof e.data.image?.type === 'string' ? e.data.image.type : undefined,
              buffer,
            }
          : undefined,
      })
      if (buffer) loomShareAccepted = true
      if (!instancesStore.isAuthenticated) {
        await router.replace('/login')
      } else {
        await openLoomCompose()
      }
    })()
  }

  /** Register listeners synchronously — call before any await in onMounted. */
  const registerLoomListeners = (): (() => void) => {
    window.addEventListener('message', onLoomMessage)
    if (window.opener && !window.opener.closed) {
      pingLoomReady()
      const readyInterval = window.setInterval(pingLoomReady, 400)
      window.setTimeout(() => window.clearInterval(readyInterval), 10000)
      return () => {
        window.removeEventListener('message', onLoomMessage)
        window.clearInterval(readyInterval)
      }
    }
    return () => window.removeEventListener('message', onLoomMessage)
  }

  /** Re-ping + query / persisted share boot (after initialize). */
  const bootLoomHandoff = async () => {
    pingLoomReady()

    const composeFrom = String(route.query.compose || '')
    const fromQuery = composeFrom === 'loom' || composeFrom === 'bruh'
    if (fromQuery) {
      const share = {
        story: typeof route.query.story === 'string' ? route.query.story : '',
        text: typeof route.query.text === 'string' ? route.query.text : '',
        source: composeFrom as 'loom' | 'bruh',
      }
      persistLoomShare(share)
      await router.replace({ path: route.path === '/login' ? '/login' : '/', query: {} })

      // Story URL is authoritative for Loom. For bruh, keep the door open for a
      // postMessage upgrade (full caption + share link) — query text is deliberately short.
      if (!instancesStore.isAuthenticated) {
        persistLoomShare(share)
        if (route.path !== '/login') await router.replace('/login')
      } else {
        await composeHandoff.ingestStored(share)
        if (composeFrom === 'loom') loomShareAccepted = composeHandoff.hasPending
        await openLoomCompose()
        // bruh: mark accepted after a beat so an early postMessage can still upgrade text
        if (composeFrom === 'bruh') {
          window.setTimeout(() => {
            loomShareAccepted = true
          }, 2500)
        }
      }
    } else {
      // Give optional postMessage a short window when we weren't opened via query
      await new Promise((r) => setTimeout(r, 1200))
      if (!composeHandoff.hasPending && !loomShareAccepted) {
        const loomPayload = readPersistedLoomShare()
        if (loomPayload && (loomPayload.story || loomPayload.text || loomPayload.imageDataUrl)) {
          if (!instancesStore.isAuthenticated) {
            persistLoomShare(loomPayload)
            if (route.path !== '/login') await router.replace('/login')
          } else {
            await composeHandoff.ingestStored(loomPayload)
            await openLoomCompose()
          }
        }
      }
    }
  }

  watch(
    () => instancesStore.isAuthenticated,
    async (ok) => {
      if (!ok) return
      const loomPayload = readPersistedLoomShare()
      if (!loomPayload || (!loomPayload.story && !loomPayload.text && !loomPayload.imageDataUrl)) return
      await composeHandoff.ingestStored(loomPayload)
      await openLoomCompose()
    },
  )

  return {
    openLoomCompose,
    registerLoomListeners,
    bootLoomHandoff,
  }
}
