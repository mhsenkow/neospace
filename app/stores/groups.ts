/**
 * NeoSpace Groups Store
 * 
 * Groups are a friendly abstraction over hashtags.
 * Under the hood: Following a group = following a hashtag
 * The UI presents this as a cohesive "group" experience.
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { useInstancesStore } from './instances'
import { useSettingsStore } from './settings'
import { activeClient, publicClient } from '~/composables/useMasto'
import { guessCategory as guessCategoryUtil } from '~/utils/guessCategory'
import { normalizeHashtagInput, tagHistorySummary, tagKey } from '~/utils/hashtag'
import { resolvePublicInstanceUrl } from '~/utils/instances'
import { logWarn, logError } from '~/utils/log'
import { cursorPage, nextMaxIdFromLink } from '~/utils/linkHeader'
import { formatTagAsName as formatTagName } from '~/utils/tagName'
import { tagIsFiltered } from '~/utils/tagFilters'
import { dropDeletedStatus, type DeletedStatusEvent } from '~/utils/deletedStatus'

/** Prevent concurrent initializeGroups races that double-push trending tags */
let groupsInitPromise: Promise<void> | null = null
const GROUPS_INIT_TTL_MS = 5 * 60 * 1000
let groupsInitializedAt = 0
/** Account the memberships were loaded for — a switch must not reuse them */
let groupsInitializedFor: string | null = null

/**
 * Hashtag names as Mastodon accepts them: word characters (any script), `_`,
 * middle dot and ZWNJ. Anything else (`/`, `?`, `#`, `.`, `%`) can't be a tag
 * and must not reach an API path — `/groups/..%2Faccounts%2F1%2Ffollow%3F`
 * would otherwise turn Join into an authenticated POST elsewhere.
 */
const GROUP_TAG_RE = /^[\p{L}\p{M}\p{N}_\u00b7\u200c]+$/u
export const GROUP_TAG_MAX = 100

export function isGroupTagName(tag: string): boolean {
  return !!tag && tag.length <= GROUP_TAG_MAX && GROUP_TAG_RE.test(tag)
}

/** A tag worth offering as a new group: valid for the API and not just digits (`#2024`) */
export const isOfferableGroupTag = (tag: string) => isGroupTagName(tag) && /[\p{L}_]/u.test(tag)

/**
 * Join/leave for one tag run one after another, and the newest click decides the
 * outcome: a Join + Undo fired close together can't land on the server in the
 * opposite order of what the UI shows.
 */
const tagTails = new Map<string, Promise<unknown>>()
const tagIntents = new Map<string, number>()
function serializeTag<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tagTails.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  tagTails.set(key, tail)
  void tail.then(() => {
    if (tagTails.get(key) === tail) tagTails.delete(key)
  })
  return run
}
const bumpIntent = (key: string) => {
  const n = (tagIntents.get(key) || 0) + 1
  tagIntents.set(key, n)
  return n
}
const isLatestIntent = (key: string, n: number) => tagIntents.get(key) === n

/**
 * One page of a hashtag timeline plus where the next one starts. The Link header
 * says whether more exists — `length === 20` ended the feed early on any short page
 * (hidden/filtered statuses, servers with smaller caps). Servers that send no Link
 * header at all fall back to "a full page means more".
 */
const TAG_PAGE = 20
async function tagTimelinePage(
  client: mastodon.rest.Client,
  tag: string,
  maxId?: string | null,
): Promise<{ items: mastodon.v1.Status[]; nextMaxId: string | null }> {
  const res = await client.v1.timelines.tag
    .$select(tagPath(tag))
    .list.$raw({ limit: TAG_PAGE, ...(maxId ? { maxId } : {}) })
  const items = Array.isArray(res.data) ? res.data : []
  const link = res.headers?.get('link')
  if (link == null) {
    return { items, nextMaxId: items.length >= TAG_PAGE ? (items[items.length - 1]?.id ?? null) : null }
  }
  return { items, nextMaxId: nextMaxIdFromLink(link) }
}

/** Path segment for `$select` — masto.js joins it into the URL unescaped */
const tagPath = (tag: string) => encodeURIComponent(tag)

export type GroupCategory =
  | 'tech'
  | 'creative'
  | 'gaming'
  | 'social'
  | 'news'
  | 'other'

export interface Group {
  /** The hashtag (without #) - this is the group's unique ID */
  tag: string
  /** Display name for the group */
  name: string
  /** Optional description */
  description?: string
  /** Emoji icon for the group */
  icon: string
  /** Category for filtering */
  category: GroupCategory
  /** Is the current user a member (following the hashtag)? */
  isMember: boolean
  /** Number of posts using this hashtag (approximation) */
  postsCount?: number
  /** Whether this is a featured/suggested group */
  featured?: boolean
  /** Live from instance trending tags */
  trending?: boolean
}

