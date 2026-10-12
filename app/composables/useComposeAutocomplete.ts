/**
 * Compose autocomplete — @mentions, #hashtags and :emoji: behind one state
 * machine: shared keyboard navigation, race-safe lookups (stale responses are
 * dropped when the query, token, or account changed) and token-scoped inserts.
 */

import { computed, onUnmounted, ref, watch } from 'vue'
import { activeClient } from '~/composables/useMasto'
import { createRaceGuard } from '~/composables/useRace'
import { useInstancesStore } from '~/stores/instances'
import {
  ALL_TOKEN_KINDS,
  applyToken,
  createKeyedCache,
  filterEmojis,
  findComposeToken,
  insertionFor,
  sameToken,
  type ComposeSuggestion,
  type ComposeToken,
  type ComposeTokenKind,
} from '~/utils/composeTokens'
import { isFeatureAvailable } from '~/utils/serverCapabilities'

const SEARCH_DEBOUNCE_MS = 220
const RESULT_LIMIT = 8
/** custom_emojis rarely changes — cache per instance, shared by every composer */
const EMOJI_TTL_MS = 30 * 60_000
const emojiCache = createKeyedCache<import('masto').mastodon.v1.CustomEmoji[]>(EMOJI_TTL_MS)

export function useComposeAutocomplete(source: {
  text: () => string
  caret: () => number
}) {
  const instancesStore = useInstancesStore()
  const token = ref<ComposeToken | null>(null)
  const items = ref<ComposeSuggestion[]>([])
  /** The token (kind, start, query) the visible rows were fetched for */
  let itemsToken: ComposeToken | null = null
  const searching = ref(false)
  /** How the latest lookup for the current token ended — drives distinct announcements */
  const outcome = ref<'pending' | 'results' | 'empty' | 'failed'>('pending')
  const index = ref(0)
  const race = createRaceGuard()
  let timer: ReturnType<typeof setTimeout> | null = null

  /** Don't offer what the server positively lacks */
  const enabledKinds = computed<ComposeTokenKind[]>(() => {
    const caps = instancesStore.serverCapabilities
    return ALL_TOKEN_KINDS.filter((kind) => {
      if (kind === 'hashtag') return isFeatureAvailable(caps.hashtagSearch)
      if (kind === 'emoji') return isFeatureAvailable(caps.customEmojis)
      return true
    })
  })

  const open = computed(() => !!token.value)
  /** Only claim "expanded" while the listbox element actually exists */
  const listShown = computed(
    () => open.value && (searching.value || items.value.length > 0 || outcome.value === 'failed'),
  )

  const clearTimer = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const close = () => {
    clearTimer()
    race.abort()
    token.value = null
    outcome.value = 'pending'
    itemsToken = null
    if (items.value.length) items.value = []
    searching.value = false
    index.value = 0
  }

  const fetchFor = async (t: ComposeToken): Promise<ComposeSuggestion[]> => {
    const client = activeClient()
    if (t.kind === 'mention') {
      const found = await client.v1.accounts.search.list({
        q: t.query,
        limit: RESULT_LIMIT,
        resolve: t.query.includes('@'),
      })
      return (Array.isArray(found) ? found : []).map((account) => ({
        kind: 'mention' as const,
        key: account.id,
        account,
      }))
    }
    if (t.kind === 'hashtag') {
      const res = await client.v2.search.list({ q: t.query, type: 'hashtags', limit: RESULT_LIMIT })
      return (res.hashtags ?? []).slice(0, RESULT_LIMIT).map((tag) => {
        const uses = Number(tag.history?.[0]?.uses)
        return {
          kind: 'hashtag' as const,
          key: tag.name,
          name: tag.name,
          uses: Number.isFinite(uses) ? uses : null,
        }
      })
    }
    const url = instancesStore.activeAccount?.url ?? ''
    const list = await emojiCache.get(url, async () => await client.v1.customEmojis.list())
    return filterEmojis(list, t.query, RESULT_LIMIT)
  }

  const run = (t: ComposeToken) => {
    clearTimer()
    const accountId = instancesStore.activeAccountId
    const ticket = race.next()
    // Lone "@" — nothing to look up yet
    if (t.kind === 'mention' && !t.query) {
      items.value = []
      itemsToken = null
      outcome.value = 'pending'
      searching.value = false
      return
    }
    outcome.value = 'pending'
    searching.value = true
    const stillValid = () =>
      ticket.isCurrent() &&
      accountId === instancesStore.activeAccountId &&
      sameToken(token.value, t)
    timer = setTimeout(
      async () => {
        timer = null
        try {
          const found = await fetchFor(t)
          if (stillValid()) {
            itemsToken = t
            items.value = found
            outcome.value = found.length ? 'results' : 'empty'
          }
        } catch {
          if (stillValid()) {
            itemsToken = null
            items.value = []
            outcome.value = 'failed'
          }
        } finally {
          if (ticket.isCurrent()) searching.value = false
        }
      },
      t.kind === 'emoji' ? 0 : SEARCH_DEBOUNCE_MS,
    )
  }

  /** Re-read the caret/text; call on input, click and non-navigation keyup. */
  const sync = () => {
    if (!instancesStore.isAuthenticated) return close()
    const next = findComposeToken(source.text(), source.caret(), enabledKinds.value)
    if (!next) return close()
    const prev = token.value
    if (sameToken(prev, next)) return // caret moved inside the same token — no refetch
    // Rows fetched for another token, kind or query text must never linger under a new one
    if (!prev || prev.kind !== next.kind || prev.start !== next.start || prev.query !== next.query) {
      itemsToken = null
      outcome.value = 'pending'
      items.value = []
    }
    index.value = 0
    token.value = next
    run(next)
  }

  // Suggestions are account-scoped (mentions resolve on that account's server, emoji per
  // instance): close at once and drop in-flight lookups so none of A's rows stay selectable as B
  watch(
    () => instancesStore.activeAccount?.id ?? null,
    () => close(),
  )

  // Fresh results can be shorter than the old list — keep the highlight on a real row
  watch(items, (list) => {
    if (index.value >= list.length) index.value = 0
  })

  const move = (delta: number) => {
    const n = items.value.length
    if (!n) return
    index.value = (index.value + delta + n) % n
  }

  /**
   * Resolve a suggestion against the *current* text. Returns the new text and
   * caret, or null when the token has moved on (never clobbers other text).
   */
  const pick = (item: ComposeSuggestion): { text: string; caret: number } | null => {
    const current = findComposeToken(source.text(), source.caret(), enabledKinds.value)
    const t = token.value
    if (!current || !t || current.kind !== item.kind || current.start !== t.start) return null
    // The row must belong to the query that's under the caret now, not an earlier one
    if (!itemsToken || !sameToken(itemsToken, current)) return null
    const out = applyToken(source.text(), current, insertionFor(item))
    close()
    return out
  }

  /** Shared keyboard handling. Returns the chosen item, or `true`/`false` if handled. */
  const handleKeydown = (e: KeyboardEvent): { picked: ComposeSuggestion } | boolean => {
    if (!open.value) return false
    // Escape dismisses the popup even while it's still searching (or empty) — and, being
    // handled, never reaches the containing sheet's own Escape handling
    if (e.key === 'Escape' && listShown.value) {
      close()
      return true
    }
    if (!items.value.length) return false
    if (e.key === 'ArrowDown') {
      move(1)
      return true
    }
    if (e.key === 'ArrowUp') {
      move(-1)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const picked = items.value[index.value]
      return picked ? { picked } : true
    }
    return false
  }

  const activeId = (listId: string) => {
    const it = items.value[index.value]
    return it ? `${listId}-${it.key}` : undefined
  }

  onUnmounted(() => {
    clearTimer()
    race.abort()
  })

  return {
    token,
    items,
    searching,
    outcome,
    index,
    open,
    listShown,
    sync,
    close,
    pick,
    handleKeydown,
    activeId,
  }
}
