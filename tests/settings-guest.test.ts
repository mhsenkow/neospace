import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useSettingsStore } from '../app/stores/settings'

const updateCredentials = vi.fn()
const mutesList = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  clientFor: () => ({
    v1: {
      accounts: { updateCredentials },
      mutes: { list: { $raw: mutesList } },
    },
  }),
  activeClient: () => ({
    v1: {
      accounts: { updateCredentials },
      mutes: { list: { $raw: mutesList } },
    },
  }),
  activeCredentials: vi.fn(),
  publicClient: vi.fn(),
}))

describe('guest settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const instances = useInstancesStore()
    instances.instances = [
      {
        id: 'watch',
        url: 'https://fosstodon.org',
        accessToken: null,
        user: null,
      } as never,
    ]
    instances.activeAccountId = 'watch'
    updateCredentials.mockReset()
    mutesList.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('loadSettings does not set an error when nobody is signed in', async () => {
    const settings = useSettingsStore()
    await settings.loadSettings()
    expect(settings.error).toBeNull()
    expect(settings.account).toBeNull()
    expect(settings.isLoading).toBe(false)
  })

  it('privacy list loads do not surface Not authenticated', async () => {
    const settings = useSettingsStore()
    await settings.loadMutedAccounts()
    await settings.loadBlockedAccounts()
    await settings.loadBlockedDomains()
    expect(settings.error).toBeNull()
    expect(mutesList).not.toHaveBeenCalled()
  })

  it('posting defaults skip the server when guest', async () => {
    const settings = useSettingsStore()
    await settings.updatePostingDefaults({ visibility: 'unlisted', sensitive: true })
    expect(updateCredentials).not.toHaveBeenCalled()
    expect(settings.error).toBeNull()
  })
})
