<script setup lang="ts">
import { useNotificationsStore, type ExtendedNotification, type NotificationFilterType, type SortOrder } from '~/stores/notifications'
import { useInstancesStore } from '~/stores/instances'
import type { mastodon } from 'masto'
import { stripHtml } from '~/utils/sanitizeHtml'
import { notifIconName, notifLabel } from '~/utils/notifHelpers'
import type { NeoIconName } from '~/utils/neoIcons'

const notificationsStore = useNotificationsStore()
const instancesStore = useInstancesStore()
const route = useRoute()
const router = useRouter()

const scrollContainer = ref<HTMLElement | null>(null)
const loadTrigger = ref<HTMLElement | null>(null)
const sortMenuOpen = ref(false)
const actionsMenuOpen = ref(false)
let observer: IntersectionObserver | null = null
const overlayStore = useOverlayStore()

const canView = computed(() =>
  instancesStore.hasAuthenticatedInstance
)

const FILTER_KEYS: NotificationFilterType[] = [
  'all',
  'mention',
  'favourite',
  'reblog',
  'follow',
  'poll',
  'update',
]

const applyFilterFromRoute = () => {
  const raw = String(route.query.filter || '')
  if (FILTER_KEYS.includes(raw as NotificationFilterType)) {
    notificationsStore.setFilter(raw as NotificationFilterType)
  }
}

const filters: { key: NotificationFilterType; label: string; icon: NeoIconName }[] = [
  { key: 'all', label: 'All', icon: 'bell' },
  { key: 'mention', label: 'Mentions', icon: 'mention' },
  { key: 'favourite', label: 'Likes', icon: 'heart' },
  { key: 'reblog', label: 'Boosts', icon: 'reblog' },
  { key: 'follow', label: 'Follows', icon: 'user' },
  { key: 'poll', label: 'Polls', icon: 'poll' },
  { key: 'update', label: 'Edits', icon: 'edit' },
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
  const query = { ...route.query }
  if (key === 'all') delete query.filter
  else query.filter = key
  router.replace({ query })
}

const filterTabs = computed(() =>
  filters.map((f) => ({ id: f.key, label: f.label })),
)
const filterTabId = computed({
  get: () => notificationsStore.filter,
  set: (key: string) => selectFilter(key as NotificationFilterType),
})

const selectSort = (key: SortOrder) => {
  notificationsStore.setSortOrder(key)
  sortMenuOpen.value = false
}

const handleRefresh = () => {
  notificationsStore.fetchNotifications(true)
}

const handleClearAll = async () => {
  const ok = await overlayStore.openConfirm({
    title: 'Clear all notifications?',
    body: 'This cannot be undone.',
    confirmLabel: 'Clear all',
    danger: true,
  })
  if (!ok) return
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

const showAccountHost = computed(() => instancesStore.authenticatedInstances.length > 1)

const hostLabel = (url?: string) => {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '')
  }
}

const { formatRelativeTime, formatAbsoluteTime } = useRelativeTime()

const ensureNotifAccount = (notif: ExtendedNotification) => {
  if (notif._instanceId && notif._instanceId !== instancesStore.activeAccountId) {
    instancesStore.setActiveAccount(notif._instanceId)
  }
}

/** Avatar / name → their profile (e.g. who liked your comment) */
const openNotifProfile = (notif: ExtendedNotification, e?: Event) => {
  e?.stopPropagation()
  ensureNotifAccount(notif)
  const acct = notif.account?.acct
  if (acct) router.push({ path: '/profile', query: { user: acct } })
}

/** Body / preview → the post (or profile for follows) */
const openNotification = (notif: ExtendedNotification) => {
  ensureNotifAccount(notif)

  if (notif.type === 'follow' || notif.type === 'follow_request') {
    const acct = notif.account?.acct
    if (acct) {
      router.push({ path: '/profile', query: { user: acct } })
      return
    }
  }

  const status = notif.status
  if (status?.id) {
    const url = status.url || status.uri
    router.push({
      path: `/status/${status.id}`,
      query: url ? { url } : undefined,
    })
    return
  }

  const acct = notif.account?.acct
  if (acct) {
    router.push({ path: '/profile', query: { user: acct } })
  }
}

const previewText = (status?: mastodon.v1.Status | null) => {
  if (!status?.content) return ''
  const text = stripHtml(status.content).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

const bindLoadObserver = (el: Element | null) => {
  observer?.disconnect()
  observer = null
  if (!el) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && !notificationsStore.isLoadingMore) {
        notificationsStore.loadMore()
      }
    },
    { threshold: 0.1 },
  )
  observer.observe(el)
}

