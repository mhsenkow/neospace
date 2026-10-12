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

/**
 * Cap on the serialized payload (UTF-8 bytes, not UTF-16 units). Roomy enough for the
 * longest posts servers accept; anything bigger is reported, never silently sliced.
 */
export const MAX_DRAFT_BYTES = 64 * 1024
const SAVE_MS = 400

export type DraftSaveResult = { ok: true } | { ok: false; reason: 'too-large' | 'storage' }

const utf8Bytes = (value: string) =>
  typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(value).length : value.length * 3

/** User-facing explanation for a failed save */
export function draftSaveMessage(reason: 'too-large' | 'storage') {
  return reason === 'too-large'
    ? 'This draft is too long to save automatically. Copy your text somewhere safe before closing.'
    : 'Couldn’t save this draft — browser storage is full or unavailable. Copy your text before closing.'
}

/** Bump when the stored shape changes; records from a newer build are ignored, never overwritten blindly */
export const DRAFT_SCHEMA_VERSION = 1

const PREFIX = 'neospace_draft:'
/** Slot prefix for the inline DM composer (ChatComposer) — hidden from the saved-drafts list */
export const CHAT_DRAFT_PREFIX = 'chat:'

export function draftStorageKey(accountId: string, key: string) {
  return `${PREFIX}${accountId || 'guest'}:${key}`
}

/** Redraft slots are keyed to a post that was just deleted — they can never be reopened */
export const isRedraftSlot = (slot: string | null | undefined) => !!slot && slot.startsWith('redraft:')

/** Status id a `reply:<id>` draft slot belongs to, or null for any other slot */
export function draftReplyTarget(key: string): string | null {
  if (!key.startsWith('reply:')) return null
  return key.slice('reply:'.length).trim() || null
}

/** Hashtag a `group:<tag>` draft slot belongs to, or null (unsafe / other slots) */
export function draftGroupTag(key: string): string | null {
  if (!key.startsWith('group:')) return null
  const tag = key.slice('group:'.length).trim()
  return /^[\p{L}\p{N}\p{M}_]{1,100}$/u.test(tag) ? tag : null
}

/** Quoted post URL a `quote:<url>` draft slot belongs to — http(s) only, else null */
export function draftQuoteUrl(key: string): string | null {
  if (!key.startsWith('quote:')) return null
  const raw = key.slice('quote:'.length).trim()
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export type ListedDraft = {
  key: string
  storageKey: string
  text: string
  spoiler: string
  visibility: DraftVisibility | ''
  /** Last modification (ms since epoch); 0 for legacy records saved before timestamps */
  updatedAt: number
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
      // Conversation-bound chat drafts live in their thread — they can't be reopened from a list
      if (draftKey.startsWith(CHAT_DRAFT_PREFIX)) continue
      const record = readDraftRecord(skey)
      if (!record) continue
      const { payload } = record
      if (!payload.text.trim() && !payload.spoiler.trim()) continue
      out.push({
        key: draftKey,
        storageKey: skey,
        text: payload.text,
        spoiler: payload.spoiler,
        visibility: payload.visibility,
        updatedAt: record.updatedAt,
      })
    }
  } catch {
    return out
  }
  // Newest edit first; legacy records (no timestamp) fall back to key order after dated ones
  return out.sort((a, b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key))
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

/**
 * Parse one stored record. Legacy (unversioned) objects are accepted as-is; anything that
 * isn't a plain object, or that a newer build wrote, is rejected so it can't become a
 * writable current draft.
 */
export function parseDraftRecord(raw: string | null): { payload: DraftPayload; updatedAt: number } | null {
  if (!raw) return null
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    const rec = data as Record<string, unknown>
    if (rec.v !== undefined && (typeof rec.v !== 'number' || rec.v > DRAFT_SCHEMA_VERSION)) return null
    const visibility = rec.visibility
    return {
      payload: {
        text: typeof rec.text === 'string' ? rec.text : '',
        spoiler: typeof rec.spoiler === 'string' ? rec.spoiler : '',
        visibility:
          visibility === 'public' ||
          visibility === 'unlisted' ||
          visibility === 'private' ||
          visibility === 'direct'
            ? visibility
            : '',
      },
      updatedAt:
        typeof rec.updatedAt === 'number' && Number.isFinite(rec.updatedAt) && rec.updatedAt > 0
          ? rec.updatedAt
          : 0,
    }
  } catch {
    return null
  }
}

