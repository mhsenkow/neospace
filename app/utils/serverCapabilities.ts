/**
 * Server capabilities — one model, derived once from instance metadata.
 *
 * Mastodon-compatible servers share a core API, but scheduling, polls, search
 * and the web settings pages differ (GoToSocial, Akkoma/Pleroma, Pixelfed…).
 * Detection is conservative: anything unrecognised is `unknown`, which the UI
 * treats as "show it, but handle API errors" and never invents settings URLs.
 */

export type ServerSoftware =
  | 'mastodon'
  | 'gotosocial'
  | 'akkoma'
  | 'pleroma'
  | 'pixelfed'
  | 'unknown'

/** `unknown` = metadata can't tell us; features stay visible, failures are handled at call time */
export type FeatureSupport = 'yes' | 'no' | 'unknown'

export type SettingsTopic = 'notifications' | 'filters' | 'account' | 'export'

export interface ServerCapabilities {
  software: ServerSoftware
  version: string | null
  scheduledStatuses: FeatureSupport
  polls: FeatureSupport
  customEmojis: FeatureSupport
  /** v2 search `type=hashtags` */
  hashtagSearch: FeatureSupport
  translation: FeatureSupport
  /** Web settings pages (path on the server) — absent topics have no known destination */
  settingsPaths: Partial<Record<SettingsTopic, string>>
}

/** The subset of the v2 instance document detection reads (masto camelCase). */
export interface ServerMetadata {
  version?: string | null
  sourceUrl?: string | null
  configuration?: {
    polls?: { maxOptions?: number | null } | null
    translation?: { enabled?: boolean | null } | null
  } | null
}

export const UNKNOWN_CAPABILITIES: ServerCapabilities = Object.freeze({
  software: 'unknown',
  version: null,
  scheduledStatuses: 'unknown',
  polls: 'unknown',
  customEmojis: 'unknown',
  hashtagSearch: 'unknown',
  translation: 'unknown',
  settingsPaths: Object.freeze({}),
}) as ServerCapabilities

type Matrix = Omit<ServerCapabilities, 'software' | 'version'>

const MATRIX: Record<ServerSoftware, Matrix> = {
  mastodon: {
    scheduledStatuses: 'yes',
    polls: 'yes',
    customEmojis: 'yes',
    hashtagSearch: 'yes',
    translation: 'unknown',
    settingsPaths: {
      notifications: '/settings/notifications',
      filters: '/settings/filters',
      account: '/settings',
      export: '/settings/export',
    },
  },
  gotosocial: {
    scheduledStatuses: 'unknown',
    polls: 'yes',
    customEmojis: 'yes',
    hashtagSearch: 'yes',
    translation: 'no',
    // Only the settings root is stable across GoToSocial releases
    settingsPaths: { account: '/settings', export: '/settings' },
  },
  akkoma: {
    scheduledStatuses: 'yes',
    polls: 'yes',
    customEmojis: 'yes',
    hashtagSearch: 'yes',
    translation: 'unknown',
    // Frontend-owned routes (Pleroma-FE / Akkoma-FE)
    settingsPaths: { account: '/settings' },
  },
  pleroma: {
    scheduledStatuses: 'yes',
    polls: 'yes',
    customEmojis: 'yes',
    hashtagSearch: 'yes',
    translation: 'no',
    settingsPaths: { account: '/settings' },
  },
  pixelfed: {
    scheduledStatuses: 'no',
    polls: 'no',
    customEmojis: 'unknown',
    hashtagSearch: 'unknown',
    translation: 'no',
    settingsPaths: { account: '/settings/home' },
  },
  unknown: {
    scheduledStatuses: 'unknown',
    polls: 'unknown',
    customEmojis: 'unknown',
    hashtagSearch: 'unknown',
    translation: 'unknown',
    settingsPaths: {},
  },
}

/** Identify the server software from the version string / source URL. */
export function detectServerSoftware(
  version?: string | null,
  sourceUrl?: string | null,
): ServerSoftware {
  const v = (version || '').toLowerCase()
  const src = (sourceUrl || '').toLowerCase()
  const hay = `${v} ${src}`

  // Pleroma-compatible builds report "2.7.2 (compatible; Akkoma 3.x)" — check the
  // compat tag before anything that looks like a plain semver.
  if (hay.includes('akkoma')) return 'akkoma'
  if (hay.includes('pleroma')) return 'pleroma'
  if (hay.includes('gotosocial')) return 'gotosocial'
  if (hay.includes('pixelfed')) return 'pixelfed'
  if (/\bcompatible;/.test(v)) return 'unknown'
  if (/\+(glitch|hometown|chuckya)\b/.test(v) || src.includes('mastodon')) return 'mastodon'
  // A bare semver with no source URL is ambiguous (Friendica, Sharkey, hand-rolled
  // compatibles all report one) — stay `unknown` rather than enabling Mastodon-only behavior.
  return 'unknown'
}

function flag(value: boolean | null | undefined): FeatureSupport {
  if (value === true) return 'yes'
  if (value === false) return 'no'
  return 'unknown'
}

/** Derive capabilities once (at probe time) from the v2 instance document. */
export function detectServerCapabilities(meta: ServerMetadata | null | undefined): ServerCapabilities {
  if (!meta) return UNKNOWN_CAPABILITIES
  const software = detectServerSoftware(meta.version, meta.sourceUrl)
  const base = MATRIX[software]
  const caps: ServerCapabilities = {
    software,
    version: meta.version?.trim() || null,
    ...base,
    settingsPaths: { ...base.settingsPaths },
  }

  // Explicit metadata beats the per-software matrix
  const maxPollOptions = meta.configuration?.polls?.maxOptions
  if (typeof maxPollOptions === 'number') caps.polls = maxPollOptions > 0 ? 'yes' : 'no'
  const translation = meta.configuration?.translation?.enabled
  if (typeof translation === 'boolean') caps.translation = flag(translation)
  return caps
}

/** Only hide a control when the server positively lacks the feature */
export function isFeatureAvailable(support: FeatureSupport): boolean {
  return support !== 'no'
}

/** Full URL to a web settings page, or null when there is no known destination. */
export function serverSettingsUrl(
  caps: ServerCapabilities,
  baseUrl: string | null | undefined,
  topic: SettingsTopic,
): string | null {
  const path = caps.settingsPaths[topic]
  if (!path || !baseUrl) return null
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * Mastodon 4.2 added the `legal` report category; older Mastodon rejects it, and other
 * software doesn't document it — so it's offered only when the version proves support.
 */
export function supportsLegalReports(caps: Pick<ServerCapabilities, 'software' | 'version'>): boolean {
  if (caps.software !== 'mastodon' || !caps.version) return false
  const m = /^(\d+)\.(\d+)/.exec(caps.version.trim())
  if (!m) return false
  const major = Number(m[1])
  const minor = Number(m[2])
  return major > 4 || (major === 4 && minor >= 2)
}
