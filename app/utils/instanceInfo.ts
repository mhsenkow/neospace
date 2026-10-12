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
  /** configuration.statuses.characters_reserved_per_url; null = server counts URLs in full */
  urlWeight?: number | null
  /** From v2 instance configuration.accounts.max_profile_fields */
  maxProfileFields?: number
  maxMediaAttachments?: number
  imageSizeLimit?: number
  videoSizeLimit?: number
  mediaDescriptionLimit?: number
  /** From configuration.polls — raw advertised values, validated by `pollLimitsFrom` */
  polls?: {
    maxOptions?: number
    maxCharactersPerOption?: number
    minExpiration?: number
    maxExpiration?: number
  }
  /** Software + feature flags, detected once when the instance is probed */
  capabilities?: ServerCapabilities
  /** When capabilities/limits were last mapped from /api/v2/instance */
  capabilitiesProbedAt?: number
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
  /** Sign-ups exist but an admin must approve each one */
  approvalRequired?: boolean
  registrationsUrl?: string | null
  languages?: string[]
  rules?: Array<{ id: string; text: string }>
}

export function mapV2InstanceInfo(info: {
  title: string
  description?: string | null
  usage?: { users?: { activeMonth?: number } | null } | null
  registrations?: { enabled?: boolean; approvalRequired?: boolean; url?: string | null } | null
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
    approvalRequired: info.registrations?.approvalRequired || undefined,
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
    statuses?: {
      maxCharacters?: number
      maxMediaAttachments?: number
      charactersReservedPerUrl?: number | null
    } | null
    accounts?: { maxProfileFields?: number } | null
    polls?: {
      maxOptions?: number
      maxCharactersPerOption?: number
      minExpiration?: number
      maxExpiration?: number
    } | null
    mediaAttachments?: {
      imageSizeLimit?: number
      videoSizeLimit?: number
      descriptionLimit?: number
    } | null
  } | null
}

/** Poll constraints the composer enforces (server-advertised, else Mastodon's defaults) */
export interface PollLimits {
  maxOptions: number
  maxCharactersPerOption: number
  minExpiration: number
  maxExpiration: number
}

export const DEFAULT_POLL_LIMITS: PollLimits = {
  maxOptions: 4,
  maxCharactersPerOption: 50,
  minExpiration: 5 * 60,
  maxExpiration: 30 * 24 * 60 * 60,
}

const inRange = (n: unknown, lo: number, hi: number): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi

/** Validate advertised poll metadata field by field — junk falls back to the default, never throws */
export function pollLimitsFrom(polls: ConnectedInstanceInfo['polls'] | null | undefined): PollLimits {
  const d = DEFAULT_POLL_LIMITS
  const maxOptions = inRange(polls?.maxOptions, 2, 20) ? Math.floor(polls!.maxOptions!) : d.maxOptions
  const maxChars = inRange(polls?.maxCharactersPerOption, 1, 500)
    ? Math.floor(polls!.maxCharactersPerOption!)
    : d.maxCharactersPerOption
  let min = inRange(polls?.minExpiration, 1, 365 * 86400) ? Math.floor(polls!.minExpiration!) : d.minExpiration
  let max = inRange(polls?.maxExpiration, 1, 3650 * 86400) ? Math.floor(polls!.maxExpiration!) : d.maxExpiration
  // Contradictory bounds → trust neither
  if (min > max) {
    min = d.minExpiration
    max = d.maxExpiration
  }
  return { maxOptions, maxCharactersPerOption: maxChars, minExpiration: min, maxExpiration: max }
}

/**
 * Per-URL character cost: the server's reported value, else Mastodon's 23, else
 * `null` (full length) for software known to count links in full.
 */
export function urlWeightFor(
  reserved: number | null | undefined,
  software: ServerCapabilities['software'],
): number | null {
  if (typeof reserved === 'number' && Number.isFinite(reserved) && reserved >= 0) return reserved
  if (software === 'gotosocial' || software === 'akkoma' || software === 'pleroma') return null
  return 23
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
  const capabilities = detectServerCapabilities(info)
  return {
    ...(prev || {}),
    title: info.title || prev?.title,
    thumbnail: info.thumbnail?.url || prev?.thumbnail,
    description: info.description || prev?.description,
    // A refresh that omits a limit keeps what we already knew (never silently resets to defaults)
    maxCharacters: cfg?.statuses?.maxCharacters ?? prev?.maxCharacters,
    maxMediaAttachments: cfg?.statuses?.maxMediaAttachments ?? prev?.maxMediaAttachments,
    urlWeight: urlWeightFor(cfg?.statuses?.charactersReservedPerUrl, capabilities.software),
    maxProfileFields: cfg?.accounts?.maxProfileFields ?? prev?.maxProfileFields,
    imageSizeLimit: cfg?.mediaAttachments?.imageSizeLimit ?? prev?.imageSizeLimit,
    videoSizeLimit: cfg?.mediaAttachments?.videoSizeLimit ?? prev?.videoSizeLimit,
    mediaDescriptionLimit: cfg?.mediaAttachments?.descriptionLimit ?? prev?.mediaDescriptionLimit,
    polls: cfg?.polls
      ? {
          maxOptions: cfg.polls.maxOptions ?? prev?.polls?.maxOptions,
          maxCharactersPerOption:
            cfg.polls.maxCharactersPerOption ?? prev?.polls?.maxCharactersPerOption,
          minExpiration: cfg.polls.minExpiration ?? prev?.polls?.minExpiration,
          maxExpiration: cfg.polls.maxExpiration ?? prev?.polls?.maxExpiration,
        }
      : prev?.polls,
    capabilities,
    capabilitiesProbedAt: Date.now(),
  }
}
