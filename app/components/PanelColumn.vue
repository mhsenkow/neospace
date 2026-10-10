<script setup lang="ts">
/**
 * Non-timeline board views: profile, search, notifications, messages.
 */

import type { mastodon } from 'masto'
import { formatCompactRelativeTime } from '~/utils/relativeTime'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore, type ExtendedNotification } from '~/stores/notifications'
import { useConversationsStore } from '~/stores/conversations'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useOverlayStore } from '~/stores/overlay'
import { useColumnsStore, FEED_LABELS, type ColumnConfig } from '~/stores/columns'
import { useStatusStore } from '~/stores/status'
import { activeClient, publicClient } from '~/composables/useMasto'
import { createRaceGuard } from '~/composables/useRace'
import { useLinkedProfileFeed } from '~/composables/useLinkedProfileFeed'
import { stripHtml } from '~/utils/stripHtml'
import { notifIconName, notifLabel } from '~/utils/notifHelpers'
import { participantLabel } from '~/utils/dmHelpers'
import { useColumnDnd } from '~/composables/useColumnDnd'

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

// Drop target for the whole column; the drag handle itself lives in ColumnChrome
const { onColumnDragOver, onColumnDrop } = useColumnDnd(
  () => props.column.id,
  emit,
  () => props.canReorder,
)

const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const statusStore = useStatusStore()
const notificationsStore = useNotificationsStore()
const conversationsStore = useConversationsStore()
const composeSheet = useComposeSheetStore()
const router = useRouter()

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
  return FEED_LABELS[props.column.feedType] || 'View'
})

const notifPreview = (status?: mastodon.v1.Status | null) => {
  if (!status?.content) return ''
  const text = stripHtml(status.content).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > 100 ? `${text.slice(0, 100)}…` : text
}

const notifSearchQuery = ref('')
const msgSearchQuery = ref('')

const panelNotifications = computed(() => {
  const items = notificationsStore.filteredNotifications
  const q = notifSearchQuery.value.trim().toLowerCase()
  if (!q) return items
  return items.filter((n) => {
    const name = `${n.account?.displayName || ''} ${n.account?.username || ''} ${n.account?.acct || ''}`.toLowerCase()
    const action = notifLabel(n.type).toLowerCase()
    const preview = notifPreview(n.status).toLowerCase()
    return name.includes(q) || action.includes(q) || preview.includes(q)
  })
})

const formatTime = (dateString?: string | null) =>
  dateString ? formatCompactRelativeTime(dateString) : ''

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

const onProfilePeekKeydown = (e: KeyboardEvent) => {
  const list = profileLinkedAccounts.value
  if (list.length < 2) return
  const idx = list.findIndex((inst) => inst.id === profilePeekId.value)
  if (idx < 0) return
  let next = idx
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % list.length
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + list.length) % list.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = list.length - 1
  else return
  e.preventDefault()
  const target = list[next]
  if (!target) return
  selectProfileAccount(target.id)
  nextTick(() => {
    const el = (e.currentTarget as HTMLElement | null)?.querySelector(
      `[aria-checked="true"]`,
    ) as HTMLElement | null
    el?.focus()
  })
}

const profilePeekRace = createRaceGuard()

const loadRemoteProfile = async () => {
  const acct = props.column.profileAcct
  if (!acct || !instancesStore.hasAuthenticatedInstance) {
    remoteAccount.value = null
    remoteStatuses.value = []
    return
  }

  const ticket = profilePeekRace.next()
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
    if (!ticket.isCurrent()) return
    if (!account) throw new Error('Account not found')
    remoteAccount.value = account
    await loadRemoteStatuses(true)
  } catch (e: any) {
    if (!ticket.isCurrent()) return
    remoteError.value = e?.message || 'Couldn’t load profile'
    remoteAccount.value = null
  } finally {
    if (ticket.isCurrent()) remoteLoading.value = false
  }
}

/** Newer status loads (refresh or another peek) supersede older ones */
let remoteStatusesGen = 0

const loadRemoteStatuses = async (refresh = false) => {
  const account = remoteAccount.value
  if (!account || !instancesStore.hasAuthenticatedInstance) return
  if (refresh) {
    remoteStatuses.value = []
    remoteMaxId.value = null
    remoteHasMore.value = true
  }
  const gen = ++remoteStatusesGen
  remoteLoadingStatuses.value = true
  try {
    const client = activeClient()
    const page = await client.v1.accounts.$select(account.id).statuses.list({
      limit: 20,
      maxId: remoteMaxId.value || undefined,
      excludeReplies: true,
    })
    // The peek moved to someone else meanwhile — don't append their posts here
    if (gen !== remoteStatusesGen || remoteAccount.value?.id !== account.id) return
    remoteStatuses.value = refresh ? page : [...remoteStatuses.value, ...page]
    if (page.length > 0) remoteMaxId.value = page[page.length - 1]!.id
    remoteHasMore.value = page.length === 20
  } catch (e: any) {
    if (gen !== remoteStatusesGen) return
    remoteError.value = e?.message || 'Couldn’t load posts'
  } finally {
    if (gen === remoteStatusesGen) remoteLoadingStatuses.value = false
  }
}

