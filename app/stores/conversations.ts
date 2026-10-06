/**
 * Mastodon direct-message conversations (visibility: direct threads).
 * @see https://docs.joinmastodon.org/methods/conversations/
 */

import { defineStore } from 'pinia'
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { useInstancesStore } from './instances'

interface ConversationsState {
  conversations: mastodon.v1.Conversation[]
  isLoading: boolean
  error: string | null
}

export const useConversationsStore = defineStore('conversations', {
  state: (): ConversationsState => ({
    conversations: [],
    isLoading: false,
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
    async fetchConversations(force = false) {
      const instancesStore = useInstancesStore()
      if (!instancesStore.hasAuthenticatedInstance) {
        this.conversations = []
        return
      }
      if (this.isLoading && !force) return

      this.isLoading = true
      this.error = null
      try {
        const client = activeClient()
        const items = (await client.v1.conversations.list({
          limit: 40,
        } as any)) as mastodon.v1.Conversation[]
        this.conversations = Array.isArray(items) ? items : []
      } catch (e: any) {
        this.error = e?.message || 'Could not load messages'
        console.warn('conversations fetch failed:', e)
      } finally {
        this.isLoading = false
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
        console.warn('mark conversation read failed:', e)
      }
    },

    async remove(conversationId: string) {
      try {
        const client = activeClient()
        await client.v1.conversations.$select(conversationId).remove()
        this.conversations = this.conversations.filter((c) => c.id !== conversationId)
      } catch (e: any) {
        this.error = e?.message || 'Could not remove conversation'
      }
    },

    async refreshUnreadBadge() {
      // Light poll for nav badge — reuse list when already warm
      if (this.conversations.length) {
        const n = this.unreadCount
        if (n > 0) return
      }
      await this.fetchConversations(true)
    },
  },
})
