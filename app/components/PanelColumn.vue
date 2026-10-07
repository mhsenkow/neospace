<script setup lang="ts">
/**
 * Non-timeline board views: profile, search, notifications, messages.
 */

import type { mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore, type ExtendedNotification } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useColumnsStore, type ColumnConfig } from '~/stores/columns'
import { useStatusStore } from '~/stores/status'
import { activeClient, publicClient } from '~/composables/useMasto'
import { useLinkedProfileFeed } from '~/composables/useLinkedProfileFeed'
import { stripHtml } from '~/utils/sanitizeHtml'
import { notifIconName, notifLabel } from '~/utils/notifHelpers'
import { participantLabel } from '~/utils/dmHelpers'

interface Props {
  column: ColumnConfig
  canRemove: boolean
  isFirst: boolean
  isLast?: boolean
  canReorder?: boolean
  dropTarget?: boolean
  dragging?: boolean
  recessed?: boolean
  focused?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isLast: false,
  canReorder: false,
  dropTarget: false,
  dragging: false,
  recessed: false,
  focused: false,
})

const emit = defineEmits<{
  remove: []
  'column-drag-start': [columnId: string]
  'column-drag-end': []
  'column-drag-over': [columnId: string]
  'column-drop': [fromColumnId: string]
  'move-left': []
  'move-right': []
  focus: []
}>()

