<script setup lang="ts">
/**
 * Threads-style “post to a group” picker — selects a hashtag community.
 */

import { useGroupsStore, type Group } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { createRaceGuard } from '~/composables/useRace'

const props = withDefaults(
  defineProps<{
    modelValue: string | null
    /** Threads-style: quiet text control in the author row */
    inline?: boolean
  }>(),
  { inline: false },
)

const emit = defineEmits<{
  'update:modelValue': [tag: string | null]
}>()

const groupsStore = useGroupsStore()
const instancesStore = useInstancesStore()

const open = ref(false)
const query = ref('')
const searchResults = ref<Group[]>([])
const isSearching = ref(false)
const sheetRef = ref<HTMLElement | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null
const searchRace = createRaceGuard()

useFocusTrap(sheetRef, open, {
  onEscape: () => {
    open.value = false
  },
  initialFocus: '.group-pick-sheet__input',
})

const selected = computed(() => {
  if (!props.modelValue) return null
  const existing = groupsStore.getGroup(props.modelValue)
  if (existing) return existing
  return {
    tag: props.modelValue,
    name: groupsStore.formatTagAsName(props.modelValue),
    icon: '🏷️',
    category: 'other' as const,
    isMember: false,
  }
})

const joined = computed(() => groupsStore.joinedGroups.slice(0, 24))
const suggested = computed(() => groupsStore.suggestedFeaturedGroups.slice(0, 12))

const filteredJoined = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return joined.value
  return joined.value.filter(
    (g) => g.name.toLowerCase().includes(q) || g.tag.toLowerCase().includes(q),
  )
})

const showSearchHits = computed(
  () => query.value.trim().length >= 2 && searchResults.value.length > 0,
)

