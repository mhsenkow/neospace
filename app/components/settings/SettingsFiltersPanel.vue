<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useOverlayStore } from '~/stores/overlay'
import { useToastStore } from '~/stores/toast'
import type { SettingsTopic } from '~/utils/serverCapabilities'

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const overlayStore = useOverlayStore()
const toastStore = useToastStore()

const serverLink = (topic: SettingsTopic) => instancesStore.serverSettingsLink(topic)

const runModeration = (action: () => Promise<unknown>) => {
  action().catch(() => {})
}

const confirmDeleteFilter = async (filterId: string, title: string) => {
  const ok = await overlayStore.openConfirm({
    title: 'Delete this filter?',
    body: `"${title}" will be removed from your account.`,
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  runModeration(() => settingsStore.deleteFilter(filterId))
}

const newFilterTitle = ref('')
const newFilterKeywords = ref('')
const newFilterAction = ref<'warn' | 'hide'>('warn')
const isCreatingFilter = ref(false)

const createNewFilter = async () => {
  const title = newFilterTitle.value.trim()
  const keywords = newFilterKeywords.value
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  if (!title || !keywords.length) {
    toastStore.show({ message: 'Enter a title and at least one keyword', duration: 3000 })
    return
  }
  isCreatingFilter.value = true
  try {
    await settingsStore.createFilter({
      title,
      keywords,
      context: ['home', 'notifications', 'public', 'thread'],
      filterAction: newFilterAction.value,
    })
    newFilterTitle.value = ''
    newFilterKeywords.value = ''
    toastStore.show({ message: 'Filter created', duration: 2500 })
  } catch {
    /* store sets error */
  } finally {
    isCreatingFilter.value = false
  }
}
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <div class="settings-group">
      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Create filter</legend>
        <form class="settings-filter-form" @submit.prevent="createNewFilter">
          <label class="settings-label">
            <span class="settings-label__text">Title</span>
            <input v-model="newFilterTitle" type="text" class="settings-input" placeholder="Politics" />
          </label>
          <label class="settings-label">
            <span class="settings-label__text">Keywords</span>
            <input
              v-model="newFilterKeywords"
              type="text"
              class="settings-input"
              placeholder="keyword1, keyword2"
            />
          </label>
          <label class="settings-label">
            <span class="settings-label__text">Action</span>
            <select v-model="newFilterAction" class="settings-input">
              <option value="warn">Warn</option>
              <option value="hide">Hide</option>
            </select>
          </label>
          <button
            type="submit"
            class="settings-btn settings-btn--primary"
            :disabled="isCreatingFilter"
          >
            {{ isCreatingFilter ? 'Creating…' : 'Create filter' }}
          </button>
        </form>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Active Filters</legend>
        <p class="settings-hint">Filters hide or warn about posts containing specific words.</p>

        <div v-if="settingsStore.filters.length === 0" class="settings-empty">
          No filters configured
        </div>
        <div v-else class="settings-filter-list">
          <div
            v-for="filter in settingsStore.filters"
            :key="filter.id"
            class="settings-filter-item"
          >
            <div class="settings-filter-info">
              <span class="settings-filter-title">{{ filter.title }}</span>
              <span class="settings-filter-keywords">
                {{ filter.keywords?.map(k => k.keyword).join(', ') }}
              </span>
              <span class="settings-filter-action">
                {{ filter.filterAction === 'hide' ? '🚫 Hidden' : '⚠️ Warning' }}
              </span>
            </div>
            <button
              class="settings-btn settings-btn--small settings-btn--danger"
              type="button"
              :aria-label="`Delete filter ${filter.title}`"
              :disabled="settingsStore.isModerationPending('delete-filter', filter.id)"
              @click="confirmDeleteFilter(filter.id, filter.title)"
            >
              {{ settingsStore.isModerationPending('delete-filter', filter.id) ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>

        <a
          v-if="serverLink('filters')"
          :href="serverLink('filters')!"
          target="_blank"
          rel="noopener noreferrer"
          class="settings-btn settings-btn--ghost"
        >
          Manage Filters on Instance →
        </a>
      </fieldset>
    </div>
  </section>
</template>
