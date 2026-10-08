/**
 * Mastodon direct-message conversations (visibility: direct threads).
 * @see https://docs.joinmastodon.org/methods/conversations/
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { useInstancesStore } from './instances'
import { logWarn } from '~/utils/log'
import { findExactOneToOne } from '~/utils/dmHelpers'
import { clipGraphemes, stripHtml } from '~/utils/stripHtml'

const PAGE_LIMIT = 40
const POLL_MS = 45_000
const POLL_BACKOFF_MAX_MS = 180_000

interface ConversationsState {
  conversations: mastodon.v1.Conversation[]
  isLoading: boolean
  isRefreshing: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: string | null
  loadMoreError: string | null
  quietRefreshFailures: number
}

type LiveRefreshStop = () => void

let pollTimer: ReturnType<typeof setTimeout> | null = null
let focusHandler: (() => void) | null = null
let pollConsumers = 0
let fetchSeq = 0
let pollIntervalMs = POLL_MS

/** Account the cached list belongs to — switching accounts must not mix inboxes */
let listAccountId: string | null = null

/** previewFor runs per row per render — memoize by status (objects are replaced on update) */
const previewCache = new WeakMap<object, string>()

/** Strip leading @mentions from DM preview text */
function previewText(html: string, participantAccts: string[]): string {
  let text = stripHtml(html)
  for (const acct of participantAccts) {
    const handle = acct.startsWith('@') ? acct : `@${acct}`
    const re = new RegExp(`^${handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i')
    text = text.replace(re, '').trim()
  }
  return text
}

export const useConversationsStore = defineStore('conversations', {
  state: (): ConversationsState => ({
    conversations: [],
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    hasMore: true,
    error: null,
    loadMoreError: null,
    quietRefreshFailures: 0,
  }),

  getters: {
    unreadCount: (state): number =>
      state.conversations.filter((c) => c.unread).length,

    badgeLabel(): string {
      const n = this.unreadCount
      if (n <= 0) return ''
      return n > 99 ? '99+' : String(n)
    },
  },

  actions: {
    async fetchConversations(opts: boolean | { force?: boolean; quiet?: boolean } = false) {
      const force = typeof opts === 'boolean' ? opts : !!opts.force
      const quiet = typeof opts === 'object' && !!opts.quiet
      const instancesStore = useInstancesStore()
      if (!instancesStore.hasAuthenticatedInstance) {
        this.conversations = []
        this.hasMore = false
        return
      }
      if ((this.isLoading || this.isRefreshing) && !force) return

      const accountId = instancesStore.activeAccountId
      if (accountId !== listAccountId) {
        this.conversations = []
        this.hasMore = true
        listAccountId = accountId
      }
      const seq = ++fetchSeq
      if (!quiet) {
        if (this.conversations.length) this.isRefreshing = true
        else this.isLoading = true
      }
      this.error = null
      try {
        const client = activeClient()
        const items = await client.v1.conversations.list({
          limit: PAGE_LIMIT,
        })
        if (seq !== fetchSeq) return
        const page = Array.isArray(items) ? items : []
        const pageIds = new Set(page.map((c) => c.id))
        const older = this.conversations.filter((c) => !pageIds.has(c.id))
        const hadExtraPages = older.length > 0
        this.conversations = [...page, ...older]
        if (!hadExtraPages) {
          this.hasMore = page.length >= PAGE_LIMIT
        }
        if (quiet) {
          this.quietRefreshFailures = 0
          pollIntervalMs = POLL_MS
        }
      } catch (e: unknown) {
        if (seq !== fetchSeq) return
        const message = e instanceof Error ? e.message : 'Could not load messages'
        if (!quiet) this.error = message
        else {
          this.quietRefreshFailures += 1
          pollIntervalMs = Math.min(POLL_BACKOFF_MAX_MS, POLL_MS * 2 ** this.quietRefreshFailures)
        }
        logWarn('conversations fetch failed:', e)
      } finally {
        if (seq === fetchSeq) {
          this.isLoading = false
          this.isRefreshing = false
        }
      }
    },

    async loadMore() {
      if (!this.hasMore || this.isLoadingMore || this.isLoading) return
      const last = this.conversations[this.conversations.length - 1]
      if (!last?.id) {
        this.hasMore = false
        return
      }
      this.isLoadingMore = true
      this.loadMoreError = null
      const seq = fetchSeq
      try {
        const client = activeClient()
        const items = await client.v1.conversations.list({
          limit: PAGE_LIMIT,
          maxId: last.id,
        })
        // A refresh / account switch landed meanwhile — this page is stale
        if (seq !== fetchSeq) return
        const batch = Array.isArray(items) ? items : []
        const seen = new Set(this.conversations.map((c) => c.id))
        const fresh = batch.filter((c) => !seen.has(c.id))
        this.conversations = [...this.conversations, ...fresh]
        this.hasMore = batch.length >= PAGE_LIMIT
      } catch (e: unknown) {
        logWarn('conversations loadMore failed:', e)
        this.loadMoreError = e instanceof Error ? e.message : 'Could not load more'
      } finally {
        this.isLoadingMore = false
      }
    },

    markReadLocal(conversationId: string) {
      const idx = this.conversations.findIndex((c) => c.id === conversationId)
      if (idx !== -1 && this.conversations[idx]?.unread) {
        this.conversations[idx] = { ...this.conversations[idx]!, unread: false }
      }
    },

    async markRead(conversationId: string) {
      this.markReadLocal(conversationId)
      try {
        const client = activeClient()
        const updated = await client.v1.conversations.$select(conversationId).read()
        const idx = this.conversations.findIndex((c) => c.id === conversationId)
        if (idx !== -1) {
          this.conversations[idx] = updated
        }
      } catch (e) {
        logWarn('mark conversation read failed:', e)
      }
    },

    async markReadForThread(opts: {
      statusIds: string[]
      accountIds: string[]
    }) {
      if (!this.conversations.length) {
        await this.fetchConversations({ quiet: true })
      }
      const statusSet = new Set(opts.statusIds.filter(Boolean))
      const acctSet = new Set(opts.accountIds.filter(Boolean))

      let match =
        this.conversations.find((c) => c.lastStatus?.id && statusSet.has(c.lastStatus.id)) ||
        null

      if (!match && acctSet.size) {
        match =
          this.conversations.find((c) => {
            const ids = (c.accounts || []).map((a) => a.id)
            return (
              ids.length === acctSet.size && ids.length > 0 && ids.every((id) => acctSet.has(id))
            )
          }) || null
      }

      if (match?.unread) await this.markRead(match.id)
    },

    findDirectWith(accountId: string): mastodon.v1.Conversation | null {
      return findExactOneToOne(this.conversations, accountId)
    },

    async remove(conversationId: string) {
      try {
        const client = activeClient()
        await client.v1.conversations.$select(conversationId).remove()
        this.conversations = this.conversations.filter((c) => c.id !== conversationId)
      } catch (e: unknown) {
        this.error = e instanceof Error ? e.message : 'Could not remove conversation'
        throw e
      }
    },

    async refreshUnreadBadge() {
      await this.fetchConversations({ force: true, quiet: true })
    },

    previewFor(c: mastodon.v1.Conversation, myId?: string | null, myAcct?: string | null): string {
      const status = c.lastStatus
      if (!status?.content) return 'No messages yet'
      let clipped = previewCache.get(status)
      if (clipped === undefined) {
        const participantAccts = (c.accounts || []).map((a) => a.acct).filter(Boolean)
        clipped = clipGraphemes(previewText(status.content, participantAccts), 120)
        previewCache.set(status, clipped)
      }
      const mine =
        (!!myId && status.account.id === myId) ||
        (!!myAcct && status.account.acct?.toLowerCase() === myAcct.toLowerCase())
      return mine ? `You: ${clipped}` : clipped
    },

    startLiveRefresh(): LiveRefreshStop {
      pollConsumers += 1
      if (pollTimer) {
        return () => this.stopLiveRefresh()
      }

      let lastTickAt = 0
      const tick = () => {
        const instancesStore = useInstancesStore()
        if (!instancesStore.hasAuthenticatedInstance) return
        if (typeof document !== 'undefined' && document.hidden) return
        // Returning to the tab fires both visibilitychange and focus — one fetch is enough
        const now = Date.now()
        if (now - lastTickAt < 5000) return
        lastTickAt = now
        void this.fetchConversations({ quiet: true, force: true })
      }

      // Self-rescheduling so failure backoff (pollIntervalMs) actually applies
      const schedule = () => {
        pollTimer = setTimeout(() => {
          tick()
          if (pollTimer) schedule()
        }, pollIntervalMs)
      }
      schedule()
      focusHandler = () => {
        if (typeof document !== 'undefined' && !document.hidden) tick()
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', focusHandler)
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', focusHandler)
      }
      return () => this.stopLiveRefresh()
    },

    stopLiveRefresh() {
      pollConsumers = Math.max(0, pollConsumers - 1)
      if (pollConsumers > 0) return
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      if (focusHandler) {
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', focusHandler)
        }
        if (typeof window !== 'undefined') {
          window.removeEventListener('focus', focusHandler)
        }
        focusHandler = null
      }
    },

    resetQuietRefreshFailures() {
      this.quietRefreshFailures = 0
      pollIntervalMs = POLL_MS
    },
  },
})