onMounted(async () => {
  applyFilterFromRoute()
  await instancesStore.initialize()
  if (canView.value) {
    await notificationsStore.fetchNotifications(true)
  }
  bindLoadObserver(loadTrigger.value)
})

watch(loadTrigger, (el) => {
  bindLoadObserver(el)
})

watch(
  () => route.query.filter,
  () => {
    applyFilterFromRoute()
  },
)

watch(canView, async (ok) => {
  if (!ok || notificationsStore.notifications.length) return
  await notificationsStore.fetchNotifications(true)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (canView.value) {
    void notificationsStore.markAllRead()
  }
})

onDeactivated(() => {
  if (canView.value) {
    void notificationsStore.markAllRead()
  }
})
</script>

<template>
  <div class="notif-page" ref="scrollContainer">
    <!-- Not authenticated -->
    <div v-if="!canView" class="notif-empty">
      <div class="notif-empty__icon"><NeoIcon name="lock" :size="32" :stroke="1.5" /></div>
      <h2 class="notif-empty__title">Notifications</h2>
      <p class="notif-empty__desc">Sign in to see activity.</p>
      <NuxtLink to="/login" class="notif-empty__cta">Sign in</NuxtLink>
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
              type="button"
              class="notif-icon-btn"
              title="Refresh"
              aria-label="Refresh notifications"
              :disabled="notificationsStore.isLoading"
              @click="handleRefresh"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :class="{ spinning: notificationsStore.isLoading }">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>

            <NeoMenu
              v-model:open="sortMenuOpen"
              class="sort-menu"
              label="Sort notifications"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="16" y2="12" /><line x1="4" y1="18" x2="12" y2="18" />
              </svg>
              <template #items>
                <button
                  v-for="opt in sortOptions"
                  :key="opt.key"
                  type="button"
                  role="menuitem"
                  class="sort-menu__item"
                  :class="{ active: notificationsStore.sortOrder === opt.key }"
                  @click="selectSort(opt.key)"
                >{{ opt.label }}</button>
              </template>
            </NeoMenu>

            <NeoMenu
              v-model:open="actionsMenuOpen"
              class="actions-menu"
              label="More notification actions"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
              </svg>
              <template #items>
                <button type="button" role="menuitem" class="actions-menu__item" @click="handleMarkRead">Mark all as read</button>
                <button type="button" role="menuitem" class="actions-menu__item actions-menu__item--danger" @click="handleClearAll">Clear all notifications</button>
              </template>
            </NeoMenu>
          </div>
        </div>

        <NeoTabs
          v-model="filterTabId"
          class="notif-filters"
          :tabs="filterTabs"
          :panels="false"
          controls-id="notif-list"
        />
      </header>

      <div id="notif-list" class="notif-panel">
      <div
        v-if="notificationsStore.failedHosts.length"
        class="notif-partial"
        role="status"
      >
        Couldn’t load from {{ notificationsStore.failedHosts.join(', ') }}.
        <button type="button" class="notif-partial__retry" @click="handleRefresh">Retry</button>
      </div>
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
        <div class="notif-error__icon"><NeoIcon name="alert" :size="28" :stroke="1.75" /></div>
        <p>{{ notificationsStore.error }}</p>
        <button class="notif-error__retry" @click="handleRefresh">Try again</button>
      </div>

      <!-- Empty state -->
      <div v-else-if="notificationsStore.filteredNotifications.length === 0 && !notificationsStore.isLoading" class="notif-empty">
        <div class="notif-empty__icon">
          <NeoIcon :name="notificationsStore.filter === 'all' ? 'sparkle' : 'search'" :size="32" :stroke="1.5" />
        </div>
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
            <article
              v-for="notif in grouped[group]"
              :key="notif._key"
              class="notif-item"
              :class="[
                'notif-item--' + notif.type,
                { 'notif-item--unread': notificationsStore.isUnread(notif) },
              ]"
            >
              <!-- Type icon badge -->
              <div class="notif-item__type-badge" aria-hidden="true">
                <NeoIcon :name="notifIconName(notif.type)" :size="14" :stroke="2" />
              </div>

              <!-- Avatar → profile -->
              <button
                v-if="notif.account"
                type="button"
                class="notif-item__avatar"
                :aria-label="`Open ${notif.account.displayName || notif.account.username}'s profile`"
                @click="openNotifProfile(notif)"
              >
                <img
                  :src="notif.account.avatar"
                  alt=""
                  loading="lazy"
                />
              </button>

              <!-- Content: name → profile; rest → post -->
              <div class="notif-item__body">
                <div class="notif-item__headline">
                  <p class="notif-item__who">
                    <button
                      v-if="notif.account"
                      type="button"
                      class="notif-item__name"
                      @click="openNotifProfile(notif)"
                    >
                      {{ notif.account.displayName || notif.account.username }}
                    </button>
                    <button
                      type="button"
                      class="notif-item__action-btn"
                      @click="openNotification(notif)"
                    >
                      <span class="notif-item__action">{{ notifLabel(notif.type) }}</span>
                      <span
                        v-if="showAccountHost && notif._instanceUrl"
                        class="notif-item__host"
                      >· {{ hostLabel(notif._instanceUrl) }}</span>
                    </button>
                  </p>
                  <time
                    class="notif-item__time"
                    :datetime="notif.createdAt"
                    :title="formatAbsoluteTime(notif.createdAt)"
                  >
                    {{ formatRelativeTime(notif.createdAt) }}
                  </time>
                </div>

                <button
                  v-if="previewText(notif.status) || notif.status?.mediaAttachments?.length"
                  type="button"
                  class="notif-item__open"
                  :aria-label="`Open post: ${notifLabel(notif.type)}`"
                  @click="openNotification(notif)"
                >
                  <p v-if="previewText(notif.status)" class="notif-item__preview">
                    {{ previewText(notif.status) }}
                  </p>

                  <div v-if="notif.status?.mediaAttachments?.length" class="notif-item__media">
                    <img
                      v-for="(media, idx) in notif.status.mediaAttachments.slice(0, 3)"
                      :key="idx"
                      :src="media.previewUrl ?? media.url ?? undefined"
                      class="notif-item__media-thumb"
                      alt=""
                      loading="lazy"
                    />
                    <span v-if="(notif.status.mediaAttachments?.length ?? 0) > 3" class="notif-item__media-more">
                      +{{ (notif.status.mediaAttachments?.length ?? 0) - 3 }}
                    </span>
                  </div>
                </button>
                <button
                  v-else
                  type="button"
                  class="notif-item__open notif-item__open--bare"
                  :aria-label="`Open ${notifLabel(notif.type)}`"
                  @click="openNotification(notif)"
                >
                  <span class="sr-only">Open</span>
                </button>
              </div>

              <!-- Dismiss -->
              <button
                type="button"
                class="notif-item__dismiss"
                aria-label="Dismiss notification"
                title="Dismiss"
                @click="handleDismiss(notif._key)"
              >
                <NeoIcon name="x" :size="14" :stroke="2" />
              </button>
            </article>
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
  </div>
