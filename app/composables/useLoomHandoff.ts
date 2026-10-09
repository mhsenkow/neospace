/**
 * Loom / bruh → NeoSpace postMessage / compose handoff.
 * Registers the message listener early (before auth init) so shares aren't lost.
 * bruh (the suite's writing room) rides the same channel as text-only shares.
 */

import {
  useComposeHandoffStore,
  clearPersistedLoomShare,
  persistLoomShare,
  peekPersistedLoomShare,
} from '~/stores/composeHandoff'
import { BRUH_ORIGINS, bruhShareText, isBruhOrigin, isBruhShare } from '~/utils/bruhHandoff'
import { LOOM_ORIGINS, isLoomOrigin } from '~/utils/loomHandoff'
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

function hasSharePayload(share: {
  story?: string
  text?: string
  imageDataUrl?: string
} | null): boolean {
  return !!(share && (share.story || share.text || share.imageDataUrl))
}

export function useLoomHandoff() {
  const composeHandoff = useComposeHandoffStore()
  const composeSheet = useComposeSheetStore()
  const instancesStore = useInstancesStore()
  const router = useRouter()
  const route = useRoute()

  /**
   * Loom / bruh → compose: open the mobile sheet once.
   * Never call show() again while open — that remounts RealComposeBox after take()
   * and the draft vanishes (looks filled for a beat, then empty).
   */
  const openHandoffCompose = async () => {
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

  /** Per-source accept flags — bruh upgrades must not lock out a later Loom share. */
  let loomShareAccepted = false
  let bruhShareAccepted = false
  let bruhUpgradeTimer: number | null = null

  const ackLoom = (origin: string) => {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'neospace-loom-ack', v: 1 }, origin)
      }
    } catch {
      /* opener may be gone */
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

  const pingSuiteReady = () => {
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

  const markBruhAcceptedSoon = () => {
    if (bruhUpgradeTimer != null) window.clearTimeout(bruhUpgradeTimer)
    // Keep the door open for a postMessage upgrade (full caption + share link).
    bruhUpgradeTimer = window.setTimeout(() => {
      bruhShareAccepted = true
      bruhUpgradeTimer = null
    }, 2500)
  }

  /** Persist across login, ingest when authed, open compose. */
  const deliverShare = async (
    share: {
      story: string
      text: string
      source: 'loom' | 'bruh'
      imageDataUrl?: string
      imageName?: string
    },
    opts?: { open?: boolean },
  ) => {
    persistLoomShare(share)
    if (!instancesStore.isAuthenticated) {
      if (route.path !== '/login') await router.replace('/login')
      return false
    }
    const ok = await composeHandoff.ingestStored(share)
    if (ok) clearPersistedLoomShare()
    if (opts?.open !== false) await openHandoffCompose()
    return ok
  }

  /** bruh → compose: text-only (page excerpt + share link). Always ack; upgrade draft if fuller text arrives. */
  const onBruhMessage = (e: MessageEvent) => {
    if (!isBruhOrigin(e.origin) || !isBruhShare(e.data)) return
    ackBruh(e.origin)
    const text = bruhShareText(e.data)
    if (!text) return
    const already = bruhShareAccepted
    bruhShareAccepted = true
    if (bruhUpgradeTimer != null) {
      window.clearTimeout(bruhUpgradeTimer)
      bruhUpgradeTimer = null
    }
    void (async () => {
      await deliverShare(
        { story: '', text, source: 'bruh' },
        // First delivery opens compose; later postMessage upgrades the pending draft quietly.
        { open: !already },
      )
    })()
  }

  const onLoomMessage = (e: MessageEvent) => {
    if (isBruhOrigin(e.origin)) {
      onBruhMessage(e)
      return
    }
    if (!isLoomOrigin(e.origin)) return
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
        source: 'loom',
        image: buffer
          ? {
              name: typeof e.data.image?.name === 'string' ? e.data.image.name : undefined,
              type: typeof e.data.image?.type === 'string' ? e.data.image.type : undefined,
              buffer,
            }
          : undefined,
      })
      if (buffer || composeHandoff.hasPending) {
        loomShareAccepted = true
        clearPersistedLoomShare()
      }
      if (!instancesStore.isAuthenticated) {
        await router.replace('/login')
      } else {
        await openHandoffCompose()
      }
    })()
  }

  /** Register listeners synchronously — call before any await in onMounted. */
  const registerLoomListeners = (): (() => void) => {
    window.addEventListener('message', onLoomMessage)
    if (window.opener && !window.opener.closed) {
      pingSuiteReady()
      const readyInterval = window.setInterval(pingSuiteReady, 400)
      window.setTimeout(() => window.clearInterval(readyInterval), 10000)
      return () => {
        window.removeEventListener('message', onLoomMessage)
        window.clearInterval(readyInterval)
        if (bruhUpgradeTimer != null) window.clearTimeout(bruhUpgradeTimer)
      }
    }
    return () => {
      window.removeEventListener('message', onLoomMessage)
      if (bruhUpgradeTimer != null) window.clearTimeout(bruhUpgradeTimer)
    }
  }

  /** Re-ping + query / persisted share boot (after initialize). */
  const bootLoomHandoff = async () => {
    pingSuiteReady()

    const composeFrom = String(route.query.compose || '')
    const fromQuery = composeFrom === 'loom' || composeFrom === 'bruh'
    if (fromQuery) {
      const share = {
        story: typeof route.query.story === 'string' ? route.query.story : '',
        text: typeof route.query.text === 'string' ? route.query.text : '',
        source: composeFrom as 'loom' | 'bruh',
      }
      // Drop compose params so refresh / back doesn't re-fire the handoff.
      await router.replace({ path: route.path === '/login' ? '/login' : '/', query: {} })

      if (!instancesStore.isAuthenticated) {
        persistLoomShare(share)
        if (route.path !== '/login') await router.replace('/login')
      } else {
        await deliverShare(share)
        if (composeFrom === 'loom') loomShareAccepted = composeHandoff.hasPending
        if (composeFrom === 'bruh') markBruhAcceptedSoon()
      }
      return
    }

    // Give optional postMessage a short window when we weren't opened via query
    await new Promise((r) => setTimeout(r, 1200))
    if (composeHandoff.hasPending || loomShareAccepted || bruhShareAccepted) return
    const persisted = peekPersistedLoomShare()
    if (!hasSharePayload(persisted) || !persisted) return
    if (!instancesStore.isAuthenticated) {
      if (route.path !== '/login') await router.replace('/login')
      return
    }
    await deliverShare({
      story: persisted.story || '',
      text: persisted.text || '',
      source: persisted.source || (persisted.story ? 'loom' : 'bruh'),
      imageDataUrl: persisted.imageDataUrl,
      imageName: persisted.imageName,
    })
  }

  watch(
    () => instancesStore.isAuthenticated,
    async (ok) => {
      if (!ok) return
      const persisted = peekPersistedLoomShare()
      if (!hasSharePayload(persisted) || !persisted) return
      // Already composing from an earlier delivery — just upgrade quietly.
      const shouldOpen = !composeSheet.open && !composeHandoff.hasPending
      await deliverShare(
        {
          story: persisted.story || '',
          text: persisted.text || '',
          source: persisted.source || (persisted.story ? 'loom' : 'bruh'),
          imageDataUrl: persisted.imageDataUrl,
          imageName: persisted.imageName,
        },
        { open: shouldOpen },
      )
    },
  )

  return {
    openLoomCompose: openHandoffCompose,
    registerLoomListeners,
    bootLoomHandoff,
  }
}
