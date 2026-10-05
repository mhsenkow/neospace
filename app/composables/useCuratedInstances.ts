/**
 * Unified server catalog for login, Explore, and Accounts.
 * Featured entries power the login shortlist; the full list powers Explore.
 */

export type ServerCategory =
  | 'art'
  | 'tech'
  | 'gaming'
  | 'social'
  | 'music'
  | 'science'
  | 'writing'
  | 'general'
  | 'regional'

export interface CuratedInstance {
  domain: string
  name: string
  vibe: string
  category: ServerCategory
  description: string
  /** Short line for login list */
  blurb: string
  /** Show on login shortlist */
  featured?: boolean
  /** Soft accent for cards (instrument chrome, not Meta purple) */
  color: string
  emoji: string
  tags?: string[]
}

export interface ServerCategoryDef {
  id: string
  label: string
}

const CATALOG: CuratedInstance[] = [
  {
    domain: 'mastodon.social',
    name: 'Mastodon Social',
    vibe: 'General & diverse',
    category: 'general',
    description: 'The flagship Mastodon server — a bit of everything and everyone.',
    blurb: 'Most popular',
    featured: true,
    color: '#c45c26',
    emoji: '🌐',
    tags: ['general', 'beginner', 'popular'],
  },
  {
    domain: 'fosstodon.org',
    name: 'Fosstodon',
    vibe: 'Open source & tech',
    category: 'tech',
    description: 'For free and open source software lovers — Linux, privacy, and hacking.',
    blurb: 'Open source & tech',
    featured: true,
    color: '#2f7d4a',
    emoji: '🐧',
    tags: ['foss', 'linux', 'privacy'],
  },
  {
    domain: 'hachyderm.io',
    name: 'Hachyderm',
    vibe: 'Welcoming tech',
    category: 'tech',
    description: 'A carefully moderated tech community for engineers, designers, and builders.',
    blurb: 'Welcoming community',
    featured: true,
    color: '#3d6b8e',
    emoji: '💻',
    tags: ['tech', 'engineering'],
  },
  {
    domain: 'infosec.exchange',
    name: 'Infosec Exchange',
    vibe: 'Security folks',
    category: 'tech',
    description: 'Information security professionals sharing research, news, and war stories.',
    blurb: 'Security folks',
    featured: true,
    color: '#8b3a3a',
    emoji: '🔐',
    tags: ['security', 'infosec'],
  },
  {
    domain: 'mastodon.art',
    name: 'Mastodon.art',
    vibe: 'Artists & makers',
    category: 'art',
    description: 'A cozy home for artists, illustrators, and creative folks.',
    blurb: 'Artists & makers',
    featured: true,
    color: '#a84d6a',
    emoji: '🎨',
    tags: ['art', 'illustration'],
  },
  {
    domain: 'mastodon.gamedev.place',
    name: 'Gamedev Place',
    vibe: 'Indie game makers',
    category: 'gaming',
    description: 'Game developers sharing devlogs, screenshots, and the grind of shipping games.',
    blurb: 'Indie game makers',
    color: '#6b4f8a',
    emoji: '🎮',
    tags: ['games', 'indiedev'],
  },
  {
    domain: 'writing.exchange',
    name: 'Writing Exchange',
    vibe: 'Writers & poets',
    category: 'writing',
    description: 'Writers, authors, poets, and storytellers — share words, find readers.',
    blurb: 'Writers & poets',
    color: '#b87a3a',
    emoji: '✍️',
    tags: ['writing', 'books'],
  },
  {
    domain: 'photog.social',
    name: 'Photog Social',
    vibe: 'Photographers',
    category: 'art',
    description: 'Photographers sharing landscapes, portraits, and street work.',
    blurb: 'Photographers',
    color: '#3a7a8c',
    emoji: '📸',
    tags: ['photo', 'camera'],
  },
  {
    domain: 'tabletop.social',
    name: 'Tabletop Social',
    vibe: 'Board games & RPGs',
    category: 'gaming',
    description: 'Board games, TTRPGs, and card games — roll dice, paint minis, tell stories.',
    blurb: 'Board games & RPGs',
    color: '#6b5344',
    emoji: '🎲',
    tags: ['boardgames', 'ttrpg'],
  },
  {
    domain: 'mathstodon.xyz',
    name: 'Mathstodon',
    vibe: 'Math & puzzles',
    category: 'science',
    description: 'Mathematicians and enthusiasts — proofs, puzzles, and beautiful equations.',
    blurb: 'Math & puzzles',
    color: '#5a4a8a',
    emoji: '🔢',
    tags: ['math', 'science'],
  },
  {
    domain: 'metalhead.club',
    name: 'Metalhead Club',
    vibe: 'Metal music',
    category: 'music',
    description: 'Metal fans united — bands, concerts, and headbanging moments.',
    blurb: 'Metal music',
    color: '#2a2a2a',
    emoji: '🤘',
    tags: ['metal', 'music'],
  },
  {
    domain: 'aus.social',
    name: 'Aus Social',
    vibe: 'Australia',
    category: 'regional',
    description: 'Australians and friends — local news, culture, and wildlife pics.',
    blurb: 'Australia',
    color: '#8a7a2a',
    emoji: '🦘',
    tags: ['australia', 'regional'],
  },
  {
    domain: 'tech.lgbt',
    name: 'Tech LGBT',
    vibe: 'LGBTQ+ in tech',
    category: 'tech',
    description: 'LGBTQ+ folks in tech — a safe space to be yourself and talk shop.',
    blurb: 'LGBTQ+ in tech',
    color: '#8a4a8a',
    emoji: '🏳️‍🌈',
    tags: ['lgbtq', 'tech'],
  },
  {
    domain: 'mstdn.ca',
    name: 'mstdn.ca',
    vibe: 'Canada',
    category: 'regional',
    description: 'A Canadian Mastodon community — bilingual-friendly and welcoming.',
    blurb: 'Canada',
    color: '#8a3a3a',
    emoji: '🍁',
    tags: ['canada', 'regional'],
  },
  {
    domain: 'indieweb.social',
    name: 'Indieweb Social',
    vibe: 'Indie web',
    category: 'tech',
    description: 'People building personal websites, blogs, and the open web.',
    blurb: 'Indie web',
    color: '#3a6a8a',
    emoji: '🕸️',
    tags: ['indieweb', 'blogging'],
  },
  {
    domain: 'universeodon.com',
    name: 'Universeodon',
    vibe: 'General & friendly',
    category: 'general',
    description: 'A large general-purpose server with a friendly moderation team.',
    blurb: 'General & friendly',
    color: '#4a5a7a',
    emoji: '🪐',
    tags: ['general'],
  },
]

