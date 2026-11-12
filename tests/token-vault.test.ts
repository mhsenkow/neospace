/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  TOKEN_STORAGE_KEY,
  clearTokenVault,
  hydrateInstancesWithTokens,
  loadTokens,
  migrateTokensFromInstances,
  saveTokens,
} from '../app/utils/tokenVault'
import { serializeInstancesPayload } from '../app/stores/instances/persistence'

describe('token vault', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists and loads tokens by instance id', () => {
    saveTokens({ a: 'tok-a', b: 'tok-b', c: null })
    expect(loadTokens()).toEqual({ a: 'tok-a', b: 'tok-b' })
    const raw = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY)!)
    expect(raw.v).toBe(1)
    expect(raw.tokens).toEqual({ a: 'tok-a', b: 'tok-b' })
  })

  it('migrates embedded accessToken fields into the vault and clears them', () => {
    const instances = [
      { id: '1', accessToken: 'secret-1', url: 'https://a.example' },
      { id: '2', accessToken: null, url: 'https://b.example' },
    ]
    const { instances: cleaned, tokens, migrated } = migrateTokensFromInstances(instances)
    expect(migrated).toBe(true)
    expect(cleaned[0]!.accessToken).toBeNull()
    expect(tokens['1']).toBe('secret-1')
    expect(loadTokens()['1']).toBe('secret-1')
  })

  it('hydrates in-memory instances from the vault', () => {
    saveTokens({ '1': 'vault-tok' })
    const hydrated = hydrateInstancesWithTokens([
      { id: '1', accessToken: null },
      { id: '2', accessToken: null },
    ])
    expect(hydrated[0]!.accessToken).toBe('vault-tok')
    expect(hydrated[1]!.accessToken).toBeNull()
  })

  it('serializeInstancesPayload never writes accessToken into the blob', () => {
    const payload = serializeInstancesPayload({
      instances: [
        {
          id: '1',
          url: 'https://a.example',
          accessToken: 'must-not-persist',
          clientSecret: 'also-secret',
          user: null,
          name: 'A',
          clientId: null,
          instanceInfo: null,
          isConnecting: true,
          error: 'x',
          lastFetched: null,
        } as never,
      ],
      activeInstanceFilter: null,
      activeAccountId: '1',
      primaryAccountId: '1',
    })
    expect(payload.instances[0]!.accessToken).toBeNull()
    expect(payload.instances[0]!.clientSecret).toBeNull()
    expect(JSON.stringify(payload)).not.toContain('must-not-persist')
  })

  it('clearTokenVault removes the key', () => {
    saveTokens({ a: 'x' })
    clearTokenVault()
    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull()
  })
})
