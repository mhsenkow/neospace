import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useInstancesStore } from '../app/stores/instances'
import { useGroupsStore, isOfferableGroupTag } from '../app/stores/groups'
import { formatTagAsName } from '../app/utils/tagName'
import { guessCategory } from '../app/utils/guessCategory'
import { tagIsFiltered } from '../app/utils/tagFilters'
import { joinGroupFailure } from '../app/utils/groupErrors'

const client = {
  follow: vi.fn(),
  unfollow: vi.fn(),
  followed: vi.fn(),
  trends: vi.fn(),
  tagPage: vi.fn(),
  search: vi.fn(),
}

const fake = () => ({
  v1: {
    tags: { $select: (name: string) => ({ follow: () => client.follow(name), unfollow: () => client.unfollow(name) }) },
    followedTags: { list: { $raw: () => client.followed() } },
    trends: { tags: { list: () => client.trends() } },
    timelines: { tag: { $select: () => ({ list: { $raw: (p: unknown) => client.tagPage(p) } }) } },
  },
  v2: { search: { list: () => client.search() } },
})

vi.mock('~/composables/useMasto', () => ({
  activeClient: () => fake(),
  publicClient: () => fake(),
  clientFor: () => fake(),
  activeCredentials: vi.fn(),
}))

const raw = <T>(data: T, link?: string) => ({ data, headers: new Headers(link ? { link } : {}) })
const tag = (name: string) => ({ name, url: `https://x/tags/${name}`, history: [{ uses: '5', accounts: '3' }] })
const deferred = <T>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const signIn = (id: string) => {
  const instances = useInstancesStore()
  instances.instances = [{ id, url: `https://${id}.example`, accessToken: `tok-${id}`, user: { id, acct: id } }] as never
  instances.activeAccountId = id
}

describe('groups store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    Object.values(client).forEach((m) => m.mockReset())
    client.followed.mockResolvedValue(raw([]))
    client.trends.mockResolvedValue([])
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    signIn('a')
  })

  it('applies the newest Join/Leave click when they are fired close together', async () => {
    const groups = useGroupsStore()
    const gate = deferred<{ name: string }>()
    const order: string[] = []
    client.follow.mockImplementation(async () => {
      order.push('follow:start')
      const r = await gate.promise
      order.push('follow:end')
      return r
    })
    client.unfollow.mockImplementation(async () => {
      order.push('unfollow')
    })
    const join = groups.joinGroup('cats')
    const leave = groups.leaveGroup('cats')
    // Leave is optimistic immediately; the server calls stay in click order
    expect(groups.getGroup('cats')?.isMember ?? false).toBe(false)
    gate.resolve({ name: 'cats' })
    await Promise.all([join, leave])
    expect(order).toEqual(['follow:start', 'follow:end', 'unfollow'])
    expect(groups.getGroup('cats')?.isMember ?? false).toBe(false)
    expect(groups.followedTags.some((t) => t.name === 'cats')).toBe(false)
    expect(groups.isTagPending('cats')).toBe(false)
  })

  it('rolls an optimistic join back when the server refuses', async () => {
    const groups = useGroupsStore()
    client.follow.mockRejectedValue(Object.assign(new Error('nope'), { status: 500 }))
    await expect(groups.joinGroup('tech')).rejects.toThrow()
    expect(groups.getGroup('tech')?.isMember ?? false).toBe(false)
    expect(groups.isTagPending('tech')).toBe(false)
  })

  it('files a followed tag under its guessed category', async () => {
    const groups = useGroupsStore()
    client.followed.mockResolvedValue(raw([tag('LinuxGaming')]))
    await groups.fetchFollowedTags()
    expect(groups.getGroup('LinuxGaming')?.isMember).toBe(true)
    expect(groups.getGroup('LinuxGaming')?.category).toBe('tech')
  })

  it('stops showing tags that dropped off the server trends', async () => {
    const groups = useGroupsStore()
    client.trends.mockResolvedValue([tag('oldnews'), tag('stayer')])
    await groups.initializeGroups(true)
    expect(groups.trendingGroups.map((g) => g.tag)).toEqual(['oldnews', 'stayer'])
    client.trends.mockResolvedValue([tag('stayer')])
    await groups.initializeGroups(true)
    expect(groups.trendingGroups.map((g) => g.tag)).toEqual(['stayer'])
    expect(groups.getGroup('oldnews')).toBeUndefined()
    expect(groups.trendingHost).toBe('a.example')
  })

  it('hides trending tags a whole-word filter covers, but not look-alikes', async () => {
    const groups = useGroupsStore()
    const { useSettingsStore } = await import('../app/stores/settings')
    useSettingsStore().filters = [
      { context: ['public'], keywords: [{ keyword: 'ai', wholeWord: true }] },
    ] as never
    client.trends.mockResolvedValue([tag('ai'), tag('rain'), tag('taiwan')])
    await groups.initializeGroups(true)
    expect(groups.trendingGroups.map((g) => g.tag).sort()).toEqual(['rain', 'taiwan'])
  })

  it('forgets the previous account’s joins on switch', async () => {
    const groups = useGroupsStore()
    client.followed.mockResolvedValue(raw([tag('mine'), tag('fediverse')]))
    await groups.initializeGroups(true)
    expect(groups.getGroup('mine')?.isMember).toBe(true)
    expect(groups.getGroup('fediverse')?.isMember).toBe(true)

    client.followed.mockResolvedValue(raw([]))
    signIn('b')
    await groups.resetForAccountSwitch()
    expect(groups.getGroup('mine')).toBeUndefined()
    expect(groups.getGroup('fediverse')?.isMember).toBe(false)
    expect(groups.followedTags).toEqual([])
  })

  it('surfaces a failed search instead of faking a "Start following" card', async () => {
    const groups = useGroupsStore()
    client.search.mockRejectedValue(new Error('offline'))
    await expect(groups.searchGroups('baking')).rejects.toThrow('offline')
    client.search.mockResolvedValue({ hashtags: [] })
    const res = await groups.searchGroups('baking')
    expect(res[0]?.description).toBe('Start following #baking')
  })

  it('offers non-ASCII tags but not bare numbers', () => {
    expect(isOfferableGroupTag('日本')).toBe(true)
    expect(isOfferableGroupTag('café')).toBe(true)
    expect(isOfferableGroupTag('100DaysOfCode')).toBe(true)
    expect(isOfferableGroupTag('2024')).toBe(false)
    expect(isOfferableGroupTag('a/b')).toBe(false)
  })

  it('follows the Link header, not page length, for group timelines', async () => {
    const groups = useGroupsStore()
    const s = (id: string) => ({ id })
    // Short page, but the server says there is more
    client.tagPage.mockResolvedValueOnce(
      raw([s('9'), s('8'), s('7')], '<https://a.example/api/v1/timelines/tag/x?max_id=7>; rel="next"'),
    )
    await groups.fetchGroupTimeline('x', true)
    expect(groups.hasMore).toBe(true)
    expect(groups.maxId).toBe('7')
    // Full-looking page with no next link is the end
    client.tagPage.mockResolvedValueOnce(raw([s('6')], '<https://a.example/x?min_id=9>; rel="prev"'))
    await groups.loadMoreTimeline()
    expect(client.tagPage.mock.calls[1]![0]).toMatchObject({ maxId: '7' })
    expect(groups.hasMore).toBe(false)
    expect(groups.groupTimeline.map((x) => x.id)).toEqual(['9', '8', '7', '6'])
  })

  it('keeps a timeline error when a background init runs', async () => {
    const groups = useGroupsStore()
    client.tagPage.mockRejectedValue(new Error('boom'))
    await groups.fetchGroupTimeline('x', true)
    expect(groups.timelineError).toBe('boom')
    await groups.initializeGroups(true)
    expect(groups.timelineError).toBe('boom')
  })
})

