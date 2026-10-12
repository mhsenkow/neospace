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

/** Software as classified by the probe (distinct from the capability matrix in serverCapabilities) */
export type CuratedSoftware =
  | 'mastodon'
  | 'glitch'
  | 'hometown'
  | 'pleroma'
  | 'akkoma'
  | 'iceshrimp'
  | 'sharkey'
  | 'gotosocial'
  | 'other'

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
  /** Server software, from the entry's own /api/v2/instance (scripts/probe-instances.mjs) */
  software?: CuratedSoftware
  /** ISO date when this entry was last verified still online (set by the probe script) */
  verifiedAt?: string
  /** Soft accent for cards (instrument chrome, not Meta purple) */
  color: string
  emoji: string
  tags?: string[]
}

export interface ServerCategoryDef {
  id: string
  label: string
}

/** Hide catalogue entries the probe has not refreshed within this window. */
const VERIFIED_MAX_AGE_DAYS = 120

function catalogEntryFresh(entry: CuratedInstance, now = Date.now()): boolean {
  if (!entry.verifiedAt) return true
  const t = Date.parse(`${entry.verifiedAt}T12:00:00Z`)
  if (!Number.isFinite(t)) return true
  return now - t <= VERIFIED_MAX_AGE_DAYS * 86_400_000
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'glitch',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'glitch',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'glitch',
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
    verifiedAt: '2026-10-12',
    software: 'glitch',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
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
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#4a5a7a',
    emoji: '🪐',
    tags: ['general'],
  },
  {
    domain: 'mstdn.social',
    name: 'mstdn.social',
    vibe: 'General European',
    category: 'general',
    description: 'A large, well-moderated general server popular across Europe.',
    blurb: 'General · EU',
    featured: true,
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#5a6a8a',
    emoji: '🇪🇺',
    tags: ['general', 'europe'],
  },
  {
    domain: 'mas.to',
    name: 'mas.to',
    vibe: 'General & breezy',
    category: 'general',
    description: 'A straightforward general-purpose Mastodon home.',
    blurb: 'General',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#6a5a4a',
    emoji: '🏠',
    tags: ['general'],
  },
  {
    domain: 'social.vivaldi.net',
    name: 'Vivaldi Social',
    vibe: 'Vivaldi browser community',
    category: 'tech',
    description: 'Run by the Vivaldi team — browsers, privacy, and the open web.',
    blurb: 'Vivaldi community',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#ef3939',
    emoji: '🧭',
    tags: ['vivaldi', 'browser', 'tech'],
  },
  {
    domain: 'ruby.social',
    name: 'Ruby Social',
    vibe: 'Ruby & Rails',
    category: 'tech',
    description: 'Rubyists, Rails folks, and friends talking code and craft.',
    blurb: 'Ruby & Rails',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#a33a3a',
    emoji: '💎',
    tags: ['ruby', 'rails', 'dev'],
  },
  {
    domain: 'chaos.social',
    name: 'chaos.social',
    vibe: 'Hackers & makers',
    category: 'tech',
    description: 'Chaos Computer Club–adjacent: hackers, makers, and digital rights.',
    blurb: 'Hackers & CCC',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#2a6a4a',
    emoji: '⚡',
    tags: ['hacker', 'ccc', 'privacy'],
  },
  {
    domain: 'social.coop',
    name: 'social.coop',
    vibe: 'Cooperative ownership',
    category: 'social',
    description: 'A cooperatively owned Mastodon — democratic, member-run.',
    blurb: 'Co-op owned',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#4a7a5a',
    emoji: '🤝',
    tags: ['coop', 'solidarity'],
  },
  {
    domain: 'kolektiva.social',
    name: 'Kolektiva',
    vibe: 'Left & mutual aid',
    category: 'social',
    description: 'Anarchist and left communities — mutual aid, organizing, and culture.',
    blurb: 'Left & mutual aid',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#8a3a4a',
    emoji: '🌹',
    tags: ['anarchist', 'mutualaid'],
  },
  {
    domain: 'blacktwitter.io',
    name: 'Black Twitter',
    vibe: 'Black community',
    category: 'social',
    description: 'A Mastodon home centered on Black voices and culture.',
    blurb: 'Black community',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a3a3a',
    emoji: '🖤',
    tags: ['black', 'culture'],
  },
  {
    domain: 'disabled.social',
    name: 'disabled.social',
    vibe: 'Disability community',
    category: 'social',
    description: 'Disability justice, accessibility, and chronically ill community.',
    blurb: 'Disability community',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#5a6a9a',
    emoji: '♿',
    tags: ['disability', 'a11y'],
  },
  {
    domain: 'beige.party',
    name: 'beige.party',
    vibe: 'Queer & cozy',
    category: 'social',
    description: 'A queer-friendly general server with a warm, conversational vibe.',
    blurb: 'Queer & cozy',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#c4a574',
    emoji: '✨',
    tags: ['lgbtq', 'general'],
  },
  {
    domain: 'grapheneos.social',
    name: 'GrapheneOS Social',
    vibe: 'Privacy & Android',
    category: 'tech',
    description: 'GrapheneOS community — private Android, security, and FOSS phones.',
    blurb: 'GrapheneOS',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a5a7a',
    emoji: '📱',
    tags: ['privacy', 'android', 'graphene'],
  },
  {
    domain: 'mastodon.sdf.org',
    name: 'SDF Mastodon',
    vibe: 'Classic public access',
    category: 'tech',
    description: 'Mastodon for the long-running SDF public-access unix community.',
    blurb: 'SDF · unix culture',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#4a6a4a',
    emoji: '🖥️',
    tags: ['unix', 'sdf', 'retro', 'mastodon'],
  },
  {
    domain: 'scholar.social',
    name: 'Scholar Social',
    vibe: 'Academia',
    category: 'science',
    description: 'Academics, researchers, and grad students across disciplines.',
    blurb: 'Academia',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#4a5a8a',
    emoji: '🎓',
    tags: ['academia', 'research'],
  },
  {
    domain: 'fediscience.org',
    name: 'FediScience',
    vibe: 'Scientists',
    category: 'science',
    description: 'Scientists sharing papers, fieldwork, and open science.',
    blurb: 'Scientists',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a7a6a',
    emoji: '🔬',
    tags: ['science', 'research'],
  },
  {
    domain: 'neuromatch.social',
    name: 'Neuromatch',
    vibe: 'Neuroscience',
    category: 'science',
    description: 'Neuroscience and computational brain science community.',
    blurb: 'Neuroscience',
    verifiedAt: '2026-10-12',
    software: 'glitch',
    color: '#6a4a8a',
    emoji: '🧠',
    tags: ['neuro', 'science'],
  },
  {
    domain: 'musicworld.social',
    name: 'Music World',
    vibe: 'Musicians & fans',
    category: 'music',
    description: 'Musicians, producers, and listeners across genres.',
    blurb: 'Music community',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#7a4a6a',
    emoji: '🎵',
    tags: ['music'],
  },
  {
    domain: 'hear-me.social',
    name: 'Hear Me',
    vibe: 'Audio & podcasts',
    category: 'music',
    description: 'Podcasts, radio, and people who think in sound.',
    blurb: 'Audio & podcasts',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#5a4a7a',
    emoji: '🎙️',
    tags: ['podcast', 'audio'],
  },
  {
    domain: 'dice.camp',
    name: 'Dice Camp',
    vibe: 'TTRPGs',
    category: 'gaming',
    description: 'Tabletop RPG players and GMs — systems, sessions, and stories.',
    blurb: 'TTRPGs',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#6a4a3a',
    emoji: '♟️',
    tags: ['ttrpg', 'rpg'],
  },
  {
    domain: 'sunny.garden',
    name: 'Sunny Garden',
    vibe: 'Cozy general',
    category: 'general',
    description: 'A smaller, carefully tended general server with a gentle pace.',
    blurb: 'Cozy general',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#7a8a4a',
    emoji: '🌻',
    tags: ['cozy', 'general'],
  },
  {
    domain: 'mstdn.jp',
    name: 'mstdn.jp',
    vibe: 'Japan',
    category: 'regional',
    description: 'One of the largest Japanese-language Mastodon communities.',
    blurb: 'Japan',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#8a4a5a',
    emoji: '🇯🇵',
    tags: ['japan', 'japanese'],
  },
  {
    domain: 'mastodon.nz',
    name: 'Mastodon NZ',
    vibe: 'Aotearoa / NZ',
    category: 'regional',
    description: 'New Zealanders and friends — local news, nature, and chat.',
    blurb: 'New Zealand',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a6a5a',
    emoji: '🥝',
    tags: ['nz', 'aotearoa'],
  },
  {
    domain: 'mastodon.ie',
    name: 'Mastodon Ireland',
    vibe: 'Ireland',
    category: 'regional',
    description: 'Irish Mastodon — news, culture, and a bit of craic.',
    blurb: 'Ireland',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a7a4a',
    emoji: '☘️',
    tags: ['ireland', 'irish'],
  },
  {
    domain: 'mastodon.scot',
    name: 'Mastodon Scotland',
    vibe: 'Scotland',
    category: 'regional',
    description: 'Scottish community on the Fediverse.',
    blurb: 'Scotland',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a4a7a',
    emoji: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    tags: ['scotland'],
  },
  {
    domain: 'mastodon.cloud',
    name: 'Mastodon Cloud',
    vibe: 'General (FR/EU)',
    category: 'general',
    description: 'A long-running European general server.',
    blurb: 'General · EU',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#4a6a8a',
    emoji: '☁️',
    tags: ['general', 'europe'],
  },
  {
    domain: 'piaille.fr',
    name: 'Piaille',
    vibe: 'Francophone',
    category: 'regional',
    description: 'A popular French-language Mastodon community.',
    blurb: 'Francophone',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a5a9a',
    emoji: '🇫🇷',
    tags: ['france', 'french'],
  },
  {
    domain: 'mastodon.green',
    name: 'Mastodon Green',
    vibe: 'Climate & environment',
    category: 'science',
    description: 'Climate, ecology, and environmental action.',
    blurb: 'Climate',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#3a8a4a',
    emoji: '🌍',
    tags: ['climate', 'environment'],
  },
  {
    domain: 'journa.host',
    name: 'Journa.host',
    vibe: 'Journalists',
    category: 'writing',
    description: 'Journalists and newsroom folks on the open social web.',
    blurb: 'Journalists',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#5a5a6a',
    emoji: '📰',
    tags: ['journalism', 'news'],
  },
  {
    domain: 'c.im',
    name: 'C.IM',
    vibe: 'General & chatty',
    category: 'general',
    description: 'A busy general-purpose server with an active timeline.',
    blurb: 'General',
    verifiedAt: '2026-10-12',
    software: 'mastodon',
    color: '#6a5a7a',
    emoji: '💬',
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
  const instances = CATALOG.filter(catalogEntryFresh)

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
