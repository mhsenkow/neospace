<script setup lang="ts">
/**
 * Home Page - Multi-column TweetDeck-style layout
 *
 * Supports 1-8 independent timeline columns, each with its own
 * feed type, scroll position, and data. Column config is persisted.
 * Desktop: equal-flex columns with a min width + horizontal scroll.
 * Mobile: full-width scroll-snap carousel (swipe left/right).
 */

import { useThemeStore } from '~/stores/theme'
import { useInstancesStore } from '~/stores/instances'
import { useColumnsStore, MAX_COLUMNS, type ColumnFeedType } from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'

const themeStore = useThemeStore()
const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()

const addMenuOpen = ref(false)
const addGroupsExpanded = ref(false)
const columnsContainer = ref<HTMLElement | null>(null)
const activeColumnIndex = ref(0)
const draggingColumnId = ref<string | null>(null)
const dropTargetColumnId = ref<string | null>(null)

const FEED_LABELS: Record<string, string> = {
  home: 'For You',
  local: 'Local',
  federated: 'Federated',
}

const columnTabLabels = computed(() =>
  columnsStore.columns.map((column) => {
    if (column.feedType === 'group' && column.groupTag) {
      const group = groupsStore.getGroup(column.groupTag)
      return group ? `${group.icon} ${group.name}` : `#${column.groupTag}`
    }
    return FEED_LABELS[column.feedType] ?? column.feedType
  }),
)

/** Keep the active mobile feed glued to the same column id across reorders */
const withActivePreserved = (fn: () => void) => {
  const activeId = columnsStore.columns[activeColumnIndex.value]?.id
  fn()
  if (!activeId) return
  const next = columnsStore.columns.findIndex(c => c.id === activeId)
  if (next !== -1) activeColumnIndex.value = next
}

const reorderToIndex = (fromColumnId: string, toIndex: number) => {
  withActivePreserved(() => {
    columnsStore.moveColumnById(fromColumnId, toIndex)
  })
}

const onColumnDragStart = (columnId: string) => {
  draggingColumnId.value = columnId
}

const onColumnDragEnd = () => {
  draggingColumnId.value = null
  dropTargetColumnId.value = null
}

const onColumnDragOver = (columnId: string) => {
  if (draggingColumnId.value && draggingColumnId.value !== columnId) {
    dropTargetColumnId.value = columnId
  }
}

const onColumnDrop = (fromColumnId: string, toColumnId: string) => {
  const toIndex = columnsStore.columns.findIndex(c => c.id === toColumnId)
  if (toIndex === -1) return
  reorderToIndex(fromColumnId, toIndex)
  onColumnDragEnd()
}

const moveColumnLeft = (index: number) => {
  if (index <= 0) return
  withActivePreserved(() => columnsStore.moveColumn(index, index - 1))
}

const moveColumnRight = (index: number) => {
  if (index >= columnsStore.columns.length - 1) return
  withActivePreserved(() => columnsStore.moveColumn(index, index + 1))
}

const onTabDragStart = (e: DragEvent, columnId: string) => {
  e.dataTransfer?.setData('text/plain', columnId)
  e.dataTransfer?.setData('application/x-neospace-column', columnId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  draggingColumnId.value = columnId
}

const onTabDragOver = (e: DragEvent, columnId: string) => {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  onColumnDragOver(columnId)
}

const onTabDrop = (e: DragEvent, toColumnId: string) => {
  e.preventDefault()
  const fromId =
    e.dataTransfer?.getData('application/x-neospace-column') ||
    e.dataTransfer?.getData('text/plain')
  if (fromId) onColumnDrop(fromId, toColumnId)
}

const closeAddMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (!target.closest('.add-column-panel')) {
    addMenuOpen.value = false
  }
}

const addColumn = (feedType: ColumnFeedType, groupTag?: string) => {
  columnsStore.addColumn(feedType, groupTag)
  addMenuOpen.value = false
  addGroupsExpanded.value = false
}

const scrollToColumn = (index: number) => {
  const el = columnsContainer.value
  if (!el) return
  const col = el.children[index] as HTMLElement | undefined
  if (!col) return
  el.scrollTo({ left: col.offsetLeft, behavior: 'smooth' })
  activeColumnIndex.value = index
}

const onColumnsScroll = () => {
  const el = columnsContainer.value
  if (!el || el.clientWidth <= 0) return
  // Mobile carousel: each column is full width
  const index = Math.round(el.scrollLeft / el.clientWidth)
  activeColumnIndex.value = Math.min(
    Math.max(index, 0),
    columnsStore.columns.length - 1,
  )
}