</template>

<style scoped lang="scss">
.notif-page {
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  overflow-y: auto;
  padding-bottom: calc(4rem + env(safe-area-inset-bottom, 0));
}

.notif-container {
  width: 100%;
  max-width: min(100%, 820px);
  margin: 0 auto;
  padding: 0 0.75rem;
  box-sizing: border-box;

  @media (min-width: 600px) {
    padding: 0 1.25rem;
  }

  @media (min-width: 1024px) {
    padding: 0 1.5rem;
  }
}

// ====== Header ======

.notif-header {
  position: sticky;
  top: 0;
  z-index: 20;
  margin: 0 -0.75rem;
  padding: 1rem 0.75rem 0;
  background: color-mix(in srgb, var(--neo-bg-primary) 92%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  @media (min-width: 600px) {
    margin: 0 -1.25rem;
    padding: 1.25rem 1.25rem 0;
  }

  @media (min-width: 1024px) {
    top: 0;
    margin: 0 -1.5rem;
    padding: 1.5rem 1.5rem 0;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.875rem;
  }

  &__title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 650;
    color: var(--neo-text-primary);
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    flex-shrink: 0;
  }
}

.notif-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--neo-radius-sm, 4px);
  border: 1px solid transparent;
  background: transparent;
  color: var(--neo-text-secondary);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;

  &:hover {
    background: var(--neo-bg-hover);
    border-color: var(--neo-border-color);
    color: var(--neo-text-primary);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
}

