/**
 * Instance metadata mapping — pure helpers split out of the instances store.
 */

import {
  detectServerCapabilities,
  type ServerCapabilities,
  type ServerMetadata,
} from '~/utils/serverCapabilities'

/** Cached per-account server limits / branding / capabilities (persisted with the account). */
export interface ConnectedInstanceInfo {
  title?: string
  thumbnail?: string
  description?: string
  /** From v2 instance configuration.statuses.max_characters */
  maxCharacters?: number
  /** From v2 instance configuration.accounts.max_profile_fields */
  maxProfileFields?: number
  maxMediaAttachments?: number
  imageSizeLimit?: number
  videoSizeLimit?: number
  mediaDescriptionLimit?: number
  /** Software + feature flags, detected once when the instance is probed */
  capabilities?: ServerCapabilities
}

/** Public (watch / explore) summary of a server. */
export interface InstanceApiInfo {
  title: string
  description: string
  stats?: {
    userCount?: number
    statusCount?: number
    domainCount?: number
  }
  registrations?: boolean
  registrationsUrl?: string | null
  languages?: string[]
  rules?: Array<{ id: string; text: string }>
}

export function mapV2InstanceInfo(info: {
  title: string
  description?: string | null
  usage?: { users?: { activeMonth?: number } | null } | null
  registrations?: { enabled?: boolean; url?: string | null } | null
  languages?: string[]
  rules?: Array<{ id: string; text: string }> | null
}): InstanceApiInfo {
  return {
    title: info.title,
    description: info.description || '',
    stats: {
      userCount: info.usage?.users?.activeMonth,
    },
    registrations: info.registrations?.enabled,
    registrationsUrl: info.registrations?.url ?? null,
    languages: info.languages,
    rules: info.rules?.map((r) => ({ id: r.id, text: r.text })),
  }
}

/** The slice of the v2 instance document stored on a connected account. */
export interface V2InstanceConfigSource extends ServerMetadata {
  title?: string
  description?: string | null
  thumbnail?: { url?: string | null } | null
  configuration?: ServerMetadata['configuration'] & {
    statuses?: { maxCharacters?: number; maxMediaAttachments?: number } | null
    accounts?: { maxProfileFields?: number } | null
    mediaAttachments?: {
      imageSizeLimit?: number
      videoSizeLimit?: number
      descriptionLimit?: number
    } | null
  } | null
}

/**
 * Map a v2 instance document to the cached per-account shape.
 * Pass `prev` on refresh so branding falls back to what we already knew.
 */
export function mapInstanceConfig(
  info: V2InstanceConfigSource,
  prev?: ConnectedInstanceInfo | null,
): ConnectedInstanceInfo {
  const cfg = info.configuration
  return {
    ...(prev || {}),
    title: info.title || prev?.title,
    thumbnail: info.thumbnail?.url || prev?.thumbnail,
    description: info.description || prev?.description,
    maxCharacters: cfg?.statuses?.maxCharacters,
    maxMediaAttachments: cfg?.statuses?.maxMediaAttachments,
    maxProfileFields: cfg?.accounts?.maxProfileFields,
    imageSizeLimit: cfg?.mediaAttachments?.imageSizeLimit,
    videoSizeLimit: cfg?.mediaAttachments?.videoSizeLimit,
    mediaDescriptionLimit: cfg?.mediaAttachments?.descriptionLimit,
    capabilities: detectServerCapabilities(info),
  }
}