watch(
  () => columnsStore.columnCount,
  (count) => {
    if (activeColumnIndex.value >= count) {
      activeColumnIndex.value = Math.max(0, count - 1)
    }
  },
)

onMounted(async () => {
  await instancesStore.initialize()
  columnsStore.initialize()

  if (instancesStore.isAuthenticated) {
    groupsStore.initializeGroups()
  }

  if (instancesStore.userCustomCSS) {
    themeStore.setUserCustomCSS(instancesStore.userCustomCSS)
  }

  // If user is authenticated and first column is 'local', switch to 'home'
  const firstCol = columnsStore.columns[0]
  if (
    firstCol &&
    instancesStore.hasAuthenticatedInstance &&
    columnsStore.columns.length === 1 &&
    firstCol.feedType === 'local'
  ) {
    columnsStore.updateColumnFeedType(firstCol.id, 'home')
  }

  document.addEventListener('click', closeAddMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', closeAddMenu)
})

useHead({ title: 'Home | NeoSpace' })
</script>

<template>
  <div class="columns-page" :class="{ 'columns-page--multi': columnsStore.isMultiColumn }">
    <!-- Mobile feed tabs: swipe or tap between columns -->
    <nav
      v-if="columnsStore.isMultiColumn"
      class="mobile-feed-tabs"
      aria-label="Feeds"
    >
      <button
        v-for="(label, idx) in columnTabLabels"
        :key="columnsStore.columns[idx]!.id"
        type="button"
        class="mobile-feed-tabs__tab"
        :class="{
          'mobile-feed-tabs__tab--active': activeColumnIndex === idx,
          'mobile-feed-tabs__tab--dragging': draggingColumnId === columnsStore.columns[idx]!.id,
          'mobile-feed-tabs__tab--drop-target': dropTargetColumnId === columnsStore.columns[idx]!.id,
        }"
        :aria-current="activeColumnIndex === idx ? 'true' : undefined"
        draggable="true"
        title="Drag to reorder"
        @click="scrollToColumn(idx)"
        @dragstart="onTabDragStart($event, columnsStore.columns[idx]!.id)"
        @dragend="onColumnDragEnd"
        @dragover="onTabDragOver($event, columnsStore.columns[idx]!.id)"
        @drop="onTabDrop($event, columnsStore.columns[idx]!.id)"
      >
        {{ label }}
      </button>
    </nav>

    <div
      ref="columnsContainer"
      class="columns-container"
      @scroll.passive="onColumnsScroll"
    >
      <TimelineColumn
        v-for="(column, idx) in columnsStore.columns"
        :key="column.id"
        :column="column"
        :is-first="idx === 0"
        :is-last="idx === columnsStore.columns.length - 1"
        :can-remove="columnsStore.canRemoveColumn"
        :can-reorder="columnsStore.isMultiColumn"
        :dragging="draggingColumnId === column.id"
        :drop-target="dropTargetColumnId === column.id"
        @remove="columnsStore.removeColumn(column.id)"
        @update-feed-type="(type: ColumnFeedType, groupTag?: string) => columnsStore.updateColumnFeedType(column.id, type, groupTag)"
        @column-drag-start="onColumnDragStart"
        @column-drag-end="onColumnDragEnd"
        @column-drag-over="onColumnDragOver"
        @column-drop="(fromId) => onColumnDrop(fromId, column.id)"
        @move-left="moveColumnLeft(idx)"
        @move-right="moveColumnRight(idx)"
      />
    </div>

    <!-- Add Column Panel -->
    <div
      v-if="columnsStore.canAddColumn"
      class="add-column-panel"
      :class="{ 'add-column-panel--expanded': addMenuOpen }"
      @click.stop
    >
      <button
        class="add-column-btn"
        :title="`Add column (${columnsStore.columnCount}/${MAX_COLUMNS})`"
        @click="addMenuOpen = !addMenuOpen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      <Transition name="add-menu">
        <div v-if="addMenuOpen" class="add-column-menu">
          <span class="add-column-menu__title">Add Column</span>
          <button class="add-column-menu__item" @click="addColumn('home')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            </svg>
            For You
          </button>
          <button class="add-column-menu__item" @click="addColumn('local')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            Local
          </button>
          <button class="add-column-menu__item" @click="addColumn('federated')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
            Federated
          </button>

          <!-- Joined Groups -->
          <template v-if="groupsStore.joinedGroups.length > 0">
            <div class="add-column-menu__divider"></div>
            <button class="add-column-menu__section-toggle" @click.stop="addGroupsExpanded = !addGroupsExpanded">
              <span>Groups</span>
              <svg :class="{ 'rotated': addGroupsExpanded }" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <template v-if="addGroupsExpanded">
              <button
                v-for="group in groupsStore.joinedGroups"
                :key="group.tag"
                class="add-column-menu__item add-column-menu__item--group"
                @click="addColumn('group', group.tag)"
              >
                <span class="add-column-menu__group-icon">{{ group.icon }}</span>
                {{ group.name }}
              </button>
            </template>
          </template>

          <span class="add-column-menu__hint">{{ columnsStore.columnCount }}/{{ MAX_COLUMNS }} columns</span>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.columns-page {
  display: flex;
  overflow: hidden;

  // Desktop: extend into main-content padding to fill the full viewport
  @media (min-width: 1024px) {
    height: 100vh;
    margin: -1.5rem -2rem;
    width: calc(100% + 4rem);
  }

  // Mobile: fill viewport minus header + nav
  @media (max-width: 1023px) {
    flex-direction: column;
    height: calc(100vh - 112px - env(safe-area-inset-bottom, 0px));
  }

  // Single column mode on desktop: center the content
  &:not(.columns-page--multi) {
    @media (min-width: 1024px) {
      justify-content: center;
    }
  }
}

