/**
 * Map a hashtag token to a coarse group category (token-exact, not substring).
 */

export type GroupCategoryGuess =
  | 'tech'
  | 'creative'
  | 'gaming'
  | 'social'
  | 'news'
  | 'other'

const CATEGORY_KEYWORDS: Array<{ category: GroupCategoryGuess; words: string[] }> = [
  {
    category: 'tech',
    words: [
      'tech', 'linux', 'foss', 'opensource', 'privacy', 'security', 'coding', 'programming',
      'python', 'javascript', 'webdev', 'ai', 'ml', 'selfhost', 'nixos', 'android', 'ios',
      'fediverse', 'mastodon', 'activitypub', 'infosec', 'cyber',
    ],
  },
  {
    category: 'creative',
    words: [
      'art', 'photo', 'music', 'book', 'write', 'poem', 'design', 'film', 'movie', 'craft',
      'draw', 'paint', 'illustration', 'animation', 'mastoart', 'nature', 'landscape',
    ],
  },
  {
    category: 'gaming',
    words: ['game', 'gaming', 'gamedev', 'steam', 'nintendo', 'playstation', 'xbox', 'rpg', 'indie'],
  },
  {
    category: 'social',
    words: [
      'cat', 'dog', 'food', 'cook', 'garden', 'travel', 'parent', 'lgbt', 'disability',
      'mentalhealth', 'introduction', 'ask', 'help', 'friend',
    ],
  },
  {
    category: 'news',
    words: ['news', 'politics', 'climate', 'science', 'world', 'election', 'breaking'],
  },
]

/** Tokenize so 'ai' does not match rain/Taiwan/mail, 'cat' does not match education */
export function guessCategory(tag: string): GroupCategoryGuess {
  const lower = tag.toLowerCase()
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  const tokenSet = new Set(tokens)
  for (const bucket of CATEGORY_KEYWORDS) {
    if (bucket.words.some((w) => tokenSet.has(w))) {
      return bucket.category
    }
  }
  return 'other'
}
