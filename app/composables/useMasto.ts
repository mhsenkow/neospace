/**
 * Mastodon/GoToSocial API Client Composable
 * 
 * Provides a configured masto client for interacting with the fediverse.
 * Works with GoToSocial, Mastodon, Pleroma, and other compatible backends.
 */

import { createRestAPIClient, type mastodon } from 'masto'

// Re-export types for convenience
export type { mastodon }

export interface MastoConfig {
  instanceUrl: string
  accessToken?: string
}

// Store the client instance
let mastoClient: mastodon.rest.Client | null = null
let currentConfig: MastoConfig | null = null

/**
 * Create or retrieve the Mastodon API client
 */
export function useMasto() {
  const config = useRuntimeConfig()
  
  /**
   * Initialize the client with instance URL and optional access token
   */
  const initClient = (instanceUrl: string, accessToken?: string) => {
    // Only recreate if config changed
    if (
      mastoClient && 
      currentConfig?.instanceUrl === instanceUrl && 
      currentConfig?.accessToken === accessToken
    ) {
      return mastoClient
    }

    currentConfig = { instanceUrl, accessToken }
    
    mastoClient = createRestAPIClient({
      url: instanceUrl,
      accessToken: accessToken,
    })

    return mastoClient
  }

  /**
   * Get the current client (throws if not initialized)
   */
  const getClient = (): mastodon.rest.Client => {
    if (!mastoClient) {
      throw new Error('Mastodon client not initialized. Call initClient first.')
    }
    return mastoClient
  }

  /**
   * Check if client is initialized and authenticated
   */
  const isAuthenticated = (): boolean => {
    return !!mastoClient && !!currentConfig?.accessToken
  }

  /**
   * Clear the client (for logout)
   */
  const clearClient = () => {
    mastoClient = null
    currentConfig = null
  }

  /**
   * Get instance information (public, no auth required)
   */
  const getInstanceInfo = async (instanceUrl: string) => {
    const client = createRestAPIClient({ url: instanceUrl })
    return await client.v2.instance.fetch()
  }

  return {
    initClient,
    getClient,
    isAuthenticated,
    clearClient,
    getInstanceInfo,
  }
}