.spinning {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

// ====== Sort & Actions menus ======

.sort-menu,
.actions-menu {
  :deep(.neo-menu__trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: var(--neo-radius-sm, 4px);
    color: var(--neo-text-secondary);

    &:hover {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }
  }

  :deep(.neo-menu__panel) {
    min-width: 180px;
    background: var(--neo-bg-secondary);
    border: var(--neo-border-width, 1px) solid var(--neo-border-color-dark);
    border-radius: var(--neo-radius-sm, 4px);
    padding: 0.25rem;
    box-shadow: var(--neo-shadow-md);
    z-index: 30;
  }
}

.sort-menu__item,
.actions-menu__item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem;
  border: none;
  background: transparent;
  border-radius: calc(var(--neo-radius-sm, 4px) - 1px);
  font-size: 0.875rem;
  color: var(--neo-text-primary);
  cursor: pointer;
  transition: background-color 0.15s;

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

// ====== Filter tabs ======

.notif-filters {
  margin: 0 -0.75rem;
  padding: 0 0.75rem 0.5rem;
  border-bottom: none;

  :deep(.neo-tabs__list) {
    display: flex;
    flex-wrap: nowrap;
    gap: 0.5rem;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    padding: 0 0 0.875rem;
    border-bottom: 1px solid var(--neo-border-color);
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }

    @media (min-width: 720px) {
      flex-wrap: wrap;
      overflow-x: visible;
    }
  }

  :deep(.neo-tabs__tab) {
    display: inline-flex;
    align-items: center;
    min-height: 34px;
    padding: 0.375rem 0.75rem;
    border-radius: var(--neo-radius-sm, 4px);
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-secondary);
    font-size: 0.8125rem;
    color: var(--neo-text-primary);
    white-space: nowrap;
    flex: 0 0 auto;
    box-shadow: none;

    &:hover {
      border-color: var(--neo-border-color-dark);
      background: var(--neo-bg-secondary);
      color: var(--neo-text-primary);
    }

    &[aria-selected='true'] {
      background: var(--neo-accent);
      border-color: var(--neo-accent);
      color: var(--neo-text-on-accent);
      box-shadow: none;
    }
  }
}

// ====== Skeleton loading ======

.notif-skeleton {
  padding-top: 1rem;
}

