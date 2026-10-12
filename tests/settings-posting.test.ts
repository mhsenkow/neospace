import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { parsePostingOverrides, useSettingsStore } from '../app/stores/settings'

const updateCredentials = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  clientFor: () => ({ v1: { accounts: { updateCredentials } } }),
  activeClient: () => ({ v1: { accounts: { updateCredentials } } }),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
}))

const account = (id: string) =>
  ({ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }) as never

describe('posting defaults per account', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [account('a'), account('b')]
    instances.activeAccountId = 'a'
    updateCredentials.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('one account\'s save does not shadow another account\'s server default', async () => {
    const instances = useInstancesStore()
    const settings = useSettingsStore()
    settings.preferences = { 'posting:default:visibility': 'unlisted' } as never
    updateCredentials.mockResolvedValue({})
    await settings.updatePostingDefaults({ visibility: 'private', sensitive: true })
    expect(settings.defaultVisibility).toBe('private')
    expect(settings.defaultSensitive).toBe(true)

    instances.activeAccountId = 'b'
    settings.preferences = { 'posting:default:visibility': 'public' } as never
    expect(settings.defaultVisibility).toBe('public')
    expect(settings.defaultSensitive).toBe(false)

    instances.activeAccountId = 'a'
    expect(settings.defaultVisibility).toBe('private')
  })

  it('reports a failed server sync instead of "saved"', async () => {
    const settings = useSettingsStore()
    updateCredentials.mockRejectedValue(new Error('422'))
    await settings.updatePostingDefaults({ visibility: 'direct' })
    expect(settings.saveSuccess).toBe(false)
    expect(settings.error).toBe('Saved on this device only — couldn’t update your server')
    // Still honoured locally
    expect(settings.defaultVisibility).toBe('direct')
  })

  it('marks success and clears a stale error when the server accepts', async () => {
    const settings = useSettingsStore()
    settings.error = 'old'
    updateCredentials.mockResolvedValue({})
    await settings.updatePostingDefaults({ visibility: 'unlisted' })
    expect(settings.error).toBeNull()
    expect(settings.saveSuccess).toBe(true)
  })
})

describe('parsePostingOverrides', () => {
  it('keeps only valid entries', () => {
    expect(
      parsePostingOverrides({
        a: { visibility: 'private', sensitive: true },
        b: { visibility: 'bogus' },
        c: 'nope',
        d: { sensitive: 'yes' },
      }),
    ).toEqual({ a: { visibility: 'private', sensitive: true } })
    expect(parsePostingOverrides(null)).toEqual({})
    expect(parsePostingOverrides([1])).toEqual({})
  })
})