// ── Search ──────────────────────────────────────────────
const searchQuery = ref('')
const searchBusy = ref(false)
const searchError = ref<string | null>(null)
const searchAccounts = ref<mastodon.v1.Account[]>([])
const searchHashtags = ref<mastodon.v1.Tag[]>([])
const searchStatuses = ref<mastodon.v1.Status[]>([])
const searchRace = createRaceGuard()
let searchTimer: ReturnType<typeof setTimeout> | null = null

const searchResultCount = computed(
  () => searchAccounts.value.length + searchHashtags.value.length + searchStatuses.value.length,
)

const runSearch = async (q: string) => {
  const query = q.trim()
  if (query.length < 2) {
    searchRace.abort()
    searchAccounts.value = []
    searchHashtags.value = []
    searchStatuses.value = []
    searchError.value = null
    return
  }
  const ticket = searchRace.next()
  searchBusy.value = true
  searchError.value = null
  try {
    const client = instancesStore.hasAuthenticatedInstance ? activeClient() : publicClient()
    const res = await client.v2.search.list({
      q: query,
      limit: 8,
      resolve: instancesStore.hasAuthenticatedInstance && /@[\w.-]+@[\w.-]+/.test(query),
    })
    if (!ticket.isCurrent()) return
    searchAccounts.value = res.accounts || []
    searchHashtags.value = res.hashtags || []
    searchStatuses.value = res.statuses || []
  } catch (e: any) {
    if (!ticket.isCurrent()) return
    searchError.value = e?.message || 'Search failed'
  } finally {
    if (ticket.isCurrent()) searchBusy.value = false
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
/** Prefer the notification's account client via ?account= — don't switch global active. */
const accountQuery = (instanceId?: string) =>
  instanceId ? { account: instanceId } : {}

const openNotification = (notif: ExtendedNotification) => {
  const via = accountQuery(notif._instanceId)
  if (notif.type === 'follow' || notif.type === 'follow_request') {
    const acct = notif.account?.acct
    if (acct) {
      router.push({ path: '/profile', query: { user: acct, ...via } })
      return
    }
  }
  const status = notif.status
  if (status?.id) {
    const url = status.url || status.uri
    router.push({
      path: `/status/${status.id}`,
      query: {
        ...(url ? { url } : {}),
        ...via,
      },
    })
    return
  }
  const acct = notif.account?.acct
  if (acct) router.push({ path: '/profile', query: { user: acct, ...via } })
}

const openNotifProfile = (notif: ExtendedNotification, e?: Event) => {
  e?.stopPropagation()
  const acct = notif.account?.acct
  if (acct) {
    router.push({
      path: '/profile',
      query: { user: acct, ...accountQuery(notif._instanceId) },
    })
  }
}

// ── Messages ────────────────────────────────────────────
const myId = computed(() => instancesStore.currentUser?.id || '')
const myAcct = computed(() => instancesStore.currentUser?.acct || '')

const previewText = (c: mastodon.v1.Conversation) =>
  conversationsStore.previewFor(c, myId.value, myAcct.value)

const panelConversations = computed(() => {
  const list = conversationsStore.conversations
  const q = msgSearchQuery.value.trim().toLowerCase()
  if (!q) return list
  return list.filter((c) => {
    const names = (c.accounts || [])
      .map((a) => `${a.displayName || ''} ${a.username || ''} ${a.acct || ''}`)
      .join(' ')
      .toLowerCase()
    const preview = previewText(c).toLowerCase()
    return names.includes(q) || preview.includes(q)
  })
})

const openConversation = async (c: mastodon.v1.Conversation) => {
  if (!c.lastStatus?.id) return
  const id = c.lastStatus.id
  if (c.unread) void conversationsStore.markRead(c.id)
  await router.push(`/status/${id}`)
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
  const ok = await useOverlayStore().openConfirm({
    title: 'Remove this chat?',
    body: 'Messages stay on the server. This only removes it from your inbox.',
    confirmLabel: 'Remove',
    danger: true,
  })
  if (!ok) return
  try {
    await conversationsStore.remove(c.id)
  } catch {
    /* store sets error */
  }
}

/** DM polling is ref-counted and shared with the shell — only release what we took */
let dmRefreshHeld = false
const startDmRefresh = () => {
  if (dmRefreshHeld) return
  conversationsStore.startLiveRefresh()
  dmRefreshHeld = true
}
const stopDmRefresh = () => {
  if (!dmRefreshHeld) return
  conversationsStore.stopLiveRefresh()
  dmRefreshHeld = false
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
    startDmRefresh()
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
      startDmRefresh()
    } else if (type !== 'messages') {
      stopDmRefresh()
    }
  },
)

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  searchRace.next()
  stopDmRefresh()
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
    <!-- Same outline as TimelineColumn: each column is an h2 section -->
    <h2 class="sr-only">{{ title }}</h2>
    <ColumnChrome
      :column-id="column.id"
      :can-reorder="canReorder"
      :is-first="isFirst"
      :is-last="isLast"
      @column-drag-start="emit('column-drag-start', $event)"
      @column-drag-end="emit('column-drag-end')"
      @column-drag-over="emit('column-drag-over', $event)"
      @column-drop="emit('column-drop', $event)"
      @move-left="emit('move-left')"
      @move-right="emit('move-right')"
    >
      <template #lead>
        <button
          v-if="isProfilePeek"
          type="button"
          class="neo-chrome-btn"
          title="Back"
          aria-label="Back to previous feed"
          @click="exitPeek"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </template>
      <template #title>
        <span class="column-feed-label">{{ title }}</span>
      </template>
      <template #actions>
        <button
          type="button"
          class="neo-chrome-btn"
          :class="{ 'neo-chrome-btn--on': focused && column.feedType !== 'profile' }"
          :title="column.feedType === 'profile' ? 'Open full profile' : focused ? 'Show all views' : 'Focus this view'"
          :aria-label="column.feedType === 'profile' ? 'Open full profile' : focused ? 'Show all views' : 'Focus this view'"
          :aria-pressed="column.feedType === 'profile' ? undefined : focused"
          @pointerdown.stop
          @click.stop="onFocusClick"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </template>
      <template #close>
        <button
          v-if="canRemove"
          type="button"
          class="neo-chrome-btn neo-chrome-btn--danger column-close"
          title="Remove column"
          aria-label="Remove column"
          @pointerdown.stop
          @click.stop="emit('remove')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </template>
    </ColumnChrome>

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
            <ProfilePeekCard
              :account="remoteAccount"
              open-label="Open profile"
              @open="openFullProfile"
            />

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
            role="radiogroup"
            aria-label="Linked accounts"
            @keydown="onProfilePeekKeydown"
          >
            <button
              v-for="inst in profileLinkedAccounts"
              :key="inst.id"
              type="button"
              class="profile-peek-chip"
              :class="{ 'profile-peek-chip--active': inst.id === profilePeekId }"
              role="radio"
              :aria-checked="inst.id === profilePeekId"
              :tabindex="inst.id === profilePeekId ? 0 : -1"
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
            <ProfilePeekCard
              :account="profileAccount"
              open-label="Open profile"
              @open="openFullProfile"
            />

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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            v-model="searchQuery"
            type="search"
            placeholder="People, tags, posts…"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            enterkeyhint="search"
            autocomplete="off"
            aria-label="Search people, tags, and posts"
            :aria-busy="searchBusy || undefined"
          />
        </label>
        <p class="panel-hint sr-only" aria-live="polite">
          <template v-if="searchBusy">Searching…</template>
          <template v-else-if="searchQuery.trim().length >= 2 && !searchError">
            {{ searchResultCount }} result{{ searchResultCount === 1 ? '' : 's' }}
          </template>
        </p>
        <p v-if="searchBusy" class="panel-hint" aria-hidden="true">Searching…</p>
        <p v-else-if="searchError" class="panel-hint panel-hint--err" role="alert">{{ searchError }}</p>
        <p v-else-if="searchQuery.trim().length < 2" class="panel-hint">Type at least two characters.</p>

        <section v-if="searchAccounts.length" class="panel-section">
          <h3 class="panel-section__title">People</h3>
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
          <h3 class="panel-section__title">Tags</h3>
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
          <h3 class="panel-section__title">Posts</h3>
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
          <label v-if="!notificationsStore.isEmpty" class="search-field panel-list-search">
            <NeoIcon name="search" :size="14" :stroke="1.75" aria-hidden="true" />
            <span class="sr-only">Search activity</span>
            <input
              v-model="notifSearchQuery"
              type="search"
              placeholder="Search activity…"
              autocomplete="off"
              enterkeyhint="search"
            />
          </label>
          <p v-if="notificationsStore.isLoading && notificationsStore.isEmpty" class="panel-hint">Loading…</p>
          <p v-else-if="notificationsStore.isEmpty" class="panel-hint">All caught up.</p>
          <p v-else-if="notifSearchQuery.trim() && !panelNotifications.length" class="panel-hint">
            No matches for “{{ notifSearchQuery.trim() }}”.
          </p>
          <div
            v-for="notif in panelNotifications"
            :key="notif._key"
            class="row-btn-wrap"
            :class="{ 'row-btn-wrap--unread': notificationsStore.isUnread(notif) }"
          >
            <button
              v-if="notif.account"
              type="button"
              class="row-btn__avatar"
              :aria-label="`View profile of ${notif.account.displayName || notif.account.username}`"
              @click="openNotifProfile(notif, $event)"
            >
              <img :src="notif.account.avatar" alt="" loading="lazy" decoding="async" />
            </button>
            <div class="row-btn row-btn--split">
              <span v-if="notificationsStore.isUnread(notif)" class="row-btn__unread">
                <span class="sr-only">Unread</span>
              </span>
              <span class="row-btn__badge" aria-hidden="true">
                <NeoIcon :name="notifIconName(notif.type)" :size="14" :stroke="2" />
              </span>
              <span class="row-btn__copy">
                <button
                  v-if="notif.account"
                  type="button"
                  class="row-btn__name"
                  @click="openNotifProfile(notif, $event)"
                >
                  {{ notif.account.displayName || notif.account.username }}
                </button>
                <button
                  type="button"
                  class="row-btn__action"
                  @click="openNotification(notif)"
                >
                  <em>{{ notifLabel(notif.type) }} · {{ formatTime(notif.createdAt) }}</em>
                  <em v-if="notifPreview(notif.status)" class="row-btn__excerpt">{{ notifPreview(notif.status) }}</em>
                </button>
              </span>
            </div>
          </div>
          <button
            v-if="notificationsStore.hasMore && !notificationsStore.isEmpty"
            type="button"
            class="neo-btn neo-btn--ghost neo-btn--sm panel-more"
            :disabled="notificationsStore.isLoadingMore"
            @click="notificationsStore.loadMore()"
          >
            {{ notificationsStore.isLoadingMore ? 'Loading…' : 'Load more' }}
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
          <label v-if="conversationsStore.conversations.length" class="search-field panel-list-search">
            <NeoIcon name="search" :size="14" :stroke="1.75" aria-hidden="true" />
            <span class="sr-only">Search chats</span>
            <input
              v-model="msgSearchQuery"
              type="search"
              placeholder="Search chats…"
              autocomplete="off"
              enterkeyhint="search"
            />
          </label>
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
          <p v-else-if="msgSearchQuery.trim() && !panelConversations.length" class="panel-hint">
            No chats match “{{ msgSearchQuery.trim() }}”.
          </p>
          <div
            v-for="c in panelConversations"
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

  @media (min-width: 1024px) {
    touch-action: pan-x pan-y;
  }
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

  &--unread .row-btn__name {
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
}

