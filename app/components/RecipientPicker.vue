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
const { results, following, isSearching, isLoadingFollowing, loadFollowing, search, clear } =
  useAccountSearch()

const showResults = computed(() => query.value.trim().length > 0)

onMounted(() => {
  void loadFollowing()
})

watch(query, (q) => search(q))

const pick = (account: mastodon.v1.Account) => {
  emit('select', account)
  clear()
  query.value = ''
}

onUnmounted(() => clear())
</script>

<template>
  <div class="recipient-picker" aria-labelledby="recipient-picker-title">
    <header class="recipient-picker__header">
      <button type="button" class="neo-btn neo-btn--tertiary recipient-picker__cancel" @click="emit('cancel')">
        Cancel
      </button>
      <h2 id="recipient-picker-title" class="recipient-picker__title">Message someone</h2>
      <span class="recipient-picker__spacer" />
    </header>

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
      />
    </div>

    <div class="recipient-picker__list">
      <template v-if="showResults">
        <p v-if="isSearching" class="recipient-picker__status">Searching…</p>
        <p v-else-if="!results.length" class="recipient-picker__status">No one matched.</p>
        <button
          v-for="account in results"
          :key="account.id"
          type="button"
          class="recipient-picker__row"
          @click="pick(account)"
        >
          <img :src="account.avatar" alt="" class="recipient-picker__avatar" />
          <span class="recipient-picker__meta">
            <span class="recipient-picker__name">{{ account.displayName || account.username }}</span>
            <span class="recipient-picker__acct">{{ accountHandle(account) }}</span>
          </span>
        </button>
      </template>

      <template v-else>
        <p class="recipient-picker__section">People you follow</p>
        <p v-if="isLoadingFollowing" class="recipient-picker__status">Loading…</p>
        <p v-else-if="!following.length" class="recipient-picker__status">
          You’re not following anyone yet.
          <NuxtLink to="/explore?tab=people" class="recipient-picker__link" @click="emit('cancel')">
            Find people
          </NuxtLink>
          — then they’ll show up here.
        </p>
        <button
          v-for="account in following"
          :key="account.id"
          type="button"
          class="recipient-picker__row"
          @click="pick(account)"
        >
          <img :src="account.avatar" alt="" class="recipient-picker__avatar" />
          <span class="recipient-picker__meta">
            <span class="recipient-picker__name">{{ account.displayName || account.username }}</span>
            <span class="recipient-picker__acct">{{ accountHandle(account) }}</span>
          </span>
        </button>
      </template>
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

.recipient-picker__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.recipient-picker__cancel {
  min-width: auto;
  min-height: 40px;
  padding: 0.35rem 0.65rem;
  font-weight: 600;
}

.recipient-picker__title {
  flex: 1;
  margin: 0;
  text-align: center;
  font-size: 0.9375rem;
  font-weight: 700;
}

.recipient-picker__spacer {
  width: 4.5rem;
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
