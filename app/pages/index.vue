<script setup lang="ts">
/**
 * Home Page - Multi-column TweetDeck-style layout
 *
 * Supports 1-8 independent timeline columns, each with its own
 * feed type, scroll position, and data. Column config is persisted.
 * Desktop: equal-flex columns with a min width + horizontal scroll.
 * Mobile: full-width scroll-snap carousel (swipe left/right).
 */

import { useInstancesStore } from '~/stores/instances'
import {
  useColumnsStore,
  MAX_COLUMNS,
  isTimelineFeed,
  type ColumnFeedType,
} from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'
import { useAlgorithmsStore } from '~/stores/algorithms'
import { useSettingsStore } from '~/stores/settings'
import { useConversationsStore } from '~/stores/conversations'
import { useNotificationsStore } from '~/stores/notifications'
import { BOARD_EDGE_LEFT } from '~/composables/useBoardPortals'
import { richDisplayName } from '~/utils/displayName'
import { formatCount, formatCountLabel } from '~/utils/searchQuery'

const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()
const settingsStore = useSettingsStore()
const conversationsStore = useConversationsStore()
const notificationsStore = useNotificationsStore()
const algorithmsStore = useAlgorithmsStore()
const { boardPortal } = useBoardPortal()
const router = useRouter()
const { openGroup } = useBoardNav()

const EDGE_LEFT = BOARD_EDGE_LEFT

/** Phone carousel only (≤767) — owned here so portals + shell + columns share one flag */
const isMobileUi = ref(false)

// Orchestration lives in composables — this page is layout + template wiring
const {
  portalSearch,
  portalThemeLabel,
  portalUiLabel,
  portalUser,
  portalGroupChips,
  portalInboxRows,
  portalActivityRows,
  openPortalActivityRow,
  openPortal,
  openInboxRow,
  syncBoardPortalFromSlide,
  isPortalActionLocked,
} = useBoardPortals({ isMobileUi })

const {
  columnsContainer,
  feedTabsScroller,
  activeColumnIndex,
  carouselSlideIndex,
  isPhoneLandscapeUi,
  slideCount,
  isDeskTabs,
  motionBehavior,
  scrollActiveFeedToTop,
  getColumnEls,
  scrollToColumn,
  slideInert,
  isColumnHidden,
  onColumnFocus,
  onColumnsScroll,
  onBoardKeydown,
  reparkCarouselAfterResize,
  goPrevFeed,
  goNextFeed,
} = useBoardShell({
  isMobileUi,
  portals: { syncBoardPortalFromSlide, isPortalActionLocked },
})

const {
  addMenuOpen,
  boardFullLabel,
  addAlgorithmsExpanded,
  addGroupsExpanded,
  addGroupQuery,
  draggingColumnId,
  dropTargetColumnId,
  localHostLabel,
  feedTabs,
  activeFeedChromeTitle,
  activeFeedTabId,
  columnMoveAnnounce,
  onColumnDragStart,
  onColumnDragEnd,
  onColumnDragOver,
  onColumnDrop,
  moveColumnLeft,
  moveColumnRight,
  removeColumnAt,
  mastodonLists,
  addColumn,
  promptAddRss,
  onDeskPackChange,
  addableGroups,
  addGroupCustomTag,
  addGroupAsColumn,
  activeViewMode,
  activeColumnIsTimeline,
  setActiveViewMode,
} = useBoardColumns({
  isMobileUi,
  shell: { activeColumnIndex, columnsContainer, getColumnEls, scrollToColumn, isDeskTabs, scrollActiveFeedToTop },
})

definePageMeta({ keepalive: true })

useHead({ title: 'Home | LoomSpace' })
</script>

