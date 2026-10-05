/**
 * Cross-app compose handoff — Loom → NeoSpace chart + lineage.
 *
 * Preferred path: Loom opens NeoSpace and postMessages the PNG (Cache API
 * for /s/{id}.img is colo-local and often 404s from another edge).
 * Fallback: fetch story .img / .data when present.
 */

import { defineStore } from 'pinia'

export type ComposeHandoffDraft = {
  text: string
  files: File[]
  notice: string | null
}

const LOOM_ORIGINS = new Set(['https://loom.ibm.io', 'https://loom-storyteller.mhsenkow.workers.dev'])
const LOOM_STORY_RE =
  /^https:\/\/(loom\.ibm\.io|loom-storyteller\.mhsenkow\.workers\.dev)\/s\/([a-z0-9]{8,16})\/?$/i
const STORAGE_KEY = 'neospace_loom_share_v1'

type StoredShare = {
  text: string
  story: string
  /** data URL for the chart image */
  imageDataUrl?: string
  imageName?: string
}

function storyIdFromUrl(url: string): string | null {
  const m = url.trim().match(LOOM_STORY_RE)
  return m?.[2] ?? null
}

function storyBase(url: string): string | null {
  const id = storyIdFromUrl(url)
  if (!id) return null
  const u = new URL(url)
  return `${u.origin}/s/${id}`
}

async function fetchAsFile(url: string, filename: string, typeHint?: string): Promise<File | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.size || blob.type.startsWith('text/')) return null
    const type = typeHint || (blob.type.startsWith('image/') ? blob.type : 'image/png')
    return new File([blob], filename, { type })
  } catch {
    return null
  }
}

function lineageBlurb(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  const source = o.source as { label?: string; url?: string } | undefined
  const cols = Array.isArray(o.columns) ? o.columns.length : 0
  const rows =
    typeof o.totalRows === 'number' ? o.totalRows : Array.isArray(o.rows) ? o.rows.length : 0
  const truncated = !!o.truncated
  const captured = typeof o.capturedAt === 'string' ? o.capturedAt.slice(0, 10) : null
  const bits: string[] = []
  if (source?.label) bits.push(`Source: ${source.label}`)
  if (rows) bits.push(`${rows.toLocaleString()} rows${truncated ? ' (sample)' : ''}`)
  if (cols) bits.push(`${cols} columns`)
  if (captured) bits.push(`captured ${captured}`)
  return bits.length ? `Data lineage · ${bits.join(' · ')}` : null
}

async function fileFromDataUrl(dataUrl: string, name: string): Promise<File | null> {
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

export function persistLoomShare(share: StoredShare) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(share))
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
      this.loading = true
      this.error = null
      try {
        const files: File[] = []
        if (share.imageDataUrl) {
          const f = await fileFromDataUrl(share.imageDataUrl, share.imageName || 'loom-chart.png')
          if (f) files.push(f)
        }

        let lineageLine: string | null = null
        const base = share.story ? storyBase(share.story) : null
        if (base) {
          if (!files.length) {
            const img = await fetchAsFile(`${base}.img`, 'loom-chart.png')
            if (img) files.push(img)
          }
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

        this.pending = {
          text: lines.join('\n').trim(),
          files,
          notice: files.length
            ? 'Chart image + lineage loaded from Loom — review and post'
            : 'Caption ready — chart image missing; try Post to NeoSpace again from Loom',
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
     * Accept a live postMessage from Loom (includes the PNG bytes).
     */
    async ingestFromMessage(data: {
      text?: string
      story?: string
      image?: { name?: string; type?: string; buffer: ArrayBuffer }
    }) {
      let imageDataUrl: string | undefined
      let imageName: string | undefined
      if (data.image?.buffer) {
        const type = data.image.type?.startsWith('image/') ? data.image.type : 'image/png'
        imageDataUrl = bufferToDataUrl(data.image.buffer, type)
        imageName = data.image.name || 'loom-chart.png'
      }
      const share: StoredShare = {
        text: data.text || '',
        story: data.story || '',
        imageDataUrl,
        imageName,
      }
      persistLoomShare(share)
      return this.ingestStored(share)
    },
  },
})

export { LOOM_ORIGINS, STORAGE_KEY }
