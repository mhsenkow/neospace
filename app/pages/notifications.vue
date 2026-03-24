<script setup lang="ts">
import { useNotificationsStore, type NotificationFilterType, type SortOrder } from '~/stores/notifications'
import { useAuthStore } from '~/stores/auth'
import { useInstancesStore } from '~/stores/instances'
import type { mastodon } from 'masto'

const notificationsStore = useNotificationsStore()
const authStore = useAuthStore()
const instancesStore = useInstancesStore()

const scrollContainer = ref<HTMLElement | null>(null)
const loadTrigger = ref<HTMLElement | null>(null)
const sortMenuOpen = ref(false)
const actionsMenuOpen = ref(false)
let observer: IntersectionObserver | null = null

const canView = computed(() =>
  authStore.isAuthenticated || instancesStore.hasAuthenticatedInstance
)

const filters: { key: NotificationFilterType; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: '🔔' },
  { key: 'mention', label: 'Mentions', icon: '💬' },
  { key: 'favourite', label: 'Likes', icon: '❤️' },
  { key: 'reblog', label: 'Boosts', icon: '🔁' },
  { key: 'follow', label: 'Follows', icon: '👤' },
  { key: 'poll', label: 'Polls', icon: '📊' },
  { key: 'update', label: 'Edits', icon: '✏️' },
]

const sortOptions: { key: SortOrder; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
]

const grouped = computed(() => notificationsStore.groupedByTime)
const groupOrder = ['Today', 'Yesterday', 'This Week', 'Older']
const visibleGroups = computed(() =>
  groupOrder.filter(g => grouped.value[g]?.length)
)

const selectFilter = (key: NotificationFilterType) => {
  notificationsStore.setFilter(key)
}

const selectSort = (key: SortOrder) => {
  notificationsStore.setSortOrder(key)
  sortMenuOpen.value = false
}

const handleRefresh = () => {
  notificationsStore.fetchNotifications(true)
}

const handleClearAll = async () => {
  if (!confirm('Clear all notifications? This cannot be undone.')) return
  await notificationsStore.clearAll()
  actionsMenuOpen.value = false
}

const handleMarkRead = async () => {
  await notificationsStore.markAllRead()
  actionsMenuOpen.value = false
}

const handleDismiss = (id: string) => {
  notificationsStore.dismissNotification(id)
}

