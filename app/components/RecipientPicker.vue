<script setup lang="ts">
/**
 * Pick who to message — following + search (Mastodon's "friends" substitute).
 * Choosing someone adds a chip. Message confirms: one person or a group of up to 8.
 */

import type { mastodon } from 'masto'
import { accountHandle, useAccountSearch } from '~/composables/useAccountSearch'
import { isImeEvent } from '~/composables/useComposerCore'
import { useInstancesStore } from '~/stores/instances'
import { useConversationsStore } from '~/stores/conversations'
import {
  DM_RECIPIENT_LIMIT,
  addDmRecipient,
  dmConfirmLabel,
  recipientLabel,
  recipientRemoveLabel,
  removeDmRecipient,
} from '~/utils/dmRecipients'

const props = withDefaults(
  defineProps<{
    /** Soft keyboard up — hide lede / compact header title */
    keyboardOpen?: boolean
    /** Parent is opening the conversation */
    busy?: boolean
  }>(),
  { keyboardOpen: false, busy: false },
)

const emit = defineEmits<{
  /** Reader pressed Message — one account, or several in pick order */
  confirm: [accounts: mastodon.v1.Account[]]
  cancel: []
}>()

const query = ref('')
const listIndex = ref(-1)
const listRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)
const chipsRef = ref<HTMLElement | null>(null)
const statusAnnounce = ref('')
const flash = ref('')
const selected = ref<mastodon.v1.Account[]>([])
let flashTimer: ReturnType<typeof setTimeout> | null = null

const {
  results,
  following,
  isSearching,
  isLoadingFollowing,
  followingError,
  error: searchError,
  loadFollowing,
  search,
  clear,
} = useAccountSearch()

const trimmedQuery = computed(() => query.value.trim())
const hasQuery = computed(() => trimmedQuery.value.length > 0)

const localMatches = computed(() => {
  const q = trimmedQuery.value.toLowerCase().replace(/^@/, '')
  if (!q) return following.value
  return following.value.filter((a) => {
    const name = (a.displayName || a.username || '').toLowerCase()
    const acct = a.acct.toLowerCase()
    return name.includes(q) || acct.includes(q) || a.username.toLowerCase().includes(q)
  })
})

const instancesStore = useInstancesStore()
const selfId = computed(() => instancesStore.currentUser?.id ?? null)

const displayAccounts = computed(() => {
  if (!hasQuery.value) return following.value
  // Never offer yourself: picking your own account would start a DM to nobody
  const seen = new Set<string>(selfId.value ? [selfId.value] : [])
  const merged: mastodon.v1.Account[] = []
  for (const a of localMatches.value) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    merged.push(a)
  }
  for (const a of results.value) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    merged.push(a)
  }
  return merged
})

const conversationsStore = useConversationsStore()
/** People you already have a 1:1 chat with (picking one reopens it instead of starting a new DM) */
const chatOpenIds = computed(() => {
  const ids = new Set<string>()
  for (const a of displayAccounts.value) {
    if (conversationsStore.findDirectWith(a.id)?.lastStatus?.id) ids.add(a.id)
  }
  return ids
})

/** Short, text-first account hints (locked / bot / moved) */
const accountBadges = (a: mastodon.v1.Account): string[] => {
  const out: string[] = []
  if (a.moved) out.push('Moved')
  if (a.locked) out.push('Locked')
  if (a.bot) out.push('Bot')
  return out
}

const selectedIds = computed(() => new Set(selected.value.map((a) => a.id)))
const atLimit = computed(() => selected.value.length >= DM_RECIPIENT_LIMIT)
const confirmLabel = computed(() => dmConfirmLabel(selected.value.length))

const listStatus = computed(() => {
  if (followingError.value) return followingError.value
  if (searchError.value) return searchError.value
  if (hasQuery.value && isSearching.value) return 'Searching…'
  if (hasQuery.value && !displayAccounts.value.length) return 'No one matched.'
  if (!hasQuery.value && isLoadingFollowing.value) return 'Loading people you follow…'
  if (!hasQuery.value && !following.value.length && !followingError.value) {
    return 'You’re not following anyone yet.'
  }
  if (displayAccounts.value.length) {
    return `${displayAccounts.value.length} ${displayAccounts.value.length === 1 ? 'person' : 'people'}`
  }
  return ''
})

