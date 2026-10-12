<script setup lang="ts">
/**
 * Account-scoped saved compose drafts (text / CW / visibility only).
 * Attachments are never restored from localStorage — see useDraft.ts.
 */
import { listAccountDrafts, type ListedDraft } from '~/composables/useDraft'
import { useInstancesStore } from '~/stores/instances'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useToastStore } from '~/stores/toast'

const instances = useInstancesStore()
const composeSheet = useComposeSheetStore()
const toast = useToastStore()

const drafts = ref<ListedDraft[]>([])

const refresh = () => {
  const id = instances.activeAccountId
  drafts.value = id ? listAccountDrafts(id) : []
}

watch(
  () => instances.activeAccountId,
  () => refresh(),
  { immediate: true },
)

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', refresh)
  }
})
onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('storage', refresh)
  }
})

const labelFor = (key: string) => {
  if (key === 'new') return 'New post'
  if (key.startsWith('reply:')) return 'Reply'
  if (key.startsWith('quote:')) return 'Quote'
  if (key.startsWith('dm:')) return 'Message'
  if (key.startsWith('group:')) return `#${key.slice(6)}`
  return key
}

const preview = (d: ListedDraft) => {
  const t = (d.spoiler ? `[${d.spoiler}] ` : '') + d.text
  return t.length > 120 ? `${t.slice(0, 117)}…` : t
}

const openDraft = (d: ListedDraft) => {
  composeSheet.show({
    title: labelFor(d.key),
    initialText: d.text,
    spoilerText: d.spoiler || undefined,
    visibility: d.visibility || undefined,
  })
}

const discardDraft = (d: ListedDraft) => {
  try {
    localStorage.removeItem(d.storageKey)
  } catch {
    /* ignore */
  }
  refresh()
  toast.show({ message: 'Draft discarded', duration: 2500 })
}
</script>

<template>
  <div v-if="instances.isAuthenticated" class="settings-group settings-drafts">
    <h3 class="settings-subheading">Saved drafts</h3>
    <p class="settings-hint">
      Text, content warning, and visibility only — media and polls are not stored in drafts.
    </p>
    <p v-if="!drafts.length" class="settings-hint">No saved drafts for this account.</p>
    <ul v-else class="settings-drafts__list">
      <li v-for="d in drafts" :key="d.storageKey" class="settings-drafts__item">
        <div class="settings-drafts__meta">
          <span class="settings-drafts__badge">{{ labelFor(d.key) }}</span>
        </div>
        <p class="settings-drafts__text">{{ preview(d) }}</p>
        <div class="settings-drafts__actions">
          <button type="button" class="neo-btn neo-btn--sm neo-btn--primary" @click="openDraft(d)">
            Open
          </button>
          <button type="button" class="neo-btn neo-btn--sm neo-btn--ghost" @click="discardDraft(d)">
            Discard
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;

.settings-drafts {
  margin-top: 1rem;
}

.settings-drafts__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.settings-drafts__item {
  padding: 0.75rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  background: var(--neo-bg-secondary);
}

.settings-drafts__meta {
  margin-bottom: 0.35rem;
}

.settings-drafts__badge {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--neo-text-muted);
}

.settings-drafts__text {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--neo-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.settings-drafts__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
</style>
