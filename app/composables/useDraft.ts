/**
 * Debounced localStorage drafts for composers.
 * Keyed by new / reply:id / quote / dm / group:tag.
 */

import {
  onMounted,
  onUnmounted,
  ref,
  toValue,
  watch,
  type Ref,
} from 'vue'

export type DraftVisibility = 'public' | 'unlisted' | 'private' | 'direct'

type DraftPayload = {
  text: string
  spoiler: string
  visibility: DraftVisibility | ''
}

const MAX_BYTES = 8 * 1024
const SAVE_MS = 400

function storageKey(key: string) {
  return `neospace_draft:${key}`
}

function readDraft(key: string): DraftPayload | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(storageKey(key))
    if (!raw) return null
    const data = JSON.parse(raw) as Partial<DraftPayload>
    return {
      text: typeof data.text === 'string' ? data.text : '',
      spoiler: typeof data.spoiler === 'string' ? data.spoiler : '',
      visibility:
        data.visibility === 'public' ||
        data.visibility === 'unlisted' ||
        data.visibility === 'private' ||
        data.visibility === 'direct'
          ? data.visibility
          : '',
    }
  } catch {
    return null
  }
}

function writeDraft(key: string, payload: DraftPayload) {
  if (typeof localStorage === 'undefined') return
  try {
    if (!payload.text.trim() && !payload.spoiler.trim()) {
      localStorage.removeItem(storageKey(key))
      return
    }
    let body = JSON.stringify(payload)
    if (body.length > MAX_BYTES) {
      const overhead = body.length - payload.text.length
      const maxText = Math.max(0, MAX_BYTES - overhead - 32)
      body = JSON.stringify({
        ...payload,
        text: payload.text.slice(0, maxText),
      })
    }
    if (body.length > MAX_BYTES) return
    localStorage.setItem(storageKey(key), body)
  } catch {
    // quota / private mode — ignore
  }
}

export function useDraft(key: Ref<string> | string) {
  const text = ref('')
  const spoiler = ref('')
  const visibility = ref<DraftVisibility | ''>('')

  let timer: ReturnType<typeof setTimeout> | null = null

  const currentKey = () => toValue(key)

  const restore = () => {
    const data = readDraft(currentKey())
    if (!data) {
      text.value = ''
      spoiler.value = ''
      visibility.value = ''
      return
    }
    text.value = data.text
    spoiler.value = data.spoiler
    visibility.value = data.visibility
  }

  const clear = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    text.value = ''
    spoiler.value = ''
    visibility.value = ''
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(storageKey(currentKey()))
      } catch {
        // ignore
      }
    }
  }

  const persist = () => {
    writeDraft(currentKey(), {
      text: text.value,
      spoiler: spoiler.value,
      visibility: visibility.value,
    })
  }

  const scheduleSave = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      persist()
    }, SAVE_MS)
  }

  watch(
    () => toValue(key),
    () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      restore()
    },
  )

  onMounted(() => {
    restore()
  })

  onUnmounted(() => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      persist()
    }
  })

  return {
    text,
    spoiler,
    visibility,
    restore,
    clear,
    scheduleSave,
  }
}
