<script setup lang="ts">
/**
 * Enhanced Followers/Following Modal
 * 
 * Shows followers/following with their recent post and quick actions
 * Inspired by Threads but better
 */

import { ref, computed, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useTimelineStore } from '~/stores/timeline'
import { createRestAPIClient, type mastodon } from 'masto'

const authStore = useAuthStore()
const timelineStore = useTimelineStore()

const props = defineProps<{
  accountId?: string
  initialTab?: 'followers' | 'following'
}>()

const isOpen = ref(false)
const activeTab = ref<'followers' | 'following'>('following')
const isLoading = ref(false)
const accounts = ref<mastodon.v1.Account[]>([])
const recentPosts = ref<Record<string, mastodon.v1.Status | null>>({})
const relationships = ref<Record<string, mastodon.v1.Relationship>>({})
const loadingActions = ref<Record<string, boolean>>({})

// Pagination
const nextPageUrl = ref<string | null>(null)
const hasMore = ref(true)

const open = (tab?: 'followers' | 'following') => {
  if (tab) activeTab.value = tab
  isOpen.value = true
  loadAccounts()
}

const close = () => {
  isOpen.value = false
  accounts.value = []
  recentPosts.value = {}
  relationships.value = {}
}

const getClient = () => {
  if (!authStore.instanceUrl || !authStore.accessToken) {
    throw new Error('Not authenticated')
  }
  return createRestAPIClient({
    url: authStore.instanceUrl,
    accessToken: authStore.accessToken,
  })
}

const loadAccounts = async () => {
  if (!authStore.isAuthenticated) return
  
  isLoading.value = true
  accounts.value = []
  recentPosts.value = {}
  
  try {
    const client = getClient()
    const accountId = props.accountId || authStore.currentUser?.id
    
    if (!accountId) return
    
    // Fetch followers or following
    let fetchedAccounts: mastodon.v1.Account[]
    if (activeTab.value === 'followers') {
      fetchedAccounts = await client.v1.accounts.$select(accountId).followers.list({ limit: 20 })
    } else {
      fetchedAccounts = await client.v1.accounts.$select(accountId).following.list({ limit: 20 })
    }
    
    accounts.value = fetchedAccounts
    hasMore.value = fetchedAccounts.length === 20
    
    // Fetch relationships for all accounts
    if (fetchedAccounts.length > 0) {
      const accountIds = fetchedAccounts.map(a => a.id)
      const rels = await client.v1.accounts.relationships.fetch({ id: accountIds })
      rels.forEach(rel => {
        relationships.value[rel.id] = rel
      })
    }
    
    // Fetch recent post for each account (in parallel, limited)
    await loadRecentPosts(fetchedAccounts.slice(0, 10))
    
  } catch (e) {
    console.error('Failed to load accounts:', e)
  } finally {
    isLoading.value = false
  }
}

const loadRecentPosts = async (accountsList: mastodon.v1.Account[]) => {
  const client = getClient()
  
  const promises = accountsList.map(async (account) => {
    try {
      const statuses = await client.v1.accounts.$select(account.id).statuses.list({
        limit: 1,
        excludeReplies: true,
        excludeReblogs: true,
      })
      recentPosts.value[account.id] = statuses[0] || null
    } catch (e) {
      recentPosts.value[account.id] = null
    }
  })
  
  await Promise.all(promises)
}

const loadMore = async () => {
  if (!hasMore.value || isLoading.value) return
  
  isLoading.value = true
  try {
    const client = getClient()
    const accountId = props.accountId || authStore.currentUser?.id
    if (!accountId) return
    
    const lastAccount = accounts.value[accounts.value.length - 1]
    
    let fetchedAccounts: mastodon.v1.Account[]
    if (activeTab.value === 'followers') {
      fetchedAccounts = await client.v1.accounts.$select(accountId).followers.list({ 
        limit: 20,
        maxId: lastAccount?.id 
      })
    } else {
      fetchedAccounts = await client.v1.accounts.$select(accountId).following.list({ 
        limit: 20,
        maxId: lastAccount?.id 
      })
    }
    
    accounts.value.push(...fetchedAccounts)
    hasMore.value = fetchedAccounts.length === 20
    
    // Fetch relationships
    if (fetchedAccounts.length > 0) {
      const accountIds = fetchedAccounts.map(a => a.id)
      const rels = await client.v1.accounts.relationships.fetch({ id: accountIds })
      rels.forEach(rel => {
        relationships.value[rel.id] = rel
      })
    }
    
    // Load recent posts for new accounts
    await loadRecentPosts(fetchedAccounts.slice(0, 10))
    
  } catch (e) {
    console.error('Failed to load more:', e)
  } finally {
    isLoading.value = false
  }
}

