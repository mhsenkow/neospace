<script setup lang="ts">
/**
 * Shared feed picker items — built from FEED_CATALOG sections so board menus stay in sync.
 */

import { FEED_LABELS, type ColumnFeedType } from '~/stores/columns'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useInstancesStore } from '~/stores/instances'
import { recipeTip } from '~/utils/algorithms'

export type FeedMenuVariant = 'add' | 'switch'

export type FeedMenuGroup = { tag: string; name: string; icon: string }

const props = withDefaults(
  defineProps<{
    variant: FeedMenuVariant
    timelinesExpanded: boolean
    localHostLabel: string
    /** Switch-feed column state */
    activeFeedType?: ColumnFeedType
    activeAlgorithmId?: string | null
    activeGroupTag?: string | null
    canShowHome?: boolean
    groupsExpanded?: boolean
    joinedGroups?: FeedMenuGroup[]
    /** Add-column menus on mobile / desktop panel include Search, Profile, etc. */
    showPanelFeeds?: boolean
    /** Desk-tab add menu uses plain labels without icons on every row */
    compactAdd?: boolean
  }>(),
  {
    activeAlgorithmId: null,
    activeGroupTag: null,
    canShowHome: false,
    groupsExpanded: false,
    joinedGroups: () => [],
    showPanelFeeds: false,
    compactAdd: false,
  },
)

const emit = defineEmits<{
  pick: [type: ColumnFeedType, param?: string]
  'toggle-timelines': []
  'toggle-groups': []
  'create-algorithm': []
  'edit-algorithm': [id: string]
}>()

const algorithmsStore = useAlgorithmsStore()
const instancesStore = useInstancesStore()

const isSwitch = computed(() => props.variant === 'switch')
const menuRole = computed(() => (isSwitch.value ? 'menuitemradio' : 'menuitem'))
const itemClass = computed(() =>
  isSwitch.value ? 'feed-dropdown__item' : 'add-column-menu__item',
)
const sectionToggleClass = computed(() =>
  isSwitch.value ? 'feed-dropdown__section-toggle' : 'add-column-menu__section-toggle',
)
const dividerClass = computed(() =>
  isSwitch.value ? 'feed-dropdown__divider' : 'add-column-menu__divider',
)
const subheadClass = computed(() =>
  isSwitch.value ? 'feed-dropdown__subhead' : 'add-column-menu__title',
)

const homeLabel = FEED_LABELS.home
const localLabel = computed(() =>
  isSwitch.value ? FEED_LABELS.local : `Local (${props.localHostLabel})`,
)

const isActive = (type: ColumnFeedType, param?: string) => {
  if (!isSwitch.value || props.activeFeedType !== type) return false
  if (type === 'algorithm') return props.activeAlgorithmId === param
  if (type === 'group') return props.activeGroupTag === param
  return true
}

const onPick = (type: ColumnFeedType, param?: string) => emit('pick', type, param)
</script>