<template>
  <div
    class="columns-page"
    :class="{
      'columns-page--multi': columnsStore.isMultiColumn && !columnsStore.focusedColumnId,
      'columns-page--packed': columnsStore.deskDensity === 'packed',
      'columns-page--roomy': columnsStore.deskDensity === 'roomy',
      'columns-page--tabs': isDeskTabs,
      'columns-page--focus': !!columnsStore.focusedColumnId && !isMobileUi,
    }"
  >
    <h1 class="sr-only">Home</h1>
    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ columnMoveAnnounce }}</p>

    <!-- Desktop focused-tab mode: one wide feed + tab strip -->
    <nav
      v-if="isDeskTabs"
      class="desk-feed-tabs"
      aria-label="Feeds"
    >
      <label v-if="columnsStore.packs.length > 1" class="desk-pack-switch">
        <span class="sr-only">Active pack</span>
        <select
          class="desk-pack-switch__select"
          :value="columnsStore.activePackId || ''"
          @change="onDeskPackChange"
        >
          <option
            v-for="pack in columnsStore.packs"
            :key="pack.id"
            :value="pack.id"
          >
            {{ pack.name }}
          </option>
        </select>
      </label>
      <NeoTabs
        class="desk-feed-tabs__neo"
        :tabs="feedTabs"
        controls-id="feed-columns"
        aria-label="Feeds"
        :model-value="activeFeedTabId"
        :panels="false"
        @update:model-value="(id) => (activeFeedTabId = id)"
      />
      <div v-if="!columnsStore.canAddColumn" class="desk-feed-tabs__add" @click.stop>
        <button type="button" class="add-column-full" aria-disabled="true" :aria-label="boardFullLabel" :title="boardFullLabel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
        </button>
      </div>
      <div v-if="columnsStore.canAddColumn" class="desk-feed-tabs__add" @click.stop>
        <NeoMenu
          v-model:open="addMenuOpen"
          class="add-column-neo add-column-neo--desk-tabs"
          align="end"
          :label="`Add feed (${columnsStore.columnCount}/${MAX_COLUMNS})`"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <template #items>
            <span class="add-column-menu__title">Add feed</span>
            <FeedMenuItems
              variant="add"
              :timelines-expanded="addAlgorithmsExpanded"
              :local-host-label="localHostLabel"
              compact-add
              @toggle-timelines="addAlgorithmsExpanded = !addAlgorithmsExpanded"
              @pick="addColumn"
              @add-rss="promptAddRss"
              @create-algorithm="algorithmsStore.openEditor(); addMenuOpen = false"
            />
          </template>
        </NeoMenu>
      </div>
    </nav>

    <!-- Mobile: feed controls up top — Flip / jump / add — so the bottom strip stays thumb-tabs only -->
    <nav
      class="mobile-feed-chrome"
      :class="{ 'mobile-feed-chrome--landscape': isPhoneLandscapeUi }"
      aria-label="Feed controls"
    >
      <!-- Same Feed|Flick control as portrait header — landscape used to only have a glyph -->
      <div
        class="mobile-feed-chrome__mode-switch"
        role="group"
        aria-label="How to move through this feed"
      >
        <button
          type="button"
          class="mobile-feed-chrome__mode-opt"
          :class="{ 'is-on': activeViewMode !== 'flip' }"
          :aria-pressed="activeViewMode !== 'flip'"
          title="Feed — scroll a list"
          :disabled="!!boardPortal || !activeColumnIsTimeline"
          @click="setActiveViewMode('flow')"
        >
          Feed
        </button>
        <button
          type="button"
          class="mobile-feed-chrome__mode-opt"
          :class="{ 'is-on': activeViewMode === 'flip' }"
          :aria-pressed="activeViewMode === 'flip'"
          title="Flick — one post at a time"
          :disabled="!!boardPortal || !activeColumnIsTimeline"
          @click="setActiveViewMode('flip')"
        >
          Flick
        </button>
      </div>

      <button
        v-if="!isPhoneLandscapeUi"
        type="button"
        class="mobile-feed-chrome__title"
        :title="`${activeFeedChromeTitle}. Tap to scroll to top`"
        :aria-label="`${activeFeedChromeTitle}. Scroll to top`"
        @click="scrollActiveFeedToTop"
      >
        {{ activeFeedChromeTitle }}
      </button>

      <!-- Phone landscape: feed pills live in the slim top bar (no bottom dock) -->
      <div
        v-if="isPhoneLandscapeUi && isMobileUi"
        ref="feedTabsScroller"
        class="mobile-feed-chrome__pills"
      >
        <NeoTabs
          class="mobile-feed-tabs__neo"
          :tabs="feedTabs"
          controls-id="feed-columns"
          aria-label="Feeds"
          :model-value="activeFeedTabId"
          :panels="false"
          @update:model-value="(id) => (activeFeedTabId = id)"
        />
      </div>

      <div class="mobile-feed-chrome__actions">
        <!-- Portrait phones: bottom pills + horizontal swipe already switch feeds.
             Landscape keeps jump buttons because the bottom dock is gone. -->
        <button
          v-if="isPhoneLandscapeUi && (columnsStore.columnCount >= 2 || isMobileUi)"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-chrome__jump"
          aria-label="Previous feed"
          :disabled="isMobileUi ? carouselSlideIndex <= 0 : activeColumnIndex <= 0"
          @click="goPrevFeed"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          v-if="isPhoneLandscapeUi && (columnsStore.columnCount >= 2 || isMobileUi)"
          type="button"
          class="neo-btn neo-btn--tertiary neo-btn--icon mobile-feed-chrome__jump"
          aria-label="Next feed"
          :disabled="isMobileUi ? carouselSlideIndex >= slideCount - 1 : activeColumnIndex >= columnsStore.columns.length - 1"
          @click="goNextFeed"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        <!-- One Add Feed menu per layout: they share addMenuOpen, and a hidden desktop
             popup's outside-tap close would shut this sheet on pointerdown -->
        <div v-if="!columnsStore.canAddColumn && isMobileUi" class="mobile-feed-chrome__add" @click.stop>
          <button type="button" class="add-column-full" aria-disabled="true" :aria-label="boardFullLabel" :title="boardFullLabel">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
        <div v-if="columnsStore.canAddColumn && isMobileUi" class="mobile-feed-chrome__add" @click.stop>
          <NeoMenu
            v-model:open="addMenuOpen"
            class="add-column-neo add-column-neo--mobile"
            align="end"
            sheet
            panel-class="add-column-menu-panel add-column-menu-panel--sheet"
            :label="`Add feed (${columnsStore.columnCount}/${MAX_COLUMNS})`"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <template #items>
              <span class="add-column-menu__title">Add feed</span>
              <FeedMenuItems
                variant="add"
                :timelines-expanded="addAlgorithmsExpanded"
                :local-host-label="localHostLabel"
                show-panel-feeds
                @toggle-timelines="addAlgorithmsExpanded = !addAlgorithmsExpanded"
                @pick="addColumn"
                @add-rss="promptAddRss"
                @create-algorithm="algorithmsStore.openEditor(); addMenuOpen = false"
              />
              <div class="add-column-menu__divider" role="separator" />
              <button type="button" role="menuitem" :aria-expanded="addGroupsExpanded" class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
                <span>Groups</span>
                <svg :class="{ rotated: addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <template v-if="addGroupsExpanded">
                <div class="add-column-menu__filter" @click.stop>
                  <input
                    v-model="addGroupQuery"
                    type="search"
                    class="add-column-menu__filter-input"
                    placeholder="Find News, Dogs…"
                    aria-label="Filter groups"
                    @keydown.enter.prevent="addGroupCustomTag ? addGroupAsColumn(addGroupCustomTag) : addableGroups[0] && addGroupAsColumn(addableGroups[0].tag)"
                  >
                </div>
                <div class="add-column-menu__groups">
                  <button
                    v-for="group in addableGroups"
                    :key="group.tag"
                    type="button"
                    role="menuitem"
                    class="add-column-menu__item add-column-menu__item--group"
                    @click="addGroupAsColumn(group.tag)"
                  >
                    <span class="add-column-menu__group-icon" aria-hidden="true">{{ group.icon }}</span>
                    {{ group.name }}
                  </button>
                  <button
                    v-if="addGroupCustomTag"
                    type="button"
                    role="menuitem"
                    class="add-column-menu__item add-column-menu__item--group"
                    @click="addGroupAsColumn(addGroupCustomTag)"
                  >
                    <span class="add-column-menu__group-icon" aria-hidden="true">🏷️</span>
                    Add #{{ addGroupCustomTag }}
                  </button>
                  <p v-else-if="addGroupQuery.trim() && !addableGroups.length" class="add-column-menu__empty">
                    No matching groups
                  </p>
                </div>
              </template>
              <span class="add-column-menu__hint">
                {{ columnsStore.columnCount }}/{{ MAX_COLUMNS }} feeds on this device
              </span>
            </template>
          </NeoMenu>
        </div>
      </div>
    </nav>

    <div
      ref="columnsContainer"
      id="feed-columns"
      class="columns-container"
      @scroll.passive="onColumnsScroll"
      @keydown="onBoardKeydown"
    >
      <!-- Mobile edge: keep swiping left → Profile, then Settings -->
      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--settings"
        :inert="slideInert(0)"
        aria-label="Settings"
      >
                <h2 class="feed-portal__title">Settings</h2>
        <p class="feed-portal__body">Appearance, posting defaults, and accounts.</p>

        <div class="feed-portal__panel">
          <button
            type="button"
            class="feed-portal__row"
            @click="settingsStore.cycleTheme()"
          >
            <span class="feed-portal__swatch" aria-hidden="true" />
            <span class="feed-portal__row-text">
              <strong>Theme</strong>
              <span>{{ portalThemeLabel }}</span>
            </span>
            <span class="feed-portal__row-action">Tap to cycle</span>
          </button>
          <button
            type="button"
            class="feed-portal__row"
            @click="settingsStore.cycleUi()"
          >
            <NeoIcon name="settings" :size="18" :stroke="1.75" />
            <span class="feed-portal__row-text">
              <strong>Chrome</strong>
              <span>{{ portalUiLabel }}</span>
            </span>
            <span class="feed-portal__row-action">Tap to cycle</span>
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('settings')">
          Open settings
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--profile"
        :inert="slideInert(1)"
        aria-label="Profile"
      >
                <h2 class="feed-portal__title">Profile</h2>

        <div v-if="portalUser" class="feed-portal__identity">
          <img
            :src="portalUser.avatar"
            alt=""
            class="feed-portal__avatar"
          />
          <div class="feed-portal__who">
            <strong v-html="richDisplayName(portalUser)" />
            <span>@{{ portalUser.acct }}</span>
          </div>
          <p class="feed-portal__stats">
            <span>{{ formatCountLabel(portalUser.statusesCount, 'post') }}</span>
            <span>{{ formatCount(portalUser.followingCount) }} following</span>
            <span>{{ formatCountLabel(portalUser.followersCount, 'follower') }}</span>
          </p>
        </div>
        <p v-else class="feed-portal__body">
          Sign in to post, follow people, and keep your layout.
        </p>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('profile')">
          {{ portalUser ? 'Open profile' : 'Sign in' }}
        </button>
      </aside>

      <template v-for="(column, idx) in columnsStore.columns" :key="column.id">
        <TimelineColumn
          v-if="isTimelineFeed(column.feedType)"
          :class="{ 'board-col--hidden': isColumnHidden(column.id) }"
          :inert="slideInert(idx + EDGE_LEFT)"
          :paused="isColumnHidden(column.id)"
          :column="column"
          :is-first="idx === 0"
          :is-last="idx === columnsStore.columns.length - 1"
          :can-remove="columnsStore.canRemoveColumn"
          :can-reorder="columnsStore.isMultiColumn"
          :recessed="columnsStore.isMultiColumn && activeColumnIndex !== idx"
          :dragging="draggingColumnId === column.id"
          :drop-target="dropTargetColumnId === column.id"
          :focused="columnsStore.focusedColumnId === column.id"
          @remove="removeColumnAt(column.id)"
          @focus="onColumnFocus(column.id)"
          @update-feed-type="(type: ColumnFeedType, feedParam?: string) => {
            const listTitle =
              type === 'list' && feedParam
                ? mastodonLists.find((l) => l.id === feedParam)?.title
                : undefined
            columnsStore.updateColumnFeedType(column.id, type, feedParam, { listTitle })
          }"
          @column-drag-start="onColumnDragStart"
          @column-drag-end="onColumnDragEnd"
          @column-drag-over="onColumnDragOver"
          @column-drop="(fromId) => onColumnDrop(fromId, column.id)"
          @move-left="moveColumnLeft(idx)"
          @move-right="moveColumnRight(idx)"
        />
        <PanelColumn
          v-else
          :class="{ 'board-col--hidden': isColumnHidden(column.id) }"
          :inert="slideInert(idx + EDGE_LEFT)"
          :column="column"
          :is-first="idx === 0"
          :is-last="idx === columnsStore.columns.length - 1"
          :can-remove="columnsStore.canRemoveColumn"
          :can-reorder="columnsStore.isMultiColumn"
          :recessed="columnsStore.isMultiColumn && activeColumnIndex !== idx"
          :dragging="draggingColumnId === column.id"
          :drop-target="dropTargetColumnId === column.id"
          :focused="columnsStore.focusedColumnId === column.id"
          @remove="removeColumnAt(column.id)"
          @focus="onColumnFocus(column.id)"
          @column-drag-start="onColumnDragStart"
          @column-drag-end="onColumnDragEnd"
          @column-drag-over="onColumnDragOver"
          @column-drop="(fromId) => onColumnDrop(fromId, column.id)"
          @move-left="moveColumnLeft(idx)"
          @move-right="moveColumnRight(idx)"
        />
      </template>

      <!-- Mobile edge: past last feed → Search → Inbox → Activity → Groups -->
      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--search"
        :inert="slideInert(EDGE_LEFT + columnsStore.columns.length)"
        aria-label="Search"
      >
                <h2 class="feed-portal__title">Search</h2>
        <p class="feed-portal__body">People, posts, tags, and servers.</p>

        <label class="feed-portal__search">
          <span class="sr-only">Search the fediverse</span>
          <NeoIcon name="search" :size="18" :stroke="1.75" />
          <input
            v-model="portalSearch"
            type="search"
            class="feed-portal__search-input"
            placeholder="Search…"
            autocomplete="off"
            enterkeyhint="search"
            @focus="($event.target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: motionBehavior('smooth') })"
            @blur="reparkCarouselAfterResize"
            @keydown.enter.prevent="openPortal('search')"
          />
        </label>

        <div class="feed-portal__chips">
          <button type="button" class="feed-portal__chip" @click="openPortal('search', { q: '#fediverse' })">
            #fediverse
          </button>
          <button
            type="button"
            class="feed-portal__chip"
            @click="router.push({ path: '/explore', query: { tab: 'people' } })"
          >
            People
          </button>
          <button
            type="button"
            class="feed-portal__chip"
            @click="router.push({ path: '/explore', query: { tab: 'servers' } })"
          >
            Servers
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('search')">
          Open search
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--inbox"
        :inert="slideInert(EDGE_LEFT + columnsStore.columns.length + 1)"
        aria-label="Messages"
      >
                <h2 class="feed-portal__title">
          Messages
          <span v-if="conversationsStore.badgeLabel" class="feed-portal__badge">
            {{ conversationsStore.badgeLabel }}
          </span>
        </h2>
        <p class="feed-portal__body">
          {{
            instancesStore.hasAuthenticatedInstance
              ? 'Direct messages and group chats.'
              : 'Sign in to read and send messages.'
          }}
        </p>

        <div v-if="portalInboxRows.length" class="feed-portal__list">
          <button
            v-for="row in portalInboxRows"
            :key="row.id"
            type="button"
            class="feed-portal__list-row"
            :class="{ 'feed-portal__list-row--unread': row.unread }"
            @click="openInboxRow(row.statusId, { id: row.id, unread: row.unread })"
          >
            <img v-if="row.avatar" :src="row.avatar" alt="" class="feed-portal__list-avatar" loading="lazy" decoding="async" />
            <span v-else class="feed-portal__list-avatar feed-portal__list-avatar--empty" />
            <span class="feed-portal__row-text">
              <strong>{{ row.label }}</strong>
              <span>{{ row.preview }}</span>
            </span>
            <!-- Unread isn't color-only: visible dot + text for screen readers -->
            <span v-if="row.unread" class="feed-portal__unread-dot">
              <span class="sr-only">Unread</span>
            </span>
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('inbox')">
          {{ instancesStore.hasAuthenticatedInstance ? 'Open inbox' : 'Sign in' }}
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--activity"
        :inert="slideInert(EDGE_LEFT + columnsStore.columns.length + 2)"
        aria-label="Activity"
      >
                <h2 class="feed-portal__title">
          Activity
          <span v-if="notificationsStore.badgeLabel" class="feed-portal__badge">
            {{ notificationsStore.badgeLabel }}
          </span>
        </h2>
        <p class="feed-portal__body">
          {{
            instancesStore.hasAuthenticatedInstance
              ? 'Mentions, likes, boosts, and follows.'
              : 'Sign in to see notifications.'
          }}
        </p>

        <div v-if="instancesStore.hasAuthenticatedInstance" class="feed-portal__chips">
          <button type="button" class="feed-portal__chip" @click="openPortal('activity', { filter: 'mention' })">
            Mentions
          </button>
          <button type="button" class="feed-portal__chip" @click="openPortal('activity', { filter: 'favourite' })">
            Likes
          </button>
          <button type="button" class="feed-portal__chip" @click="openPortal('activity', { filter: 'reblog' })">
            Boosts
          </button>
        </div>

        <div v-if="portalActivityRows.length" class="feed-portal__list">
          <button
            v-for="row in portalActivityRows"
            :key="row.id"
            type="button"
            class="feed-portal__list-row"
            :class="{ 'feed-portal__list-row--unread': row.unread }"
            @click="openPortalActivityRow(row.notif)"
          >
            <img v-if="row.avatar" :src="row.avatar" alt="" class="feed-portal__list-avatar" loading="lazy" decoding="async" />
            <span v-else class="feed-portal__list-avatar feed-portal__list-avatar--empty" />
            <span class="feed-portal__row-text">
              <strong>{{ row.label }}</strong>
            </span>
            <span v-if="row.unread" class="feed-portal__unread-dot">
              <span class="sr-only">Unread</span>
            </span>
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('activity')">
          {{ instancesStore.hasAuthenticatedInstance ? 'Open activity' : 'Sign in' }}
        </button>
      </aside>

      <aside
        v-if="isMobileUi"
        class="feed-portal feed-portal--communities"
        :inert="slideInert(EDGE_LEFT + columnsStore.columns.length + 3)"
        aria-label="Groups"
      >
                <h2 class="feed-portal__title">Groups</h2>
        <p class="feed-portal__body">
          {{
            groupsStore.joinedGroups.length
              ? 'Communities you follow — swipe back for feeds.'
              : 'Find communities and tags to follow.'
          }}
        </p>

        <div v-if="portalGroupChips.length" class="feed-portal__chips">
          <button
            v-for="group in portalGroupChips"
            :key="group.tag"
            type="button"
            class="feed-portal__chip"
            @click="void openGroup(group.tag)"
          >
            <span aria-hidden="true">{{ group.icon }}</span>
            {{ group.name }}
          </button>
        </div>

        <button type="button" class="neo-btn neo-btn--primary feed-portal__cta" @click="openPortal('communities')">
          Browse groups
        </button>
      </aside>

    </div>

    <!-- Mobile portrait: thumb-zone feed pills (Feed|Flick lives in the header) -->
    <nav
      v-if="!isPhoneLandscapeUi"
      class="mobile-feed-tabs"
      aria-label="Feeds"
    >
      <div ref="feedTabsScroller" class="mobile-feed-tabs__scroller">
        <NeoTabs
          class="mobile-feed-tabs__neo"
          :tabs="feedTabs"
          controls-id="feed-columns"
          aria-label="Feeds"
          :model-value="activeFeedTabId"
          :panels="false"
          @update:model-value="(id) => (activeFeedTabId = id)"
        />
      </div>
    </nav>

    <div
      v-if="!columnsStore.canAddColumn && !isDeskTabs && !isMobileUi"
      class="add-column-panel"
      @click.stop
    >
      <button type="button" class="add-column-full" aria-disabled="true" :aria-label="boardFullLabel" :title="boardFullLabel">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
    </div>

    <!-- Desktop Add Column Panel -->
    <div
      v-if="columnsStore.canAddColumn && !isDeskTabs && !isMobileUi"
      class="add-column-panel"
      :class="{ 'add-column-panel--expanded': addMenuOpen }"
      @click.stop
    >
      <NeoMenu
        v-model:open="addMenuOpen"
        class="add-column-neo add-column-neo--desktop"
        align="end"
        :label="`Add feed (${columnsStore.columnCount}/${MAX_COLUMNS})`"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        <template #items>
          <span class="add-column-menu__title">Add feed</span>
          <FeedMenuItems
            variant="add"
            :timelines-expanded="addAlgorithmsExpanded"
            :local-host-label="localHostLabel"
            show-panel-feeds
            @toggle-timelines="addAlgorithmsExpanded = !addAlgorithmsExpanded"
            @pick="addColumn"
            @add-rss="promptAddRss"
            @create-algorithm="algorithmsStore.openEditor(); addMenuOpen = false"
          />
          <div class="add-column-menu__divider" role="separator" />
          <button type="button" role="menuitem" :aria-expanded="addGroupsExpanded" class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
            <span>Groups</span>
            <svg :class="{ rotated: addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <template v-if="addGroupsExpanded">
            <div class="add-column-menu__filter" @click.stop>
              <input
                v-model="addGroupQuery"
                type="search"
                class="add-column-menu__filter-input"
                placeholder="Find News, Dogs…"
                aria-label="Filter groups"
                @keydown.enter.prevent="addGroupCustomTag ? addGroupAsColumn(addGroupCustomTag) : addableGroups[0] && addGroupAsColumn(addableGroups[0].tag)"
              >
            </div>
            <div class="add-column-menu__groups">
              <button
                v-for="group in addableGroups"
                :key="group.tag"
                type="button"
                role="menuitem"
                class="add-column-menu__item add-column-menu__item--group"
                @click="addGroupAsColumn(group.tag)"
              >
                <span class="add-column-menu__group-icon" aria-hidden="true">{{ group.icon }}</span>
                {{ group.name }}
              </button>
              <button
                v-if="addGroupCustomTag"
                type="button"
                role="menuitem"
                class="add-column-menu__item add-column-menu__item--group"
                @click="addGroupAsColumn(addGroupCustomTag)"
              >
                <span class="add-column-menu__group-icon" aria-hidden="true">🏷️</span>
                Add #{{ addGroupCustomTag }}
              </button>
              <p v-else-if="addGroupQuery.trim() && !addableGroups.length" class="add-column-menu__empty">
                No matching groups
              </p>
            </div>
          </template>
          <span class="add-column-menu__hint">
            {{ columnsStore.columnCount }}/{{ MAX_COLUMNS }} feeds on this device
          </span>
        </template>
      </NeoMenu>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.columns-page {
  display: flex;
  overflow: hidden;

  // Tablet+ / desk: extend into main-content padding to fill the full viewport
  @media (min-width: 768px) {
    height: 100vh;
    height: 100dvh;
    margin: -1rem;
    width: calc(100% + 2rem);
    overscroll-behavior-x: none;
  }

  @media (min-width: 1024px) {
    margin: -1.25rem;
    width: calc(100% + 2.5rem);
  }

  @media (min-width: 1200px) {
    margin: -1.5rem -2rem;
    width: calc(100% + 4rem);
  }

  // Phone carousel: fill the padded main box
  @media (max-width: 767px) {
    flex: 1;
    flex-direction: column;
    min-height: 0;
    width: 100%;
    max-width: 100%;
    margin-inline: 0;
    // Publish for layout dock / FAB (inherits up through main → layout)
    --neo-feed-tabs-h: 48px;
  }

  @media (max-height: 500px) and (orientation: landscape) and (max-width: 1023px) {
    --neo-feed-tabs-h: 0px;
  }

  // Single column / focused tab: center the content
  &:not(.columns-page--multi) {
    @media (min-width: 768px) {
      justify-content: center;
    }
  }

  &--tabs {
    @media (min-width: 768px) {
      flex-direction: column;
      align-items: stretch;
    }
  }

  // Desktop multi: whisper until hovered — only when real hover exists (not iPad sticky-hover)
  &--multi {
    @media (min-width: 1024px) and (hover: hover) and (pointer: fine) {
      :deep(.timeline-column.neo-chrome),
      :deep(.panel-column.neo-chrome) {
        --neo-chrome-fg: var(--neo-text-quaternary);
        --neo-chrome-fg-strong: var(--neo-text-tertiary);
        --neo-chrome-label: var(--neo-text-tertiary);
      }

      :deep(.timeline-column.neo-chrome:hover),
      :deep(.timeline-column.neo-chrome:focus-within),
      :deep(.panel-column.neo-chrome:hover),
      :deep(.panel-column.neo-chrome:focus-within) {
        --neo-chrome-fg: var(--neo-text-tertiary);
        --neo-chrome-fg-strong: var(--neo-text-secondary);
        --neo-chrome-label: var(--neo-text-primary);
      }
    }
  }
}