function readDraftRecord(skey: string) {
  if (typeof localStorage === 'undefined') return null
  try {
    return parseDraftRecord(localStorage.getItem(skey))
  } catch {
    return null
  }
}

export function readDraft(skey: string): DraftPayload | null {
  return readDraftRecord(skey)?.payload ?? null
}

/** Modification time of a stored draft (0 = none / legacy) */
export function readDraftUpdatedAt(skey: string): number {
  return readDraftRecord(skey)?.updatedAt ?? 0
}

/**
 * Persist a draft. Never truncates: a payload that can't be stored whole is reported
 * and the previously saved draft is left untouched, so it stays recoverable.
 */
export function writeDraft(skey: string, input: DraftPayload): DraftSaveResult {
  if (typeof localStorage === 'undefined') return { ok: false, reason: 'storage' }
  try {
    // Scalars only — whatever else a caller hands over (attachments, polls) is dropped
    const payload: DraftPayload = {
      text: input.text,
      spoiler: input.spoiler,
      visibility: input.visibility,
    }
    if (!payload.text.trim() && !payload.spoiler.trim()) {
      localStorage.removeItem(skey)
      return { ok: true }
    }
    const body = JSON.stringify({ v: DRAFT_SCHEMA_VERSION, ...payload, updatedAt: Date.now() })
    if (utf8Bytes(body) > MAX_DRAFT_BYTES) return { ok: false, reason: 'too-large' }
    localStorage.setItem(skey, body)
    return { ok: true }
  } catch {
    // quota / private mode
    return { ok: false, reason: 'storage' }
  }
}

export function useDraft(key: Ref<string> | string) {
  const text = ref('')
  const spoiler = ref('')
  const visibility = ref<DraftVisibility | ''>('')
  /** Why the last save failed (too long / storage) — surfaced by the composer */
  const saveError = ref<'' | 'too-large' | 'storage'>('')
  /** Another tab saved different text into this slot since we last read/wrote it */
  const conflict = ref<DraftPayload | null>(null)
  /** updatedAt of the version this tab last loaded or wrote (cross-tab revision) */
  let knownRevision = 0

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
    saveError.value = ''
    conflict.value = null
    knownRevision = readDraftUpdatedAt(currentKey())
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
    saveError.value = ''
    conflict.value = null
    knownRevision = 0
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(currentKey())
      } catch {
        // ignore
      }
    }
  }

  const persist = (skey = currentKey()) => {
    const result = writeDraft(skey, {
      text: text.value,
      spoiler: spoiler.value,
      visibility: visibility.value,
    })
    saveError.value = result.ok ? '' : result.reason
    if (result.ok) {
      knownRevision = readDraftUpdatedAt(skey)
      if (skey === currentKey()) conflict.value = null
    }
    return result.ok
  }

  /** Persist pending edits immediately when the page is hidden or being torn down */
  const flushPending = () => {
    if (!timer) return
    clearTimeout(timer)
    timer = null
    persist()
  }
  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushPending()
  }

  // Another tab wrote this slot: surface a conflict instead of silently overwriting it
  const onStorage = (e: StorageEvent) => {
    if (e.key !== currentKey()) return
    const record = readDraftRecord(e.key)
    if (!record || record.updatedAt === knownRevision) return
    const theirs = record.payload
    if (
      theirs.text === text.value &&
      theirs.spoiler === spoiler.value &&
      theirs.visibility === visibility.value
    ) {
      knownRevision = record.updatedAt
      return
    }
    // Local edits still pending: the next autosave would clobber theirs — let the user choose
    if (timer || text.value.trim() || spoiler.value.trim()) {
      conflict.value = theirs
    }
  }

  /** Resolve a cross-tab conflict: take the other tab's version, or keep ours and overwrite it */
  const resolveConflict = (choice: 'theirs' | 'mine') => {
    const theirs = conflict.value
    conflict.value = null
    if (choice === 'theirs' && theirs) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      text.value = theirs.text
      spoiler.value = theirs.spoiler
      visibility.value = theirs.visibility
      knownRevision = readDraftUpdatedAt(currentKey())
      return theirs
    }
    persist()
    return null
  }

  /** Write the current values now (explicit "Save draft and close"); false = not saved */
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    return persist()
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
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushPending)
      window.addEventListener('storage', onStorage)
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', flushPending)
      window.removeEventListener('storage', onStorage)
    }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
    flushPending()
  })

  return {
    text,
    spoiler,
    visibility,
    saveError,
    conflict,
    resolveConflict,
    restore,
    clear,
    flush,
    scheduleSave,
  }
}
