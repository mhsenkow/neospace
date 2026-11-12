import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useProfileStore } from '../app/stores/profile'

const fetchAccount = vi.fn()
const listStatuses = vi.fn()
const verifyCredentials = vi.fn()
const lookup = vi.fn()
const search = vi.fn()

vi.mock('~/composables/useMasto', () => ({
  activeClient: () => ({
    v1: {
      accounts: {
        verifyCredentials: () => verifyCredentials(),
        lookup: (p: unknown) => lookup(p),
        $select: (id: string) => ({
          fetch: () => fetchAccount(id),
          statuses: {
            list: (opts: unknown) => listStatuses(id, opts),
          },
        }),
      },
    },
    v2: { search: { list: (p: unknown) => search(p) } },
  }),
  activeCredentials: () => ({ url: 'https://home.example', accessToken: 'tok' }),
  readAccountOverride: () => null,
  publicClient: () => ({}),
  clientFor: () => ({}),
}))

const account = (id: string, acct = id) =>
  ({
    id,
    acct,
    username: acct.split('@')[0],
    displayName: acct,
    note: '<p>bio</p>',
    fields: [],
    avatar: '',
    header: '',
    locked: false,
    bot: false,
    discoverable: true,
    createdAt: '2020-01-01T00:00:00.000Z',
  }) as never

describe('profile store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    ;[fetchAccount, listStatuses, verifyCredentials, lookup, search].forEach((m) => m.mockReset())
    listStatuses.mockResolvedValue([])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const instances = useInstancesStore()
    instances.instances = [
      {
        id: 'a',
        url: 'https://home.example',
        accessToken: 'tok',
        user: account('a', 'neo'),
      },
    ] as never
    instances.activeAccountId = 'a'
  })

  it('setViewedProfile seeds the edit form from stripped bio HTML', () => {
    const profile = useProfileStore()
    profile.setViewedProfile({
      ...account('42', 'alice'),
      note: '<p>Hello <strong>world</strong></p>',
      fields: [{ name: 'site', value: '<a href="https://x">x</a>', verifiedAt: null }],
    } as never)
    expect(profile.editForm.displayName).toBe('alice')
    expect(profile.editForm.note).not.toMatch(/<p>/)
    expect(profile.editForm.note).toContain('Hello')
  })

  it('fetchProfile loads account + statuses and clears loading', async () => {
    const profile = useProfileStore()
    fetchAccount.mockResolvedValue(account('42', 'alice'))
    listStatuses.mockResolvedValue([{ id: 's1', content: 'hi', account: account('42', 'alice') }])
    await profile.fetchProfile('42')
    expect(profile.viewedProfile?.acct).toBe('alice')
    expect(profile.isLoading).toBe(false)
    expect(profile.error).toBeNull()
    expect(listStatuses).toHaveBeenCalled()
  })

  it('stale fetchProfile responses do not overwrite newer state', async () => {
    const profile = useProfileStore()
    let resolveFirst!: (v: unknown) => void
    const first = new Promise((r) => {
      resolveFirst = r
    })
    fetchAccount.mockImplementationOnce(() => first)
    fetchAccount.mockResolvedValueOnce(account('2', 'second'))
    listStatuses.mockResolvedValue([])

    const slow = profile.fetchProfile('1')
    await profile.fetchProfile('2')
    resolveFirst(account('1', 'first'))
    await slow

    expect(profile.viewedProfile?.acct).toBe('second')
  })

  it('isOwnProfile compares against the active account', () => {
    const profile = useProfileStore()
    profile.setViewedProfile(account('a', 'neo') as never)
    expect(profile.isOwnProfile).toBe(true)
    profile.setViewedProfile(account('other', 'bob') as never)
    expect(profile.isOwnProfile).toBe(false)
  })
})