describe('tag names and categories', () => {
  it('keeps names that merely contain a capital', () => {
    expect(formatTagAsName('NixOS')).toBe('NixOS')
    expect(formatTagAsName('JavaScript')).toBe('JavaScript')
    expect(formatTagAsName('TikTok')).toBe('TikTok')
    expect(formatTagAsName('iPhone')).toBe('iPhone')
    expect(formatTagAsName('macOS')).toBe('macOS')
    expect(formatTagAsName('LGBTQ')).toBe('LGBTQ')
  })

  it('still splits obvious compounds and snake_case', () => {
    expect(formatTagAsName('CatsOfMastodon')).toBe('Cats Of Mastodon')
    expect(formatTagAsName('mental_health')).toBe('Mental Health')
    expect(formatTagAsName('photography')).toBe('Photography')
  })

  it('buckets camelCase and digit-joined tags', () => {
    expect(guessCategory('CatsOfMastodon')).not.toBe('other')
    expect(guessCategory('DogWalks')).toBe('social')
    expect(guessCategory('LinuxGaming')).toBe('tech')
    expect(guessCategory('IndieDev')).toBe('other')
    expect(guessCategory('education')).toBe('other')
  })
})

describe('tagIsFiltered', () => {
  const f = (keywords: { keyword: string; wholeWord?: boolean }[], over = {}) => [{ context: ['public'], keywords, ...over }]

  it('honours wholeWord, expiry and context', () => {
    expect(tagIsFiltered('rain', f([{ keyword: 'ai', wholeWord: true }]))).toBe(false)
    expect(tagIsFiltered('rain', f([{ keyword: 'ai', wholeWord: false }]))).toBe(true)
    expect(tagIsFiltered('AI_art', f([{ keyword: 'ai', wholeWord: true }]))).toBe(true)
    expect(tagIsFiltered('x', f([{ keyword: 'x' }], { expiresAt: '2000-01-01T00:00:00Z' }))).toBe(false)
    expect(tagIsFiltered('x', f([{ keyword: 'x' }], { context: ['home'] }))).toBe(false)
  })
})

describe('joinGroupFailure', () => {
  it('stops offering Retry where it cannot work', () => {
    expect(joinGroupFailure({ status: 404 })).toMatchObject({ retryable: false })
    expect(joinGroupFailure({ status: 501 }).message).toMatch(/doesn’t support following hashtags/)
    expect(joinGroupFailure({ status: 429 }).message).toMatch(/Slow down/)
    expect(joinGroupFailure(new Error('network'))).toMatchObject({ retryable: true })
  })
})
