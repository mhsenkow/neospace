/**
 * Debounced localStorage drafts for composers.
 * Keyed by new / reply:id / quote / dm / group:tag, scoped per active account
 * (`neospace_draft:<accountId>:<key>`) so text typed as A never shows up for B.
 *
 * Only scalars persist (text, CW, visibility). Attachments, polls and schedule are
 * NOT restored from localStorage — uploaded media ids are server/account-bound and
 * can expire, so a restored draft is text-only.
 *
 * Legacy unscoped keys (`neospace_draft:<key>`) are migrated to the active account
 * only when exactly one account is signed in (unambiguous); otherwise ignored.
 */

import { useInstancesStore } from '~/stores/instances'
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

const PREFIX = 'neospace_draft:'

export function draftStorageKey(accountId: string, key: string) {
  return `${PREFIX}${accountId || 'guest'}:${key}`
}

export type ListedDraft = {
  key: string
  storageKey: string
  text: string
  spoiler: string
  visibility: DraftVisibility | ''
}

/** Scan localStorage for this account's saved drafts (for "find drafts" UI). */
export function listAccountDrafts(accountId: string): ListedDraft[] {
  if (typeof localStorage === 'undefined' || !accountId) return []
  const needle = `${PREFIX}${accountId}:`
  const out: ListedDraft[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const skey = localStorage.key(i)
      if (!skey || !skey.startsWith(needle)) continue
      const draftKey = skey.slice(needle.length)
      const payload = readDraft(skey)
      if (!payload || (!payload.text.trim() && !payload.spoiler.trim())) continue
      out.push({
        key: draftKey,
        storageKey: skey,
        text: payload.text,
        spoiler: payload.spoiler,
        visibility: payload.visibility,
      })
    }
  } catch {
    return out
  }
  return out.sort((a, b) => a.key.localeCompare(b.key))
}

function legacyKey(key: string) {
  return `${PREFIX}${key}`
}

/** Move a pre-scoping draft onto this account when that can't leak across accounts */
export function migrateLegacyDraft(accountId: string, key: string, canMigrate: boolean) {
  if (typeof localStorage === 'undefined' || !canMigrate) return
  try {
    const old = localStorage.getItem(legacyKey(key))
    if (old === null) return
    const scoped = draftStorageKey(accountId, key)
    if (localStorage.getItem(scoped) === null) localStorage.setItem(scoped, old)
    localStorage.removeItem(legacyKey(key))
  } catch {
    // ignore
  }
}

export function readDraft(skey: string): DraftPayload | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(skey)
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

export function writeDraft(skey: string, input: DraftPayload) {
  if (typeof localStorage === 'undefined') return
  try {
    // Scalars only — whatever else a caller hands over (attachments, polls) is dropped
    const payload: DraftPayload = {
      text: input.text,
      spoiler: input.spoiler,
      visibility: input.visibility,
    }
    if (!payload.text.trim() && !payload.spoiler.trim()) {
      localStorage.removeItem(skey)
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
    localStorage.setItem(skey, body)
  } catch {
    // quota / private mode — ignore
  }
}

export function useDraft(key: Ref<string> | string) {
  const text = ref('')
  const spoiler = ref('')
  const visibility = ref<DraftVisibility | ''>('')

  let timer: ReturnType<typeof setTimeout> | null = null

  const instances = useInstancesStore()
  const accountId = () => instances.activeAccountId || ''
  const currentKey = () => draftStorageKey(accountId(), toValue(key))

  const restore = () => {
    migrateLegacyDraft(
      accountId(),
      toValue(key),
      instances.authenticatedInstances.length === 1,
    )
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
        localStorage.removeItem(currentKey())
      } catch {
        // ignore
      }
    }
  }

  const persist = (skey = currentKey()) => {
    writeDraft(skey, {
      text: text.value,
      spoiler: spoiler.value,
      visibility: visibility.value,
    })
  }

  /** Write the current values now (explicit "Save draft and close") */
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    persist()
  }

  const scheduleSave = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      persist()
    }, SAVE_MS)
  }

  // Key or account changed: flush a pending save to the OLD slot, then load the new one
  watch(currentKey, (_next, prev) => {
    if (timer) {
      clearTimeout(timer)
      timer = null
      persist(prev)
    }
    restore()
  })

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
    flush,
    scheduleSave,
  }
}
