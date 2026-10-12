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
    words: ['game', 'gaming', 'gamedev', 'nintendo', 'playstation', 'xbox', 'rpg'],
  },
  {
    category: 'social',
    words: [
      'cat', 'dog', 'food', 'cook', 'garden', 'travel', 'parent', 'lgbt', 'disability',
      'mentalhealth', 'introduction', 'friend',
    ],
  },
  {
    category: 'news',
    words: ['news', 'politics', 'climate', 'science', 'election', 'breaking'],
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
  // Split camelCase / letter-digit boundaries *before* lowercasing: most real tags are
  // concatenated words (CatsOfMastodon, LinuxGaming) and would otherwise be one token
  const tokens = tag
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)|(\d)([a-zA-Z])/g, '$1$3 $2$4')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  for (const bucket of CATEGORY_KEYWORDS) {
    if (bucket.words.some((w) => tokens.some((t) => tokenMatches(t, w)))) {
      return bucket.category
    }
  }
  return 'other'
}
