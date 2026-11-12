/**
 * localStorage / sessionStorage helpers for the instances store: payload parsing,
 * duplicate-slot collapsing, cross-tab merge, and launch-account semantics.
 */

import type { ConnectedInstance } from './types'

export const STORAGE_KEY = 'neospace_instances'
export const LEGACY_AUTH_KEY = 'neospace_auth'
export const STORAGE_VERSION = 1

/** sessionStorage flag: this tab/window already chose its posting account for the session */
export const SESSION_STARTED_KEY = 'neospace_session_started'

/**
 * "Main" account semantics: a fresh launch (new tab / PWA start — no session flag yet) posts as
 * the main account; later reloads in the same session keep whatever the user switched to.
 */
export function launchAccountId(opts: {
  activeId: string | null
  primaryId: string | null
  authenticatedIds: string[]
  sessionStarted: boolean
}): string | null {
  if (opts.sessionStarted) return opts.activeId
  if (opts.primaryId && opts.authenticatedIds.includes(opts.primaryId)) return opts.primaryId
  return opts.activeId
}

/** Accept raw blobs or `{ v: 1, ... }` wrappers */
export function unwrapStoragePayload(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (typeof obj.v === 'number' && obj.v >= 1) {
    const { v: _v, ...rest } = obj
    return rest
  }
  return obj
}

/** Parsed stored payload, or null when nothing (usable) is saved. Throws on malformed JSON. */
export function readStoredPayload(): Record<string, unknown> | null {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return null
  return unwrapStoragePayload(JSON.parse(saved))
}

/** Stored instances with tab-local / secret fields reset */
export function sanitizeStoredInstances(data: Record<string, unknown>): ConnectedInstance[] {
  return ((data.instances as ConnectedInstance[]) || []).map((i: ConnectedInstance) => ({
    ...i,
    clientSecret: null,
    isConnecting: false,
    error: null,
  })) as ConnectedInstance[]
}

const slotKey = (inst: ConnectedInstance) => {
  const urlKey = (inst.url || '').replace(/\/+$/, '').toLowerCase()
  if (!urlKey) return null
  const userKey = inst.user?.id || inst.id
  return `${urlKey}::${userKey}`
}

/**
 * First-load dedupe: keep multiple accounts on the same server; only collapse empty duplicates.
 */
export function dedupeLoadedInstances(raw: ConnectedInstance[]): ConnectedInstance[] {
  const seen = new Map<string, ConnectedInstance>()
  const kept: ConnectedInstance[] = []
  for (const inst of raw) {
    const key = slotKey(inst)
    if (!key) continue
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, inst)
      kept.push(inst)
      continue
    }
    // Same slot — prefer authenticated + richer user
    if (!!inst.accessToken && !prev.accessToken) {
      const idx = kept.indexOf(prev)
      if (idx !== -1) {
        kept[idx] = { ...inst, id: prev.id, url: prev.url }
        seen.set(key, kept[idx]!)
      }
    } else if (!!inst.user && !prev.user && !prev.accessToken) {
      const idx = kept.indexOf(prev)
      if (idx !== -1) {
        kept[idx] = { ...inst, id: prev.id, url: prev.url }
        seen.set(key, kept[idx]!)
      }
    }
  }
  return kept
}

/** Cross-tab dedupe of the remote payload (richer slot overlays the earlier one). */
export function dedupeRemoteInstances(raw: ConnectedInstance[]): ConnectedInstance[] {
  const seen = new Map<string, ConnectedInstance>()
  const remoteKept: ConnectedInstance[] = []
  for (const inst of raw) {
    const key = slotKey(inst)
    if (!key) continue
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, inst)
      remoteKept.push(inst)
      continue
    }
    if (
      (!!inst.accessToken && !prev.accessToken) ||
      (!!inst.user && !prev.user)
    ) {
      const idx = remoteKept.indexOf(prev)
      if (idx !== -1) {
        remoteKept[idx] = { ...prev, ...inst, url: prev.url, id: prev.id }
        seen.set(key, remoteKept[idx]!)
      }
    }
  }
  return remoteKept
}

/** Merge remote instances over local by id, preserving tab-local ephemeral / session-only fields. */
export function mergeRemoteInstances(
  remoteKept: ConnectedInstance[],
  local: ConnectedInstance[],
): ConnectedInstance[] {
  const localById = new Map(local.map((i) => [i.id, i]))
  const merged: ConnectedInstance[] = []
  for (const remote of remoteKept) {
    const prev = localById.get(remote.id)
    if (prev) {
      merged.push({
        ...remote,
        // Keep tab-local ephemeral / session-only fields (tokens live in vault;
        // in-memory copy must survive cross-tab metadata merges)
        isConnecting: prev.isConnecting,
        error: prev.isConnecting ? prev.error : remote.error,
        clientSecret: prev.clientSecret ?? remote.clientSecret,
        accessToken: prev.accessToken ?? remote.accessToken,
      })
    } else {
      merged.push(remote)
    }
  }
  return merged
}

/**
 * Never persist clientSecret or accessToken in the instances blob.
 * Tokens go to the dedicated vault (`neospace_tokens`) — see utils/tokenVault.ts.
 */
export function serializeInstancesPayload(state: {
  instances: ConnectedInstance[]
  activeInstanceFilter: string | null
  activeAccountId: string | null
  primaryAccountId: string | null
}) {
  return {
    v: STORAGE_VERSION,
    instances: state.instances.map((i) => ({
      ...i,
      clientSecret: null,
      accessToken: null,
      isConnecting: false,
      error: null,
    })),
    activeInstanceFilter: state.activeInstanceFilter,
    activeAccountId: state.activeAccountId,
    primaryAccountId: state.primaryAccountId,
  }
}

/** Build the token map for the vault from in-memory instances. */
export function tokensFromInstances(instances: ConnectedInstance[]): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const i of instances) {
    if (i.id && i.accessToken) tokens[i.id] = i.accessToken
  }
  return tokens
}

/**
 * Wipe LoomSpace local device data (drafts, settings, columns, etc.).
 * Does not revoke remote tokens.
 */
export function clearLocalDeviceStorage() {
  if (typeof localStorage === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && (k.startsWith('neospace') || k.startsWith('neo_'))) keys.push(k)
  }
  for (const k of keys) localStorage.removeItem(k)
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}
