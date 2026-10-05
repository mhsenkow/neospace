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
import { activeClient, publicClient } from '~/composables/useMasto'

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
  category: 'tech' | 'creative' | 'gaming' | 'social' | 'news' | 'local' | 'other'
  /** Is the current user a member (following the hashtag)? */
  isMember: boolean
  /** Number of posts using this hashtag (approximation) */
  postsCount?: number
  /** Whether this is a featured/suggested group */
  featured?: boolean
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
  { id: 'other', label: 'Other', emoji: '🌈' }
]

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
    maxId: null
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

    /** Get groups by category */
    getByCategory: (state) => (category: string): Group[] => {
      if (category === 'all') return state.groups
      return state.groups.filter(g => g.category === category)
    },

    /** Get a specific group by tag */
    getGroup: (state) => (tag: string): Group | undefined => {
      return state.groups.find(g => g.tag.toLowerCase() === tag.toLowerCase())
    },

    /** Current group being viewed */
    currentGroup: (state): Group | undefined => {
      if (!state.currentGroupTag) return undefined
      return state.groups.find(g => g.tag.toLowerCase() === state.currentGroupTag!.toLowerCase())
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
     * Initialize groups - load featured groups and check membership
     */
    async initializeGroups() {
      this.isLoading = true
      this.error = null

      try {
        // Start with featured groups
        this.groups = FEATURED_GROUPS.map(g => ({ ...g, isMember: false }))

        // If authenticated, fetch followed tags to determine membership
        const instancesStore = useInstancesStore()
        if (instancesStore.isAuthenticated) {
          await this.fetchFollowedTags()
        }
      } catch (e: any) {
        this.error = e.message || 'Failed to initialize groups'
        console.error('Groups init error:', e)
      } finally {
        this.isLoading = false
      }
    },

    /**
     * Fetch hashtags the user is following (their group memberships)
     */
    async fetchFollowedTags() {
      const instancesStore = useInstancesStore()
      if (!instancesStore.isAuthenticated) return

      try {
        const client = this.getClient()
        const tags = await client.v1.followedTags.list()
        this.followedTags = tags

        // Update membership status for known groups
        const followedTagNames = new Set(tags.map(t => t.name.toLowerCase()))
        
        this.groups = this.groups.map(group => ({
          ...group,
          isMember: followedTagNames.has(group.tag.toLowerCase())
        }))

        // Add any followed tags that aren't in our featured list
        for (const tag of tags) {
          const tagLower = tag.name.toLowerCase()
          if (!this.groups.find(g => g.tag.toLowerCase() === tagLower)) {
            this.groups.push({
              tag: tag.name,
              name: this.formatTagAsName(tag.name),
              icon: '🏷️',
              category: 'other',
              isMember: true,
              featured: false
            })
          }
        }
      } catch (e: any) {
        console.error('Failed to fetch followed tags:', e)
      }
    },

    /**
     * Join a group (follow the hashtag)
     */
    async joinGroup(tag: string) {
      const instancesStore = useInstancesStore()
      if (!instancesStore.isAuthenticated) {
        throw new Error('Must be logged in to join groups')
      }

      try {
        const client = this.getClient()
        const result = await client.v1.tags.$select(tag).follow()
        
        // Update local state
        const groupIndex = this.groups.findIndex(g => g.tag.toLowerCase() === tag.toLowerCase())
        if (groupIndex !== -1) {
          this.groups[groupIndex].isMember = true
        } else {
          // Add as new group
          this.groups.push({
            tag: result.name,
            name: this.formatTagAsName(result.name),
            icon: '🏷️',
            category: 'other',
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
        console.error('Failed to join group:', e)
        throw e
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

      try {
        const client = this.getClient()
        await client.v1.tags.$select(tag).unfollow()
        
        // Update local state
        const groupIndex = this.groups.findIndex(g => g.tag.toLowerCase() === tag.toLowerCase())
        if (groupIndex !== -1) {
          this.groups[groupIndex].isMember = false
        }

        // Update followed tags
        this.followedTags = this.followedTags.filter(
          t => t.name.toLowerCase() !== tag.toLowerCase()
        )
      } catch (e: any) {
        console.error('Failed to leave group:', e)
        throw e
      }
    },

    /**
     * Fetch the group's timeline (hashtag timeline)
     */
    async fetchGroupTimeline(tag: string, refresh = false) {
      const instancesStore = useInstancesStore()
      
      if (refresh) {
        this.groupTimeline = []
        this.maxId = null
        this.hasMore = true
      }

      this.isLoadingTimeline = true
      this.error = null
      this.currentGroupTag = tag

      try {
        const client = this.getPublicClient()
        const statuses = await client.v1.timelines.tag.$select(tag).list({
          limit: 20
        })

        this.groupTimeline = statuses
        
        if (statuses.length > 0) {
          this.maxId = statuses[statuses.length - 1].id
        }
        
        this.hasMore = statuses.length === 20
      } catch (e: any) {
        this.error = e.message || 'Failed to fetch group timeline'
        console.error('Group timeline error:', e)
      } finally {
        this.isLoadingTimeline = false
      }
    },

    /**
     * Load more posts in the group timeline
     */
    async loadMoreTimeline() {
      if (this.isLoadingMore || !this.hasMore || !this.maxId || !this.currentGroupTag) return

      this.isLoadingMore = true

      try {
        const client = this.getPublicClient()
        const statuses = await client.v1.timelines.tag.$select(this.currentGroupTag).list({
          maxId: this.maxId,
          limit: 20
        })

        if (statuses.length > 0) {
          this.groupTimeline = [...this.groupTimeline, ...statuses]
          this.maxId = statuses[statuses.length - 1].id
        }
        
        this.hasMore = statuses.length === 20
      } catch (e: any) {
        console.error('Load more error:', e)
      } finally {
        this.isLoadingMore = false
      }
    },

    /**
     * Search/discover groups by hashtag
     */
    async searchGroups(query: string) {
      if (!query.trim()) return []

      try {
        const client = this.getPublicClient()
        // Search for hashtags
        const results = await client.v2.search.fetch({
          q: query,
          type: 'hashtags',
          limit: 10
        })

        // Convert to groups
        return results.hashtags.map(tag => {
          const existing = this.groups.find(g => g.tag.toLowerCase() === tag.name.toLowerCase())
          if (existing) return existing

          return {
            tag: tag.name,
            name: this.formatTagAsName(tag.name),
            icon: '🏷️',
            category: 'other' as const,
            isMember: false,
            featured: false
          }
        })
      } catch (e: any) {
        console.error('Group search error:', e)
        return []
      }
    },

    /**
     * Create a custom group from any hashtag
     */
    addCustomGroup(tag: string, name?: string, icon?: string) {
      const cleanTag = tag.replace(/^#/, '')
      
      // Check if already exists
      if (this.groups.find(g => g.tag.toLowerCase() === cleanTag.toLowerCase())) {
        return
      }

      this.groups.push({
        tag: cleanTag,
        name: name || this.formatTagAsName(cleanTag),
        icon: icon || '🏷️',
        category: 'other',
        isMember: false,
        featured: false
      })
    },

    /**
     * Format a hashtag as a readable group name
     */
    formatTagAsName(tag: string): string {
      // Convert camelCase and snake_case to spaces, capitalize first letter of each word
      return tag
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
    },

    /**
     * Clear the current group timeline
     */
    clearTimeline() {
      this.groupTimeline = []
      this.currentGroupTag = null
      this.maxId = null
      this.hasMore = true
      this.error = null
    }
  }
})

