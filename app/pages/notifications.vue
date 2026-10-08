<script setup lang="ts">
import { useNotificationsStore, type ExtendedNotification, type NotificationFilterType, type SortOrder } from '~/stores/notifications'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { clientFor } from '~/composables/useMasto'
import type { mastodon } from 'masto'
import { stripHtml } from '~/utils/sanitizeHtml'
import { notifIconName, notifLabel } from '~/utils/notifHelpers'
import { groupActorLabel } from '~/utils/notifGroup'
import { getMainScroller } from '~/utils/pageScroll'
import { useMobileViewport } from '~/composables/useBreakpoint'
import type { NeoIconName } from '~/utils/neoIcons'

const notificationsStore = useNotificationsStore()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()
const route = useRoute()
const router = useRouter()

const scrollContainer = ref<HTMLElement | null>(null)
const loadTrigger = ref<HTMLElement | null>(null)
const sortMenuOpen = ref(false)
const actionsMenuOpen = ref(false)
const searchQuery = ref('')
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
  'status',
  'update',
]

const applyFilterFromRoute = () => {
  const raw = String(route.query.filter || '')
  if (FILTER_KEYS.includes(raw as NotificationFilterType)) {
    notificationsStore.setFilter(raw as NotificationFilterType)
  } else {
    notificationsStore.setFilter('all')
  }
}

const filters: { key: NotificationFilterType; label: string; icon: NeoIconName }[] = [
  { key: 'all', label: 'All', icon: 'bell' },
  { key: 'mention', label: 'Mentions', icon: 'mention' },
  { key: 'favourite', label: 'Likes', icon: 'heart' },
  { key: 'reblog', label: 'Boosts', icon: 'reblog' },
  { key: 'follow', label: 'Follows', icon: 'user' },
  { key: 'poll', label: 'Polls', icon: 'poll' },
  { key: 'status', label: 'Posts', icon: 'pen' },
  { key: 'update', label: 'Edits', icon: 'edit' },
]

const skeletonLineWidths = ['68%', '42%', '55%', '38%', '62%', '45%', '50%', '36%']
const skeletonLineShortWidths = ['28%', '34%', '22%', '30%', '26%', '32%', '24%', '29%']

const sortOptions: { key: SortOrder; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
]

const grouped = computed(() => notificationsStore.groupedByTime)
const groupOrder = ['Today', 'Yesterday', 'This Week', 'Older']

const notifMatchesQuery = (notif: {
  type: string
  account?: { displayName?: string | null; username?: string; acct?: string } | null
  status?: mastodon.v1.Status | null
}) => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return true
  const name = `${notif.account?.displayName || ''} ${notif.account?.username || ''} ${notif.account?.acct || ''}`.toLowerCase()
  const action = notifLabel(notif.type).toLowerCase()
  const preview = (() => {
    const status = notif.status
    if (!status?.content) return ''
    return stripHtml(status.content).replace(/\s+/g, ' ').trim().toLowerCase()
  })()
  return name.includes(q) || action.includes(q) || preview.includes(q)
}

const filteredGrouped = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return grouped.value
  const out: typeof grouped.value = {}
  for (const label of groupOrder) {
    const items = grouped.value[label]
    if (!items?.length) continue
    const hit = items.filter(notifMatchesQuery)
    if (hit.length) out[label] = hit
  }
  return out
})

const visibleGroups = computed(() =>
  groupOrder.filter(g => filteredGrouped.value[g]?.length)
)

const filteredNotifCount = computed(() =>
  visibleGroups.value.reduce((n, g) => n + (filteredGrouped.value[g]?.length || 0), 0)
)

const searchStatusText = computed(() => {
  const q = searchQuery.value.trim()
  if (!q) return ''
  const n = filteredNotifCount.value
  if (!n) return `No activity matches “${q}”.`
  return `${n} match${n === 1 ? '' : 'es'} for “${q}”.`
})

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
  try {
    await notificationsStore.clearAll()
    actionsMenuOpen.value = false
    toastStore.show({ message: 'Notifications cleared' })
  } catch {
    toastStore.show({ message: 'Couldn’t clear notifications' })
  }
}

const handleMarkRead = async () => {
  await notificationsStore.markAllRead()
  actionsMenuOpen.value = false
}

const handleDismiss = (notif: { _key: string; _groupedKeys?: string[] }) => {
  notificationsStore.dismissNotification(notif._key)
  for (const key of notif._groupedKeys || []) {
    notificationsStore.dismissNotification(key)
  }
}

