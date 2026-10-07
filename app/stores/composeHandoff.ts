/**
 * Cross-app compose handoff — Loom → NeoSpace chart + lineage.
 *
 * Reliable path: Loom publishes the story (KV-backed `/s/{id}.img`) and opens
 * NeoSpace with `?compose=loom&story=…`. We fetch the PNG + lineage over HTTPS.
 * postMessage is an optional fast path when opener survives; large charts often
 * fail that channel, so story fetch is authoritative.
 */

import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import {
  LOOM_ORIGINS,
  STORY_PUBLIC_NOTICE,
  lineageBlurb,
  storyBase,
  suggestedChartAlt,
} from '~/utils/loomHandoff'

export type ComposeHandoffDraft = {
  text: string
  files: File[]
  /** Parallel to files — suggested alt text for accessibility */
  descriptions: (string | null)[]
  notice: string | null
}

const STORAGE_KEY = 'neospace_loom_share_v1'

type StoredShare = {
  text: string
  story: string
  /** data URL for the chart image (optional; story fetch is preferred) */
  imageDataUrl?: string
  imageName?: string
}

const MAX_HANDOFF_BYTES = 25 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/
const DATA_URL_IMAGE = /^data:image\/(png|jpeg|webp);base64,/

async function fetchAsFile(url: string, filename: string, typeHint?: string): Promise<File | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const len = res.headers.get('content-length')
    if (len && Number(len) > MAX_HANDOFF_BYTES) return null
    const blob = await res.blob()
    if (!blob.size || blob.size > MAX_HANDOFF_BYTES) return null
    if (blob.type.startsWith('text/')) return null
    const type = typeHint || blob.type
    if (!ALLOWED_IMAGE_TYPES.test(type)) return null
    return new File([blob], filename, { type })
  } catch {
    return null
  }
}

/** Story assets can take a beat after publish — retry briefly. */
async function fetchStoryImage(base: string, filename: string): Promise<File | null> {
  const delays = [0, 400, 900, 1600, 2500]
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait))
    const img = await fetchAsFile(`${base}.img`, filename)
    if (img) return img
  }
  return null
}

async function fileFromDataUrl(dataUrl: string, name: string): Promise<File | null> {
  if (!DATA_URL_IMAGE.test(dataUrl)) return null
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const type = blob.type.startsWith('image/') ? blob.type : 'image/png'
    return new File([blob], name || 'loom-chart.png', { type })
  } catch {
    return null
  }
}