.columns-container {
  // Positioned so absolutely-placed descendants (e.g. .sr-only labels in
  // off-screen carousel slides) are clipped by the scroller instead of
  // widening the phone layout viewport.
  position: relative;
  display: flex;
  flex: 1 1 auto;
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  // none (not contain) — stop Safari history swipe at the board edges
  overscroll-behavior-x: none;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
  // Let iPad finger + trackpad claim horizontal; nested feeds keep pan-y for vertical
  touch-action: pan-x pan-y;
  scrollbar-width: thin;
  // Keep first column clear of the fixed sidebar when board scrolls
  scroll-padding-inline-start: 0.5rem;
  padding-inline-start: 0.25rem;
  box-sizing: border-box;

  @media (min-width: 768px) {
    scroll-padding-inline-start: 0.75rem;
    padding-inline-start: 0.5rem;
  }

  &--swiping,
  &--settling {
    scroll-snap-type: none !important;
    cursor: grabbing;
    user-select: none;
  }

  // During a horizontal flick, don't let nested feeds capture hit-testing
  &--swiping {
    :deep(.timeline-column),
    :deep(.panel-column),
    .feed-portal {
      pointer-events: none;
    }
  }

  // Single column: cap width for readability
  .columns-page:not(.columns-page--multi):not(.columns-page--tabs) & {
    @media (min-width: 768px) {
      max-width: 640px;
      overflow-x: hidden;
      touch-action: pan-y;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 auto;
        min-width: 0;
      }
    }
  }

  // Focused tab: fill the main pane so media can go edge-to-edge; text stays
  // capped inside the column / card (see TimelineColumn + RealPostCard).
  .columns-page--tabs & {
    @media (min-width: 768px) {
      max-width: none;
      width: 100%;
      margin-inline: 0;
      overflow-x: hidden;
      touch-action: pan-y;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 auto;
        width: 100%;
        min-width: 0;
        max-width: none;
      }
    }
  }

  // Multi-column: fill available space; columns keep a readable min-width and scroll
  .columns-page--multi & {
    max-width: none;
  }

  // Tablet portrait: 2 columns side-by-side with proximity snap
  @media (min-width: 768px) and (max-width: 1023px) {
    .columns-page--multi.columns-page--packed &,
    .columns-page--multi.columns-page--roomy & {
      overflow-x: auto;
      scroll-snap-type: x proximity;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 0 0 50%;
        min-width: max(320px, 50%);
        max-width: none;
        scroll-snap-align: start;
      }
    }

    .columns-page--multi.columns-page--roomy & {
      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 0 0 55%;
        min-width: max(340px, 52%);
        max-width: 520px;
      }
    }
  }

  // Phone: full-width pages — JS parks on release (CSS mandatory snap bounced vs settle)
  @media (max-width: 767px) {
    width: 100%;
    // No side padding — equal-width pages + scrollLeft math need a clean box
    padding-inline: 0;
    scroll-padding-inline: 0;
    scroll-snap-type: none;
    scrollbar-width: none;
    // Finger: we axis-lock in JS; keep pan-y for nested feed scroll
    touch-action: pan-y;

    &::-webkit-scrollbar {
      display: none;
    }

    :deep(.timeline-column),
    :deep(.panel-column),
    .feed-portal {
      flex: 0 0 100%;
      width: 100%;
      min-width: 100%;
      max-width: 100%;
      border-right: none;
      box-sizing: border-box;
      // Skip paint/layout for off-screen carousel pages while swiping
      contain: layout style paint;
      content-visibility: auto;
      contain-intrinsic-size: 100vw 70vh;
    }
  }

  @media (min-width: 1024px) {
    // Packed: share the row, but never crush past a readable width.
    // Soft proximity snap only — no mandatory/always (those fought trackpad panning).
    .columns-page--multi.columns-page--packed & {
      overflow-x: auto;
      scroll-snap-type: x proximity;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 0;
        min-width: max(280px, calc(100% / 6));
        max-width: none;
        scroll-snap-align: start;
      }
    }

    @media (max-width: 1366px) {
      .columns-page--multi.columns-page--packed & {
        :deep(.timeline-column),
        :deep(.panel-column) {
          // ~3 across on iPad landscape, then trackpad/finger scroll
          min-width: max(300px, 32%);
        }
      }
    }

    @media (min-width: 1367px) and (max-width: 1599px) {
      .columns-page--multi.columns-page--packed & {
        :deep(.timeline-column),
        :deep(.panel-column) {
          min-width: max(300px, 25%);
        }
      }
    }

    .columns-page--multi.columns-page--roomy & {
      overflow-x: auto;
      scroll-snap-type: x proximity;

      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 0 0 30%;
        min-width: 320px;
        max-width: 520px;
        scroll-snap-align: start;
      }
    }

    @media (max-width: 1199px) {
      .columns-page--multi.columns-page--roomy & {
        :deep(.timeline-column),
        :deep(.panel-column) {
          flex: 0 0 42%;
          min-width: 300px;
          max-width: 480px;
        }
      }
    }

    // Single column: Board toggle still changes width (was a silent no-op before)
    .columns-page:not(.columns-page--multi).columns-page--roomy & {
      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 0 1 auto;
        width: min(100%, 520px);
        max-width: 520px;
      }
    }

    .columns-page:not(.columns-page--multi).columns-page--packed & {
      :deep(.timeline-column),
      :deep(.panel-column) {
        flex: 1 1 auto;
        width: 100%;
        max-width: none;
      }
    }
  }
}

