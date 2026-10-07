<script setup lang="ts">
/**
 * Pick someone to message — following + search (Mastodon's "friends" substitute).
 */

import type { mastodon } from 'masto'
import { accountHandle, useAccountSearch } from '~/composables/useAccountSearch'

const emit = defineEmits<{
  select: [account: mastodon.v1.Account]
  cancel: []
}>()

const query = ref('')
const listIndex = ref(-1)
const listRef = ref<HTMLElement | null>(null)
const statusAnnounce = ref('')

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

const displayAccounts = computed(() => {
  if (!hasQuery.value) return following.value
  const seen = new Set<string>()
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

onMounted(() => {
  void loadFollowing()
})

const pick = (account: mastodon.v1.Account) => {
  emit('select', account)
  clear()
  query.value = ''
  listIndex.value = -1
}

const retryFollowing = () => {
  void loadFollowing(true)
}

const onListKeydown = (e: KeyboardEvent) => {
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

onUnmounted(() => clear())
</script>

<template>
  <div
    class="recipient-picker"
    role="dialog"
    aria-modal="true"
    aria-labelledby="recipient-picker-title"
  >
    <NeoSheetHeader title="Message someone" title-id="recipient-picker-title" @cancel="emit('cancel')" />

    <p class="recipient-picker__hint">
      No separate friends list — pick someone you follow, or search the fediverse.
    </p>

    <div class="recipient-picker__search">
      <label class="sr-only" for="recipient-search-input">Search people</label>
      <input
        id="recipient-search-input"
        v-model="query"
        type="search"
        class="neo-input recipient-picker__input"
        placeholder="Search name or @handle"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="recipient-picker-list"
        :aria-expanded="displayAccounts.length > 0"
        @keydown="onListKeydown"
      />
    </div>

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ statusAnnounce }}</p>

    <div
      id="recipient-picker-list"
      ref="listRef"
      class="recipient-picker__list"
      role="listbox"
      aria-label="People"
    >
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

      <button
        v-for="(account, index) in displayAccounts"
        :key="account.id"
        type="button"
        class="recipient-picker__row"
        role="option"
        :aria-selected="listIndex === index"
        :data-active="listIndex === index ? 'true' : undefined"
        @click="pick(account)"
        @mouseenter="listIndex = index"
      >
        <img :src="account.avatar" alt="" class="recipient-picker__avatar" />
        <span class="recipient-picker__meta">
          <span class="recipient-picker__name">{{ account.displayName || account.username }}</span>
          <span class="recipient-picker__acct">{{ accountHandle(account) }}</span>
        </span>
      </button>
    </div>
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

.recipient-picker__search {
  padding: 0.5rem 1rem 0.75rem;
  flex-shrink: 0;
}

.recipient-picker__input {
  font-size: 1rem;
}

.recipient-picker__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.recipient-picker__section {
  margin: 0;
  padding: 0.35rem 1rem 0.5rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-quaternary);
}

.recipient-picker__status {
  margin: 0;
  padding: 1.25rem 1rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  text-align: center;
  line-height: 1.45;
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