function bufferToDataUrl(buffer: ArrayBuffer, type: string): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${type};base64,${btoa(binary)}`
}

function handoffNotice(hasImage: boolean): string {
  if (!hasImage) {
    return 'Caption ready — chart image missing; try Post to NeoSpace again from Loom'
  }
  return `Chart + lineage loaded. Add alt text, then post. ${STORY_PUBLIC_NOTICE}`
}

export function persistLoomShare(share: StoredShare) {
  try {
    // Prefer not storing huge data URLs — story URL is enough to re-fetch
    const slim: StoredShare = {
      text: share.text,
      story: share.story,
      imageName: share.imageName,
    }
    if (share.imageDataUrl && share.imageDataUrl.length < 500_000) {
      slim.imageDataUrl = share.imageDataUrl
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
  } catch {
    /* quota / private */
  }
}

export function readPersistedLoomShare(): StoredShare | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(STORAGE_KEY)
    return JSON.parse(raw) as StoredShare
  } catch {
    return null
  }
}

export const useComposeHandoffStore = defineStore('composeHandoff', {
  state: () => ({
    pending: null as ComposeHandoffDraft | null,
    loading: false,
    error: null as string | null,
    /** Dedupe repeated Loom postMessages / query ingest. */
    lastIngestKey: null as string | null,
    /** In-flight ingest per story — avoids double chart upload. */
    _ingestPromises: {} as Record<string, Promise<boolean>>,
  }),

  getters: {
    hasPending(state): boolean {
      return !!state.pending && (!!state.pending.text || state.pending.files.length > 0)
    },
  },

  actions: {
    clear() {
      this.pending = null
      this.error = null
      this.loading = false
    },

    take(): ComposeHandoffDraft | null {
      const draft = this.pending
      this.pending = null
      return draft
    },

    async ingestStored(share: StoredShare) {
      const base = share.story ? storyBase(share.story) : null
      const storyKey = share.story || `${share.text || ''}|${share.imageName || ''}`
      const inflight = this._ingestPromises[storyKey]
      if (inflight) return inflight

      const run = this._ingestStoredOnce(share, base)
      this._ingestPromises[storyKey] = run
      try {
        return await run
      } finally {
        delete this._ingestPromises[storyKey]
      }
    },

    async _ingestStoredOnce(share: StoredShare, base: string | null) {
      // Key without img flag first — we upgrade after fetch
      const provisionalKey = `${share.story || ''}|${share.text || ''}`
      if (
        this.lastIngestKey?.startsWith(provisionalKey) &&
        this.lastIngestKey.endsWith('|img') &&
        (this.pending || this.hasPending)
      ) {
        // Already have image-bearing draft for this story
        if (!share.imageDataUrl) return true
      }

      this.loading = true
      this.error = null
      try {
        const files: File[] = []
        const imageName = share.imageName || 'loom-chart.png'

        // 1) Prefer live story image (KV — works cross-colo)
        if (base) {
          const img = await fetchStoryImage(base, imageName)
          if (img) files.push(img)
        }

        // 2) Fallback: data URL from postMessage / session
        if (!files.length && share.imageDataUrl) {
          const f = await fileFromDataUrl(share.imageDataUrl, imageName)
          if (f) files.push(f)
        }

        let lineageLine: string | null = null
        if (base) {
          try {
            const dataRes = await fetch(`${base}.data`, { cache: 'no-store' })
            if (dataRes.ok) lineageLine = lineageBlurb(await dataRes.json())
          } catch {
            /* ignore */
          }
        }

        const lines = [share.text?.trim()].filter(Boolean) as string[]
        if (lineageLine && !lines.some((l) => l.includes('Data lineage'))) {
          lines.push('', lineageLine)
        }
        if (base && !lines.some((l) => l.includes(base))) {
          lines.push('', base)
        }

        const text = lines.join('\n').trim()
        const descriptions = files.length
          ? [suggestedChartAlt({ caption: text, lineage: lineageLine })]
          : []

        const key = `${share.story || ''}|${share.text || ''}|${files.length ? 'img' : 'noimg'}`
        // Don't replace an image draft with a later text-only one
        if (
          this.lastIngestKey?.startsWith(`${share.story || ''}|`) &&
          this.lastIngestKey.endsWith('|img') &&
          !files.length
        ) {
          return true
        }

        this.lastIngestKey = key
        this.pending = {
          text,
          files: files.map((f) => markRaw(f)),
          descriptions,
          notice: handoffNotice(files.length > 0),
        }
        return true
      } catch (e: any) {
        this.error = e?.message || 'Failed to load Loom share'
        return false
      } finally {
        this.loading = false
      }
    },

    async ingestFromQuery(query: Record<string, unknown> | { [key: string]: any }) {
      const mode = String(query.compose || '')
      if (mode !== 'loom') return false
      return this.ingestStored({
        story: typeof query.story === 'string' ? query.story : '',
        text: typeof query.text === 'string' ? query.text : '',
      })
    },

    /**
     * Optional live postMessage from Loom (may include PNG bytes).
     * Still re-fetches story.img when possible — more reliable for large charts.
     */
    async ingestFromMessage(data: {
      text?: string
      story?: string
      image?: { name?: string; type?: string; buffer: ArrayBuffer }
    }) {
      const imageName = data.image?.name || 'loom-chart.png'
      const imageType = data.image?.type?.startsWith('image/')
        ? data.image.type
        : 'image/png'

      let imageDataUrl: string | undefined
      if (data.image?.buffer && data.image.buffer.byteLength > 0) {
        try {
          // Only keep small images in sessionStorage; large ones use story fetch
          if (data.image.buffer.byteLength < 400_000) {
            imageDataUrl = bufferToDataUrl(data.image.buffer, imageType)
          }
        } catch {
          /* ignore */
        }
      }

      const share: StoredShare = {
        text: data.text || '',
        story: data.story || '',
        imageDataUrl,
        imageName,
      }
      persistLoomShare(share)

      // If we have bytes and no story URL yet, use them directly
      if (data.image?.buffer && data.image.buffer.byteLength > 0 && !share.story) {
        const key = `|${share.text || ''}|img`
        if (this.lastIngestKey === key && (this.pending || this.hasPending)) return true
        this.loading = true
        this.error = null
        try {
          const file = markRaw(new File([data.image.buffer], imageName, { type: imageType }))
          const text = (share.text || '').trim()
          this.lastIngestKey = key
          this.pending = {
            text,
            files: [file],
            descriptions: [suggestedChartAlt({ caption: text })],
            notice: handoffNotice(true),
          }
          return true
        } finally {
          this.loading = false
        }
      }

      return this.ingestStored(share)
    },
  },
})

export { LOOM_ORIGINS, STORAGE_KEY }