/* Keep mounted so column scrollTop survives focus mode (avoid display:none). */
:deep(.board-col--hidden) {
  content-visibility: hidden;
  visibility: hidden;
  position: absolute !important;
  inset: 0 auto auto 0;
  width: 1px !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 1px !important;
  margin: 0 !important;
  padding: 0 !important;
  border: none !important;
  overflow: hidden !important;
  opacity: 0;
  pointer-events: none;
  z-index: -1;
}

.feed-portal {
  display: none;
  box-sizing: border-box;
  flex-direction: column;
  align-items: flex-start;
  // `safe` keeps the title reachable at the top when a landscape phone overflows
  justify-content: center;
  justify-content: safe center;
  gap: 0.75rem;
  padding: 2.5rem 1.25rem 5rem;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
  background:
    radial-gradient(
      ellipse 70% 45% at 20% 35%,
      color-mix(in srgb, var(--neo-accent) 10%, transparent),
      transparent 70%
    ),
    var(--neo-bg-primary);
  color: var(--neo-text-primary);

  @media (max-width: 767px) {
    display: flex;
  }

  &__title {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }

  &__body {
    margin: 0;
    max-width: 22rem;
    font-size: 0.9375rem;
    line-height: 1.45;
    color: var(--neo-text-secondary);
  }

  &__cta {
    margin-top: 0.35rem;
  }

  &__panel {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: min(100%, 20rem);
    margin-top: 0.15rem;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    @media (hover: hover) {
      &:hover {
        border-color: color-mix(in srgb, var(--neo-accent) 40%, var(--neo-border-color));
        background: var(--neo-bg-hover, var(--neo-bg-tertiary));
      }
    }
  }

  &__swatch {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 50%;
    background:
      radial-gradient(circle at 30% 30%, var(--neo-accent) 0 35%, transparent 36%),
      linear-gradient(135deg, var(--neo-bg-card) 45%, var(--neo-text-primary) 46%);
    border: 1.5px solid var(--neo-border-color-dark);
  }

  &__row-text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1;

    strong {
      font-size: 0.8125rem;
      font-weight: 650;
    }

    span {
      font-size: 0.8125rem;
      color: var(--neo-text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  &__unread-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--neo-accent);
  }

  &__row-action {
    flex-shrink: 0;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }

  &__identity {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.65rem;
    width: min(100%, 20rem);
  }

  &__avatar {
    width: 72px;
    height: 72px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--neo-border-color);
    background: var(--neo-bg-tertiary);
  }

  &__who {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;

    strong {
      font-size: 1.125rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    span {
      font-size: 0.875rem;
      color: var(--neo-text-secondary);
    }
  }

  &__stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    margin: 0;
    font-size: 0.8125rem;
    color: var(--neo-text-secondary);

    b {
      color: var(--neo-text-primary);
      font-weight: 650;
    }
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    width: min(100%, 22rem);
  }

  &__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.8125rem;
    font-weight: 550;
    cursor: pointer;

    @media (hover: hover) {
      &:hover {
        border-color: color-mix(in srgb, var(--neo-accent) 40%, var(--neo-border-color));
        background: var(--neo-accent-soft);
      }
    }
  }

  &__badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.35rem;
    height: 1.35rem;
    margin-left: 0.4rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--neo-accent);
    color: var(--neo-on-accent, #fff);
    font-size: 0.75rem;
    font-weight: 700;
    vertical-align: middle;
  }

  &__search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: min(100%, 22rem);
    padding: 0.65rem 0.85rem;
    border-radius: 12px;
    border: 1px solid var(--neo-border-color);
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: var(--neo-text-secondary);

    &:focus-within {
      border-color: var(--neo-accent);
      box-shadow: 0 0 0 3px var(--neo-accent-soft);
    }
  }

  &__search-input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.9375rem;

    &:focus {
      outline: none;
    }

    &::placeholder {
      color: var(--neo-text-muted);
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    width: min(100%, 22rem);
  }

  &__list-row {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;

    @media (hover: hover) {
      &:hover {
        border-color: color-mix(in srgb, var(--neo-accent) 40%, var(--neo-border-color));
        background: var(--neo-bg-hover, var(--neo-bg-tertiary));
      }
    }

    &--unread {
      border-color: color-mix(in srgb, var(--neo-accent) 35%, var(--neo-border-color));
      background: var(--neo-accent-soft);
    }

    &--static {
      cursor: default;

      @media (hover: hover) {
        &:hover {
          border-color: var(--neo-border-color);
          background: var(--neo-bg-card, var(--neo-bg-secondary));
        }
      }
    }
  }

  &__list-avatar {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 50%;
    object-fit: cover;
    background: var(--neo-bg-tertiary);

    &--empty {
      display: block;
    }
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

// ========================================
// Desktop focused-tab strip
// ========================================
.desk-pack-switch {
  flex-shrink: 0;

  &__select {
    appearance: none;
    max-width: 8.5rem;
    padding: 0.35rem 1.5rem 0.35rem 0.55rem;
    border: 1px solid var(--neo-border-color);
    border-radius: var(--neo-radius-sm, 6px);
    background:
      linear-gradient(45deg, transparent 50%, var(--neo-text-muted) 50%) calc(100% - 12px) calc(50% - 2px) / 5px 5px no-repeat,
      linear-gradient(135deg, var(--neo-text-muted) 50%, transparent 50%) calc(100% - 8px) calc(50% - 2px) / 5px 5px no-repeat,
      var(--neo-bg-secondary);
    color: var(--neo-text-primary);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }
}

.desk-feed-tabs {
  display: none;

  @media (min-width: 768px) {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    max-width: min(44rem, 100%);
    width: 100%;
    margin: 0 auto;
    padding: 0.35rem 0.75rem 0.5rem;
    border-bottom: 1px solid var(--neo-border-color);
    box-sizing: border-box;
  }

  &__neo {
    flex: 1;
    min-width: 0;

    :deep(.neo-tabs__list) {
      gap: 0.25rem;
      border-bottom: none;
      overflow-x: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar {
        display: none;
      }
    }

    :deep(.neo-tabs__tab) {
      flex-shrink: 0;
      min-height: 40px;
      padding: 0.45rem 0.95rem;
      font-size: 0.9375rem;
      font-weight: 600;
      white-space: nowrap;
      border-radius: 999px;
      box-shadow: none;

      &[aria-selected='true'] {
        color: var(--neo-text-inverse, #fff);
        background: var(--neo-accent);
        box-shadow: none;
      }
    }
  }

  &__add {
    flex-shrink: 0;
  }
}

// ========================================
// Mobile feed chrome (top) + feed tabs (bottom)
// Portrait: no top feed chrome (Threads-clean). Landscape keeps the slim bar.
// ========================================
.mobile-feed-chrome {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 0.25rem;
  min-height: 44px;
  padding: 0.15rem 0.3rem 0.15rem 0.25rem;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  z-index: var(--neo-z-sticky-bar, 20);

  &--landscape {
    display: flex;
    min-height: 36px;
    padding: 0.1rem 0.25rem;
    gap: 0.15rem;

    .mobile-feed-chrome__jump {
      width: 36px;
      height: 32px;
    }

    .mobile-feed-chrome__mode-switch {
      margin-right: 0.15rem;
    }
  }

  &__mode-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    flex-shrink: 0;
    gap: 0.12rem;
    padding: 0.12rem;
    border-radius: 8px;
    background: var(--neo-bg-tertiary);
  }

  &__mode-opt {
    min-width: 2.5rem;
    min-height: 28px;
    padding: 0 0.4rem;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--neo-text-tertiary);
    font: inherit;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &.is-on {
      background: var(--neo-bg-primary);
      color: var(--neo-text-primary);
      box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--neo-accent) 70%, transparent);
    }

    &:disabled {
      opacity: 0.45;
      cursor: default;
    }

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 1px;
    }
  }

  &__pills {
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-x;

    &::-webkit-scrollbar {
      display: none;
    }

    :deep(.neo-tabs__list) {
      display: flex;
      gap: 0.25rem;
      border-bottom: none;
      overflow: visible;
    }

    :deep(.neo-tabs__tab) {
      flex-shrink: 0;
      max-width: 9rem;
      min-height: 28px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-radius: 6px;
      box-shadow: none;
      color: var(--neo-text-tertiary);

      &[aria-selected='true'] {
        color: var(--neo-text-primary);
        background: var(--neo-bg-tertiary);
        box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--neo-accent) 70%, transparent);
      }
    }
  }

  &__title {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0 0.15rem;
    border: none;
    background: transparent;
    font: inherit;
    font-size: 0.9375rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    color: var(--neo-text-primary);
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;

    &:focus-visible {
      outline: 2px solid var(--neo-accent);
      outline-offset: 2px;
      border-radius: 4px;
    }
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 0.05rem;
  }

  &__jump,
  &__mode {
    width: 40px;
    height: 40px;
  }

  &__jump:disabled,
  &__mode:disabled {
    opacity: 0.28;
  }

  &__add {
    position: relative;
    flex-shrink: 0;
  }

  &__mode {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    // Tertiary, not quaternary: an icon-only control needs 3:1 against the bar
    color: var(--neo-text-tertiary);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition:
      color var(--neo-transition-fast),
      background-color var(--neo-transition-fast),
      transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring);

    &:active:not(:disabled) {
      transition-duration: var(--neo-dur-instant, 90ms);
      transform: scale3d(var(--neo-press-squash-x, 1.06), var(--neo-press-squash-y, 0.91), 1);
    }

    &--flip {
      color: var(--neo-text-secondary);
    }

    &:hover:not(:disabled),
    &:focus-visible:not(:disabled) {
      color: var(--neo-text-secondary);
      background: var(--neo-bg-tertiary);
    }
  }
}

