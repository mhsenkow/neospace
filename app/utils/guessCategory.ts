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
      'art', 'photo', 'photography', 'music', 'book', 'write', 'poem', 'design', 'film', 'movie', 'craft',
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

/**
 * Plural / -ing forms of a keyword ("cats", "books", "cooking", "writing") —
 * token-exact alone sent most real tags to Other. Short words (ai, ml, ios)
 * stay exact so they can't pick up stray suffixes.
 */
function tokenMatches(token: string, word: string): boolean {
  if (token === word) return true
  if (word.length < 3) return false
  if (token === `${word}s` || token === `${word}es` || token === `${word}ing`) return true
  return word.endsWith('e') && token === `${word.slice(0, -1)}ing`
}

/** Tokenize so 'ai' does not match rain/Taiwan/mail, 'cat' does not match education */
export function guessCategory(tag: string): GroupCategoryGuess {
  const lower = tag.toLowerCase()
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean)
  for (const bucket of CATEGORY_KEYWORDS) {
    if (bucket.words.some((w) => tokens.some((t) => tokenMatches(t, w)))) {
      return bucket.category
    }
  }
  return 'other'
}
