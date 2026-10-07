<script setup lang="ts">
/**
 * Followers / following modal with recent posts and quick actions.
 */

import { ref, computed, watch } from 'vue'
import { useInstancesStore } from '~/stores/instances'
import { useOverlayStore } from '~/stores/overlay'
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { usePager } from '~/composables/usePager'

const instancesStore = useInstancesStore()
const overlayStore = useOverlayStore()

const props = defineProps<{
  accountId?: string
  initialTab?: 'followers' | 'following'
}>()

const isOpen = ref(false)
const activeTab = ref<'followers' | 'following'>('following')
const relationships = ref<Record<string, mastodon.v1.Relationship>>({})
const loadingActions = ref<Record<string, boolean>>({})
const modalRef = ref<HTMLElement | null>(null)

const tabDefs = [
  { id: 'followers', label: 'Followers' },
  { id: 'following', label: 'Following' },
]

const isOwnFollowersList = computed(() => {
  const viewing = props.accountId || instancesStore.currentUser?.id
  return !!viewing && viewing === instancesStore.currentUser?.id
})

const getClient = () => activeClient()

const enrichPage = async (fetchedAccounts: mastodon.v1.Account[]) => {
  if (!fetchedAccounts.length) return
  const client = getClient()
  try {
    const accountIds = fetchedAccounts.map((a) => a.id)
    const rels = await client.v1.accounts.relationships.fetch({ id: accountIds })
    rels.forEach((rel) => {
      relationships.value[rel.id] = rel
    })
  } catch {
    /* relationships are optional */
  }
  // Skip N+1 lastStatus fetches — use account.lastStatusAt in the row UI
}

const pager = usePager<mastodon.v1.Account>(async ({ maxId, signal }) => {
  void signal
  const client = getClient()
  const accountId = props.accountId || instancesStore.currentUser?.id
  if (!accountId) return []

  const opts = { limit: 20, maxId }
  const fetched =
    activeTab.value === 'followers'
      ? await client.v1.accounts.$select(accountId).followers.list(opts)
      : await client.v1.accounts.$select(accountId).following.list(opts)

  void enrichPage(fetched)
  return fetched
})

const accounts = pager.items
const isLoading = pager.isLoading
const isLoadingMore = pager.isLoadingMore
const hasMore = pager.hasMore
const loadError = computed(() => {
  const err = pager.error.value
  if (!err) return null
  return err instanceof Error ? err.message : String(err)
})

const close = () => {
  isOpen.value = false
  pager.reset()
  relationships.value = {}
}

useFocusTrap(modalRef, isOpen, {
  onEscape: close,
  initialFocus: '.close-btn',
})

const open = (tab?: 'followers' | 'following') => {
  if (tab) activeTab.value = tab
  else if (props.initialTab) activeTab.value = props.initialTab
  isOpen.value = true
  void loadAccounts()
}

const loadAccounts = async () => {
  if (!instancesStore.isAuthenticated) return
  relationships.value = {}
  pager.reset()
  await pager.loadInitial()
}

const loadMore = async () => {
  await pager.loadMore()
}

const formatLastActive = (iso?: string | null) => {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return null
  }
}