const formatTime = (dateString: string) => {
  const date = new Date(dateString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const notifIcon = (type: string) => {
  switch (type) {
    case 'mention': return '💬'
    case 'favourite': return '❤️'
    case 'reblog': return '🔁'
    case 'follow': return '👤'
    case 'follow_request': return '🔒'
    case 'poll': return '📊'
    case 'status': return '📝'
    case 'update': return '✏️'
    default: return '🔔'
  }
}

const notifLabel = (type: string) => {
  switch (type) {
    case 'mention': return 'mentioned you'
    case 'favourite': return 'liked your post'
    case 'reblog': return 'boosted your post'
    case 'follow': return 'followed you'
    case 'follow_request': return 'requested to follow you'
    case 'poll': return 'poll ended'
    case 'status': return 'posted'
    case 'update': return 'edited a post'
    default: return 'notification'
  }
}

const stripHtml = (html: string) => {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  return tmp.textContent || tmp.innerText || ''
}

const closeDropdowns = (e: MouseEvent) => {
  const t = e.target as HTMLElement
  if (!t.closest('.sort-menu')) sortMenuOpen.value = false
  if (!t.closest('.actions-menu')) actionsMenuOpen.value = false
}

onMounted(async () => {
  if (canView.value) {
    await notificationsStore.fetchNotifications(true)
  }

  if (loadTrigger.value) {
    observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !notificationsStore.isLoadingMore) {
          notificationsStore.loadMore()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(loadTrigger.value)
  }

  document.addEventListener('click', closeDropdowns)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('click', closeDropdowns)
})
</script>

<template>
  <div class="notif-page" ref="scrollContainer">
    <!-- Not authenticated -->
    <div v-if="!canView" class="notif-empty">
      <div class="notif-empty__icon">🔒</div>
      <h2 class="notif-empty__title">Sign in to see notifications</h2>
      <p class="notif-empty__desc">Log in to your Mastodon account to view mentions, likes, boosts, and follows.</p>
      <NuxtLink to="/login" class="notif-empty__cta">Sign In</NuxtLink>
    </div>

    <!-- Main content -->
    <div v-else class="notif-container">
      <!-- Header -->
      <header class="notif-header">
        <div class="notif-header__top">
          <h1 class="notif-header__title">Notifications</h1>
          <div class="notif-header__actions">
            <!-- Refresh -->
            <button
              class="notif-icon-btn"
              title="Refresh"
              :disabled="notificationsStore.isLoading"
              @click="handleRefresh"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ spinning: notificationsStore.isLoading }">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>

            <!-- Sort -->
            <div class="sort-menu">
              <button class="notif-icon-btn" title="Sort" @click.stop="sortMenuOpen = !sortMenuOpen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="18" x2="12" y2="18" />
                </svg>
              </button>
              <Transition name="dropdown">
                <div v-if="sortMenuOpen" class="sort-menu__dropdown">
                  <button
                    v-for="opt in sortOptions"
                    :key="opt.key"
                    class="sort-menu__item"
                    :class="{ active: notificationsStore.sortOrder === opt.key }"
                    @click="selectSort(opt.key)"
                  >{{ opt.label }}</button>
                </div>
              </Transition>
            </div>

            <!-- More actions -->
            <div class="actions-menu">
              <button class="notif-icon-btn" title="More actions" @click.stop="actionsMenuOpen = !actionsMenuOpen">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
                </svg>
              </button>
              <Transition name="dropdown">
                <div v-if="actionsMenuOpen" class="actions-menu__dropdown">
                  <button class="actions-menu__item" @click="handleMarkRead">Mark all as read</button>
                  <button class="actions-menu__item actions-menu__item--danger" @click="handleClearAll">Clear all notifications</button>
                </div>
              </Transition>
            </div>
          </div>
        </div>

        <!-- Filter pills -->
        <div class="notif-filters">
          <button
            v-for="f in filters"
            :key="f.key"
            class="notif-filter-pill"
            :class="{ active: notificationsStore.filter === f.key }"
            @click="selectFilter(f.key)"
          >
            <span class="notif-filter-pill__icon">{{ f.icon }}</span>
            <span class="notif-filter-pill__label">{{ f.label }}</span>
          </button>
        </div>
      </header>

      <!-- Loading skeleton -->
      <div v-if="notificationsStore.isLoading && notificationsStore.isEmpty" class="notif-skeleton">
        <div v-for="i in 8" :key="i" class="notif-skeleton__item">
          <div class="notif-skeleton__avatar" />
          <div class="notif-skeleton__body">
            <div class="notif-skeleton__line" :style="{ width: 40 + Math.random() * 40 + '%' }" />
            <div class="notif-skeleton__line notif-skeleton__line--short" :style="{ width: 20 + Math.random() * 30 + '%' }" />
          </div>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="notificationsStore.error" class="notif-error">
        <div class="notif-error__icon">⚠️</div>
        <p>{{ notificationsStore.error }}</p>
        <button class="notif-error__retry" @click="handleRefresh">Try again</button>
      </div>

      <!-- Empty state -->
      <div v-else-if="notificationsStore.filteredNotifications.length === 0 && !notificationsStore.isLoading" class="notif-empty">
        <div class="notif-empty__icon">{{ notificationsStore.filter === 'all' ? '✨' : '🔍' }}</div>
        <h2 class="notif-empty__title">
          {{ notificationsStore.filter === 'all' ? 'All caught up!' : 'Nothing here' }}
        </h2>
        <p class="notif-empty__desc">
          {{ notificationsStore.filter === 'all'
            ? "You don't have any notifications yet. Start interacting to see activity here."
            : 'No notifications match this filter. Try a different one.'
          }}
        </p>
      </div>

      <!-- Notification list, grouped by time -->
      <div v-else class="notif-list">
        <div v-for="group in visibleGroups" :key="group" class="notif-group">
          <div class="notif-group__label">{{ group }}</div>
          <div class="notif-group__items">
            <div
              v-for="notif in grouped[group]"
              :key="notif.id"
              class="notif-item"
              :class="'notif-item--' + notif.type"
            >
              <!-- Type icon badge -->
              <div class="notif-item__type-badge">
                {{ notifIcon(notif.type) }}
              </div>

              <!-- Avatar -->
              <div class="notif-item__avatar" v-if="notif.account">
                <img
                  :src="notif.account.avatar"
                  :alt="notif.account.displayName || notif.account.username"
                  loading="lazy"
                />
              </div>

              <!-- Content -->
              <div class="notif-item__body">
                <div class="notif-item__headline">
                  <strong v-if="notif.account" class="notif-item__name">
                    {{ notif.account.displayName || notif.account.username }}
                  </strong>
                  <span class="notif-item__action">{{ notifLabel(notif.type) }}</span>
                  <span class="notif-item__time">{{ formatTime(notif.createdAt) }}</span>
                </div>

                <!-- Status preview (for mention/fav/reblog/poll/update) -->
                <div v-if="notif.status" class="notif-item__preview">
                  {{ stripHtml(notif.status.content).slice(0, 180) }}{{ stripHtml(notif.status.content).length > 180 ? '...' : '' }}
                </div>

                <!-- Media thumbnails -->
                <div v-if="notif.status?.mediaAttachments?.length" class="notif-item__media">
                  <img
                    v-for="(media, idx) in notif.status.mediaAttachments.slice(0, 3)"
                    :key="idx"
                    :src="media.previewUrl ?? media.url ?? undefined"
                    class="notif-item__media-thumb"
                    loading="lazy"
                  />
                  <span v-if="(notif.status.mediaAttachments?.length ?? 0) > 3" class="notif-item__media-more">
                    +{{ (notif.status.mediaAttachments?.length ?? 0) - 3 }}
                  </span>
                </div>
              </div>

              <!-- Dismiss -->
              <button class="notif-item__dismiss" title="Dismiss" @click.stop="handleDismiss(notif.id)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Load more trigger -->
        <div ref="loadTrigger" class="notif-loadmore">
          <div v-if="notificationsStore.isLoadingMore" class="notif-loadmore__spinner" />
          <span v-else-if="!notificationsStore.hasMore" class="notif-loadmore__end">
            That's everything
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.notif-page {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-y: auto;
  padding-bottom: 6rem;
}

// ====== Container ======

.notif-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 1rem;
}