.mobile-feed-tabs {
  display: none;
  flex-shrink: 0;
  align-items: center;
  gap: 0;
  // Sits directly above the tab bar as one bottom thumb stack
  padding: 0.35rem 0.55rem 0.2rem;
  border-top: 1px solid color-mix(in srgb, var(--neo-border-color) 70%, transparent);
  border-bottom: none;
  background: var(--neo-bg-primary);
  position: relative;
  z-index: var(--neo-z-sticky-bar, 20);

  @media (max-width: 767px) {
    display: flex;
  }

  @media (max-height: 500px) and (orientation: landscape) and (max-width: 1023px) {
    display: none;
  }

  &__scroller {
    display: flex;
    flex: 1;
    min-width: 0;
    gap: 0.35rem;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
    touch-action: pan-x;
    scroll-behavior: auto;
  }

  &__scroller::-webkit-scrollbar {
    display: none;
  }

  &__neo {
    flex: 1;
    min-width: 0;

    :deep(.neo-tabs__list) {
      display: flex;
      gap: 0.35rem;
      border-bottom: none;
      overflow: visible;
    }

    :deep(.neo-tabs__tab) {
      flex-shrink: 0;
      max-width: 11rem;
      min-height: 40px;
      padding: 0.4rem 0.85rem;
      font-size: 0.875rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border-radius: 8px;
      box-shadow: none;
      color: var(--neo-text-tertiary);
      transition:
        color var(--neo-transition-fast),
        background-color var(--neo-transition-fast),
        box-shadow var(--neo-transition-fast),
        transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring);

      &[aria-selected='true'] {
        color: var(--neo-text-primary);
        background: var(--neo-bg-tertiary);
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--neo-accent) 70%, transparent);
      }

      &:active {
        transition-duration: var(--neo-dur-instant, 90ms);
        transform: scale3d(var(--neo-press-squash-x, 1.06), var(--neo-press-squash-y, 0.91), 1);
      }

      &:focus-visible {
        outline: 2px solid var(--neo-focus, var(--neo-accent));
        outline-offset: 2px;
      }
    }
  }
}