<template>
  <button
    v-if="instancesStore.hasAuthenticatedInstance"
    type="button"
    :role="menuRole"
    :aria-checked="isSwitch ? isActive('home') : undefined"
    :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('home') }]"
    :disabled="isSwitch && !canShowHome"
    @click="onPick('home')"
  >
    <svg
      v-if="!compactAdd"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      aria-hidden="true"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </svg>
    {{ homeLabel }}
  </button>
  <div
    v-if="instancesStore.hasAuthenticatedInstance"
    :class="dividerClass"
    role="separator"
  />

  <button
    type="button"
    role="menuitem"
    :aria-expanded="timelinesExpanded"
    :class="sectionToggleClass"
    @click.stop="emit('toggle-timelines')"
  >
    <span>Timelines</span>
    <svg
      :class="{ rotated: timelinesExpanded }"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  <template v-if="timelinesExpanded">
    <button
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('local') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('local') }]"
      @click="onPick('local')"
    >
      <svg
        v-if="!compactAdd"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
      {{ localLabel }}
    </button>
    <button
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('federated') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('federated') }]"
      @click="onPick('federated')"
    >
      <svg
        v-if="!compactAdd"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
      {{ FEED_LABELS.federated }}
    </button>
    <button
      v-if="instancesStore.hasAuthenticatedInstance"
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('favourites') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('favourites') }]"
      @click="onPick('favourites')"
    >
      <NeoIcon v-if="!compactAdd" name="heart" :size="16" :stroke="1.5" />
      {{ FEED_LABELS.favourites }}
    </button>
    <button
      v-if="instancesStore.hasAuthenticatedInstance"
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('bookmarks') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('bookmarks') }]"
      @click="onPick('bookmarks')"
    >
      <NeoIcon v-if="!compactAdd" name="bookmark" :size="16" :stroke="1.5" />
      {{ FEED_LABELS.bookmarks }}
    </button>

    <span v-if="algorithmsStore.allRecipes.length" :class="subheadClass">Algorithms</span>
    <button
      v-for="recipe in algorithmsStore.allRecipes"
      :key="recipe.id"
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('algorithm', recipe.id) : undefined"
      :class="[
        itemClass,
        {
          'feed-dropdown__item--active': isSwitch && isActive('algorithm', recipe.id),
          'feed-dropdown__item--algo': isSwitch && !!recipeTip(recipe),
        },
      ]"
      :title="isSwitch && recipeTip(recipe) ? recipeTip(recipe) || recipe.name : undefined"
      @click="onPick('algorithm', recipe.id)"
    >
      <NeoIcon v-if="!compactAdd" name="filter" :size="16" :stroke="1.5" />
      <span v-if="isSwitch && recipeTip(recipe)" class="feed-dropdown__algo">
        <span class="feed-dropdown__algo-name">{{ recipe.name }}</span>
        <span class="feed-dropdown__algo-tip">{{ recipeTip(recipe) }}</span>
      </span>
      <template v-else>{{ recipe.name }}</template>
    </button>
    <button
      type="button"
      role="menuitem"
      :class="itemClass"
      @click="emit('create-algorithm')"
    >
      <NeoIcon v-if="!compactAdd" name="plus" :size="16" :stroke="1.5" />
      Create algorithm…
    </button>
    <button
      v-if="isSwitch && activeFeedType === 'algorithm' && activeAlgorithmId"
      type="button"
      role="menuitem"
      :class="itemClass"
      @click="emit('edit-algorithm', activeAlgorithmId!)"
    >
      <NeoIcon name="edit" :size="16" :stroke="1.5" />
      Edit / share…
    </button>
  </template>

  <template v-if="isSwitch && joinedGroups.length > 0">
    <div :class="dividerClass" role="separator" />
    <button
      type="button"
      role="menuitem"
      :aria-expanded="groupsExpanded"
      :class="sectionToggleClass"
      @click.stop="emit('toggle-groups')"
    >
      <span>Groups</span>
      <svg
        :class="{ rotated: groupsExpanded }"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <template v-if="groupsExpanded">
      <button
        v-for="group in joinedGroups"
        :key="group.tag"
        type="button"
        role="menuitemradio"
        :aria-checked="isActive('group', group.tag)"
        class="feed-dropdown__item feed-dropdown__item--group"
        :class="{ 'feed-dropdown__item--active': isActive('group', group.tag) }"
        @click="onPick('group', group.tag)"
      >
        <span class="feed-dropdown__group-icon">{{ group.icon }}</span>
        {{ group.name }}
      </button>
    </template>
  </template>

  <template v-if="showPanelFeeds">
    <div :class="dividerClass" role="separator" />
    <button
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('search') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('search') }]"
      @click="onPick('search')"
    >
      <svg
        v-if="!compactAdd"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      {{ FEED_LABELS.search }}
    </button>
    <button
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('profile') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('profile') }]"
      @click="onPick('profile')"
    >
      <svg
        v-if="!compactAdd"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
      {{ FEED_LABELS.profile }}
    </button>
    <button
      v-if="instancesStore.hasAuthenticatedInstance"
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('notifications') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('notifications') }]"
      @click="onPick('notifications')"
    >
      <svg
        v-if="!compactAdd"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
      {{ FEED_LABELS.notifications }}
    </button>
    <button
      v-if="instancesStore.hasAuthenticatedInstance"
      type="button"
      :role="menuRole"
      :aria-checked="isSwitch ? isActive('messages') : undefined"
      :class="[itemClass, { 'feed-dropdown__item--active': isSwitch && isActive('messages') }]"
      @click="onPick('messages')"
    >
      <svg
        v-if="!compactAdd"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
      {{ FEED_LABELS.messages }}
    </button>
  </template>
</template>