// Actions
const handleFollow = async (accountId: string) => {
  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    const rel = relationships.value[accountId]
    
    if (rel?.following) {
      await client.v1.accounts.$select(accountId).unfollow()
      relationships.value[accountId] = { ...rel, following: false }
    } else {
      await client.v1.accounts.$select(accountId).follow()
      relationships.value[accountId] = { ...rel, following: true }
    }
  } catch (e) {
    console.error('Follow action failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

const handleMute = async (accountId: string) => {
  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    const rel = relationships.value[accountId]
    
    if (rel?.muting) {
      await client.v1.accounts.$select(accountId).unmute()
      relationships.value[accountId] = { ...rel, muting: false }
    } else {
      await client.v1.accounts.$select(accountId).mute()
      relationships.value[accountId] = { ...rel, muting: true }
    }
  } catch (e) {
    console.error('Mute action failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

const handleBlock = async (accountId: string) => {
  if (!confirm('Are you sure you want to block this account?')) return
  
  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    await client.v1.accounts.$select(accountId).block()
    
    // Remove from list
    accounts.value = accounts.value.filter(a => a.id !== accountId)
  } catch (e) {
    console.error('Block action failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

const handleRemoveFollower = async (accountId: string) => {
  if (!confirm('Remove this follower? They can still follow you again.')) return
  
  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    await client.v1.accounts.$select(accountId).removeFromFollowers()
    
    // Remove from list
    accounts.value = accounts.value.filter(a => a.id !== accountId)
  } catch (e) {
    console.error('Remove follower failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

// Helper to strip HTML
const stripHtml = (html: string) => {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent || ''
}

// Format date
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Watch for tab changes
watch(activeTab, () => {
  if (isOpen.value) {
    loadAccounts()
  }
})

// Expose methods
defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="isOpen" class="followers-modal-overlay" @click.self="close">
        <div class="followers-modal">
          <!-- Header with tabs -->
          <header class="modal-header">
            <div class="modal-tabs">
              <button 
                class="modal-tab"
                :class="{ 'modal-tab--active': activeTab === 'followers' }"
                @click="activeTab = 'followers'"
              >
                Followers
              </button>
              <button 
                class="modal-tab"
                :class="{ 'modal-tab--active': activeTab === 'following' }"
                @click="activeTab = 'following'"
              >
                Following
              </button>
            </div>
            <button class="close-btn" @click="close" aria-label="Close">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </header>

          <!-- Content -->
          <div class="modal-content">
            <!-- Loading state -->
            <div v-if="isLoading && accounts.length === 0" class="loading-state">
              <span class="spinner">🌀</span>
              <p>Loading...</p>
            </div>

            <!-- Empty state -->
            <div v-else-if="accounts.length === 0" class="empty-state">
              <span>👤</span>
              <p>{{ activeTab === 'followers' ? 'No followers yet' : 'Not following anyone yet' }}</p>
            </div>

            <!-- Account list -->
            <div v-else class="account-list">
              <div 
                v-for="account in accounts" 
                :key="account.id"
                class="account-card"
              >
                <!-- Account Info Row -->
                <div class="account-row">
                  <a :href="account.url" target="_blank" class="account-avatar">
                    <img :src="account.avatar" :alt="account.displayName || account.username" />
                  </a>
                  
                  <div class="account-info">
                    <a :href="account.url" target="_blank" class="account-name">
                      {{ account.displayName || account.username }}
                      <span v-if="account.bot" class="bot-badge">🤖</span>
                    </a>
                    <span class="account-handle">@{{ account.acct }}</span>
                  </div>
                  
                  <!-- Quick Actions -->
                  <div class="account-actions">
                    <button 
                      v-if="activeTab === 'following'"
                      class="action-btn"
                      :class="{ 
                        'action-btn--following': relationships[account.id]?.following,
                        'action-btn--loading': loadingActions[account.id]
                      }"
                      :disabled="loadingActions[account.id]"
                      @click="handleFollow(account.id)"
                    >
                      {{ relationships[account.id]?.following ? 'Following' : 'Follow' }}
                    </button>
                    
                    <div class="action-menu">
                      <button class="action-menu-trigger" aria-label="More actions">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2"/>
                          <circle cx="12" cy="12" r="2"/>
                          <circle cx="12" cy="19" r="2"/>
                        </svg>
                      </button>
                      <div class="action-menu-dropdown">
                        <button @click="handleMute(account.id)">
                          {{ relationships[account.id]?.muting ? '🔊 Unmute' : '🔇 Mute' }}
                        </button>
                        <button @click="handleBlock(account.id)" class="danger">
                          🚫 Block
                        </button>
                        <button 
                          v-if="activeTab === 'followers'"
                          @click="handleRemoveFollower(account.id)"
                          class="danger"
                        >
                          ✖️ Remove follower
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Recent Post Preview -->
                <div v-if="recentPosts[account.id]" class="recent-post">
                  <div class="recent-post-header">
                    <span class="recent-post-label">Latest post</span>
                    <span class="recent-post-date">{{ formatDate(recentPosts[account.id]!.createdAt) }}</span>
                  </div>
                  <p class="recent-post-content">
                    {{ stripHtml(recentPosts[account.id]!.content).slice(0, 120) }}{{ stripHtml(recentPosts[account.id]!.content).length > 120 ? '...' : '' }}
                  </p>
                  <div v-if="recentPosts[account.id]!.mediaAttachments?.length" class="recent-post-media">
                    <span>📷 {{ recentPosts[account.id]!.mediaAttachments.length }} media</span>
                  </div>
                </div>
                <div v-else-if="recentPosts[account.id] === null" class="no-recent-post">
                  <span>No recent posts</span>
                </div>
              </div>

              <!-- Load More -->
              <button 
                v-if="hasMore" 
                class="load-more-btn"
                :disabled="isLoading"
                @click="loadMore"
              >
                {{ isLoading ? 'Loading...' : 'Load more' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.followers-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.followers-modal {
  background: var(--neo-bg-primary);
  border-radius: 16px;
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 25px 80px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1rem;
  border-bottom: 1px solid var(--neo-border-color);
}

.modal-tabs {
  display: flex;
}

.modal-tab {
  padding: 1rem 1.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--neo-text-muted);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: var(--neo-text-secondary);
  }

  &--active {
    color: var(--neo-text-primary);
    border-bottom-color: var(--neo-accent);
  }
}

.close-btn {
  background: none;
  border: none;
  color: var(--neo-text-muted);
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 8px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-bg-secondary);
    color: var(--neo-text-primary);
  }
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  text-align: center;
  color: var(--neo-text-muted);

  span {
    font-size: 2.5rem;
    margin-bottom: 0.75rem;
  }

  p {
    font-size: 0.9375rem;
  }
}

.spinner {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.account-card {
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  padding: 1rem;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--neo-border-hover, var(--neo-border-color));
  }
}

.account-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.account-avatar {
  flex-shrink: 0;

  img {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    object-fit: cover;
  }
}

.account-info {
  flex: 1;
  min-width: 0;
}

.account-name {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  text-decoration: none;
  font-size: 0.9375rem;

  &:hover {
    text-decoration: underline;
  }

  .bot-badge {
    font-size: 0.75rem;
  }
}

.account-handle {
  display: block;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.action-btn {
  padding: 0.5rem 1rem;
  font-size: 0.8125rem;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid var(--neo-accent);
  background: var(--neo-accent);
  color: white;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--following {
    background: transparent;
    color: var(--neo-text-primary);
    border-color: var(--neo-border-color);

    &:hover:not(:disabled) {
      border-color: var(--neo-danger);
      color: var(--neo-danger);
    }
  }

  &--loading {
    opacity: 0.7;
  }
}

.action-menu {
  position: relative;

  &:hover .action-menu-dropdown,
  &:focus-within .action-menu-dropdown {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
  }
}

.action-menu-trigger {
  background: none;
  border: none;
  color: var(--neo-text-muted);
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 8px;
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.action-menu-dropdown {
  position: absolute;
  top: 100%;
  right: 0;
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  padding: 0.5rem;
  min-width: 160px;
  box-shadow: var(--neo-shadow-lg);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-8px);
  transition: all 0.15s ease;
  z-index: 10;

  button {
    display: block;
    width: 100%;
    padding: 0.625rem 0.875rem;
    font-size: 0.875rem;
    text-align: left;
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    color: var(--neo-text-primary);
    transition: background 0.15s ease;

    &:hover {
      background: var(--neo-bg-secondary);
    }

    &.danger {
      color: var(--neo-danger);

      &:hover {
        background: rgba(239, 68, 68, 0.1);
      }
    }
  }
}

.recent-post {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--neo-border-color);
}

.recent-post-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.375rem;
}

.recent-post-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--neo-text-muted);
}

.recent-post-date {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.recent-post-content {
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  line-height: 1.5;
  margin: 0;
}

.recent-post-media {
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--neo-accent);
}

.no-recent-post {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--neo-border-color);
  
  span {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    font-style: italic;
  }
}

.load-more-btn {
  display: block;
  width: 100%;
  padding: 1rem;
  margin-top: 0.5rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-accent);
  background: transparent;
  border: 1px dashed var(--neo-border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--neo-bg-secondary);
    border-style: solid;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// Transitions
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
  
  .followers-modal {
    transition: transform 0.2s ease;
  }
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
  
  .followers-modal {
    transform: scale(0.95) translateY(20px);
  }
}
</style>