export const SERVER_CATEGORIES: ServerCategoryDef[] = [
  { id: 'all', label: 'All' },
  { id: 'general', label: 'General' },
  { id: 'art', label: 'Art & photo' },
  { id: 'tech', label: 'Technology' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'music', label: 'Music' },
  { id: 'science', label: 'Science' },
  { id: 'writing', label: 'Writing' },
  { id: 'social', label: 'Social' },
  { id: 'regional', label: 'Regional' },
]

export function useCuratedInstances() {
  const instances = CATALOG

  const categories = SERVER_CATEGORIES

  const featured = computed(() => instances.filter((i) => i.featured))

  const getByCategory = (category: string) => {
    if (category === 'all') return instances
    return instances.filter((i) => i.category === category)
  }

  const search = (query: string): CuratedInstance[] => {
    const q = query.trim().toLowerCase()
    if (!q) return instances
    return instances.filter((i) => {
      const hay = [
        i.domain,
        i.name,
        i.vibe,
        i.blurb,
        i.description,
        i.category,
        ...(i.tags || []),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }

  const getByDomain = (domain: string) =>
    instances.find((i) => i.domain.toLowerCase() === domain.toLowerCase())

  return {
    instances,
    categories,
    featured,
    getByCategory,
    search,
    getByDomain,
  }
}
