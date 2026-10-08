/**
 * Cached plain text for status HTML.
 *
 * stripHtml parses with DOMParser; list templates and find-in-feed filters
 * call it per row per render/keystroke. Cache by the (raw) status object and
 * re-parse only when its `content` string changes (edits).
 */

import { toRaw } from 'vue'
import { stripHtml } from '~/utils/sanitizeHtml'

type HasContent = { content?: string | null }

interface Entry {
  html: string
  text: string
  lower?: string
}

const cache = new WeakMap<object, Entry>()

function entryFor(status: HasContent): Entry {
  const key = toRaw(status) as object
  const html = status.content || ''
  const hit = cache.get(key)
  if (hit && hit.html === html) return hit
  const entry: Entry = { html, text: stripHtml(html) }
  cache.set(key, entry)
  return entry
}

/** Whitespace-collapsed plain text of `status.content` (memoized per status object). */
export function plainTextOf(status: HasContent | null | undefined): string {
  if (!status?.content) return ''
  return entryFor(status).text
}

/** Lower-cased plainTextOf — for case-insensitive find-in-feed matching. */
export function plainTextLowerOf(status: HasContent | null | undefined): string {
  if (!status?.content) return ''
  const entry = entryFor(status)
  return (entry.lower ??= entry.text.toLowerCase())
}