const onColumnDragStart = (e: DragEvent) => {
  if (!props.canReorder) return
  e.dataTransfer?.setData('text/plain', props.column.id)
  e.dataTransfer?.setData('application/x-neospace-column', props.column.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  emit('column-drag-start', props.column.id)
}

const onColumnDragEnd = () => {
  emit('column-drag-end')
}

const onColumnDragOver = (e: DragEvent) => {
  if (!props.canReorder) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  emit('column-drag-over', props.column.id)
}

const onColumnDrop = (e: DragEvent) => {
  if (!props.canReorder) return
  e.preventDefault()
  const fromId =
    e.dataTransfer?.getData('application/x-neospace-column') ||
    e.dataTransfer?.getData('text/plain')
  if (fromId && fromId !== props.column.id) {
    emit('column-drop', fromId)
  }
  emit('column-drag-end')
}

const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const statusStore = useStatusStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const composeSheet = useComposeSheetStore()
const router = useRouter()

const labels: Record<string, string> = {
  profile: 'Profile',
  search: 'Search',
  notifications: 'Notifications',
  messages: 'Messages',
}

const isProfilePeek = computed(
  () => props.column.feedType === 'profile' && !!props.column.profileAcct,
)

const title = computed(() => {
  if (isProfilePeek.value) {
    const name =
      remoteAccount.value?.displayName ||
      remoteAccount.value?.username ||
      props.column.profileAcct
    return name || 'Profile'
  }
  return labels[props.column.feedType] || 'View'
})

const formatTime = (dateString?: string | null) => {
  if (!dateString) return ''
  const date = new Date(dateString)
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const me = computed(() => instancesStore.activeAccount?.user || null)

// ── Profile (column-local peek) ─────────────────────────
const {
  resolvedInstanceId: profilePeekId,
  viewingInstance: profilePeekInstance,
  linkedAccounts: profileLinkedAccounts,
  account: profileAccount,
  statuses: profileStatuses,
  isLoading: profileLoading,
  isLoadingStatuses: profileLoadingStatuses,
  error: profileError,
  hasMore: profileHasMore,
  selectAccount: selectProfileAccount,
  refresh: refreshProfileFeed,
  loadMore: loadMoreProfilePosts,
} = useLinkedProfileFeed()

const profileHost = (url?: string | null) => {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

const profileHandle = computed(() => {
  const acct = profileAccount.value?.acct
  if (!acct) return ''
  if (acct.includes('@')) return `@${acct}`
  const host = profileHost(profilePeekInstance.value?.url)
  return host ? `@${acct}@${host}` : `@${acct}`
})

const openFullProfile = () => {
  if (props.column.profileAcct) {
    router.push({ path: '/profile', query: { user: props.column.profileAcct } })
    return
  }
  const peekId = profilePeekId.value
  if (peekId && peekId !== instancesStore.activeAccountId) {
    instancesStore.setActiveAccount(peekId)
  }
  router.push('/profile')
}

const onFocusClick = () => {
  // Profile columns jump to the full /profile page — no board "focus" shelf
  if (props.column.feedType === 'profile') {
    openFullProfile()
    return
  }
  emit('focus')
}

const exitPeek = () => {
  columnsStore.exitProfilePeek(props.column.id)
}

// ── Remote profile peek (other people) ─────────────────
const remoteAccount = ref<mastodon.v1.Account | null>(null)
const remoteStatuses = ref<mastodon.v1.Status[]>([])
const remoteLoading = ref(false)
const remoteLoadingStatuses = ref(false)
const remoteError = ref<string | null>(null)
const remoteMaxId = ref<string | null>(null)
const remoteHasMore = ref(true)

const remoteHandle = computed(() => {
  const acct = remoteAccount.value?.acct || props.column.profileAcct || ''
  return acct ? `@${acct.replace(/^@/, '')}` : ''
})

const loadRemoteProfile = async () => {
  const acct = props.column.profileAcct
  if (!acct || !instancesStore.hasAuthenticatedInstance) {
    remoteAccount.value = null
    remoteStatuses.value = []
    return
  }

  remoteLoading.value = true
  remoteError.value = null
  remoteStatuses.value = []
  remoteMaxId.value = null
  remoteHasMore.value = true

  try {
    const client = activeClient()
    let account: mastodon.v1.Account | null = null
    try {
      account = await client.v1.accounts.lookup({ acct: acct.replace(/^@/, '') })
    } catch {
      const id = await statusStore.resolveAccount(acct)
      if (id) account = await client.v1.accounts.$select(id).fetch()
    }
    if (!account) throw new Error('Account not found')
    remoteAccount.value = account
    await loadRemoteStatuses(true)
  } catch (e: any) {
    remoteError.value = e?.message || 'Couldn’t load profile'
    remoteAccount.value = null
  } finally {
    remoteLoading.value = false
  }
}

const loadRemoteStatuses = async (refresh = false) => {
  const account = remoteAccount.value
  if (!account || !instancesStore.hasAuthenticatedInstance) return
  if (refresh) {
    remoteStatuses.value = []
    remoteMaxId.value = null
    remoteHasMore.value = true
  }
  remoteLoadingStatuses.value = true
  try {
    const client = activeClient()
    const page = await client.v1.accounts.$select(account.id).statuses.list({
      limit: 20,
      maxId: remoteMaxId.value || undefined,
      excludeReplies: true,
    } as any)
    remoteStatuses.value = refresh ? page : [...remoteStatuses.value, ...page]
    if (page.length > 0) remoteMaxId.value = page[page.length - 1].id
    remoteHasMore.value = page.length === 20
  } catch (e: any) {
    remoteError.value = e?.message || 'Couldn’t load posts'
  } finally {
    remoteLoadingStatuses.value = false
  }
}

// ── Search ──────────────────────────────────────────────
const searchQuery = ref('')
const searchBusy = ref(false)
const searchError = ref<string | null>(null)
const searchAccounts = ref<mastodon.v1.Account[]>([])
const searchHashtags = ref<mastodon.v1.Tag[]>([])
const searchStatuses = ref<mastodon.v1.Status[]>([])
let searchTimer: ReturnType<typeof setTimeout> | null = null

const runSearch = async (q: string) => {
  const query = q.trim()
  if (query.length < 2) {
    searchAccounts.value = []
    searchHashtags.value = []
    searchStatuses.value = []
    searchError.value = null
    return
  }
  searchBusy.value = true
  searchError.value = null
  try {
    const client = instancesStore.hasAuthenticatedInstance ? activeClient() : publicClient()
    const res = await client.v2.search.fetch({
      q: query,
      limit: 8,
      resolve: instancesStore.hasAuthenticatedInstance,
    } as any)
    searchAccounts.value = res.accounts || []
    searchHashtags.value = res.hashtags || []
    searchStatuses.value = res.statuses || []
  } catch (e: any) {
    searchError.value = e?.message || 'Search failed'
  } finally {
    searchBusy.value = false
  }
}

watch(searchQuery, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void runSearch(q)
  }, 280)
})