const actorLabel = (notif: {
  account?: { displayName?: string | null; username?: string } | null
  _groupCount?: number
}) => {
  const name = notif.account?.displayName || notif.account?.username || 'Someone'
  return groupActorLabel(name, notif._groupCount || 1)
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

const { formatAbsoluteTime } = useRelativeTime()

const ensureNotifAccount = (notif: ExtendedNotification) => {
  if (notif._instanceId && notif._instanceId !== instancesStore.activeAccountId) {
    const inst = instancesStore.instances.find((i) => i.id === notif._instanceId)
    instancesStore.setActiveAccount(notif._instanceId)
    const handle = inst?.user?.acct || inst?.name || 'account'
    toastStore.show({ message: `Switched to @${handle}`, duration: 3200 })
  }
}

const followRequestBusy = ref<Record<string, boolean>>({})

const authorizeFollowRequest = async (notif: ExtendedNotification, e?: Event) => {
  e?.stopPropagation()
  if (!notif.account?.id || !notif._instanceId) return
  const key = notif._key
  followRequestBusy.value = { ...followRequestBusy.value, [key]: true }
  try {
    const client = clientFor(notif._instanceId)
    await client.v1.followRequests.$select(notif.account.id).authorize()
    notificationsStore.dismissNotification(key)
    toastStore.show({ message: 'Follow request accepted' })
  } catch {
    toastStore.show({ message: 'Couldn’t accept request' })
  } finally {
    const next = { ...followRequestBusy.value }
    delete next[key]
    followRequestBusy.value = next
  }
}

const rejectFollowRequest = async (notif: ExtendedNotification, e?: Event) => {
  e?.stopPropagation()
  if (!notif.account?.id || !notif._instanceId) return
  const key = notif._key
  followRequestBusy.value = { ...followRequestBusy.value, [key]: true }
  try {
    const client = clientFor(notif._instanceId)
    await client.v1.followRequests.$select(notif.account.id).reject()
    notificationsStore.dismissNotification(key)
    toastStore.show({ message: 'Follow request rejected' })
  } catch {
    toastStore.show({ message: 'Couldn’t reject request' })
  } finally {
    const next = { ...followRequestBusy.value }
    delete next[key]
    followRequestBusy.value = next
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
      if (entry?.isIntersecting && !notificationsStore.isLoadingMore) {
        notificationsStore.loadMore()
      }
    },
    // Mobile scrolls `main` — observe it so we start loading before the end
    { root: getMainScroller(), rootMargin: '0px 0px 400px 0px', threshold: 0.1 },
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

// Observer root depends on the shell (main vs window) — rebind when it flips
watch(useMobileViewport(), () => bindLoadObserver(loadTrigger.value), { flush: 'post' })

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

const goHome = () => {
  void router.push('/')
}

const chromeTitle = computed(() => {
  const n = notificationsStore.unreadCount
  return n > 0 ? `Activity (${n})` : 'Activity'
})
</script>

<template>
  <div class="notif-page" ref="scrollContainer">
    <SubviewChrome :title="chromeTitle" :back-action="goHome">
      <template v-if="canView" #actions>
        <button
          type="button"
          class="subview-chrome__btn neo-tip"
          title="Refresh"
          aria-label="Refresh notifications"
          :disabled="notificationsStore.isLoading"
          @click="handleRefresh"
        >
          <NeoIcon
            name="refresh"
            :size="18"
            :stroke="1.75"
            :class="{ spinning: notificationsStore.isLoading }"
          />
        </button>

        <NeoMenu
          v-model:open="sortMenuOpen"
          class="sort-menu"
          label="Sort notifications"
        >
          <NeoIcon name="menu" :size="18" :stroke="1.75" />
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
          <NeoIcon name="more" :size="18" :stroke="1.75" />
          <template #items>
            <button type="button" role="menuitem" class="actions-menu__item" @click="handleMarkRead">Mark all as read</button>
            <button type="button" role="menuitem" class="actions-menu__item actions-menu__item--danger" @click="handleClearAll">Clear all notifications</button>
          </template>
        </NeoMenu>
      </template>
    </SubviewChrome>

    <!-- Not authenticated -->
    <div v-if="!canView" class="notif-empty">
      <div class="notif-empty__icon"><NeoIcon name="lock" :size="32" :stroke="1.5" /></div>
      <h2 class="notif-empty__title">Activity</h2>
      <p class="notif-empty__desc">Sign in to see activity.</p>
      <NuxtLink to="/login" class="notif-empty__cta">Sign in</NuxtLink>
    </div>

    <!-- Main content -->
    <div v-else class="notif-container">
      <div class="notif-filters-wrap neo-sticky-bar neo-sticky-bar--under-chrome">
        <label class="notif-search">
          <span class="sr-only">Search activity</span>
          <NeoIcon name="search" :size="16" :stroke="1.75" class="notif-search__icon" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            class="notif-search__input"
            placeholder="Search activity…"
            autocomplete="off"
            enterkeyhint="search"
          />
        </label>
        <NeoTabs
          v-model="filterTabId"
          class="notif-filters"
          :tabs="filterTabs"
          :panels="false"
          controls-id="notif-list"
          id-prefix="notif-tabs"
          aria-label="Filter activity"
        />
        <p
          v-if="searchStatusText"
          class="notif-search-status"
          role="status"
          aria-live="polite"
        >
          {{ searchStatusText }}
        </p>
      </div>

      <div
        id="notif-list"
        class="notif-panel"
        role="tabpanel"
        :aria-labelledby="`notif-tabs-tab-${filterTabId}`"
      >
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
            <div class="notif-skeleton__line" :style="{ width: skeletonLineWidths[i - 1] }" />
            <div class="notif-skeleton__line notif-skeleton__line--short" :style="{ width: skeletonLineShortWidths[i - 1] }" />
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

      <!-- Search miss (loaded items exist, query matched none) -->
      <div v-else-if="searchQuery.trim() && !filteredNotifCount" class="notif-empty">
        <div class="notif-empty__icon"><NeoIcon name="search" :size="32" :stroke="1.5" /></div>
        <h2 class="notif-empty__title">No matches</h2>
        <p class="notif-empty__desc">Nothing in loaded activity matches “{{ searchQuery.trim() }}”.</p>
      </div>

      <!-- Notification list, grouped by time -->
      <div v-else class="notif-list">
        <div v-for="group in visibleGroups" :key="group" class="notif-group">
          <h2 class="notif-group__label">{{ group }}</h2>
          <div class="notif-group__items">
            <article
              v-for="notif in filteredGrouped[group]"
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

              <!-- Avatar → profile (decorative for keyboard) -->
              <div v-if="notif.account" class="notif-item__avatar" aria-hidden="true">
                <img
                  :src="notif.account.avatar"
                  alt=""
                  loading="lazy"
                />
              </div>

              <!-- Content: name → profile; rest → post -->
              <div class="notif-item__body">
                <div class="notif-item__headline">
                  <button
                    type="button"
                    class="notif-item__open-headline"
                    @click="openNotification(notif)"
                  >
                    <span v-if="notif.account" class="notif-item__name">{{ actorLabel(notif) }}</span>
                    <span class="notif-item__action">{{ notifLabel(notif.type) }}</span>
                    <span
                      v-if="showAccountHost && notif._instanceUrl"
                      class="notif-item__host"
                    >· {{ hostLabel(notif._instanceUrl) }}</span>
                  </button>
                  <time
                    class="notif-item__time"
                    :datetime="notif.createdAt"
                    :title="formatAbsoluteTime(notif.createdAt)"
                  >
                    <NeoTimeAgo :date="notif.createdAt" />
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

                <div
                  v-if="notif.type === 'follow_request' && notif.account"
                  class="notif-item__follow-actions"
                >
                  <button
                    type="button"
                    class="neo-btn neo-btn--primary neo-btn--sm"
                    :disabled="followRequestBusy[notif._key]"
                    @click="authorizeFollowRequest(notif, $event)"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    class="neo-btn neo-btn--ghost neo-btn--sm"
                    :disabled="followRequestBusy[notif._key]"
                    @click="rejectFollowRequest(notif, $event)"
                  >
                    Reject
                  </button>
                </div>
              </div>

              <!-- Dismiss -->
              <button
                type="button"
                class="notif-item__dismiss"
                aria-label="Dismiss notification"
                title="Dismiss"
                @click="handleDismiss(notif)"
              >
                <NeoIcon name="x" :size="14" :stroke="2" />
              </button>
            </article>
          </div>
        </div>

        <!-- Load more trigger -->
        <div
          ref="loadTrigger"
          class="notif-loadmore"
          role="status"
          aria-live="polite"
          :aria-busy="notificationsStore.isLoadingMore"
        >
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
  min-width: 0;
  max-width: 820px;
  margin: 0 auto;
  padding-bottom: 2rem;
  box-sizing: border-box;
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

.notif-filters-wrap {
  padding-top: 0.35rem;
  padding-bottom: 0.15rem;
  margin: 0 -0.75rem;
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  background: var(--neo-bg-primary);
  border-bottom: 1px solid var(--neo-border-color);

  @media (min-width: 600px) {
    margin: 0 -1.25rem;
    padding-left: 1.25rem;
    padding-right: 1.25rem;
  }

  @media (min-width: 1024px) {
    margin: 0 -1.5rem;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
  }
}

.notif-search {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0 0 0.45rem;
  min-height: 2.4rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md, 12px);
  background: var(--neo-bg-tertiary);
  box-sizing: border-box;

  &:focus-within {
    border-color: color-mix(in srgb, var(--neo-accent) 50%, var(--neo-border-color));
    box-shadow: 0 0 0 3px var(--neo-accent-soft);
  }

  &__icon {
    flex-shrink: 0;
    color: var(--neo-text-muted);
  }

  &__input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.875rem;
    outline: none;

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }
}

.notif-search-status {
  margin: 0 0 0.35rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
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
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--neo-text-primary);
    cursor: pointer;

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
  margin: 0;
  padding: 0 0 0.35rem;
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
    border-radius: 50%;
    overflow: hidden;
    background: var(--neo-bg-tertiary);
    margin-top: 0.125rem;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  &__open-headline {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }
  }

  &__follow-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  &__body {
    position: relative;
    z-index: 1;
    min-width: 0;
    padding-right: 1.75rem;
  }

  &__headline {
    // NeoTimeAgo goes compact when this row is narrow
    container-type: inline-size;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.9375rem;
    line-height: 1.35;

    // Touch: dismiss stays visible (no hover) — keep the timestamp clear of it
    @media (hover: none) {
      padding-right: 2.25rem;
    }
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

    &:hover {
      text-decoration: underline;
    }

    &:focus-visible {
      text-decoration: underline;
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
      border-radius: 2px;
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
