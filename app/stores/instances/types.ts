/**
 * Shared types for the instances store (re-exported from `~/stores/instances`).
 */

import type { mastodon } from 'masto'
import type { ConnectedInstanceInfo, InstanceApiInfo } from '~/utils/instanceInfo'

export interface ConnectedInstance {
  id: string
  url: string
  name: string
  accessToken: string | null
  clientId: string | null
  clientSecret: string | null
  user: mastodon.v1.Account | null
  instanceInfo: ConnectedInstanceInfo | null
  isConnecting: boolean
  error: string | null
  lastFetched: string | null
  /** Token revoked/expired — keep profile under Signed in until user re-auths */
  sessionExpired?: boolean
}

export interface ExtendedStatus extends mastodon.v1.Status {
  _instanceId: string
  _instanceUrl: string
}

export interface MultiInstanceState {
  instances: ConnectedInstance[]
  activeAccountId: string | null
  /** First / home identity for this LoomSpace session — other logins hang off it */
  primaryAccountId: string | null
  activeInstanceFilter: string | null
  isLoading: boolean
  isInitialized: boolean
  previewingInstance: string | null
  previewLoading: boolean
  previewError: string | null
  previewTimeline: mastodon.v1.Status[]
  previewInstanceInfo: Record<string, InstanceApiInfo>
  /** Shown when the active account changes after a token dies */
  authNotice: string | null
}
