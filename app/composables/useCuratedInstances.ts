// Curated list of interesting Fediverse instances
// Each has a vibe, category, and description to help users discover

export interface CuratedInstance {
  domain: string
  name: string
  vibe: string
  category: 'art' | 'tech' | 'gaming' | 'social' | 'music' | 'science' | 'writing' | 'general'
  description: string
  color: string // Accent color for the card
  emoji: string
}

export const useCuratedInstances = () => {
  const instances: CuratedInstance[] = [
    {
      domain: 'mastodon.art',
      name: 'Mastodon.art',
      vibe: 'Creative & Visual',
      category: 'art',
      description: 'A cozy home for artists, illustrators, and creative folks. Show your work, get feedback, find inspiration.',
      color: '#e91e63',
      emoji: '🎨'
    },
    {
      domain: 'mastodon.gamedev.place',
      name: 'Gamedev Place',
      vibe: 'Indie & Passionate',
      category: 'gaming',
      description: 'Game developers sharing devlogs, screenshots, and the ups and downs of making games.',
      color: '#9c27b0',
      emoji: '🎮'
    },
    {
      domain: 'fosstodon.org',
      name: 'Fosstodon',
      vibe: 'Open Source & Techy',
      category: 'tech',
      description: 'For lovers of free and open source software. Linux enthusiasts, privacy advocates, and hackers.',
      color: '#4caf50',
      emoji: '🐧'
    },
    {
      domain: 'hachyderm.io',
      name: 'Hachyderm',
      vibe: 'Professional Tech',
      category: 'tech',
      description: 'Tech industry professionals. Engineers, designers, and folks building the future.',
      color: '#2196f3',
      emoji: '💻'
    },
    {
      domain: 'writing.exchange',
      name: 'Writing Exchange',
      vibe: 'Literary & Thoughtful',
      category: 'writing',
      description: 'Writers, authors, poets, and storytellers. Share your words, find your readers.',
      color: '#ff9800',
      emoji: '✍️'
    },
    {
      domain: 'photog.social',
      name: 'Photog Social',
      vibe: 'Visual & Wanderlust',
      category: 'art',
      description: 'Photographers sharing their best shots. Landscapes, portraits, street photography.',
      color: '#00bcd4',
      emoji: '📸'
    },
    {
      domain: 'tabletop.social',
      name: 'Tabletop Social',
      vibe: 'Nerdy & Fun',
      category: 'gaming',
      description: 'Board games, TTRPGs, card games. Roll dice, paint minis, tell stories.',
      color: '#795548',
      emoji: '🎲'
    },
    {
      domain: 'mathstodon.xyz',
      name: 'Mathstodon',
      vibe: 'Nerdy & Academic',
      category: 'science',
      description: 'Mathematicians and math enthusiasts. Proofs, puzzles, and beautiful equations.',
      color: '#673ab7',
      emoji: '🔢'
    },
    {
      domain: 'metalhead.club',
      name: 'Metalhead Club',
      vibe: 'Loud & Proud',
      category: 'music',
      description: 'Metal fans united. Share bands, concerts, and headbanging moments.',
      color: '#212121',
      emoji: '🤘'
    },
    {
      domain: 'mastodon.social',
      name: 'Mastodon Social',
      vibe: 'General & Diverse',
      category: 'general',
      description: 'The flagship instance. A bit of everything and everyone.',
      color: '#6364ff',
      emoji: '🐘'
    },
    {
      domain: 'aus.social',
      name: 'Aus Social',
      vibe: 'Regional & Friendly',
      category: 'social',
      description: 'Australians and friends. Local news, culture, and lots of wildlife pics.',
      color: '#ffeb3b',
      emoji: '🦘'
    },
    {
      domain: 'tech.lgbt',
      name: 'Tech LGBT',
      vibe: 'Inclusive & Techy',
      category: 'tech',
      description: 'LGBTQ+ folks in tech. Safe space to be yourself and talk shop.',
      color: '#e040fb',
      emoji: '🏳️‍🌈'
    }
  ]

  const categories = [
    { id: 'all', label: 'All', emoji: '🌐' },
    { id: 'art', label: 'Art & Design', emoji: '🎨' },
    { id: 'tech', label: 'Technology', emoji: '💻' },
    { id: 'gaming', label: 'Gaming', emoji: '🎮' },
    { id: 'music', label: 'Music', emoji: '🎵' },
    { id: 'science', label: 'Science', emoji: '🔬' },
    { id: 'writing', label: 'Writing', emoji: '✍️' },
    { id: 'social', label: 'Social', emoji: '👋' },
    { id: 'general', label: 'General', emoji: '🐘' }
  ]

  const getByCategory = (category: string) => {
    if (category === 'all') return instances
    return instances.filter(i => i.category === category)
  }

  return {
    instances,
    categories,
    getByCategory
  }
}