// ====== Header ======

.notif-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--neo-bg-primary);
  padding: 1.25rem 0 0;

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
  }

  &__title {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    letter-spacing: -0.02em;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
}

.notif-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--neo-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;

  &:hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

// ====== Sort & Actions dropdowns ======

.sort-menu, .actions-menu {
  position: relative;
}

.sort-menu__dropdown, .actions-menu__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color-light);
  border-radius: 12px;
  padding: 0.375rem;
  min-width: 170px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  z-index: 30;
}

.sort-menu__item, .actions-menu__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 0.875rem;
  color: var(--neo-text-primary);
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--neo-bg-hover);
  }

  &.active {
    color: var(--neo-accent);
    font-weight: 600;
  }
}

.actions-menu__item--danger {
  color: var(--neo-danger);

  &:hover {
    background: var(--neo-danger-soft);
  }
}

// ====== Filter pills ======

.notif-filters {
  display: flex;
  gap: 0.375rem;
  overflow-x: auto;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--neo-border-color-light);
  scrollbar-width: none;

  &::-webkit-scrollbar { display: none; }
}

.notif-filter-pill {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.375rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--neo-border-color-light);
  background: var(--neo-bg-card);
  font-size: 0.8125rem;
  color: var(--neo-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  flex-shrink: 0;

  &:hover {
    border-color: var(--neo-border-color);
    color: var(--neo-text-primary);
  }

  &.active {
    background: var(--neo-accent);
    border-color: var(--neo-accent);
    color: #fff;
  }

  &__icon { font-size: 0.875rem; line-height: 1; }
  &__label { font-weight: 500; }
}

// ====== Skeleton loading ======

.notif-skeleton {
  padding-top: 1rem;
}

.notif-skeleton__item {
  display: flex;
  gap: 0.75rem;
  padding: 0.875rem 0;
}

.notif-skeleton__avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--neo-bg-tertiary);
  flex-shrink: 0;
  animation: pulse 1.5s ease-in-out infinite;
}

.notif-skeleton__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.25rem;
}