.panel-section__title {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  font-weight: 650;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  // quaternary was ~2:1 — section labels still need to be legible
  color: var(--neo-text-tertiary);
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

.search-field {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 8px;
  background: var(--neo-bg-secondary);

  &:focus-within {
    border-color: var(--neo-accent);
    box-shadow: 0 0 0 3px var(--neo-accent-soft);
  }

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

.panel-list-search {
  position: sticky;
  top: 0;
  z-index: 2;
  margin-bottom: 0.55rem;
  background: var(--neo-bg-secondary);
}

.row-btn-wrap {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  width: 100%;

  &--unread {
    border-left: 2px solid var(--neo-accent);
    margin-left: -0.35rem;
    padding-left: 0.35rem;
    background: color-mix(in srgb, var(--neo-accent) 5%, transparent);
  }
}

.row-btn-wrap > .row-btn__avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
  padding: 2px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;

  img {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    object-fit: cover;
    pointer-events: none;
  }

  &:hover {
    background: var(--neo-bg-hover);
  }
}

.row-btn {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex: 1;
  min-width: 0;
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

  &--split {
    cursor: default;

    &:hover {
      background: transparent;
    }
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

  &__copy {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;
  }

  &__name,
  &__action {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 4px;

    &:hover {
      background: var(--neo-bg-hover);
    }

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 1px;
    }
  }

  &__name {
    font-size: 0.8125rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &:hover {
      color: var(--neo-accent);
      text-decoration: underline;
    }
  }

  &__action {
    em {
      display: block;
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

  &__unread {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--neo-accent);
    flex-shrink: 0;
  }

  &__excerpt {
    white-space: normal !important;
    display: -webkit-box !important;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--neo-text-secondary) !important;
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
