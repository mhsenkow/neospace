/**
 * OAuth access tokens live in a dedicated localStorage key, not in the
 * instances metadata blob. In-memory ConnectedInstance.accessToken still
 * holds the token for the masto client factory; only persistence is isolated
 * so XSS that reads `neospace_instances` does not get bearer tokens.
 */

export const TOKEN_STORAGE_KEY = 'neospace_tokens'
export const TOKEN_STORAGE_VERSION = 1

type TokenVaultPayload = {
  v: number
  tokens: Record<string, string>
}

function readVault(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as TokenVaultPayload
    if (!parsed || typeof parsed !== 'object' || !parsed.tokens) return {}
    const out: Record<string, string> = {}
    for (const [id, tok] of Object.entries(parsed.tokens)) {
      if (typeof id === 'string' && typeof tok === 'string' && tok) out[id] = tok
    }
    return out
  } catch {
    return {}
  }
}

function writeVault(tokens: Record<string, string>) {
  if (typeof localStorage === 'undefined') return
  const clean: Record<string, string> = {}
  for (const [id, tok] of Object.entries(tokens)) {
    if (id && tok) clean[id] = tok
  }
  const payload: TokenVaultPayload = { v: TOKEN_STORAGE_VERSION, tokens: clean }
  try {
    if (Object.keys(clean).length === 0) localStorage.removeItem(TOKEN_STORAGE_KEY)
    else localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

/** Persist the current in-memory token map (instance id → access token). */
export function saveTokens(tokens: Record<string, string | null | undefined>) {
  const next: Record<string, string> = {}
  for (const [id, tok] of Object.entries(tokens)) {
    if (id && tok) next[id] = tok
  }
  writeVault(next)
}

/** Read stored tokens. */
export function loadTokens(): Record<string, string> {
  return readVault()
}

/**
 * One-shot migration: pull accessToken fields out of a legacy instances payload
 * into the vault, returning instances with tokens cleared for re-persist.
 */
export function migrateTokensFromInstances<T extends { id: string; accessToken?: string | null }>(
  instances: T[],
): { instances: T[]; tokens: Record<string, string>; migrated: boolean } {
  const existing = readVault()
  const tokens = { ...existing }
  let migrated = false
  const cleaned = instances.map((inst) => {
    if (inst.accessToken) {
      if (!tokens[inst.id]) {
        tokens[inst.id] = inst.accessToken
        migrated = true
      } else if (tokens[inst.id] !== inst.accessToken) {
        // Prefer the vault token if both exist; still strip the blob copy
        migrated = true
      } else {
        migrated = true
      }
      return { ...inst, accessToken: null }
    }
    return inst
  })
  if (migrated || Object.keys(existing).length === 0 && Object.keys(tokens).length > 0) {
    writeVault(tokens)
  }
  // Also treat "tokens only in vault already" as not needing blob rewrite unless we stripped
  return { instances: cleaned, tokens, migrated }
}

/** Apply vault tokens onto in-memory instances (blob has null accessToken). */
export function hydrateInstancesWithTokens<T extends { id: string; accessToken?: string | null }>(
  instances: T[],
  tokens: Record<string, string> = loadTokens(),
): T[] {
  return instances.map((inst) => {
    const tok = tokens[inst.id]
    if (!tok) return inst
    if (inst.accessToken === tok) return inst
    return { ...inst, accessToken: tok }
  })
}

export function clearTokenVault() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