.notif-skeleton__item {
  display: flex;
  gap: 0.75rem;
  padding: 0.875rem 0;
  border-bottom: 1px solid var(--neo-border-color);
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
  border-radius: 2px;
  background: var(--neo-bg-tertiary);
  animation: pulse 1.5s ease-in-out infinite;

  &--short {
    height: 10px;
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.notif-partial {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
  margin: 0.5rem 0 0.75rem;
  padding: 0.65rem 0.85rem;
  border-radius: var(--neo-radius-sm, 6px);
  border: 1px solid color-mix(in srgb, var(--neo-warning, #b8860b) 40%, var(--neo-border-color));
  background: color-mix(in srgb, var(--neo-warning, #b8860b) 10%, var(--neo-bg-secondary));
  color: var(--neo-text-primary);
  font-size: 0.8125rem;

  &__retry {
    margin-left: auto;
    padding: 0.25rem 0.65rem;
    border-radius: 4px;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-primary);
    color: var(--neo-text-primary);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
}

// ====== Error ======

.notif-error {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--neo-text-secondary);

  &__icon {
    font-size: 2rem;
    margin-bottom: 0.75rem;
  }

  p {
    margin-bottom: 1rem;
    color: var(--neo-text-primary);
  }

  &__retry {
    padding: 0.5rem 1.25rem;
    border-radius: var(--neo-radius-sm, 4px);
    border: 1px solid var(--neo-border-color-dark);
    background: var(--neo-bg-secondary);
    color: var(--neo-text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      background: var(--neo-bg-hover);
    }
  }
}

// ====== Empty state ======

.notif-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4rem 1.5rem;
  min-height: 50vh;

  &__icon {
    font-size: 2.75rem;
    margin-bottom: 1rem;
    line-height: 1;
  }

  &__title {
    margin: 0 0 0.5rem;
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }

  &__desc {
    margin: 0 0 1.5rem;
    font-size: 0.9375rem;
    color: var(--neo-text-secondary);
    max-width: 36ch;
    line-height: 1.5;
  }

  &__cta {
    display: inline-flex;
    padding: 0.625rem 1.25rem;
    border-radius: var(--neo-radius-sm, 4px);
    background: var(--neo-accent);
    color: var(--neo-text-on-accent);
    font-weight: 600;
    font-size: 0.875rem;
    text-decoration: none;

    &:hover {
      background: var(--neo-accent-hover);
    }
  }
}

// ====== Notification list ======

.notif-list {
  padding-top: 0.25rem;
}

.notif-group {
  &__label {
    font-size: 0.6875rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--neo-text-secondary);
    padding: 1.25rem 0 0.5rem;
  }

  &__items {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid var(--neo-border-color);
  }
}

// ====== Notification item ======

.notif-item {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: start;
  gap: 0.75rem;
  padding: 0.875rem 0.5rem 0.875rem 0.625rem;
  border-bottom: 1px solid var(--neo-border-color);
  border-left: 3px solid transparent;
  background: transparent;
  transition: background-color 0.15s;
  position: relative;

  &--unread {
    border-left-color: var(--neo-accent);
    background: color-mix(in srgb, var(--neo-accent) 6%, transparent);
  }

  &:hover {
    background: var(--neo-bg-hover);

    .notif-item__dismiss {
      opacity: 1;
    }
  }

  &__type-badge {
    width: 1.25rem;
    padding-top: 0.55rem;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    color: var(--neo-text-muted);
    flex-shrink: 0;
  }

  &__avatar {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    padding: 0;
    border: none;
    border-radius: 50%;
    overflow: hidden;
    background: var(--neo-bg-tertiary);
    margin-top: 0.125rem;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }
  }

  &__body {
    min-width: 0;
    padding-right: 1.75rem;
  }

  &__headline {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.35;
  }

  &__who {
    margin: 0;
    min-width: 0;
  }

  &__name {
    display: inline;
    padding: 0;
    margin: 0 0.35rem 0 0;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
    text-align: left;
    -webkit-tap-highlight-color: transparent;

    &:hover,
    &:focus-visible {
      text-decoration: underline;
      outline: none;
    }
  }

  &__action {
    color: var(--neo-text-secondary);
    font-weight: 400;
  }

  &__action-btn {
    display: inline;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;

    &:hover .notif-item__action,
    &:focus-visible .notif-item__action {
      text-decoration: underline;
    }

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
      border-radius: 2px;
    }
  }

  &__open {
    display: block;
    width: 100%;
    margin: 0.375rem 0 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
    border-radius: 6px;

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }

    &--bare {
      position: absolute;
      inset: 0;
      z-index: 0;
      margin: 0;
      opacity: 0;
    }
  }

  &__host {
    color: var(--neo-text-muted);
    font-size: 0.8125rem;
    font-weight: 400;
  }

  &__time {
    color: var(--neo-text-secondary);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }

  &__preview {
    margin: 0;
    padding: 0.5rem 0.625rem;
    font-size: 0.875rem;
    color: var(--neo-text-primary);
    line-height: 1.45;
    background: var(--neo-bg-secondary);
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-sm, 4px);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__media {
    display: flex;
    gap: 0.375rem;
    margin-top: 0.5rem;
    align-items: center;
  }

  &__media-thumb {
    width: 52px;
    height: 52px;
    object-fit: cover;
    border-radius: var(--neo-radius-sm, 4px);
    background: var(--neo-bg-tertiary);
    border: 1px solid var(--neo-border-color);
  }

  &__media-more {
    font-size: 0.75rem;
    color: var(--neo-text-secondary);
    font-weight: 600;
  }

  &__dismiss {
    position: absolute;
    top: 0.5rem;
    right: 0.15rem;
    z-index: 2;
    opacity: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 1px solid transparent;
    background: var(--neo-bg-secondary);
    color: var(--neo-text-secondary);
    cursor: pointer;
    transition: opacity 0.15s, background-color 0.15s, color 0.15s, border-color 0.15s;

    &:hover,
    &:focus-visible {
      opacity: 1;
      background: var(--neo-danger-soft);
      border-color: var(--neo-danger);
      color: var(--neo-danger);
      outline: none;
    }

    @media (hover: none) {
      opacity: 0.7;
    }
  }

  &:hover &__dismiss {
    opacity: 1;
  }
}

// Type-specific accent strips
.notif-item--favourite {
  border-left-color: var(--neo-danger);
}
.notif-item--reblog {
  border-left-color: var(--neo-success);
}
.notif-item--mention {
  border-left-color: var(--neo-accent);
}
.notif-item--follow,
.notif-item--follow_request {
  border-left-color: var(--neo-info);
}
.notif-item--poll {
  border-left-color: var(--neo-warning);
}
.notif-item--update {
  border-left-color: var(--neo-info);
}

// ====== Load more ======

.notif-loadmore {
  display: flex;
  justify-content: center;
  padding: 2rem 0;

  &__spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--neo-border-color);
    border-top-color: var(--neo-accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  &__end {
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
  }
}

// ====== Dropdown transition ======

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

// ====== Responsive ======

@media (max-width: 560px) {
  .notif-item {
    gap: 0.5rem;
    padding: 0.75rem 0.25rem 0.75rem 0.375rem;

    &__type-badge {
      display: none;
    }

    &__avatar {
      width: 36px;
      height: 36px;
    }

    &__headline {
      font-size: 0.875rem;
    }

    &__preview {
      font-size: 0.8125rem;
    }

    &__body {
      padding-right: 1.5rem;
    }
  }
}
</style>