const queryTag = computed(() => {
  const raw = query.value.trim().replace(/^#/, '').toLowerCase()
  if (!raw || raw.length < 2) return null
  if (!/^[a-z0-9_]+$/i.test(raw)) return null
  return raw
})

const showUseQuery = computed(() => {
  if (!queryTag.value) return false
  const tag = queryTag.value
  if (searchResults.value.some((g) => g.tag.toLowerCase() === tag)) return false
  if (filteredJoined.value.some((g) => g.tag.toLowerCase() === tag)) return false
  return true
})

watch(open, async (isOpen) => {
  if (isOpen && instancesStore.isAuthenticated) {
    await groupsStore.initializeGroups()
  }
  if (!isOpen) {
    query.value = ''
    searchResults.value = []
  }
})

watch(query, (q) => {
  if (searchTimer) clearTimeout(searchTimer)
  const trimmed = q.trim()
  if (trimmed.length < 2) {
    searchRace.abort()
    searchResults.value = []
    isSearching.value = false
    return
  }
  isSearching.value = true
  searchTimer = setTimeout(async () => {
    const ticket = searchRace.next()
    try {
      const hits = await groupsStore.searchGroups(trimmed)
      if (!ticket.isCurrent()) return
      searchResults.value = hits
    } catch {
      if (!ticket.isCurrent()) return
      searchResults.value = []
    } finally {
      if (ticket.isCurrent()) isSearching.value = false
    }
  }, 280)
})

const pick = (tag: string) => {
  emit('update:modelValue', tag.replace(/^#/, ''))
  open.value = false
}

const useQueryAsTag = () => {
  const raw = query.value.trim().replace(/^#/, '')
  if (!raw) return
  pick(raw)
}

const inlineTriggerRef = ref<HTMLButtonElement | null>(null)
const chipTriggerRef = ref<HTMLButtonElement | null>(null)

const clear = () => {
  emit('update:modelValue', null)
  nextTick(() => {
    inlineTriggerRef.value?.focus()
    chipTriggerRef.value?.focus()
  })
}

const toggle = () => {
  open.value = !open.value
}

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  searchRace.abort()
})
</script>

<template>
  <div class="group-pick" :class="{ 'group-pick--inline': inline }">
    <!-- Threads-style: › Community or topic -->
    <template v-if="inline">
      <span class="group-pick__chev" aria-hidden="true">›</span>
      <button
        v-if="selected"
        ref="inlineTriggerRef"
        type="button"
        class="group-pick__link group-pick__link--on"
        :aria-label="`Change group, currently ${selected.name}`"
        aria-current="true"
        @click="toggle"
      >
        <span class="group-pick__emoji" aria-hidden="true">{{ selected.icon }}</span>
        {{ selected.name }}
      </button>
      <button
        v-else
        type="button"
        class="group-pick__link"
        aria-label="Add community or topic"
        title="Community or topic"
        @click="toggle"
      >
        Community or topic
      </button>
      <button
        v-if="selected"
        type="button"
        class="group-pick__clear group-pick__clear--inline"
        aria-label="Remove group"
        title="Remove group"
        @click="clear"
      >
        <NeoIcon name="x" :size="12" :stroke="2.5" />
      </button>
    </template>
    <template v-else>
      <div v-if="selected" class="group-pick__selected">
        <button
          ref="chipTriggerRef"
          type="button"
          class="group-pick__chip group-pick__chip--active"
          :aria-label="`Change group, currently ${selected.name}`"
          aria-current="true"
          @click="toggle"
        >
          <span class="group-pick__emoji" aria-hidden="true">{{ selected.icon }}</span>
          <span class="group-pick__label">{{ selected.name }}</span>
        </button>
        <button
          type="button"
          class="group-pick__clear"
          aria-label="Remove group"
          title="Remove group"
          @click="clear"
        >
          <NeoIcon name="x" :size="12" :stroke="2.5" />
        </button>
      </div>
      <button
        v-else
        type="button"
        class="group-pick__chip"
        aria-label="Add to a group"
        title="Add to a group"
        @click="toggle"
      >
        <NeoIcon name="users" :size="15" :stroke="1.75" />
        <span class="group-pick__label">Add group</span>
      </button>
    </template>

    <Teleport to="body">
      <Transition name="group-pick-sheet">
        <div
          v-if="open"
          ref="sheetRef"
          class="group-pick-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="group-pick-title"
        >
          <button type="button" class="group-pick-sheet__backdrop" aria-label="Close" @click="open = false" />
          <div class="group-pick-sheet__panel">
            <header class="group-pick-sheet__header">
              <h2 id="group-pick-title" class="group-pick-sheet__title">Community or topic</h2>
              <button type="button" class="group-pick-sheet__close" aria-label="Close" @click="open = false">
                <NeoIcon name="x" :size="18" :stroke="2" />
              </button>
            </header>

            <div class="group-pick-sheet__search">
              <label class="sr-only" for="group-pick-search">Search groups</label>
              <NeoIcon name="search" :size="16" :stroke="1.75" />
              <input
                id="group-pick-search"
                v-model="query"
                type="search"
                class="group-pick-sheet__input"
                placeholder="Search groups or any hashtag…"
                enterkeyhint="search"
              />
            </div>

            <div class="group-pick-sheet__body">
              <p class="group-pick-sheet__hint">
                Pick a community — your post lands in that group feed.
              </p>

              <button
                v-if="showUseQuery"
                type="button"
                class="group-pick-sheet__row group-pick-sheet__row--use"
                @click="useQueryAsTag"
              >
                <span class="group-pick-sheet__row-icon">🏷️</span>
                <span class="group-pick-sheet__row-text">
                  <strong>Use #{{ queryTag }}</strong>
                  <em>Post into this hashtag group</em>
                </span>
              </button>

              <section v-if="showSearchHits" class="group-pick-sheet__section">
                <h3 class="group-pick-sheet__section-title">Results</h3>
                <button
                  v-for="g in searchResults"
                  :key="'s-' + g.tag"
                  type="button"
                  class="group-pick-sheet__row"
                  @click="pick(g.tag)"
                >
                  <span class="group-pick-sheet__row-icon">{{ g.icon }}</span>
                  <span class="group-pick-sheet__row-text">
                    <strong>{{ g.name }}</strong>
                    <em>#{{ g.tag }}</em>
                  </span>
                </button>
              </section>

              <section v-else-if="isSearching" class="group-pick-sheet__section">
                <p class="group-pick-sheet__empty">Searching…</p>
              </section>

              <template v-else>
                <section v-if="filteredJoined.length" class="group-pick-sheet__section">
                  <h3 class="group-pick-sheet__section-title">Your groups</h3>
                  <button
                    v-for="g in filteredJoined"
                    :key="'j-' + g.tag"
                    type="button"
                    class="group-pick-sheet__row"
                    :class="{ 'group-pick-sheet__row--on': modelValue === g.tag }"
                    :aria-current="modelValue === g.tag ? 'true' : undefined"
                    @click="pick(g.tag)"
                  >
                    <span class="group-pick-sheet__row-icon">{{ g.icon }}</span>
                    <span class="group-pick-sheet__row-text">
                      <strong>{{ g.name }}</strong>
                      <em>#{{ g.tag }}</em>
                    </span>
                    <NeoIcon v-if="modelValue === g.tag" name="check" :size="16" :stroke="2.5" />
                  </button>
                </section>

                <section v-if="suggested.length && !query.trim()" class="group-pick-sheet__section">
                  <h3 class="group-pick-sheet__section-title">Suggested</h3>
                  <button
                    v-for="g in suggested"
                    :key="'r-' + g.tag"
                    type="button"
                    class="group-pick-sheet__row"
                    @click="pick(g.tag)"
                  >
                    <span class="group-pick-sheet__row-icon">{{ g.icon }}</span>
                    <span class="group-pick-sheet__row-text">
                      <strong>{{ g.name }}</strong>
                      <em>#{{ g.tag }}</em>
                    </span>
                  </button>
                </section>

                <p
                  v-if="!filteredJoined.length && !suggested.length"
                  class="group-pick-sheet__empty"
                >
                  Search any hashtag to post into that group.
                </p>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
.group-pick {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.group-pick--inline {
  gap: 0.2rem;
  max-width: 100%;
}

.group-pick__chev {
  flex-shrink: 0;
  color: var(--neo-text-quaternary);
  font-size: 1.05rem;
  font-weight: 400;
  line-height: 1;
  margin: 0 0.05rem;
}

.group-pick__link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  min-height: 24px;
  max-width: 14rem;
  margin: 0;
  padding: 0.25rem 0;
  border: none;
  background: transparent;
  color: var(--neo-text-tertiary);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.2;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &:hover {
    color: var(--neo-text-secondary);
  }

  &--on {
    color: var(--neo-accent);

    &:hover {
      color: var(--neo-accent-hover, var(--neo-accent));
    }
  }
}

.group-pick__clear--inline {
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  color: var(--neo-text-tertiary);

  &:hover {
    color: var(--neo-text-primary);
    background: var(--neo-bg-hover);
  }
}

.group-pick__selected {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  max-width: 12.5rem;
  padding-right: 0.15rem;
  border: 1.5px solid color-mix(in srgb, var(--neo-accent) 55%, transparent);
  border-radius: 999px;
  background: var(--neo-accent-soft);
}

.group-pick__selected .group-pick__chip {
  border: none;
  background: transparent;
  max-width: none;
  min-height: 30px;
}

.group-pick__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 32px;
  max-width: 11rem;
  padding: 0.25rem 0.65rem;
  border: 1.5px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;

  &:hover {
    border-color: var(--neo-accent);
    color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &--active {
    border-color: color-mix(in srgb, var(--neo-accent) 55%, transparent);
    background: var(--neo-accent-soft);
    color: var(--neo-accent);
  }
}

.group-pick__emoji {
  font-size: 0.875rem;
  line-height: 1;
}

.group-pick__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-pick__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--neo-accent);
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    background: color-mix(in srgb, var(--neo-accent) 20%, transparent);
  }
}

