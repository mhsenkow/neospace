/**
 * Directory / preview helpers: bounded remote instance-info cache and preview map eviction.
 */

import type { InstanceApiInfo } from '~/utils/instanceInfo'

/** Directory / preview / add-server probes — masto has no default timeout */
export const PEEK_TIMEOUT_MS = 8_000

export const INSTANCE_INFO_TTL_MS = 10 * 60_000
export const INSTANCE_INFO_FAIL_TTL_MS = 120_000

export type InstanceInfoCacheEntry = { at: number; ok: boolean; value: InstanceApiInfo | null }
const instanceInfoRemoteCache = new Map<string, InstanceInfoCacheEntry>()
/** Explore / directory browsing can touch hundreds of hosts — keep both caches bounded */
const INSTANCE_INFO_CACHE_MAX = 200
const PREVIEW_INFO_MAX = 60

export function rememberRemoteInstanceInfo(key: string, entry: InstanceInfoCacheEntry) {
  instanceInfoRemoteCache.delete(key)
  instanceInfoRemoteCache.set(key, entry)
  while (instanceInfoRemoteCache.size > INSTANCE_INFO_CACHE_MAX) {
    const oldest = instanceInfoRemoteCache.keys().next().value
    if (oldest === undefined) break
    instanceInfoRemoteCache.delete(oldest)
  }
}

export const readRemoteInstanceInfo = (key: string) => instanceInfoRemoteCache.get(key)

/** Insert into the reactive preview map, evicting the oldest hosts past the cap */
export function rememberPreviewInfo(
  map: Record<string, InstanceApiInfo>,
  key: string,
  info: InstanceApiInfo,
) {
  delete map[key]
  map[key] = info
  const keys = Object.keys(map)
  for (let i = 0; i < keys.length - PREVIEW_INFO_MAX; i++) delete map[keys[i]!]
}