const liveStatus = computed(() => flash.value || statusAnnounce.value)

const announce = (msg: string) => {
  flash.value = ''
  nextTick(() => {
    flash.value = msg
  })
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flashTimer = null
    if (flash.value === msg) flash.value = ''
  }, 1600)
}

watch(listStatus, (msg) => {
  if (!msg) return
  statusAnnounce.value = ''
  nextTick(() => {
    statusAnnounce.value = msg
  })
})

watch(query, (q) => {
  listIndex.value = -1
  search(q)
})

/*
 * Search results / the following list land asynchronously. Keep the highlight
 * on the same person (or drop it) so Enter can't pick whoever slid into that
 * slot, and aria-activedescendant never points at a removed option.
 */
watch(displayAccounts, (next, prev) => {
  if (listIndex.value < 0) return
  const activeId = prev?.[listIndex.value]?.id
  listIndex.value = activeId ? next.findIndex((a) => a.id === activeId) : -1
})

onMounted(() => {
  void loadFollowing()
  // "Chat open" markers need the inbox; it's usually loaded already
  if (!conversationsStore.conversations.length) {
    void conversationsStore.fetchConversations({ quiet: true }).catch(() => {
      /* markers are a hint — the picker works without them */
    })
  }
})

const focusSearch = () => {
  nextTick(() => inputRef.value?.focus())
}

const pick = (account: mastodon.v1.Account) => {
  const next = addDmRecipient(selected.value, account)
  const name = recipientLabel(account)
  if (!next.added) {
    announce(
      next.reason === 'limit'
        ? `You can message up to ${DM_RECIPIENT_LIMIT} people.`
        : `Already added ${name}`,
    )
  } else {
    selected.value = next.selected
    announce(`Added ${name}`)
  }
  clear()
  query.value = ''
  listIndex.value = -1
  focusSearch()
}

const removeRecipient = (id: string, index: number) => {
  const account = selected.value.find((a) => a.id === id)
  selected.value = removeDmRecipient(selected.value, id)
  if (account) announce(`Removed ${recipientLabel(account)}`)
  nextTick(() => {
    const buttons = chipsRef.value?.querySelectorAll<HTMLButtonElement>('button')
    const next = buttons?.length ? buttons[Math.min(index, buttons.length - 1)] : undefined
    ;(next ?? inputRef.value)?.focus()
  })
}

const confirmRecipients = () => {
  if (props.busy || !selected.value.length) return
  emit('confirm', selected.value.slice())
}

const retryFollowing = () => {
  void loadFollowing(true)
}

const onListKeydown = (e: KeyboardEvent) => {
  if (isImeEvent(e)) return
  const count = displayAccounts.value.length
  if (!count) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    listIndex.value = (listIndex.value + 1) % count
    scrollActiveIntoView()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    listIndex.value = (listIndex.value - 1 + count) % count
    scrollActiveIntoView()
  } else if (e.key === 'Enter' && listIndex.value >= 0) {
    e.preventDefault()
    const pickAccount = displayAccounts.value[listIndex.value]
    if (pickAccount) pick(pickAccount)
  }
}

const scrollActiveIntoView = () => {
  nextTick(() => {
    const el = listRef.value?.querySelector<HTMLElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  })
}

onUnmounted(() => {
  clear()
  if (flashTimer) clearTimeout(flashTimer)
})
</script>

