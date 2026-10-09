/**
 * What Explore shows before you type — per tab, from the server that answers
 * searches (active account, or the public browsing host for guests).
 *
 * - All:    trending tags + trending links (news)
 * - People: follow suggestions (signed in) or the server's active directory
 * - Posts:  trending posts
 * - Tags:   trending tags + tags you follow
 *
 * Each slice loads lazily the first time its tab needs it and is cached per
 * server for a few minutes.
 */

import type { mastodon } from 'masto'
import { ref, type Ref } from 'vue'
import { activeClient, activeCredentials, publicClient } from '~/composables/useMasto'
import { resolvePublicInstanceUrl } from '~/utils/instances'
import { useInstancesStore } from '~/stores/instances'
import type { ExploreSearchTab } from '~/composables/useFediverseSearch'

const TTL_MS = 5 * 60_000

type Slice = 'tags' | 'links' | 'posts' | 'people' | 'followedTags'

const memo = new Map<string, { at: number; value: unknown }>()

export function useSearchDiscovery(opts: { isSignedIn: Ref<boolean> }) {
  const instancesStore = useInstancesStore()

  const trendingTags = ref<mastodon.v1.Tag[]>([])
  const trendingLinks = ref<mastodon.v1.TrendLink[]>([])
  const trendingPosts = ref<mastodon.v1.Status[]>([])
  const suggestedPeople = ref<mastodon.v1.Account[]>([])
  const followedTagList = ref<mastodon.v1.Tag[]>([])
  /** "Suggested for you" vs "Active on host" */
  const peopleSource = ref<'suggestions' | 'directory'>('directory')
  const sourceHost = ref('')
  const loading = ref<Set<Slice>>(new Set())

  const source = () => {
    if (opts.isSignedIn.value) {
      try {
        const { url } = activeCredentials()
        return { client: activeClient(), url, guest: false }
      } catch {
        // Signed in elsewhere, but the active account is watch-only — search as a guest
      }
    }
    const url = resolvePublicInstanceUrl(instancesStore.activeAccount?.url)
    return { client: publicClient(url), url, guest: true }
  }

  const fetchSlice = async <T>(slice: Slice, fn: (src: ReturnType<typeof source>) => Promise<T>, apply: (v: T) => void) => {
    let src: ReturnType<typeof source>
    try {
      src = source()
    } catch {
      return
    }
    sourceHost.value = new URL(src.url).hostname
    const key = `${src.url}|${src.guest ? 'g' : 'u'}|${slice}`
    const hit = memo.get(key)
    if (hit && Date.now() - hit.at < TTL_MS) {
      apply(hit.value as T)
      return
    }
    loading.value = new Set([...loading.value, slice])
    try {
      const value = await fn(src)
      memo.set(key, { at: Date.now(), value })
      apply(value)
    } catch {
      // Discovery is garnish — some servers disable trends or the directory
    } finally {
      const next = new Set(loading.value)
      next.delete(slice)
      loading.value = next
    }
  }

  const withOrigin = (list: mastodon.v1.Status[], url: string) =>
    list.map((s) => ({ ...s, _instanceUrl: url }) as mastodon.v1.Status)

  const loadTags = () =>
    fetchSlice('tags', async ({ client }) => await client.v1.trends.tags.list({ limit: 12 }), (v) => (trendingTags.value = v))

  const loadLinks = () =>
    fetchSlice('links', async ({ client }) => await client.v1.trends.links.list({ limit: 6 }), (v) => (trendingLinks.value = v))

  const loadPosts = () =>
    fetchSlice(
      'posts',
      async ({ client, url }) => withOrigin(await client.v1.trends.statuses.list({ limit: 12 }), url),
      (v) => (trendingPosts.value = v),
    )

  const loadPeople = () =>
    fetchSlice(
      'people',
      async ({ client, guest }) => {
        if (!guest) {
          try {
            const list = await client.v2.suggestions.list({ limit: 12 })
            if (list.length) return { from: 'suggestions' as const, people: list.map((s) => s.account) }
          } catch {
            // fall through to the directory
          }
        }
        const people = await client.v1.directory.list({ order: 'active', local: true, limit: 12 })
        return { from: 'directory' as const, people }
      },
      (v) => {
        suggestedPeople.value = v.people
        peopleSource.value = v.from
      },
    )

  const loadFollowedTags = () => {
    if (!opts.isSignedIn.value) {
      followedTagList.value = []
      return Promise.resolve()
    }
    return fetchSlice('followedTags', async ({ client }) => await client.v1.followedTags.list({ limit: 40 }), (v) => (followedTagList.value = v))
  }

  /** Load what a tab's empty state needs */
  const loadFor = (tab: ExploreSearchTab) => {
    if (tab === 'all') return Promise.all([loadTags(), loadLinks()])
    if (tab === 'people') return loadPeople()
    if (tab === 'posts') return loadPosts()
    if (tab === 'tags') return Promise.all([loadTags(), loadFollowedTags()])
    return Promise.resolve()
  }

  /** Account/sign-in changed — drop stale slices so the next load refetches */
  const reset = () => {
    trendingTags.value = []
    trendingLinks.value = []
    trendingPosts.value = []
    suggestedPeople.value = []
    followedTagList.value = []
  }

  /** After a tag follow/unfollow elsewhere on the page */
  const forgetFollowedTags = () => {
    for (const k of [...memo.keys()]) if (k.endsWith('|followedTags')) memo.delete(k)
  }

  return {
    trendingTags,
    trendingLinks,
    trendingPosts,
    suggestedPeople,
    followedTagList,
    peopleSource,
    sourceHost,
    loading,
    loadFor,
    reset,
    forgetFollowedTags,
  }
}