.notif-skeleton__line {
  height: 12px;
  border-radius: 6px;
  background: var(--neo-bg-tertiary);
  animation: pulse 1.5s ease-in-out infinite;

  &--short { height: 10px; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

// ====== Error ======

.notif-error {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--neo-text-secondary);

  &__icon { font-size: 2rem; margin-bottom: 0.75rem; }

  p { margin-bottom: 1rem; }

  &__retry {
    padding: 0.5rem 1.25rem;
    border-radius: 999px;
    border: 1px solid var(--neo-border-color);
    background: transparent;
    color: var(--neo-text-primary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;

    &:hover { background: var(--neo-bg-hover); }
  }
}

// ====== Empty state ======

.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 5rem 1.5rem;
  min-height: 60vh;

  &__icon {
    font-size: 3.5rem;
    margin-bottom: 1.25rem;
    line-height: 1;
  }

  &__title {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--neo-text-primary);
    margin-bottom: 0.5rem;
  }

  &__desc {
    font-size: 0.9375rem;
    color: var(--neo-text-muted);
    max-width: 360px;
    line-height: 1.5;
    margin-bottom: 1.5rem;
  }

  &__cta {
    display: inline-flex;
    padding: 0.625rem 1.5rem;
    border-radius: 999px;
    background: var(--neo-accent);
    color: #fff;
    font-weight: 600;
    font-size: 0.9375rem;
    text-decoration: none;
    transition: opacity 0.15s;

    &:hover { opacity: 0.9; }
  }
}

// ====== Notification list ======

.notif-list {
  padding-top: 0.5rem;
}

.notif-group {
  &__label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--neo-text-muted);
    padding: 1rem 0 0.375rem;
  }
}

// ====== Notification item ======

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: 0.75rem 0.625rem;
  border-radius: 12px;
  transition: background 0.15s;
  position: relative;

  &:hover {
    background: var(--neo-bg-hover);

    .notif-item__dismiss { opacity: 1; }
  }

  &__type-badge {
    position: absolute;
    top: 0.5rem;
    left: 0.25rem;
    font-size: 0.75rem;
    line-height: 1;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  &__avatar {
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    overflow: hidden;
    margin-left: 0.75rem;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }

  &__body {
    flex: 1;
    min-width: 0;
  }

  &__headline {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.25rem;
    font-size: 0.875rem;
    line-height: 1.4;
  }

  &__name {
    color: var(--neo-text-primary);
    font-weight: 600;
  }

  &__action {
    color: var(--neo-text-secondary);
  }

  &__time {
    color: var(--neo-text-muted);
    font-size: 0.75rem;
    margin-left: auto;
    white-space: nowrap;
    flex-shrink: 0;
  }

  &__preview {
    margin-top: 0.25rem;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__media {
    display: flex;
    gap: 0.25rem;
    margin-top: 0.375rem;
    align-items: center;
  }

  &__media-thumb {
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: 8px;
    background: var(--neo-bg-tertiary);
  }

  &__media-more {
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    font-weight: 500;
    padding-left: 0.25rem;
  }

  &__dismiss {
    position: absolute;
    top: 0.5rem;
    right: 0.375rem;
    opacity: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: none;
    background: transparent;
    color: var(--neo-text-muted);
    cursor: pointer;
    transition: opacity 0.15s, background 0.15s, color 0.15s;

    &:hover {
      background: var(--neo-danger-soft);
      color: var(--neo-danger);
    }
  }
}

// Type-specific accent strips
.notif-item--favourite { border-left: 3px solid #e0245e; }
.notif-item--reblog { border-left: 3px solid #00ba7c; }
.notif-item--mention { border-left: 3px solid var(--neo-accent); }
.notif-item--follow, .notif-item--follow_request { border-left: 3px solid #7c3aed; }
.notif-item--poll { border-left: 3px solid #f59e0b; }
.notif-item--update { border-left: 3px solid #06b6d4; }

// ====== Load more ======

.notif-loadmore {
  display: flex;
  justify-content: center;
  padding: 2rem 0;

  &__spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--neo-border-color-light);
    border-top-color: var(--neo-accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  &__end {
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
  }
}

// ====== Dropdown transition ======

.dropdown-enter-active, .dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.dropdown-enter-from, .dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

// ====== Dark mode refinements ======

[data-theme="dark"] {
  .sort-menu__dropdown, .actions-menu__dropdown {
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    border-color: var(--neo-border-color);
  }
}

// ====== Responsive ======

@media (max-width: 640px) {
  .notif-container { padding: 0 0.5rem; }

  .notif-header__title { font-size: 1.25rem; }

  .notif-item {
    gap: 0.5rem;
    padding: 0.625rem 0.375rem;

    &__avatar { width: 38px; height: 38px; margin-left: 0.5rem; }
    &__type-badge { display: none; }
    &__time { font-size: 0.6875rem; }
  }
}
</style>