<template>
  <!-- Lives inside ComposeSheet's dialog, which takes its name from our title -->
  <div class="recipient-picker" :class="{ 'recipient-picker--keyboard': props.keyboardOpen }">
    <NeoSheetHeader
      title="New message"
      title-id="recipient-picker-title"
      :title-sr-only="props.keyboardOpen"
      @cancel="emit('cancel')"
    />

    <p v-if="!props.keyboardOpen" class="recipient-picker__hint">
      No separate friends list — add people you follow, or search the fediverse. Up to 8.
    </p>

    <ul
      v-if="selected.length"
      ref="chipsRef"
      class="recipient-picker__chips"
      aria-label="Selected people"
    >
      <li v-for="(account, index) in selected" :key="account.id">
        <button
          type="button"
          class="recipient-picker__chip"
          :aria-label="recipientRemoveLabel(account)"
          @click="removeRecipient(account.id, index)"
        >
          <img
            :src="account.avatar"
            alt=""
            class="recipient-picker__chip-avatar"
            loading="lazy"
            decoding="async"
          />
          <span class="recipient-picker__chip-name">{{ recipientLabel(account) }}</span>
          <span class="recipient-picker__chip-x" aria-hidden="true">×</span>
        </button>
      </li>
    </ul>
    <p v-if="atLimit" class="recipient-picker__cap">You can message up to 8 people.</p>

    <div class="recipient-picker__search">
      <label class="sr-only" for="recipient-search-input">Search people</label>
      <input
        id="recipient-search-input"
        ref="inputRef"
        v-model="query"
        type="search"
        class="neo-input recipient-picker__input"
        placeholder="Search name or @handle"
        enterkeyhint="search"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="recipient-picker-list"
        :aria-expanded="displayAccounts.length > 0"
        :aria-activedescendant="listIndex >= 0 ? `recipient-option-${listIndex}` : undefined"
        @keydown="onListKeydown"
      />
    </div>

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ liveStatus }}</p>

    <div ref="listRef" class="recipient-picker__list" data-keyboard-scroll>
      <!-- Status / empty / error copy sits outside the listbox (options only inside);
           the sr-only status above announces it -->
      <p v-if="followingError" class="recipient-picker__status">
        {{ followingError }}
        <button type="button" class="recipient-picker__retry" @click="retryFollowing">Retry</button>
      </p>

      <template v-else-if="hasQuery && isSearching && !displayAccounts.length">
        <p class="recipient-picker__status">Searching…</p>
      </template>

      <template v-else-if="hasQuery && !displayAccounts.length">
        <p class="recipient-picker__status">No one matched.</p>
      </template>

      <template v-else-if="!hasQuery">
        <p class="recipient-picker__section">People you follow</p>
        <p v-if="isLoadingFollowing" class="recipient-picker__status">Loading…</p>
        <p v-else-if="!following.length" class="recipient-picker__status">
          You’re not following anyone yet.
          <NuxtLink to="/explore?tab=people" class="recipient-picker__link" @click="emit('cancel')">
            Find people
          </NuxtLink>
          — then they’ll show up here.
        </p>
      </template>

      <div id="recipient-picker-list" role="listbox" aria-label="People">
        <button
          v-for="(account, index) in displayAccounts"
          :id="`recipient-option-${index}`"
          :key="account.id"
          type="button"
          tabindex="-1"
          class="recipient-picker__row"
          role="option"
          :aria-selected="listIndex === index"
          :data-active="listIndex === index ? 'true' : undefined"
          @click="pick(account)"
          @mouseenter="listIndex = index"
        >
          <img
            :src="account.avatar"
            alt=""
            class="recipient-picker__avatar"
            loading="lazy"
            decoding="async"
          />
          <span class="recipient-picker__meta">
            <span class="recipient-picker__name">{{ account.displayName || account.username }}</span>
            <span class="recipient-picker__acct">{{ accountHandle(account) }}</span>
          </span>
          <span
            v-if="selectedIds.has(account.id) || chatOpenIds.has(account.id) || accountBadges(account).length"
            class="recipient-picker__badges"
          >
            <span v-if="selectedIds.has(account.id)" class="recipient-picker__badge">Added</span>
            <span v-if="chatOpenIds.has(account.id)" class="recipient-picker__badge recipient-picker__badge--chat">
              Chat open
            </span>
            <span v-for="badge in accountBadges(account)" :key="badge" class="recipient-picker__badge">
              {{ badge }}
            </span>
          </span>
        </button>
      </div>

      <!-- Remote search still running, but local matches are already listed -->
      <p
        v-if="hasQuery && isSearching && displayAccounts.length"
        class="recipient-picker__status recipient-picker__status--inline"
      >
        Searching the fediverse…
      </p>
    </div>

    <footer class="recipient-picker__footer">
      <button
        type="button"
        class="recipient-picker__confirm neo-btn neo-btn--primary"
        :disabled="!selected.length || props.busy"
        :aria-busy="props.busy || undefined"
        @click="confirmRecipients"
      >
        {{ confirmLabel }}
      </button>
    </footer>
  </div>