.columns-container {
  display: flex;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: thin;

  // Single column: cap width for readability
  .columns-page:not(.columns-page--multi) & {
    @media (min-width: 1024px) {
      max-width: 620px;
      overflow-x: hidden;

      :deep(.timeline-column) {
        flex: 1 1 auto;
        min-width: 0;
      }
    }
  }

  // Multi-column: fill available space; columns keep a readable min-width and scroll
  .columns-page--multi & {
    max-width: none;
  }

  // Mobile: full-width snap carousel — swipe left/right between feeds
  @media (max-width: 1023px) {
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }

    :deep(.timeline-column) {
      flex: 0 0 100%;
      min-width: 100%;
      max-width: 100%;
      scroll-snap-align: start;
      scroll-snap-stop: always;
      border-right: none;
    }
  }
}

// ========================================
// Mobile feed tabs
// ========================================
.mobile-feed-tabs {
  display: none;
  flex-shrink: 0;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--neo-border-color);
  background: var(--neo-bg-primary);
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (max-width: 1023px) {
    display: flex;
  }

  &__tab {
    flex-shrink: 0;
    max-width: 10rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-radius: 8px;
    cursor: grab;
    transition: color 0.15s ease, background 0.15s ease, opacity 0.15s ease;

    &--active {
      color: var(--neo-text-primary);
      background: var(--neo-bg-tertiary);
    }

    &--dragging {
      opacity: 0.45;
    }

    &--drop-target {
      color: var(--neo-text-primary);
      background: color-mix(in srgb, var(--neo-accent) 18%, var(--neo-bg-tertiary));
      box-shadow: inset 0 -2px 0 var(--neo-accent);
    }

    &:active {
      cursor: grabbing;
      transform: scale(0.97);
    }
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

  @media (min-width: 1024px) {
    display: flex;
  }

  &--expanded {
    width: 48px;
  }
}

.add-column-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  color: var(--neo-text-muted);
  transition: all 0.15s ease;

  &:hover {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }
}

.add-column-menu {
  position: absolute;
  top: 0.5rem;
  right: calc(100% + 0.5rem);
  width: 200px;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  box-shadow: var(--neo-shadow-xl);
  padding: 0.5rem;
  z-index: 50;

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
    border-radius: 8px;
    transition: all 0.12s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-primary);
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
    border-radius: 6px;
    transition: all 0.12s ease;

    &:hover {
      background: var(--neo-bg-tertiary);
      color: var(--neo-text-secondary);
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

  &__hint {
    display: block;
    padding: 0.25rem 0.75rem 0.375rem;
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    text-align: center;
  }
}

// ========================================
// Add menu transition
// ========================================
.add-menu-enter-active,
.add-menu-leave-active {
  transition: all 0.15s ease;
  transform-origin: right top;
}
.add-menu-enter-from,
.add-menu-leave-to {
  opacity: 0;
  transform: scale(0.95) translateX(4px);
}
</style>