.group-pick-sheet {
  position: fixed;
  inset: 0;
  z-index: 240;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;

  @media (min-width: 1024px) {
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
  }
}

.group-pick-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.group-pick-sheet__panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: min(78dvh, 560px);
  background: var(--neo-bg-primary);
  border-radius: 16px 16px 0 0;
  border: 1px solid var(--neo-border-color);
  border-bottom: none;
  box-shadow: var(--neo-shadow-xl);
  padding-bottom: env(safe-area-inset-bottom, 0);
  overflow: hidden;

  @media (min-width: 1024px) {
    max-width: 420px;
    border-radius: 12px;
    border-bottom: 1px solid var(--neo-border-color);
  }
}

.group-pick-sheet__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1rem 0.5rem;
}

.group-pick-sheet__title {
  margin: 0;
  font-size: 1.0625rem;
  font-weight: 700;
}

.group-pick-sheet__close {
  width: 40px;
  height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--neo-text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }
}

.group-pick-sheet__search {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 1rem 0.75rem;
  padding: 0.55rem 0.75rem;
  border: 1.5px solid var(--neo-border-color);
  border-radius: 10px;
  color: var(--neo-text-muted);
  background: var(--neo-bg-secondary);
}

.group-pick-sheet__input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--neo-text-primary);
  font-size: 0.9375rem;
  outline: none;

  &::placeholder {
    color: var(--neo-text-muted);
  }
}

.group-pick-sheet__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0.5rem 1rem;
  -webkit-overflow-scrolling: touch;
}

.group-pick-sheet__hint {
  margin: 0 0.5rem 0.85rem;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  line-height: 1.4;
}

.group-pick-sheet__section {
  margin-bottom: 0.75rem;
}

.group-pick-sheet__section-title {
  margin: 0 0.5rem 0.35rem;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.group-pick-sheet__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  min-height: 52px;
  padding: 0.55rem 0.65rem;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--neo-text-primary);
  text-align: left;
  cursor: pointer;

  &:hover,
  &--on {
    background: var(--neo-accent-soft);
  }
}

.group-pick-sheet__row-icon {
  width: 2rem;
  height: 2rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--neo-bg-tertiary);
  font-size: 1rem;
  flex-shrink: 0;
}

.group-pick-sheet__row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;

  strong {
    font-size: 0.9375rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    font-size: 0.75rem;
    font-style: normal;
    color: var(--neo-text-muted);
  }
}

.group-pick-sheet__empty {
  margin: 1.5rem 0.5rem;
  text-align: center;
  color: var(--neo-text-muted);
  font-size: 0.875rem;
}

.group-pick-sheet-enter-active,
.group-pick-sheet-leave-active {
  transition: opacity 0.18s ease;

  .group-pick-sheet__panel {
    transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
  }
}

.group-pick-sheet-enter-from,
.group-pick-sheet-leave-to {
  opacity: 0;

  .group-pick-sheet__panel {
    transform: translateY(18px);

    @media (min-width: 1024px) {
      transform: translateY(8px) scale(0.98);
    }
  }
}
</style>