const openAccount = (acct: string) => {
  router.push({ path: '/profile', query: { user: acct } })
}

const openStatus = (status: mastodon.v1.Status) => {
  router.push({
    path: `/status/${status.id}`,
    query: status.url || status.uri ? { url: status.url || status.uri } : undefined,
  })
}

const openHashtag = (tag: string) => {
  router.push(`/groups/${encodeURIComponent(tag)}`)
}

// ── Notifications ───────────────────────────────────────
const openNotification = (notif: ExtendedNotification) => {
  if (notif._instanceId && notif._instanceId !== instancesStore.activeAccountId) {
    instancesStore.setActiveAccount(notif._instanceId)
  }
  if (notif.type === 'follow' || notif.type === 'follow_request') {
    const acct = notif.account?.acct
    if (acct) {
      router.push({ path: '/profile', query: { user: acct } })
      return
    }
  }
  const status = notif.status
  if (status?.id) {
    router.push({
      path: `/status/${status.id}`,
      query: status.url || status.uri ? { url: status.url || status.uri } : undefined,
    })
    return
  }
  const acct = notif.account?.acct
  if (acct) router.push({ path: '/profile', query: { user: acct } })
}

const openNotifProfile = (notif: ExtendedNotification, e?: Event) => {
  e?.stopPropagation()
  if (notif._instanceId && notif._instanceId !== instancesStore.activeAccountId) {
    instancesStore.setActiveAccount(notif._instanceId)
  }
  const acct = notif.account?.acct
  if (acct) router.push({ path: '/profile', query: { user: acct } })
}

// ── Messages ────────────────────────────────────────────
const myId = computed(() => instancesStore.currentUser?.id || '')
const myAcct = computed(() => instancesStore.currentUser?.acct || '')

const previewText = (c: mastodon.v1.Conversation) =>
  conversationsStore.previewFor(c, myId.value, myAcct.value)

const openConversation = async (c: mastodon.v1.Conversation) => {
  if (!c.lastStatus?.id) return
  if (c.unread) await conversationsStore.markRead(c.id)
  await router.push(`/status/${c.lastStatus.id}`)
}

const startNewMessage = () => {
  composeSheet.show({
    pickRecipient: true,
    visibility: 'direct',
    title: 'New message',
    onPosted: async (status) => {
      await conversationsStore.fetchConversations(true)
      await router.push(`/status/${status.id}`)
    },
  })
}

const archiveConversation = async (c: mastodon.v1.Conversation, e: Event) => {
  e.stopPropagation()
  if (!confirm('Remove this chat from your inbox? Messages stay on the server.')) return
  try {
    await conversationsStore.remove(c.id)
  } catch {
    /* store sets error */
  }
}

onMounted(() => {
  if (props.column.feedType === 'profile' && instancesStore.hasAuthenticatedInstance) {
    if (props.column.profileAcct) void loadRemoteProfile()
    else void refreshProfileFeed()
  }
  if (props.column.feedType === 'notifications' && instancesStore.hasAuthenticatedInstance) {
    notificationsStore.fetchNotifications(true)
  }
  if (props.column.feedType === 'messages' && instancesStore.hasAuthenticatedInstance) {
    conversationsStore.fetchConversations(true)
    conversationsStore.startLiveRefresh()
  }
})

