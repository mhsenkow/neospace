/**
 * Compose modalities — the peek FAB mirrors what you usually post
 * (write / media / voice), while the tab-bar create stays neutral.
 */

import { computed, watch } from 'vue'
import { useInstancesStore } from '~/stores/instances'
import type { NeoIconName } from '~/utils/neoIcons'

export type ComposeModality = 'write' | 'media' | 'voice'

export type ComposeModalityCounts = Record<ComposeModality, number>

export type ComposeModalityPrefs = {
  counts: ComposeModalityCounts
  /** Manual pin — wins over counts until cleared */
  override: ComposeModality | null
}

const STORAGE_KEY = 'neospace_compose_modality_v1'

const EMPTY_COUNTS = (): ComposeModalityCounts => ({ write: 0, media: 0, voice: 0 })

export function emptyModalityPrefs(): ComposeModalityPrefs {
  return { counts: EMPTY_COUNTS(), override: null }
}

export function preferredFromPrefs(prefs: ComposeModalityPrefs): ComposeModality {
  if (prefs.override === 'write' || prefs.override === 'media' || prefs.override === 'voice') {
    return prefs.override
  }
  const { write, media, voice } = prefs.counts
  const best = Math.max(write, media, voice)
  if (best <= 0) return 'write'
  // Prefer media on ties with write — photo posters are the optimization target
  if (media >= write && media >= voice) return 'media'
  if (voice > write && voice > media) return 'voice'
  return 'write'
}

export function modalityIcon(modality: ComposeModality): NeoIconName {
  if (modality === 'media') return 'camera'
  if (modality === 'voice') return 'mic'
  return 'pen'
}

export function modalityLabel(modality: ComposeModality): string {
  if (modality === 'media') return 'New photo'
  if (modality === 'voice') return 'Voice note'
  return 'New thread'
}

export function modalityPlaceholder(modality: ComposeModality): string {
  if (modality === 'media') return 'Add a caption…'
  if (modality === 'voice') return 'Say something…'
  return "What's new?"
}

/** Infer modality from a successful post (media beats text). */
export function modalityFromPost(opts: { hasMedia: boolean; hasVoice?: boolean }): ComposeModality {
  if (opts.hasVoice) return 'voice'
  if (opts.hasMedia) return 'media'
  return 'write'
}

export function recordModalitySuccess(
  prefs: ComposeModalityPrefs,
  modality: ComposeModality,
): ComposeModalityPrefs {
  const counts = { ...prefs.counts, [modality]: (prefs.counts[modality] || 0) + 1 }
  return { ...prefs, counts }
}

type StoredBlob = Record<string, ComposeModalityPrefs>

function readBlob(): StoredBlob {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as StoredBlob) : {}
  } catch {
    return {}
  }
}

function writeBlob(blob: StoredBlob) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(blob))
  } catch {
    /* private mode / quota */
  }
}

function parsePrefs(raw: unknown): ComposeModalityPrefs {
  if (!raw || typeof raw !== 'object') return emptyModalityPrefs()
  const o = raw as Partial<ComposeModalityPrefs>
  const c = o.counts || ({} as ComposeModalityCounts)
  return {
    counts: {
      write: Number(c.write) || 0,
      media: Number(c.media) || 0,
      voice: Number(c.voice) || 0,
    },
    override:
      o.override === 'write' || o.override === 'media' || o.override === 'voice' ? o.override : null,
  }
}

export function useComposeModality() {
  const instances = useInstancesStore()
  const accountId = computed(() => instances.activeAccount?.id || 'guest')
  const prefs = useState<ComposeModalityPrefs>('neo-compose-modality-prefs', emptyModalityPrefs)

  const hydrate = () => {
    const blob = readBlob()
    prefs.value = parsePrefs(blob[accountId.value])
  }

  const persist = () => {
    const blob = readBlob()
    blob[accountId.value] = prefs.value
    writeBlob(blob)
  }

  if (import.meta.client) {
    watch(accountId, () => hydrate(), { immediate: true })
  }

  const preferred = computed(() => preferredFromPrefs(prefs.value))
  const preferredIcon = computed(() => modalityIcon(preferred.value))

  const recordSuccess = (modality: ComposeModality) => {
    prefs.value = recordModalitySuccess(prefs.value, modality)
    persist()
  }

  const setOverride = (modality: ComposeModality | null) => {
    prefs.value = { ...prefs.value, override: modality }
    persist()
  }

  return {
    preferred,
    preferredIcon,
    prefs,
    recordSuccess,
    setOverride,
    hydrate,
  }
}
