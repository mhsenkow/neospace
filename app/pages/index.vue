<script setup lang="ts">
/**
 * Home Page - Multi-column TweetDeck-style layout
 *
 * Supports 1-4 independent timeline columns, each with its own
 * feed type, scroll position, and data. Column config is persisted.
 */

import { useAuthStore } from '~/stores/auth'
import { useThemeStore } from '~/stores/theme'
import { useInstancesStore } from '~/stores/instances'
import { useColumnsStore, type ColumnFeedType } from '~/stores/columns'
import { useGroupsStore } from '~/stores/groups'

const authStore = useAuthStore()
const themeStore = useThemeStore()
const instancesStore = useInstancesStore()
const columnsStore = useColumnsStore()
const groupsStore = useGroupsStore()

const instanceManagerRef = ref<{ open: () => void } | null>(null)
const addMenuOpen = ref(false)
const addGroupsExpanded = ref(false)

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

const openInstanceManager = () => {
  instanceManagerRef.value?.open()
}

onMounted(async () => {
  await Promise.all([
    authStore.initialize(),
    instancesStore.initialize(),
  ])
  columnsStore.initialize()

  if (authStore.isAuthenticated) {
    groupsStore.initializeGroups()
  }

  if (authStore.userCustomCSS) {
    themeStore.setUserCustomCSS(authStore.userCustomCSS)
  }

  // If user is authenticated and first column is 'local', switch to 'home'
  const firstCol = columnsStore.columns[0]
  if (
    firstCol &&
    (authStore.isAuthenticated || instancesStore.hasAuthenticatedInstance) &&
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
    <InstanceManager ref="instanceManagerRef" />

    <div class="columns-container">
      <TimelineColumn
        v-for="(column, idx) in columnsStore.columns"
        :key="column.id"
        :column="column"
        :is-first="idx === 0"
        :can-remove="columnsStore.canRemoveColumn"
        @remove="columnsStore.removeColumn(column.id)"
        @update-feed-type="(type: ColumnFeedType, groupTag?: string) => columnsStore.updateColumnFeedType(column.id, type, groupTag)"
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
        :title="`Add column (${columnsStore.columnCount}/4)`"
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

          <div class="add-column-menu__divider"></div>

          <button class="add-column-menu__item add-column-menu__item--server" @click="openInstanceManager(); addMenuOpen = false">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
              <line x1="6" y1="6" x2="6.01" y2="6" />
              <line x1="6" y1="18" x2="6.01" y2="18" />
            </svg>
            Manage Servers
          </button>

          <span class="add-column-menu__hint">{{ columnsStore.columnCount }}/4 columns</span>
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
  overflow: hidden;

  // Single column: cap width for readability
  .columns-page:not(.columns-page--multi) & {
    @media (min-width: 1024px) {
      max-width: 620px;
    }
  }

  // Multi-column: fill available space
  .columns-page--multi & {
    max-width: none;
  }

  // Mobile: only show first column
  @media (max-width: 1023px) {
    :deep(.timeline-column:not(:first-child)) {
      display: none;
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