interface GroupsState {
  /** All known groups */
  groups: Group[]
  /** Current group's timeline */
  groupTimeline: mastodon.v1.Status[]
  /** Currently viewing group tag */
  currentGroupTag: string | null
  /** Followed hashtags (the groups the user has joined) */
  followedTags: mastodon.v1.Tag[]
  /** Loading states */
  isLoading: boolean
  isLoadingTimeline: boolean
  isLoadingMore: boolean
  error: string | null
  /** Pagination */
  hasMore: boolean
  maxId: string | null
  /** Followed-tags fetch failed — membership flags may be stale */
  followedTagsError: string | null
  /** Group timeline failure — separate from `error` so a background re-init can't wipe it */
  timelineError: string | null
  /** Host the "Trending on …" tags actually came from */
  trendingHost: string | null
  /** Per-tag join/leave in flight */
  pendingTags: Record<string, boolean>
  /** Per-tag timeline + scroll cache when navigating back */
  timelineCache: Record<
    string,
    {
      timeline: mastodon.v1.Status[]
      maxId: string | null
      hasMore: boolean
      scrollY: number
      /** LRU recency tick */
      cachedAt: number
    }
  >
}

// Predefined/suggested groups - friendly wrappers over popular hashtags
const FEATURED_GROUPS: Omit<Group, 'isMember'>[] = [
  // Tech
  {
    tag: 'fediverse',
    name: 'Fediverse Meta',
    description: 'Discuss the fediverse itself — instances, protocols, and decentralized social.',
    icon: '🌐',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'tech',
    name: 'Tech Talk',
    description: 'Technology news, gadgets, and geekery.',
    icon: '💻',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'opensource',
    name: 'Open Source',
    description: 'Free and open source software, hardware, and culture.',
    icon: '🔓',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'linux',
    name: 'Linux',
    description: 'Linux users, sysadmins, and penguin enthusiasts.',
    icon: '🐧',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'privacy',
    name: 'Privacy & Security',
    description: 'Digital privacy, security tips, and staying safe online.',
    icon: '🔒',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'webdev',
    name: 'Web Development',
    description: 'Front-end, back-end, and everything that ships to the web.',
    icon: '🕸️',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'python',
    name: 'Python',
    description: 'Python programming, libraries, and projects.',
    icon: '🐍',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'ai',
    name: 'AI & Machine Learning',
    description: 'AI tools, research, and what it means for everyday life.',
    icon: '🤖',
    category: 'tech',
    featured: true,
  },
  {
    tag: 'selfhosting',
    name: 'Self-Hosting',
    description: 'Run your own services — home labs, Docker, and independence.',
    icon: '🏠',
    category: 'tech',
    featured: true,
  },

  // Creative
  {
    tag: 'photography',
    name: 'Photography',
    description: 'Share your photos and appreciate the art of photography.',
    icon: '📸',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'art',
    name: 'Art & Artists',
    description: 'Digital art, traditional art, illustrations, and creative expression.',
    icon: '🎨',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'music',
    name: 'Music',
    description: 'Musicians, producers, and music lovers unite.',
    icon: '🎵',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'books',
    name: 'Book Club',
    description: 'Recommendations, reviews, and literary discussions.',
    icon: '📚',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'nature',
    name: 'Nature & Wildlife',
    description: 'Nature photography and wildlife appreciation.',
    icon: '🌿',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'writing',
    name: 'Writers',
    description: 'Fiction, non-fiction, poetry — all forms of the written word.',
    icon: '✍️',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'film',
    name: 'Film & TV',
    description: 'Movies, shows, and recommendations worth your evening.',
    icon: '🎬',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'design',
    name: 'Design',
    description: 'Graphic design, UX, typography, and visual craft.',
    icon: '✏️',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'mastoart',
    name: 'MastoArt',
    description: 'Art shared across the fediverse — paint, pixels, and process.',
    icon: '🖼️',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'crafts',
    name: 'Crafts & Making',
    description: 'Knitting, woodworking, DIY, and handmade projects.',
    icon: '🧵',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'poetry',
    name: 'Poetry',
    description: 'Poems, spoken word, and verse from around the network.',
    icon: '📜',
    category: 'creative',
    featured: true,
  },
  {
    tag: 'animation',
    name: 'Animation',
    description: '2D, 3D, stop-motion, and motion design.',
    icon: '🎞️',
    category: 'creative',
    featured: true,
  },

  // Gaming
  {
    tag: 'gamedev',
    name: 'Game Development',
    description: 'Indie devs, studios, and everyone making games.',
    icon: '🎮',
    category: 'gaming',
    featured: true,
  },
  {
    tag: 'retrogaming',
    name: 'Retro Gaming',
    description: 'Classic games, nostalgia, and vintage gaming culture.',
    icon: '👾',
    category: 'gaming',
    featured: true,
  },
  {
    tag: 'gaming',
    name: 'Gaming',
    description: 'Playing games, sharing clips, and finding co-op friends.',
    icon: '🕹️',
    category: 'gaming',
    featured: true,
  },
  {
    tag: 'indiegames',
    name: 'Indie Games',
    description: 'Small teams, big heart — indie game news and love.',
    icon: '🎲',
    category: 'gaming',
    featured: true,
  },
  {
    tag: 'boardgames',
    name: 'Board Games',
    description: 'Tabletop nights, reviews, and game-night ideas.',
    icon: '♟️',
    category: 'gaming',
    featured: true,
  },

  // Social
  {
    tag: 'introduction',
    name: 'Introductions',
    description: 'New here? Introduce yourself and meet the community.',
    icon: '👋',
    category: 'social',
    featured: true,
  },
  {
    tag: 'cooking',
    name: 'Cooking & Food',
    description: 'Recipes, food photos, and culinary adventures.',
    icon: '🍳',
    category: 'social',
    featured: true,
  },
  {
    tag: 'cats',
    name: 'Cats',
    description: 'The internet’s true purpose: sharing cat photos.',
    icon: '🐱',
    category: 'social',
    featured: true,
  },
  {
    tag: 'dogs',
    name: 'Dogs',
    description: 'Good boys, good girls, and puppy content.',
    icon: '🐕',
    category: 'social',
    featured: true,
  },
  {
    tag: 'gardening',
    name: 'Gardening',
    description: 'Plants, plots, and growing things at home.',
    icon: '🌱',
    category: 'social',
    featured: true,
  },
  {
    tag: 'parenting',
    name: 'Parenting',
    description: 'Raising kids — tips, solidarity, and real talk.',
    icon: '👨‍👩‍👧',
    category: 'social',
    featured: true,
  },
  {
    tag: 'mentalhealth',
    name: 'Mental Health',
    description: 'Support, resources, and kinder conversations.',
    icon: '💚',
    category: 'social',
    featured: true,
  },
  {
    tag: 'travel',
    name: 'Travel',
    description: 'Trips, tips, and places worth the journey.',
    icon: '✈️',
    category: 'social',
    featured: true,
  },
  {
    tag: 'lgbtq',
    name: 'LGBTQ+',
    description: 'Pride, community, and queer life on the fediverse.',
    icon: '🏳️‍🌈',
    category: 'social',
    featured: true,
  },
  {
    tag: 'disability',
    name: 'Disability',
    description: 'Accessibility, advocacy, and lived experience.',
    icon: '♿',
    category: 'social',
    featured: true,
  },

  // News
  {
    tag: 'news',
    name: 'News',
    description: 'Headlines and discussion from around the world.',
    icon: '📰',
    category: 'news',
    featured: true,
  },
  {
    tag: 'climate',
    name: 'Climate',
    description: 'Climate science, action, and the living planet.',
    icon: '🌍',
    category: 'news',
    featured: true,
  },
  {
    tag: 'politics',
    name: 'Politics',
    description: 'Civic life, policy, and democratic conversation.',
    icon: '🏛️',
    category: 'news',
    featured: true,
  },
  {
    tag: 'science',
    name: 'Science',
    description: 'Research, discoveries, and curious minds.',
    icon: '🔬',
    category: 'news',
    featured: true,
  },
]