.mode-glyph {
  position: relative;
  width: 18px;
  height: 16px;
  display: block;

  &__flow,
  &__flip {
    position: absolute;
    inset: 0;
    transition:
      opacity var(--neo-dur-quick, 160ms) var(--neo-ease-out),
      transform var(--neo-dur-normal, 240ms) var(--neo-ease-spring);
  }

  &__flow {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    opacity: 1;
    transform: scale(1);

    i {
      display: block;
      height: 2px;
      border-radius: 1px;
      background: currentColor;
    }

    i:nth-child(1) { width: 100%; }
    i:nth-child(2) { width: 78%; }
    i:nth-child(3) { width: 92%; }
  }

  &__flip {
    width: 11px;
    height: 15px;
    margin: 0 auto;
    left: 0;
    right: 0;
    border: 1.75px solid currentColor;
    border-radius: 3px;
    opacity: 0;
    transform: scale(0.86);
  }
}


.mobile-feed-chrome__mode--flip .mode-glyph {
  .mode-glyph__flow {
    opacity: 0;
    transform: scale(0.86);
  }

  .mode-glyph__flip {
    opacity: 1;
    transform: scale(1);
  }
}

// ========================================
// Add Column Panel
// ========================================
.add-column-panel {
  display: none;
  flex-shrink: 0;
  width: 48px;
  height: 100%;
  flex-direction: column;
  align-items: center;
  padding-top: 0.5rem;
  border-left: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  position: relative;
  transition: width 0.2s ease;

  @media (min-width: 768px) {
    display: flex;
  }

  &--expanded {
    width: 48px;
    z-index: var(--neo-z-dropdown, 1000);
  }
}