watch(
  () => [props.column.feedType, props.column.profileAcct] as const,
  ([type, acct]) => {
    if (type === 'profile' && instancesStore.hasAuthenticatedInstance) {
      if (acct) void loadRemoteProfile()
      else void refreshProfileFeed()
    }
    if (type === 'notifications' && instancesStore.hasAuthenticatedInstance) {
      notificationsStore.fetchNotifications(true)
    }
    if (type === 'messages' && instancesStore.hasAuthenticatedInstance) {
      conversationsStore.fetchConversations(true)
      conversationsStore.startLiveRefresh()
    } else if (type !== 'messages') {
      conversationsStore.stopLiveRefresh()
    }
  },
)

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  conversationsStore.stopLiveRefresh()
})
</script>

<template>
  <div
    class="panel-column neo-chrome"
    :class="{
      'neo-chrome--recessed': recessed,
      'panel-column--drop-target': dropTarget,
      'panel-column--dragging': dragging,
    }"
    @dragover="onColumnDragOver"
    @drop="onColumnDrop"
  >
    <div class="column-header">
      <button
        v-if="canReorder"
        type="button"
        class="neo-chrome-btn column-drag-handle"
        draggable="true"
        title="Drag to reorder"
        aria-label="Drag to reorder column"
        @click.stop
        @dragstart="onColumnDragStart"
        @dragend="onColumnDragEnd"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      <button
        v-if="isProfilePeek"
        type="button"
        class="neo-chrome-btn"
        title="Back"
        aria-label="Back to previous feed"
        @click="exitPeek"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <span class="column-feed-label">{{ title }}</span>

      <div v-if="canReorder && !isProfilePeek" class="column-reorder">
        <button type="button" class="neo-chrome-btn" title="Move left" aria-label="Move column left" :disabled="isFirst" @click="emit('move-left')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button type="button" class="neo-chrome-btn" title="Move right" aria-label="Move column right" :disabled="isLast" @click="emit('move-right')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="neo-chrome-btn"
        :class="{ 'neo-chrome-btn--on': focused && column.feedType !== 'profile' }"
        :title="column.feedType === 'profile' ? 'Open full profile' : focused ? 'Show all views' : 'Focus this view'"
        :aria-label="column.feedType === 'profile' ? 'Open full profile' : focused ? 'Show all views' : 'Focus this view'"
        :aria-pressed="column.feedType === 'profile' ? undefined : focused"
        @click="onFocusClick"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>

      <button
        v-if="canRemove"
        type="button"
        class="neo-chrome-btn neo-chrome-btn--danger column-close"
        title="Remove column"
        aria-label="Remove column"
        @click="emit('remove')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>

    <div class="panel-scroll">
      <!-- Profile peek (other person) -->
      <div
        v-if="column.feedType === 'profile' && column.profileAcct"
        class="panel-body panel-body--profile"
      >
        <div v-if="!instancesStore.hasAuthenticatedInstance" class="panel-empty">
          <p>Sign in to view profiles here.</p>
          <NuxtLink to="/login" class="neo-btn neo-btn--primary">Sign in</NuxtLink>
        </div>
        <template v-else>
          <div v-if="remoteLoading && !remoteAccount" class="panel-loading" aria-busy="true">
            <FunLoader fill label="Loading profile" />
          </div>

          <template v-else-if="remoteAccount">
            <div class="profile-card">
              <img
                :src="remoteAccount.avatar"
                :alt="remoteAccount.displayName || remoteAccount.username"
                class="profile-card__avatar"
              />
              <div class="profile-card__meta">
                <h3 class="profile-card__name">
                  {{ remoteAccount.displayName || remoteAccount.username }}
                </h3>
                <p class="profile-card__acct">{{ remoteHandle }}</p>
                <p v-if="remoteAccount.note" class="profile-card__bio">
                  {{ stripHtml(remoteAccount.note) }}
                </p>
                <p class="profile-card__followers">
                  <strong>{{ remoteAccount.followersCount?.toLocaleString() }}</strong> followers
                </p>
                <button
                  type="button"
                  class="neo-btn neo-btn--secondary profile-card__open"
                  @click="openFullProfile"
                >
                  Open profile
                </button>
              </div>
            </div>

            <p v-if="remoteError" class="panel-hint panel-hint--err">{{ remoteError }}</p>

            <div
              v-if="remoteLoadingStatuses && !remoteStatuses.length"
              class="panel-loading"
              aria-busy="true"
            >
              <FunLoader fill label="Loading posts" />
            </div>

            <div v-else-if="remoteStatuses.length" class="profile-panel-posts">
              <RealPostCard
                v-for="status in remoteStatuses"
                :key="status.id"
                :status="status"
              />
              <button
                v-if="remoteHasMore"
                type="button"
                class="neo-btn neo-btn--secondary panel-more"
                :disabled="remoteLoadingStatuses"
                @click="loadRemoteStatuses(false)"
              >
                {{ remoteLoadingStatuses ? 'Loading…' : 'Load more' }}
              </button>
            </div>

            <p v-else-if="!remoteLoading && !remoteError" class="panel-hint">
              No posts yet.
            </p>
          </template>

          <p v-else-if="remoteError" class="panel-hint panel-hint--err">{{ remoteError }}</p>
        </template>
      </div>

      <!-- Own profile (linked accounts) -->
      <div v-else-if="column.feedType === 'profile'" class="panel-body panel-body--profile">
        <div v-if="!me" class="panel-empty">
          <p>Sign in to see your profile here.</p>
          <NuxtLink to="/login" class="neo-btn neo-btn--primary">Sign in</NuxtLink>
        </div>
        <template v-else>
          <div
            v-if="profileLinkedAccounts.length > 1"
            class="profile-peek-strip"
            role="listbox"
            aria-label="Linked accounts"
          >
            <button
              v-for="inst in profileLinkedAccounts"
              :key="inst.id"
              type="button"
              class="profile-peek-chip"
              :class="{ 'profile-peek-chip--active': inst.id === profilePeekId }"
              role="option"
              :aria-selected="inst.id === profilePeekId"
              :title="`${inst.user?.displayName || inst.user?.username || inst.name} · ${profileHost(inst.url)}`"
              @click="selectProfileAccount(inst.id)"
            >
              <img
                :src="inst.user?.avatar || ''"
                :alt="inst.user?.displayName || inst.user?.username || inst.name"
                class="profile-peek-chip__avatar"
              />
              <span class="profile-peek-chip__host">{{ profileHost(inst.url) }}</span>
            </button>
          </div>

          <div v-if="profileLoading && !profileAccount" class="panel-loading" aria-busy="true">
            <FunLoader fill label="Loading profile" />
          </div>

          <template v-else-if="profileAccount">
            <div class="profile-card">
              <img
                :src="profileAccount.avatar"
                :alt="profileAccount.displayName || profileAccount.username"
                class="profile-card__avatar"
              />
              <div class="profile-card__meta">
                <h3 class="profile-card__name">
                  {{ profileAccount.displayName || profileAccount.username }}
                </h3>
                <p class="profile-card__acct">{{ profileHandle }}</p>
                <p v-if="profileAccount.note" class="profile-card__bio">
                  {{ stripHtml(profileAccount.note) }}
                </p>
                <p class="profile-card__followers">
                  <strong>{{ profileAccount.followersCount?.toLocaleString() }}</strong> followers
                </p>
                <button
                  type="button"
                  class="neo-btn neo-btn--secondary profile-card__open"
                  @click="openFullProfile"
                >
                  Open profile
                </button>
              </div>
            </div>

            <p v-if="profileError" class="panel-hint panel-hint--err">{{ profileError }}</p>

            <div
              v-if="profileLoadingStatuses && !profileStatuses.length"
              class="panel-loading"
              aria-busy="true"
            >
              <FunLoader fill label="Loading posts" />
            </div>

            <div v-else-if="profileStatuses.length" class="profile-panel-posts">
              <RealPostCard
                v-for="status in profileStatuses"
                :key="status.id"
                :status="status"
              />
              <button
                v-if="profileHasMore"
                type="button"
                class="neo-btn neo-btn--secondary panel-more"
                :disabled="profileLoadingStatuses"
                @click="loadMoreProfilePosts"
              >
                {{ profileLoadingStatuses ? 'Loading…' : 'Load more' }}
              </button>
            </div>

            <p v-else-if="!profileLoading && !profileError" class="panel-hint">
              No posts yet.
            </p>
          </template>

          <p v-else-if="profileError" class="panel-hint panel-hint--err">{{ profileError }}</p>
        </template>
      </div>

      <!-- Search -->
      <div v-else-if="column.feedType === 'search'" class="panel-body">
        <label class="search-field">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="People, tags, posts…"
            autocomplete="off"
          />
        </label>
        <p v-if="searchBusy" class="panel-hint">Searching…</p>
        <p v-else-if="searchError" class="panel-hint panel-hint--err">{{ searchError }}</p>
        <p v-else-if="searchQuery.trim().length < 2" class="panel-hint">Type at least two characters.</p>

        <section v-if="searchAccounts.length" class="panel-section">
          <h4>People</h4>
          <button
            v-for="acct in searchAccounts"
            :key="acct.id"
            type="button"
            class="row-btn"
            @click="openAccount(acct.acct)"
          >
            <img :src="acct.avatar" alt="" loading="lazy" decoding="async" />
            <span>
              <strong>{{ acct.displayName || acct.username }}</strong>
              <em>@{{ acct.acct }}</em>
            </span>
          </button>
        </section>

        <section v-if="searchHashtags.length" class="panel-section">
          <h4>Tags</h4>
          <button
            v-for="tag in searchHashtags"
            :key="tag.name"
            type="button"
            class="row-btn row-btn--plain"
            @click="openHashtag(tag.name)"
          >
            #{{ tag.name }}
          </button>
        </section>

        <section v-if="searchStatuses.length" class="panel-section">
          <h4>Posts</h4>
          <button
            v-for="status in searchStatuses"
            :key="status.id"
            type="button"
            class="row-btn"
            @click="openStatus(status)"
          >
            <img :src="status.account.avatar" alt="" loading="lazy" decoding="async" />
            <span>
              <strong>{{ status.account.displayName || status.account.username }}</strong>
              <em>{{ stripHtml(status.content).slice(0, 120) }}</em>
            </span>
          </button>
        </section>
      </div>

      <!-- Notifications -->
      <div v-else-if="column.feedType === 'notifications'" class="panel-body">
        <div v-if="!instancesStore.hasAuthenticatedInstance" class="panel-empty">
          <p>Sign in to see notifications here.</p>
          <NuxtLink to="/login" class="neo-btn neo-btn--primary">Sign in</NuxtLink>
        </div>
        <template v-else>
          <div class="panel-toolbar">
            <button
              type="button"
              class="neo-btn neo-btn--tertiary neo-btn--icon"
              title="Refresh"
              aria-label="Refresh"
              @click="notificationsStore.fetchNotifications(true)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
            <NuxtLink to="/notifications" class="panel-link">Full page</NuxtLink>
          </div>
          <p v-if="notificationsStore.isLoading && notificationsStore.isEmpty" class="panel-hint">Loading…</p>
          <p v-else-if="notificationsStore.isEmpty" class="panel-hint">All caught up.</p>
          <button
            v-for="notif in notificationsStore.filteredNotifications.slice(0, 40)"
            :key="notif._key"
            type="button"
            class="row-btn"
            @click="openNotification(notif)"
          >
            <span class="row-btn__badge"><NeoIcon :name="notifIconName(notif.type)" :size="14" :stroke="2" /></span>
            <span
              v-if="notif.account"
              class="row-btn__avatar"
              role="link"
              tabindex="-1"
              @click="openNotifProfile(notif, $event)"
            >
              <img :src="notif.account.avatar" alt="" loading="lazy" decoding="async" />
            </span>
            <span>
              <strong
                class="row-btn__name"
                @click="openNotifProfile(notif, $event)"
              >{{ notif.account?.displayName || notif.account?.username }}</strong>
              <em>{{ notifLabel(notif.type) }} · {{ formatTime(notif.createdAt) }}</em>
            </span>
          </button>
        </template>
      </div>

      <!-- Messages -->
      <div v-else class="panel-body">
        <div v-if="!instancesStore.hasAuthenticatedInstance" class="panel-empty">
          <p>Sign in to see messages here.</p>
          <NuxtLink to="/login" class="neo-btn neo-btn--primary">Sign in</NuxtLink>
        </div>
        <template v-else>
          <div class="panel-toolbar">
            <button type="button" class="neo-btn neo-btn--primary" @click="startNewMessage">New</button>
            <NuxtLink to="/messages" class="panel-link">Full page</NuxtLink>
          </div>
          <div
            v-if="conversationsStore.isLoading && !conversationsStore.conversations.length"
            class="panel-loading"
            aria-busy="true"
          >
            <FunLoader variant="region" label="Loading messages" />
          </div>
          <div v-else-if="!conversationsStore.conversations.length" class="panel-empty panel-empty--soft">
            <p>No chats yet — pick someone you follow to say hi.</p>
            <button type="button" class="neo-btn neo-btn--primary neo-btn--sm" @click="startNewMessage">
              Message someone
            </button>
            <NuxtLink to="/explore?tab=people" class="panel-link">Find people</NuxtLink>
          </div>
          <div
            v-for="c in conversationsStore.conversations"
            :key="c.id"
            class="panel-msg-row"
            :class="{ 'panel-msg-row--unread': c.unread, 'panel-msg-row--disabled': !c.lastStatus?.id }"
          >
            <button
              type="button"
              class="row-btn"
              :disabled="!c.lastStatus?.id"
              @click="openConversation(c)"
            >
              <img :src="c.accounts?.[0]?.avatar || me?.avatar" alt="" loading="lazy" decoding="async" />
              <span>
                <strong>{{ participantLabel(c) }}</strong>
                <em>{{ previewText(c) }}</em>
              </span>
              <time>{{ formatTime(c.lastStatus?.createdAt) }}</time>
            </button>
            <button
              type="button"
              class="panel-msg-row__x"
              title="Remove from inbox"
              aria-label="Remove from inbox"
              @click="archiveConversation(c, $event)"
            >
              <NeoIcon name="x" :size="14" :stroke="2" />
            </button>
          </div>
          <button
            v-if="conversationsStore.hasMore"
            type="button"
            class="neo-btn neo-btn--ghost neo-btn--sm panel-more"
            :disabled="conversationsStore.isLoadingMore"
            @click="conversationsStore.loadMore()"
          >
            {{ conversationsStore.isLoadingMore ? 'Loading…' : 'Load more' }}
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.panel-column {
  flex: 1 0 280px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 280px;
  border-right: 1px solid var(--neo-border-color);
  position: relative;
  background: var(--neo-bg-primary);

  &:last-of-type {
    border-right: none;
  }

  &--dragging {
    opacity: 0.45;
  }

  &--drop-target {
    background: color-mix(in srgb, var(--neo-accent) 6%, transparent);
  }
}