// Category definitions
export const GROUP_CATEGORIES = [
  { id: 'all', label: 'All Groups', emoji: '✨' },
  { id: 'tech', label: 'Tech', emoji: '💻' },
  { id: 'creative', label: 'Creative', emoji: '🎨' },
  { id: 'gaming', label: 'Gaming', emoji: '🎮' },
  { id: 'social', label: 'Social', emoji: '💬' },
  { id: 'news', label: 'News', emoji: '📰' },
  { id: 'other', label: 'Other', emoji: '🌈' },
]

/** Bumps on each timeline fetch so a slow prior tag cannot overwrite the current one */
let timelineRequestId = 0
/** Back/forward restore cache is LRU-bounded so browsing many tags doesn't grow forever */
const TIMELINE_CACHE_MAX = 12
let timelineCacheClock = 0

export const useGroupsStore = defineStore('groups', {
  state: (): GroupsState => ({
    groups: [],
    groupTimeline: [],
    currentGroupTag: null,
    followedTags: [],
    isLoading: false,
    isLoadingTimeline: false,
    isLoadingMore: false,
    error: null,
    hasMore: true,
    maxId: null,
    followedTagsError: null,
    timelineError: null,
    trendingHost: null,
    pendingTags: {},
    timelineCache: {},
  }),

  getters: {
    /** Groups the user has joined (is following the hashtag) */
    joinedGroups: (state): Group[] => {
      return state.groups.filter(g => g.isMember)
    },

    /** Featured/suggested groups */
    featuredGroups: (state): Group[] => {
      return state.groups.filter(g => g.featured)
    },

    /**
     * Threads-style discovery picks: unjoined featured + trending, best first.
     * Always dedupe by tag — concurrent inits can leave duplicates in state.
     */
    recommendedGroups: (state): Group[] => {
      const seen = new Set<string>()
      return [...state.groups]
        .filter((g) => {
          if (g.isMember || !(g.featured || g.trending)) return false
          const key = tagKey(g.tag)
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .sort((a, b) => {
          if (!!a.trending !== !!b.trending) return a.trending ? -1 : 1
          if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1
          return (b.postsCount || 0) - (a.postsCount || 0)
        })
        .slice(0, 16)
    },

    /** Live trending tags from the active server (deduped, unjoined) */
    trendingGroups: (state): Group[] => {
      const seen = new Set<string>()
      const out: Group[] = []
      for (const g of state.groups) {
        if (!g.trending || g.isMember) continue
        const key = tagKey(g.tag)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(g)
        if (out.length >= 12) break
      }
      return out
    },

    /** Featured curated picks only (for Suggested rail — avoid overlapping Trending) */
    suggestedFeaturedGroups: (state): Group[] => {
      const seen = new Set<string>()
      return state.groups.filter((g) => {
        if (!g.featured || g.isMember) return false
        const key = tagKey(g.tag)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }).slice(0, 16)
    },

    /** Get groups by category — unjoined first so discovery isn't buried under Leave */
    getByCategory: (state) => (category: string): Group[] => {
      const list =
        category === 'all'
          ? state.groups
          : state.groups.filter((g) => g.category === category)

      return [...list].sort((a, b) => {
        if (a.isMember !== b.isMember) return a.isMember ? 1 : -1
        if (!!a.trending !== !!b.trending) return a.trending ? -1 : 1
        if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    },

    /** Get a specific group by tag */
    getGroup: (state) => (tag: string): Group | undefined => {
      const key = tagKey(tag)
      return state.groups.find((g) => tagKey(g.tag) === key)
    },

    /** Current group being viewed */
    currentGroup: (state): Group | undefined => {
      if (!state.currentGroupTag) return undefined
      const key = tagKey(state.currentGroupTag)
      return state.groups.find((g) => tagKey(g.tag) === key)
    }
  },

  actions: {
    /**
     * Get an authenticated API client
     */
    getClient(): mastodon.rest.Client {
      return activeClient()
    },

    getPublicClient(instanceUrl?: string): mastodon.rest.Client {
      return publicClient(instanceUrl)
    },

    /**
     * Initialize groups - curated + live trending hashtags from your server.
     * Single-flight so home + columns + menu can't race and double-push tags.
     */
    async initializeGroups(force = false, retried = false) {
      const accountKey = useInstancesStore().activeAccountId || null
      if (
        !force &&
        groupsInitializedAt &&
        groupsInitializedFor === accountKey &&
        Date.now() - groupsInitializedAt < GROUPS_INIT_TTL_MS
      ) {
        return
      }
      if (groupsInitPromise) return groupsInitPromise

      groupsInitPromise = (async () => {
        this.isLoading = true
        this.error = null

        try {
          const prevMembers = new Map(
            this.groups.map((g) => [g.tag.toLowerCase(), g.isMember]),
          )
          const prevByTag = new Map(this.groups.map((g) => [g.tag.toLowerCase(), g]))
          const merged: Group[] = []
          for (const f of FEATURED_GROUPS) {
            const key = f.tag.toLowerCase()
            const prev = prevByTag.get(key)
            merged.push({
              ...f,
              isMember: prev?.isMember ?? prevMembers.get(key) ?? false,
              trending: false,
              postsCount: prev?.postsCount,
              description: prev?.description ?? f.description,
            })
            prevByTag.delete(key)
          }
          for (const g of prevByTag.values()) {
            merged.push({ ...g })
          }
          this.groups = merged

          const instancesStore = useInstancesStore()
          await Promise.all([
            this.fetchTrendingTags(),
            instancesStore.isAuthenticated ? this.fetchFollowedTags() : Promise.resolve(),
          ])
          this.dedupeGroups()
          groupsInitializedAt = Date.now()
          groupsInitializedFor = accountKey
        } catch (e: any) {
          this.error = e.message || 'Failed to initialize groups'
          logError('Groups init error:', e)
        } finally {
          this.isLoading = false
        }
      })()

      try {
        await groupsInitPromise
      } finally {
        groupsInitPromise = null
      }
      // Joined while another account's init was in flight: that result is not ours — load again
      const nowKey = useInstancesStore().activeAccountId || null
      if (!retried && nowKey === accountKey && groupsInitializedFor !== accountKey && !this.error) {
        await this.initializeGroups(true, true)
      }
    },

    /**
     * The active account changed: its memberships, followed tags and cached
     * timelines are not the previous account's. Drops everything account-specific,
     * keeps featured + trending tags, and reloads.
     */
    async resetForAccountSwitch() {
      this.followedTags = []
      this.followedTagsError = null
      this.timelineCache = {}
      this.pendingTags = {}
      this.groups = this.groups
        .filter((g) => g.featured || g.trending)
        .map((g) => ({ ...g, isMember: false }))
      await this.initializeGroups(true)
    },

    /** A filter changed after trends loaded — hide tags it now covers (and nothing else) */
    refilterTrending() {
      const filters = useSettingsStore().filters || []
      const keep = (g: Group) =>
        g.featured || g.isMember || !g.trending || !tagIsFiltered(g.tag, filters)
      if (this.groups.every(keep)) return
      this.groups = this.groups.filter(keep)
    },

    /** Collapse duplicate tags (prefer member + trending + featured flags) */
    dedupeGroups() {
      const byTag = new Map<string, Group>()
      for (const g of this.groups) {
        const key = g.tag.toLowerCase()
        const prev = byTag.get(key)
        if (!prev) {
          byTag.set(key, { ...g })
          continue
        }
        byTag.set(key, {
          ...prev,
          ...g,
          isMember: prev.isMember || g.isMember,
          featured: prev.featured || g.featured,
          trending: prev.trending || g.trending,
          postsCount: Math.max(prev.postsCount || 0, g.postsCount || 0) || prev.postsCount || g.postsCount,
          description: prev.description || g.description,
          icon: prev.featured ? prev.icon : g.icon,
          name: prev.featured ? prev.name : g.name,
        })
      }
      this.groups = Array.from(byTag.values())
    },

    guessCategory(tag: string): GroupCategory {
      return guessCategoryUtil(tag) as GroupCategory
    },

    /**
     * Pull whatever is hot on the instance — the wide / "scary" range of real hashtags
     */
    async fetchTrendingTags() {
      try {
        const instancesStore = useInstancesStore()
        const settingsStore = useSettingsStore()
        const client = instancesStore.isAuthenticated
          ? this.getClient()
          : this.getPublicClient()

        // Mastodon trends/tags maxes out around 20 — still a live slice of the network
        const tags = await client.v1.trends.tags.list({ limit: 20 })
        if (!tags?.length) return

        const filters = settingsStore.filters || []

        // Tags that dropped off the server's trends must not stay "Trending" with a stale count
        const wasTrending = new Set(this.groups.filter((g) => g.trending).map((g) => g.tag.toLowerCase()))
        for (const g of this.groups) {
          g.trending = false
          g.postsCount = undefined
        }
        this.trendingHost = (() => {
          try {
            return new URL(
              instancesStore.isAuthenticated
                ? instancesStore.activeAccount?.url || ''
                : resolvePublicInstanceUrl(instancesStore.activeAccount?.url || null),
            ).hostname
          } catch {
            return null
          }
        })()

        for (const tag of tags) {
          const name = tag.name
          const key = name.toLowerCase()

          if (tagIsFiltered(name, filters)) {
            continue
          }

          // history[].accounts = accounts that used the tag that day (when provided)
          const history = tag.history || []
          const hasAccountsField = history.some(
            (day) =>
              (day as { accounts?: string | number }).accounts != null &&
              (day as { accounts?: string | number }).accounts !== '',
          )
          if (hasAccountsField) {
            const accountPeak = Math.max(
              ...history.map((day) => Number((day as { accounts?: string | number }).accounts || 0)),
            )
            if (!Number.isFinite(accountPeak) || accountPeak < 2) {
              continue
            }
          }

          // Re-check after await — concurrent inits may have already pushed this tag
          const existing = this.groups.find((g) => g.tag.toLowerCase() === key)
          if (existing) {
            existing.trending = true
            const uses =
              tag.history?.reduce((sum, day) => sum + Number(day.uses || 0), 0) || undefined
            if (uses != null) existing.postsCount = uses
            continue
          }

          const uses =
            tag.history?.reduce((sum, day) => sum + Number(day.uses || 0), 0) || undefined

          this.groups.push({
            tag: name,
            name: this.formatTagAsName(name),
            description: `Live on the network — #${name}`,
            icon: '🔥',
            category: this.guessCategory(name),
            isMember: false,
            featured: false,
            trending: true,
            postsCount: uses,
          })
        }
        // Carried-over trending entries that no longer trend and aren't yours
        this.groups = this.groups.filter((g) => {
          const key = g.tag.toLowerCase()
          return g.trending || g.featured || g.isMember || !!this.pendingTags[key] || !wasTrending.has(key)
        })
      } catch (e: any) {
        logWarn('Trending tags unavailable:', e?.message || e)
      }
    },

    /**
     * Fetch hashtags the user is following (their group memberships)
     */
    async fetchFollowedTags() {
      const instancesStore = useInstancesStore()
      if (!instancesStore.isAuthenticated) return

      const accountId = instancesStore.activeAccountId
      try {
        this.followedTagsError = null
        const client = this.getClient()
        const tags: mastodon.v1.Tag[] = []
        let maxId: string | undefined
        // Followed tags paginate by follow-row id from the Link header (not tag name)
        for (;;) {
          const page = await cursorPage(
            client.v1.followedTags.list.$raw({
              limit: 100,
              ...(maxId ? { maxId } : {}),
            }),
          )
          if (!page.items.length) break
          tags.push(...page.items)
          if (!page.nextMaxId || page.nextMaxId === maxId) break
          maxId = page.nextMaxId
        }
        // Switched accounts mid-fetch — these memberships belong to the old one
        if (instancesStore.activeAccountId !== accountId) return
        this.followedTags = tags

        // Update membership status for known groups
        const followedTagNames = new Set(tags.map(t => t.name.toLowerCase()))

        // A join/leave still in flight was sent after this list was read —
        // keep its optimistic state instead of flipping the button back
        this.groups = this.groups.map(group => {
          const key = group.tag.toLowerCase()
          return {
            ...group,
            isMember: this.pendingTags[key] ? group.isMember : followedTagNames.has(key),
          }
        })

        // Add any followed tags that aren't in our featured list
        for (const tag of tags) {
          const tagLower = tag.name.toLowerCase()
          if (!this.groups.find(g => g.tag.toLowerCase() === tagLower)) {
            this.groups.push({
              tag: tag.name,
              name: this.formatTagAsName(tag.name),
              icon: '🏷️',
              category: this.guessCategory(tag.name),
              isMember: true,
              featured: false
            })
          }
        }
      } catch (e: any) {
        this.followedTagsError = e.message || 'Failed to load joined groups'
        logError('Failed to fetch followed tags:', e)
      }
    },

    isTagPending(tag: string): boolean {
      return !!this.pendingTags[tag.toLowerCase()]
    },

    /**
     * Join a group (follow the hashtag)
     */
    async joinGroup(tag: string) {
      const instancesStore = useInstancesStore()
      if (!instancesStore.isAuthenticated) {
        throw new Error('Must be logged in to join groups')
      }

      const key = tag.toLowerCase()
      const intent = bumpIntent(key)
      this.pendingTags = { ...this.pendingTags, [key]: true }

      // Look the group up again after each await — init/dedupe replace `groups`
      const findGroup = () => this.groups.find((g) => g.tag.toLowerCase() === key)
      const before = findGroup()
      const wasMember = before ? before.isMember : false
      if (before) before.isMember = true

      try {
        const result = await serializeTag(key, () => this.getClient().v1.tags.$select(tagPath(tag)).follow())
        // A newer Join/Leave click for this tag decides the final state — don't overwrite it
        if (!isLatestIntent(key, intent)) return result

        const current = findGroup()
        if (current) {
          current.isMember = true
        } else {
          // Add as new group
          this.groups.push({
            tag: result.name,
            name: this.formatTagAsName(result.name),
            icon: '🏷️',
            category: this.guessCategory(result.name),
            isMember: true,
            featured: false
          })
        }

        // Update followed tags
        if (!this.followedTags.find(t => t.name.toLowerCase() === tag.toLowerCase())) {
          this.followedTags.push(result)
        }

        return result
      } catch (e: any) {
        if (isLatestIntent(key, intent)) {
          const current = findGroup()
          if (current) current.isMember = wasMember
        }
        logError('Failed to join group:', e)
        throw e
      } finally {
        if (isLatestIntent(key, intent)) {
          const next = { ...this.pendingTags }
          delete next[key]
          this.pendingTags = next
        }
      }
    },

    /**
     * Leave a group (unfollow the hashtag)
     */
    async leaveGroup(tag: string) {
      const instancesStore = useInstancesStore()
      if (!instancesStore.isAuthenticated) {
        throw new Error('Must be logged in to leave groups')
      }

      const key = tag.toLowerCase()
      const intent = bumpIntent(key)
      this.pendingTags = { ...this.pendingTags, [key]: true }
      const findGroup = () => this.groups.find((g) => g.tag.toLowerCase() === key)
      const before = findGroup()
      const wasMember = before ? before.isMember : true
      if (before) before.isMember = false
      const removed = this.followedTags.find((t) => t.name.toLowerCase() === key)
      this.followedTags = this.followedTags.filter((t) => t.name.toLowerCase() !== key)

      try {
        await serializeTag(key, () => this.getClient().v1.tags.$select(tagPath(tag)).unfollow())
      } catch (e: any) {
        if (isLatestIntent(key, intent)) {
          const current = findGroup()
          if (current) current.isMember = wasMember
          // Put back only this tag — a whole-list snapshot would undo other joins
          if (removed && !this.followedTags.some((t) => t.name.toLowerCase() === key)) {
            this.followedTags = [...this.followedTags, removed]
          }
        }
        logError('Failed to leave group:', e)
        throw e
      } finally {
        if (isLatestIntent(key, intent)) {
          const next = { ...this.pendingTags }
          delete next[key]
          this.pendingTags = next
        }
      }
    },

    /**
     * Fetch the group's timeline (hashtag timeline)
     */
    async fetchGroupTimeline(tag: string, refresh = false) {
      const instancesStore = useInstancesStore()
      const requestId = ++timelineRequestId
      
      if (refresh) {
        this.groupTimeline = []
        this.maxId = null
        this.hasMore = true
      }

      this.isLoadingTimeline = true
      this.timelineError = null
      this.currentGroupTag = tag

      try {
        const client = this.getPublicClient()
        const fetchAccount =
          instancesStore.activeAccount ||
          instancesStore.instances.find((i) => i.accessToken)
        const page = await tagTimelinePage(client, tag)
        const statuses = page.items

        if (requestId !== timelineRequestId || this.currentGroupTag !== tag) return

        // Stamp with the account that owns the client used for fetch
        this.groupTimeline = fetchAccount
          ? statuses.map((s) => ({
              ...s,
              _instanceId: fetchAccount.id,
              _instanceUrl: fetchAccount.url,
            }))
          : statuses
        
        this.maxId = page.nextMaxId
        this.hasMore = page.nextMaxId !== null
      } catch (e: any) {
        if (requestId !== timelineRequestId) return
        this.timelineError = e.message || 'Failed to fetch group timeline'
        logError('Group timeline error:', e)
      } finally {
        if (requestId === timelineRequestId) this.isLoadingTimeline = false
      }
    },

    /**
     * A post was deleted elsewhere — drop it from the open group timeline without a refetch
     */
    removeDeletedStatus(event: DeletedStatusEvent) {
      this.groupTimeline = dropDeletedStatus(this.groupTimeline, event)
    },

    /**
     * Load more posts in the group timeline
     */
    async loadMoreTimeline() {
      if (this.isLoadingMore || !this.hasMore || !this.maxId || !this.currentGroupTag) return

      const tag = this.currentGroupTag
      const requestId = timelineRequestId
      this.isLoadingMore = true

      try {
        const instancesStore = useInstancesStore()
        const client = this.getPublicClient()
        const fetchAccount =
          instancesStore.activeAccount ||
          instancesStore.instances.find((i) => i.accessToken)
        const page = await tagTimelinePage(client, tag, this.maxId)
        const statuses = page.items

        if (requestId !== timelineRequestId || this.currentGroupTag !== tag) return

        if (statuses.length > 0) {
          const tagged = fetchAccount
            ? statuses.map((s) => ({
                ...s,
                _instanceId: fetchAccount.id,
                _instanceUrl: fetchAccount.url,
              }))
            : statuses
          this.groupTimeline = [...this.groupTimeline, ...tagged]
        }
        this.maxId = page.nextMaxId
        this.hasMore = page.nextMaxId !== null
      } catch (e: any) {
        if (requestId !== timelineRequestId) return
        logError('Load more error:', e)
        throw e
      } finally {
        // Always release — a stale request must not leave load-more stuck
        this.isLoadingMore = false
      }
    },

    /**
     * Search/discover groups by hashtag — any tag on the network can be a group
     */
    async searchGroups(query: string) {
      const q = normalizeHashtagInput(query)
      if (!q) return []

      // Errors propagate: "search failed" must look different from "no such tag"
      const instancesStore = useInstancesStore()
      const client = instancesStore.isAuthenticated
        ? this.getClient()
        : this.getPublicClient()

      const results = await client.v2.search.list({
        q,
        type: 'hashtags',
        limit: 20,
      })

      const mapped = results.hashtags.map((tag) => {
        const existing = this.groups.find(
          (g) => tagKey(g.tag) === tagKey(tag.name),
        )
        if (existing) return existing

        const uses7d = (tag.history || []).reduce((sum, day) => sum + Number(day.uses || 0), 0)
        const summary = tagHistorySummary(tag)

        return {
          tag: tag.name,
          name: this.formatTagAsName(tag.name),
          description: summary || `Join #${tag.name} as a group`,
          icon: '🏷️',
          category: this.guessCategory(tag.name),
          isMember: false,
          featured: false,
          trending: false,
          postsCount: uses7d > 0 ? uses7d : undefined,
        }
      })

      const exactKey = tagKey(q)
      const exactIdx = mapped.findIndex((g) => tagKey(g.tag) === exactKey)
      if (exactIdx > 0) {
        const [hit] = mapped.splice(exactIdx, 1)
        if (hit) mapped.unshift(hit)
      } else if (isOfferableGroupTag(q) && exactIdx < 0) {
        const existing = this.groups.find((g) => tagKey(g.tag) === exactKey)
        mapped.unshift(
          existing || {
            tag: q,
            name: this.formatTagAsName(q),
            description: `Start following #${q}`,
            icon: '➕',
            category: this.guessCategory(q),
            isMember: false,
            featured: false,
            trending: false,
          },
        )
      }

      return mapped
    },

    cacheTimeline(tag: string, scrollY = 0) {
      const key = tagKey(tag)
      // Only snapshot a loaded feed for this tag — caching a still-loading
      // (empty) or another tag's timeline would restore as "No posts yet"
      if (!this.groupTimeline.length || tagKey(this.currentGroupTag || '') !== key) return
      const next = { ...this.timelineCache }
      // Re-insert to mark most recent; evict least-recent beyond the cap
      delete next[key]
      next[key] = {
        timeline: [...this.groupTimeline],
        maxId: this.maxId,
        hasMore: this.hasMore,
        scrollY,
        cachedAt: ++timelineCacheClock,
      }
      const keys = Object.keys(next)
      if (keys.length > TIMELINE_CACHE_MAX) {
        keys
          .sort((a, b) => next[a]!.cachedAt - next[b]!.cachedAt)
          .slice(0, keys.length - TIMELINE_CACHE_MAX)
          .forEach((k) => delete next[k])
      }
      this.timelineCache = next
    },

    restoreTimeline(tag: string): number | null {
      const key = tagKey(tag)
      const cached = this.timelineCache[key]
      if (!cached) return null
      cached.cachedAt = ++timelineCacheClock
      // Supersede any fetch still in flight for the tag we're leaving
      timelineRequestId++
      this.isLoadingTimeline = false
      this.isLoadingMore = false
      this.groupTimeline = [...cached.timeline]
      this.maxId = cached.maxId
      this.hasMore = cached.hasMore
      this.currentGroupTag = tag
      this.timelineError = null
      return cached.scrollY
    },

    /**
     * Format a hashtag as a readable group name
     */
    formatTagAsName(tag: string): string {
      return formatTagName(tag)
    },

    /**
     * Clear the current group timeline
     */
    clearTimeline(tag?: string, scrollY = 0) {
      if (tag && this.groupTimeline.length) {
        this.cacheTimeline(tag, scrollY)
      }
      this.groupTimeline = []
      this.currentGroupTag = null
      this.maxId = null
      this.hasMore = true
      this.timelineError = null
    },

    /** Prepend a freshly posted status onto the open group timeline */
    prependToTimeline(tag: string, status: mastodon.v1.Status) {
      if (this.currentGroupTag?.toLowerCase() !== tag.toLowerCase()) return
      this.groupTimeline = [status, ...this.groupTimeline]
    },
  }
})