// Board at the column cap: keep the control (so the limit is discoverable) but inert
.add-column-full {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--neo-text-muted);
  opacity: 0.55;
  cursor: not-allowed;

  @media (hover: none), (pointer: coarse) {
    width: 44px;
    height: 44px;
  }
}

.add-column-neo {
  :deep(.neo-menu__trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 8px;
    color: var(--neo-text-secondary);

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-tertiary);
        color: var(--neo-text-primary);
      }
    }

    @media (hover: none), (pointer: coarse) {
      width: 44px;
      height: 44px;
    }
  }

  :deep(.neo-menu__panel) {
    width: 240px;
    max-height: min(70vh, 28rem);
    overflow-x: hidden;
    overflow-y: auto;
    background: var(--neo-bg-secondary);
    border-radius: 12px;
    box-shadow: var(--neo-shadow-xl);
    padding: 0.5rem;
    z-index: 50;
  }

  &--desktop :deep(.neo-menu__panel) {
    top: 0;
    right: calc(100% + 0.5rem);
    left: auto;
  }

  &--mobile :deep(.neo-menu__panel) {
    top: calc(100% + 0.35rem);
    right: 0;
    left: auto;
  }
}

.add-column-menu {
  &__title {
    display: block;
    padding: 0.375rem 0.75rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--neo-text-secondary);
    border-radius: var(--neo-radius-lg, 8px);
    transition: background-color 0.12s ease, color 0.12s ease;

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-tertiary);
        color: var(--neo-text-primary);
      }
    }

    &--server {
      color: var(--neo-text-muted);
    }

    svg {
      flex-shrink: 0;
    }
  }

  &__divider {
    height: 1px;
    background: var(--neo-border-color);
    margin: 0.375rem 0.5rem;
  }

  &__section-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 0.5rem 0.75rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: var(--neo-radius-lg, 6px);
    transition: background-color 0.12s ease, color 0.12s ease;

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-tertiary);
        color: var(--neo-text-secondary);
      }
    }

    svg {
      transition: transform 0.2s ease;
      &.rotated {
        transform: rotate(180deg);
      }
    }
  }

  &__item--group {
    font-size: 0.8125rem;
    padding: 0.5rem 0.75rem;
  }

  &__group-icon {
    font-size: 1rem;
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }

  &__filter {
    padding: 0.25rem 0.5rem 0.5rem;
  }

  &__filter-input {
    width: 100%;
    padding: 0.45rem 0.6rem;
    font-size: 0.8125rem;
    color: var(--neo-text-primary);
    background: var(--neo-bg-primary);
    border: 1px solid var(--neo-border-color);
    border-radius: 8px;

    &::placeholder {
      color: var(--neo-text-muted);
    }

    &:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
    }
  }

  &__groups {
    max-height: 14rem;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  &__empty {
    margin: 0;
    padding: 0.5rem 0.75rem 0.75rem;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }

  &__hint {
    display: block;
    padding: 0.25rem 0.75rem 0.375rem;
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    text-align: center;
  }
}


.feed-portal__who strong :deep(img) {
  height: 1.15em;
  width: auto;
  vertical-align: -0.2em;
}
</style>

<!-- Teleported Add Feed panel lives on <body>; scoped :deep() cannot reach it. -->
<style lang="scss">
.add-column-menu-panel.neo-menu__panel {
  width: 240px;
  max-height: min(70vh, 28rem);
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--neo-bg-secondary);
  border-radius: 12px;
  box-shadow: var(--neo-shadow-xl);
  padding: 0.5rem;
}

.add-column-menu-panel--sheet.neo-menu__panel {
  width: 100%;
  max-width: 100%;
  max-height: min(78dvh, 36rem);
  border-radius: 16px 16px 0 0;
  box-shadow: none;
  padding: 0.35rem 0.65rem calc(0.75rem + env(safe-area-inset-bottom, 0px));

  .add-column-menu__title {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    padding: 0.15rem 0.85rem 0.55rem;
  }

  .add-column-menu__item--group {
    min-height: 48px;
  }

  .add-column-menu__filter-input {
    min-height: 44px;
    font-size: 16px; /* avoid iOS zoom */
  }

  .add-column-menu__hint {
    padding-top: 0.5rem;
    padding-bottom: 0.25rem;
  }
}
</style>