.column-header {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.5rem 0 0.35rem;
  height: 48px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  z-index: 10;

  @media (max-width: 1023px) {
    display: none;
  }
}

.column-drag-handle {
  cursor: grab;
  &:active { cursor: grabbing; }
}

.column-feed-label {
  font-size: 0.875rem;
  font-weight: 650;
  color: var(--neo-chrome-label, var(--neo-text-primary));
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-reorder {
  display: flex;
  align-items: center;
  margin-left: auto;
  gap: 0.125rem;
}

.column-close {
  margin-left: 0;
}

.neo-chrome-btn--on {
  color: var(--neo-accent);
}

.panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  touch-action: pan-y;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
}

.panel-body {
  padding: 0.75rem 0.85rem 1.5rem;
}

.panel-empty,
.panel-hint {
  font-size: 0.875rem;
  color: var(--neo-text-tertiary);
  line-height: 1.45;
}

.panel-hint--err {
  color: var(--neo-danger, #c44);
}

.panel-loading {
  display: flex;
  align-items: stretch;
  justify-content: center;
  width: 100%;
  min-height: min(42dvh, 18rem);
  padding: 0.75rem 0.35rem;
  box-sizing: border-box;
}

.panel-msg-row {
  display: flex;
  align-items: stretch;

  &--unread .row-btn strong {
    font-weight: 700;
  }

  &--disabled .row-btn {
    opacity: 0.55;
  }

  &__x {
    width: 40px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-quaternary);
    cursor: pointer;

    &:hover {
      color: var(--neo-text-primary);
      background: var(--neo-bg-tertiary);
    }
  }
}