const handleFollow = async (accountId: string) => {
  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    const rel = relationships.value[accountId]

    if (rel?.following) {
      const updated = await client.v1.accounts.$select(accountId).unfollow()
      relationships.value[accountId] = updated
    } else {
      const updated = await client.v1.accounts.$select(accountId).follow()
      relationships.value[accountId] = updated
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
      const updated = await client.v1.accounts.$select(accountId).unmute()
      relationships.value[accountId] = updated
    } else {
      const updated = await client.v1.accounts.$select(accountId).mute()
      relationships.value[accountId] = updated
    }
  } catch (e) {
    console.error('Mute action failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

const handleBlock = async (accountId: string) => {
  const ok = await overlayStore.openConfirm({
    title: 'Block this account?',
    body: 'They will not be able to see your posts or interact with you.',
    confirmLabel: 'Block',
    danger: true,
  })
  if (!ok) return

  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    await client.v1.accounts.$select(accountId).block()
    accounts.value = accounts.value.filter((a) => a.id !== accountId)
  } catch (e) {
    console.error('Block action failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

const handleRemoveFollower = async (accountId: string) => {
  const ok = await overlayStore.openConfirm({
    title: 'Remove this follower?',
    body: 'They can still follow you again.',
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return

  loadingActions.value[accountId] = true
  try {
    const client = getClient()
    await client.v1.accounts.$select(accountId).removeFromFollowers()
    accounts.value = accounts.value.filter((a) => a.id !== accountId)
  } catch (e) {
    console.error('Remove follower failed:', e)
  } finally {
    loadingActions.value[accountId] = false
  }
}

watch(activeTab, () => {
  if (isOpen.value) {
    void loadAccounts()
  }
})

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="isOpen"
        ref="modalRef"
        class="followers-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="followers-modal-title"
        @click.self="close"
      >
        <div class="followers-modal">
          <header class="modal-header">
            <h2 id="followers-modal-title" class="sr-only">
              {{ activeTab === 'followers' ? 'Followers' : 'Following' }}
            </h2>
            <NeoTabs
              v-model="activeTab"
              class="modal-tabs"
              :tabs="tabDefs"
              :panels="false"
              controls-id="followers-modal-list"
            />
            <button type="button" class="close-btn" @click="close" aria-label="Close">
              <NeoIcon name="x" :size="22" :stroke="2" />
            </button>
          </header>

          <div id="followers-modal-list" class="modal-content">
            <div v-if="isLoading && accounts.length === 0" class="loading-state" aria-busy="true">
              <FunLoader fill label="Loading" />
            </div>

            <div v-else-if="loadError" class="empty-state" role="alert">
              <NeoIcon name="alert" :size="32" :stroke="1.5" />
              <p>{{ loadError }}</p>
              <button type="button" class="load-more-btn" @click="loadAccounts">Retry</button>
            </div>

            <div v-else-if="accounts.length === 0" class="empty-state">
              <NeoIcon name="user" :size="32" :stroke="1.5" />
              <p>
                {{
                  isOwnFollowersList && activeTab === 'followers'
                    ? 'No followers yet'
                    : activeTab === 'followers'
                      ? 'This account hides its follower list or has no followers'
                      : 'Not following anyone yet'
                }}
              </p>
            </div>

            <div v-else class="account-list">
              <div
                v-for="account in accounts"
                :key="account.id"
                class="account-card"
              >
                <div class="account-row">
                  <NuxtLink
                    :to="{ path: '/profile', query: { user: account.acct } }"
                    class="account-avatar"
                    :aria-label="`View profile of ${account.displayName || account.username}`"
                    @click="close()"
                  >
                    <img :src="account.avatar" alt="" />
                  </NuxtLink>

                  <div class="account-info">
                    <NuxtLink
                      :to="{ path: '/profile', query: { user: account.acct } }"
                      class="account-name"
                      @click="close()"
                    >
                      {{ account.displayName || account.username }}
                      <span v-if="account.bot" class="bot-badge" title="Automated account">BOT</span>
                    </NuxtLink>
                    <span class="account-handle">@{{ account.acct }}</span>
                    <span
                      v-if="relationships[account.id]?.followedBy"
                      class="account-badge"
                    >Follows you</span>
                  </div>

                  <div class="account-actions">
                    <button
                      class="action-btn"
                      :class="{
                        'action-btn--following': relationships[account.id]?.following,
                        'action-btn--requested': relationships[account.id]?.requested,
                        'action-btn--loading': loadingActions[account.id]
                      }"
                      :disabled="loadingActions[account.id]"
                      @click="handleFollow(account.id)"
                    >
                      {{
                        relationships[account.id]?.following
                          ? 'Following'
                          : relationships[account.id]?.requested
                            ? 'Requested'
                            : activeTab === 'followers'
                              ? 'Follow back'
                              : 'Follow'
                      }}
                    </button>

                    <NeoMenu
                      class="action-menu"
                      :label="`More actions for @${account.acct}`"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <circle cx="12" cy="5" r="2"/>
                        <circle cx="12" cy="12" r="2"/>
                        <circle cx="12" cy="19" r="2"/>
                      </svg>
                      <template #items>
                        <button type="button" role="menuitem" @click="handleMute(account.id)">
                          {{ relationships[account.id]?.muting ? 'Unmute' : 'Mute' }}
                        </button>
                        <button type="button" role="menuitem" class="danger" @click="handleBlock(account.id)">
                          Block
                        </button>
                        <button
                          v-if="activeTab === 'followers' && isOwnFollowersList"
                          type="button"
                          role="menuitem"
                          class="danger"
                          @click="handleRemoveFollower(account.id)"
                        >
                          Remove follower
                        </button>
                      </template>
                    </NeoMenu>
                  </div>
                </div>

                <p v-if="formatLastActive(account.lastStatusAt)" class="recent-post-meta">
                  Last post {{ formatLastActive(account.lastStatusAt) }}
                </p>
                <p v-else class="no-recent-post">No recent posts</p>
              </div>

              <button
                v-if="hasMore"
                class="load-more-btn"
                :disabled="isLoading || isLoadingMore"
                @click="loadMore"
              >
                {{ isLoading || isLoadingMore ? 'Loading...' : 'Load more' }}
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
  z-index: var(--neo-z-modal, 200);
  padding: 1rem;
}

.followers-modal {
  width: min(520px, 100%);
  max-height: min(85vh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-lg, 12px);
  overflow: hidden;
  box-shadow: var(--neo-shadow-xl);
}

.modal-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.75rem 0;
  border-bottom: 1px solid var(--neo-border-color);
}

.modal-tabs {
  flex: 1;
  min-width: 0;

  :deep(.neo-tabs__list) {
    border-bottom: none;
    gap: 0.25rem;
  }

  :deep(.neo-tabs__tab) {
    flex: 1;
    justify-content: center;
    font-weight: 600;
  }
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: var(--neo-radius-sm, 4px);
  background: transparent;
  color: var(--neo-text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.modal-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 12rem;
  color: var(--neo-text-secondary);
  text-align: center;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.account-card {
  padding: 0.75rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md, 8px);
  background: var(--neo-bg-secondary);
}

.account-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.account-avatar {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.account-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.account-name {
  font-weight: 600;
  color: var(--neo-text-primary);
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    text-decoration: underline;
  }
}

.account-badge {
  display: inline-block;
  margin-top: 0.15rem;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  background: color-mix(in srgb, var(--neo-accent) 14%, transparent);
}

.account-handle {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bot-badge {
  margin-left: 0.25rem;
}

.account-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.action-btn {
  min-height: 44px;
  min-width: 44px;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  background: var(--neo-accent);
  color: var(--neo-text-on-accent, #fff);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;

  &--following {
    background: transparent;
    color: var(--neo-text-primary);
  }

  &--loading,
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}

.action-menu {
  :deep(.neo-menu__trigger) {
    width: 32px;
    height: 32px;
    border-radius: var(--neo-radius-sm, 4px);
    color: var(--neo-text-secondary);

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
    }
  }

  :deep(.neo-menu__panel) {
    min-width: 10rem;
  }

  :deep(.danger) {
    color: var(--neo-danger);
  }
}

.recent-post {
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--neo-border-color);
}

.recent-post-header {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.recent-post-content {
  margin: 0;
  font-size: 0.875rem;
  color: var(--neo-text-secondary);
  line-height: 1.4;
}

.recent-post-meta,
.no-recent-post {
  margin: 0.35rem 0 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.load-more-btn {
  width: 100%;
  min-height: 40px;
  margin-top: 0.25rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  font-weight: 600;
  cursor: pointer;

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.15s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 600px) {
  .followers-modal-overlay {
    padding: 0;
    align-items: stretch;
  }

  .followers-modal {
    width: 100%;
    max-height: 100%;
    border-radius: 0;
  }
}
</style>
