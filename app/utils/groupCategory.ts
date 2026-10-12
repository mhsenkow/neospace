/**
 * Group / hashtag category colours — CSS token names shared by sidebar and cards.
 */

export type GroupCategoryKey =
  | 'tech'
  | 'creative'
  | 'gaming'
  | 'social'
  | 'news'
  | 'trending'
  | 'local'
  | 'other'

const CATEGORY_KEYS = new Set<string>([
  'tech',
  'creative',
  'gaming',
  'social',
  'news',
  'trending',
  'local',
  'other',
])

export function normalizeGroupCategory(category: string): GroupCategoryKey {
  return CATEGORY_KEYS.has(category) ? (category as GroupCategoryKey) : 'other'
}

export function categoryColor(category: string): string {
  return `var(--neo-cat-${normalizeGroupCategory(category)})`
}

export function categoryTint(category: string): string {
  return `color-mix(in srgb, ${categoryColor(category)} 13%, transparent)`
}
