/**
 * Cross-app compose handoff — Loom → NeoSpace chart + lineage.
 * Loom opens /?compose=loom&story=…&text=…; we pull .img + .data and stage a draft.
 */

import { defineStore } from 'pinia'

export type ComposeHandoffDraft = {
  text: string
  files: File[]
  notice: string | null
}

const LOOM_STORY_RE = /^https:\/\/(loom\.ibm\.io|loom-storyteller\.mhsenkow\.workers\.dev)\/s\/([a-z0-9]{8,16})\/?$/i

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
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const type = typeHint || blob.type || 'image/png'
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
  const rows = typeof o.totalRows === 'number' ? o.totalRows : Array.isArray(o.rows) ? o.rows.length : 0
  const truncated = !!o.truncated
  const captured = typeof o.capturedAt === 'string' ? o.capturedAt.slice(0, 10) : null
  const bits: string[] = []
  if (source?.label) bits.push(`Source: ${source.label}`)
  if (rows) bits.push(`${rows.toLocaleString()} rows${truncated ? ' (sample)' : ''}`)
  if (cols) bits.push(`${cols} columns`)
  if (captured) bits.push(`captured ${captured}`)
  return bits.length ? `Data lineage · ${bits.join(' · ')}` : null
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

    /**
     * Ingest ?compose=loom&story=&text= from the URL.
     */
    async ingestFromQuery(query: Record<string, unknown> | { [key: string]: any }) {
      const mode = String(query.compose || '')
      if (mode !== 'loom') return false

      const storyRaw = typeof query.story === 'string' ? query.story : ''
      const textRaw = typeof query.text === 'string' ? query.text : ''
      const base = storyRaw ? storyBase(storyRaw) : null

      if (!base && !textRaw.trim()) {
        this.error = 'Missing Loom share link'
        return false
      }

      this.loading = true
      this.error = null

      try {
        const files: File[] = []
        let lineageLine: string | null = null

        if (base) {
          const [img, dataRes] = await Promise.all([
            fetchAsFile(`${base}.img`, 'loom-chart.png', 'image/png'),
            fetch(`${base}.data`).catch(() => null),
          ])
          if (img) files.push(img)
          if (dataRes?.ok) {
            try {
              lineageLine = lineageBlurb(await dataRes.json())
            } catch {
              /* ignore */
            }
          }
        }

        const lines = [textRaw.trim()].filter(Boolean)
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
            : 'Caption ready — chart image unavailable; link still included',
        }
        return true
      } catch (e: any) {
        this.error = e?.message || 'Failed to load Loom share'
        return false
      } finally {
        this.loading = false
      }
    },
  },
})
