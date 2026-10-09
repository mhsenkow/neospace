/**
 * Cross-app compose handoff — Loom chart + lineage, bruh page excerpt + link.
 *
 * Reliable path: sibling opens NeoSpace with `?compose=loom|bruh&…`.
 * Loom publishes the story (KV-backed `/s/{id}.img`); we fetch PNG + lineage.
 * bruh lands a short query caption; postMessage upgrades with caption + `/s/{id}`.
 * postMessage is an optional fast path when opener survives.
 */

import { defineStore } from 'pinia'
import { markRaw } from 'vue'
import {
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
  /** Which suite tool sent this. Text-only tools (bruh) never carry an image. */
  source?: 'loom' | 'bruh'
}

type StoryPhase = 'idle' | 'loading' | 'ready' | 'error'

type StoryState = {
  phase: StoryPhase
  hasImage: boolean
  error: string | null
}

const MAX_HANDOFF_BYTES = 25 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|avif)$/
const DATA_URL_IMAGE = /^data:image\/(png|jpeg|webp);base64,/

function storyKey(share: StoredShare): string {
  // bruh upgrades (query caption → caption + page link) must share one key so the
  // fuller postMessage replaces the short draft instead of forking a second ingest.
  if (share.source === 'bruh') return 'local:bruh'
  return share.story || `local:${share.text}|${share.imageName || ''}`
}

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

function handoffNotice(hasImage: boolean, source: StoredShare['source'] = 'loom'): string {
  if (source === 'bruh') {
    return 'Page excerpt + link from bruh. Anyone with the link can read the page.'
  }
  if (!hasImage) {
    return 'Caption ready — chart image missing; try Post to NeoSpace again from Loom'
  }
  return `Chart + lineage loaded. Add alt text, then post. ${STORY_PUBLIC_NOTICE}`
}

export function persistLoomShare(share: StoredShare) {
  try {
    const slim: StoredShare = {
      text: share.text,
      story: share.story,
      imageName: share.imageName,
      source: share.source,
    }
    if (share.imageDataUrl && share.imageDataUrl.length < 500_000) {
      slim.imageDataUrl = share.imageDataUrl
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(slim))
  } catch {
    /* quota / private */
  }
}

/** Read without clearing — survive login redirects / failed first ingest. */
export function peekPersistedLoomShare(): StoredShare | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredShare
  } catch {
    return null
  }
}

export function clearPersistedLoomShare() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** Peek then clear — prefer peek + clearPersisted after a successful ingest. */
export function readPersistedLoomShare(): StoredShare | null {
  const share = peekPersistedLoomShare()
  if (share) clearPersistedLoomShare()
  return share
}

export const useComposeHandoffStore = defineStore('composeHandoff', {
  state: () => ({
    pending: null as ComposeHandoffDraft | null,
    loading: false,
    error: null as string | null,
    /** Per-story ingest state — avoids convoluted string keys and dropped text-only reshares. */
    storyStates: {} as Record<string, StoryState>,
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

    _getStoryState(key: string): StoryState {
      return this.storyStates[key] || { phase: 'idle', hasImage: false, error: null }
    },

    _setStoryState(key: string, patch: Partial<StoryState>) {
      this.storyStates[key] = { ...this._getStoryState(key), ...patch }
    },

    /** Don't replace an image draft with a later text-only ingest for the same story. */
    _shouldSkipTextOnlyUpdate(key: string, hasNewImage: boolean): boolean {
      const state = this._getStoryState(key)
      return state.phase === 'ready' && state.hasImage && !hasNewImage
    },

    _commitDraft(key: string, draft: ComposeHandoffDraft, hasImage: boolean) {
      this.pending = draft
      this._setStoryState(key, { phase: 'ready', hasImage, error: null })
    },

    async ingestStored(share: StoredShare) {
      const key = storyKey(share)
      // Wait out any in-flight ingest for this key, then run ours. Important for bruh:
      // the short query caption and the fuller postMessage (caption + page link) share
      // one key — returning the first promise would drop the upgrade.
      const inflight = this._ingestPromises[key]
      if (inflight) await inflight

      const nextText = (share.text || '').trim()
      if (
        this.pending?.text &&
        nextText &&
        this.pending.text.includes(nextText) &&
        this.pending.text.length >= nextText.length
      ) {
        return true
      }

      const run = this._ingestStoredOnce(share, key)
      this._ingestPromises[key] = run
      try {
        return await run
      } finally {
        if (this._ingestPromises[key] === run) delete this._ingestPromises[key]
      }
    },

    async _ingestStoredOnce(share: StoredShare, key: string) {
      this.loading = true
      this.error = null
      this._setStoryState(key, { phase: 'loading', error: null })
      const base = share.story ? storyBase(share.story) : null

      try {
        const files: File[] = []
        const imageName = share.imageName || 'loom-chart.png'

        if (base) {
          const img = await fetchStoryImage(base, imageName)
          if (img) files.push(img)
        }

        if (!files.length && share.imageDataUrl) {
          const f = await fileFromDataUrl(share.imageDataUrl, imageName)
          if (f) files.push(f)
        }

        if (this._shouldSkipTextOnlyUpdate(key, files.length > 0)) {
          return true
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

        this._commitDraft(
          key,
          {
            text,
            files: files.map((f) => markRaw(f)),
            descriptions,
            notice: handoffNotice(files.length > 0, share.source),
          },
          files.length > 0,
        )
        return true
      } catch (e: any) {
        const msg = e?.message || 'Failed to load Loom share'
        this.error = msg
        this._setStoryState(key, { phase: 'error', error: msg })
        return false
      } finally {
        this.loading = false
      }
    },

    async ingestFromQuery(query: Record<string, unknown> | { [key: string]: any }) {
      const mode = String(query.compose || '')
      if (mode !== 'loom' && mode !== 'bruh') return false
      return this.ingestStored({
        story: typeof query.story === 'string' ? query.story : '',
        text: typeof query.text === 'string' ? query.text : '',
        source: mode,
      })
    },

    async ingestFromMessage(data: {
      text?: string
      story?: string
      image?: { name?: string; type?: string; buffer: ArrayBuffer }
      source?: StoredShare['source']
    }) {
      // postMessage payloads are only origin-checked — hold them to the same
      // type/size limits as story fetches (no SVG, no 1 GB buffers).
      const imageType = data.image?.type || 'image/png'
      const buffer =
        data.image?.buffer &&
        data.image.buffer.byteLength > 0 &&
        data.image.buffer.byteLength <= MAX_HANDOFF_BYTES &&
        ALLOWED_IMAGE_TYPES.test(imageType)
          ? data.image.buffer
          : null
      const imageName =
        (data.image?.name || '').replace(/[\\/\0-\x1f]/g, '').trim().slice(0, 120) ||
        'loom-chart.png'

      let imageDataUrl: string | undefined
      if (buffer) {
        try {
          if (buffer.byteLength < 400_000) {
            imageDataUrl = bufferToDataUrl(buffer, imageType)
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
        source: data.source || 'loom',
      }
      persistLoomShare(share)

      if (buffer && !share.story) {
        const key = storyKey(share)
        if (this._shouldSkipTextOnlyUpdate(key, true)) return true
        this.loading = true
        this.error = null
        try {
          const file = markRaw(new File([buffer], imageName, { type: imageType }))
          const text = (share.text || '').trim()
          this._commitDraft(
            key,
            {
              text,
              files: [file],
              descriptions: [suggestedChartAlt({ caption: text })],
              notice: handoffNotice(true),
            },
            true,
          )
          return true
        } finally {
          this.loading = false
        }
      }

      return this.ingestStored(share)
    },
  },
})