.panel-more {
  margin: 0.75rem auto 0.25rem;
  display: block;
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem 0;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.panel-link {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-accent);
  text-decoration: none;
}

.panel-section {
  margin-top: 1rem;

  h4 {
    margin: 0 0 0.4rem;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--neo-text-quaternary);
  }
}

.search-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 8px;
  background: var(--neo-bg-secondary);

  input {
    flex: 1;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    outline: none;
    min-width: 0;
  }
}

.row-btn {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.15rem;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 6px;

  &:hover {
    background: var(--neo-bg-hover);
  }

  img,
  .row-btn__avatar img {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    pointer-events: none;
  }

  &__avatar {
    display: block !important;
    flex: 0 0 auto !important;
    width: 40px;
    height: 40px;
    padding: 2px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  &__name {
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }

  span {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;

    strong {
      font-size: 0.8125rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    em {
      font-style: normal;
      font-size: 0.75rem;
      color: var(--neo-text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  time {
    font-size: 0.7rem;
    color: var(--neo-text-quaternary);
    flex-shrink: 0;
  }

  &__badge {
    width: 1.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--neo-text-muted);
    flex-shrink: 0;
  }

  &--plain {
    font-weight: 600;
    padding: 0.4rem 0.15rem;
  }

  &--unread strong {
    color: var(--neo-accent);
  }
}

.panel-body--profile {
  // Flush to the column chrome — match timeline posts, no inset “card shelf”
  padding: 0;
}

.profile-peek-strip {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding: 0.65rem 0.5rem 0.75rem;
  margin-bottom: 0;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.profile-peek-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  max-width: 4.5rem;
  padding: 0.2rem;
  border: none;
  background: transparent;
  color: var(--neo-text-tertiary);
  cursor: pointer;
  border-radius: 0.65rem;
  transition: color 0.15s ease, background-color 0.15s ease;

  &:hover {
    color: var(--neo-text-primary);
    background: color-mix(in srgb, var(--neo-text-primary) 5%, transparent);
  }

  &--active {
    color: var(--neo-text-primary);

    .profile-peek-chip__avatar {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
    }
  }

  &__avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-tertiary);
  }

  &__host {
    font-size: 0.625rem;
    line-height: 1.2;
    font-weight: 600;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.profile-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.75rem;
  box-sizing: border-box;
  width: 100%;
  padding: 0.75rem 0.5rem 0.85rem;
  margin: 0;
  border-bottom: 1px solid var(--neo-border-color);

  &__avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    border: 1px solid var(--neo-border-color);
    flex-shrink: 0;
  }

  &__meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    width: 100%;
    min-width: 0;
  }

  &__name {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 700;
  }

  &__acct {
    margin: 0;
    font-size: 0.875rem;
    color: var(--neo-text-tertiary);
  }

  &__bio {
    margin: 0.35rem 0 0;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__followers {
    margin: 0.35rem 0 0;
    font-size: 0.875rem;
    color: var(--neo-text-muted);

    strong {
      color: var(--neo-text-primary);
      font-weight: 600;
    }
  }

  &__open {
    margin-top: 0.5rem;
    width: 100%;
    justify-content: center;
  }
}

.profile-panel-posts {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0.5rem;
  box-sizing: border-box;
  width: 100%;

  // Same card edges as TimelineColumn posts
  :deep(.status-card) {
    border: 1px solid var(--neo-border-color);
    border-radius: 4px;
  }
}
</style>
