/**
 * Mastodon direct-message conversations (visibility: direct threads).
 * @see https://docs.joinmastodon.org/methods/conversations/
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { useInstancesStore } from './instances'
import { logWarn } from '~/utils/log'

const PAGE_LIMIT = 40
const POLL_MS = 45_000

interface ConversationsState {
  conversations: mastodon.v1.Conversation[]
  isLoading: boolean
  isRefreshing: boolean
  isLoadingMore: boolean
  hasMore: boolean
  error: string | null
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let focusHandler: (() => void) | null = null
let pollConsumers = 0

const stripHtml = (html: string) =>
  html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

export const useConversationsStore = defineStore('conversations', {
  state: (): ConversationsState => ({
    conversations: [],
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    hasMore: true,
    error: null,
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

      if (quiet || this.conversations.length) this.isRefreshing = true
      else this.isLoading = true
      this.error = null
      try {
        const client = activeClient()
        const items = (await client.v1.conversations.list({
          limit: PAGE_LIMIT,
        } as any)) as mastodon.v1.Conversation[]
        this.conversations = Array.isArray(items) ? items : []
        this.hasMore = this.conversations.length >= PAGE_LIMIT
      } catch (e: any) {
        if (!quiet) this.error = e?.message || 'Could not load messages'
        logWarn('conversations fetch failed:', e)
      } finally {
        this.isLoading = false
        this.isRefreshing = false
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
      try {
        const client = activeClient()
        const items = (await client.v1.conversations.list({
          limit: PAGE_LIMIT,
          maxId: last.id,
        } as any)) as mastodon.v1.Conversation[]
        const batch = Array.isArray(items) ? items : []
        const seen = new Set(this.conversations.map((c) => c.id))
        const fresh = batch.filter((c) => !seen.has(c.id))
        this.conversations = [...this.conversations, ...fresh]
        this.hasMore = batch.length >= PAGE_LIMIT
      } catch (e) {
        logWarn('conversations loadMore failed:', e)
        this.hasMore = false
      } finally {
        this.isLoadingMore = false
      }
    },

    async markRead(conversationId: string) {
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

    /**
     * Mark the conversation matching this DM thread as read.
     * Matches by last_status id, any known status id, or participant set.
     */
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
            if (!ids.length) return false
            // Prefer exact participant set
            if (ids.length === acctSet.size && ids.every((id) => acctSet.has(id))) return true
            return false
          }) ||
          this.conversations.find((c) =>
            (c.accounts || []).some((a) => acctSet.has(a.id)),
          ) ||
          null
      }

      if (match?.unread) await this.markRead(match.id)
    },

    /** 1:1 DM with this account, else any conversation that includes them */
    findDirectWith(accountId: string): mastodon.v1.Conversation | null {
      if (!accountId) return null
      const exact = this.conversations.find((c) => {
        const ids = (c.accounts || []).map((a) => a.id)
        return ids.length === 1 && ids[0] === accountId
      })
      if (exact) return exact
      return (
        this.conversations.find((c) => (c.accounts || []).some((a) => a.id === accountId)) ||
        null
      )
    },

    async remove(conversationId: string) {
      try {
        const client = activeClient()
        await client.v1.conversations.$select(conversationId).remove()
        this.conversations = this.conversations.filter((c) => c.id !== conversationId)
      } catch (e: any) {
        this.error = e?.message || 'Could not remove conversation'
        throw e
      }
    },

    async refreshUnreadBadge() {
      await this.fetchConversations({ force: true, quiet: true })
    },

    /** Preview line with “You:” when the last message is ours */
    previewFor(c: mastodon.v1.Conversation, myId?: string | null, myAcct?: string | null): string {
      const status = c.lastStatus
      if (!status?.content) return 'No messages yet'
      const text = stripHtml(status.content)
      const clipped = text.length > 120 ? `${text.slice(0, 120)}…` : text
      const mine =
        (!!myId && status.account.id === myId) ||
        (!!myAcct && status.account.acct?.toLowerCase() === myAcct.toLowerCase())
      return mine ? `You: ${clipped}` : clipped
    },

    startLiveRefresh() {
      pollConsumers += 1
      if (pollTimer) return

      const tick = () => {
        const instancesStore = useInstancesStore()
        if (!instancesStore.hasAuthenticatedInstance) return
        if (typeof document !== 'undefined' && document.hidden) return
        void this.fetchConversations({ quiet: true, force: true })
      }

      pollTimer = setInterval(tick, POLL_MS)
      focusHandler = () => {
        if (typeof document !== 'undefined' && !document.hidden) tick()
      }
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', focusHandler)
      }
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', focusHandler)
      }
    },

    stopLiveRefresh() {
      pollConsumers = Math.max(0, pollConsumers - 1)
      if (pollConsumers > 0) return
      if (pollTimer) {
        clearInterval(pollTimer)
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
  },
})