</template>

<style lang="scss" scoped>
.recipient-picker {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--neo-bg-primary);
}

.recipient-picker__hint {
  margin: 0;
  padding: 0.65rem 1rem 0.25rem;
  font-size: 0.8125rem;
  color: var(--neo-text-tertiary);
  line-height: 1.4;
}

.recipient-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0.35rem 1rem 0.15rem;
  list-style: none;
  flex-shrink: 0;

  > li {
    display: flex;
    max-width: 100%;
    min-width: 0;
  }
}

.recipient-picker__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  min-height: 36px;
  padding: 0.15rem 0.55rem 0.15rem 0.15rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
  touch-action: manipulation;

  &:hover,
  &:focus-visible {
    border-color: color-mix(in srgb, var(--neo-accent) 45%, var(--neo-border-color));
    background: var(--neo-accent-soft);
  }
}

.recipient-picker__chip-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--neo-bg-primary);
}

.recipient-picker__chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recipient-picker__chip-x {
  flex-shrink: 0;
  color: var(--neo-text-tertiary);
  font-size: 1rem;
  line-height: 1;
}

.recipient-picker__cap {
  margin: 0;
  padding: 0.15rem 1rem 0;
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
  flex-shrink: 0;
}

.recipient-picker__search {
  padding: 0.5rem 1rem 0.75rem;
  flex-shrink: 0;
}

.recipient-picker__input {
  font-size: max(16px, 1rem);
}

.recipient-picker--keyboard {
  .recipient-picker__chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding: 0.2rem 0.75rem 0.1rem;
  }

  .recipient-picker__search {
    padding: 0.35rem 0.75rem 0.45rem;
  }

  .recipient-picker__section {
    padding-top: 0.2rem;
    padding-bottom: 0.3rem;
  }

  .recipient-picker__footer {
    padding: 0.4rem 0.75rem;
    padding-bottom: max(0.4rem, env(safe-area-inset-bottom, 0px));
  }
}

.recipient-picker__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 0.5rem;
}

.recipient-picker__footer {
  flex-shrink: 0;
  padding: 0.65rem 1rem;
  padding-bottom: max(0.65rem, env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
}

.recipient-picker__confirm {
  width: 100%;
  min-height: 40px;
  font-weight: 700;
  touch-action: manipulation;

  &:disabled {
    opacity: 0.4;
  }
}

.recipient-picker__section {
  margin: 0;
  padding: 0.35rem 1rem 0.5rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-tertiary);
}

.recipient-picker__status {
  margin: 0;
  padding: 1.25rem 1rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  text-align: center;
  line-height: 1.45;
}

.recipient-picker__status--inline {
  padding: 0.6rem 1rem 0.9rem;
  font-size: 0.8125rem;
}

.recipient-picker__badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.25rem;
  margin-left: auto;
  flex-shrink: 0;
}

.recipient-picker__badge {
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.3;
  color: var(--neo-text-tertiary);
  white-space: nowrap;

  &--chat {
    border-color: color-mix(in srgb, var(--neo-accent) 40%, transparent);
    background: var(--neo-accent-soft);
    color: var(--neo-accent);
  }
}

.recipient-picker__retry {
  margin-left: 0.35rem;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--neo-accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.recipient-picker__link {
  color: var(--neo-accent);
  font-weight: 600;
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
}

.recipient-picker__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.7rem 1rem;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  min-height: 56px;

  &[data-active='true'],
  &:hover,
  &:active {
    background: var(--neo-bg-tertiary);
  }
}

.recipient-picker__avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.recipient-picker__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.1rem;
}

.recipient-picker__name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recipient-picker__acct {
  font-size: 0.8125rem;
  color: var(--neo-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
