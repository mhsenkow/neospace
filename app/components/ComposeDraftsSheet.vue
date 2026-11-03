<script setup lang="ts">
/**
 * Threads-style drafts picker opened from the New thread header.
 */
import {
  draftGroupTag,
  draftQuoteUrl,
  draftReplyTarget,
  listAccountDrafts,
  type ListedDraft,
} from '~/composables/useDraft'
import { useInstancesStore } from '~/stores/instances'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useToastStore } from '~/stores/toast'
import { useSettingsStore } from '~/stores/settings'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const instances = useInstancesStore()
const composeSheet = useComposeSheetStore()
const toast = useToastStore()
const settings = useSettingsStore()

const drafts = ref<ListedDraft[]>([])
const sheetRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => props.open)

const refresh = () => {
  const id = instances.activeAccountId
  drafts.value = id ? listAccountDrafts(id) : []
}

watch(
  () => [props.open, instances.activeAccountId] as const,
  ([open]) => {
    if (open) refresh()
  },
)

useFocusTrap(sheetRef, isOpen, {
  onEscape: () => emit('close'),
  initialFocus: '.compose-drafts__item, .compose-drafts__empty-action, .action-sheet__cancel',
})

const labelFor = (key: string) => {
  if (key === 'new') return 'New thread'
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
  emit('close')
  composeSheet.show({
    title: labelFor(d.key),
    draftSlot: d.key,
    inReplyToId: draftReplyTarget(d.key),
    groupTag: draftGroupTag(d.key),
    quoteUrl: draftQuoteUrl(d.key),
    initialText: d.text,
    spoilerText: d.spoiler || undefined,
    visibility: d.visibility || undefined,
  })
}

const discardDraft = (d: ListedDraft) => {
  try {
    localStorage.removeItem(d.storageKey)
    if (localStorage.getItem(d.storageKey) !== null) throw new Error('not removed')
  } catch {
    refresh()
    toast.show({ message: 'Couldn’t discard this draft — browser storage is unavailable.', duration: 5000 })
    return
  }
  refresh()
  toast.show({ message: 'Draft discarded', duration: 2500 })
}

const openAllInSettings = () => {
  emit('close')
  composeSheet.hide()
  settings.open('posting')
}
</script>

<template>
  <Teleport to="body">
    <Transition appear name="action-sheet">
      <div
        v-if="open"
        ref="sheetRef"
        class="action-sheet compose-drafts"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-drafts-title"
      >
        <button
          type="button"
          class="action-sheet__backdrop"
          tabindex="-1"
          aria-hidden="true"
          @click="emit('close')"
        />
        <div class="action-sheet__panel">
          <p id="compose-drafts-title" class="action-sheet__title">Drafts</p>
          <p v-if="!drafts.length" class="compose-drafts__empty">No saved drafts for this account.</p>
          <ul v-else class="compose-drafts__list">
            <li v-for="d in drafts" :key="d.storageKey" class="compose-drafts__row">
              <button type="button" class="compose-drafts__item" @click="openDraft(d)">
                <span class="compose-drafts__badge">{{ labelFor(d.key) }}</span>
                <span class="compose-drafts__text">{{ preview(d) }}</span>
              </button>
              <button
                type="button"
                class="compose-drafts__discard"
                :aria-label="`Discard draft: ${preview(d)}`"
                @click="discardDraft(d)"
              >
                Discard
              </button>
            </li>
          </ul>
          <button
            type="button"
            class="compose-drafts__empty-action"
            @click="openAllInSettings"
          >
            Manage in Settings
          </button>
          <button type="button" class="action-sheet__cancel" @click="emit('close')">Cancel</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.compose-drafts {
  z-index: 220;
}

.action-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.action-sheet__panel {
  position: relative;
  z-index: 1;
  margin: 0 0.5rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  padding: 0.4rem 0.4rem 0.5rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px;
  max-height: calc(100dvh - 1rem - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  overscroll-behavior: contain;

  @media (min-width: 640px) {
    align-self: center;
    width: 100%;
    max-width: 22rem;
    margin-bottom: 1.5rem;
  }
}

.action-sheet {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.action-sheet__title {
  margin: 0.35rem 0.75rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.action-sheet__cancel {
  display: block;
  width: 100%;
  margin-top: 0.35rem;
  min-height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  font-weight: 600;
  cursor: pointer;
}

.compose-drafts__empty {
  margin: 0.5rem 0.75rem 0.75rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
}

.compose-drafts__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.compose-drafts__row {
  display: flex;
  gap: 0.35rem;
  align-items: stretch;
}

.compose-drafts__item {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.7rem 0.75rem;
  border: none;
  border-radius: 12px;
  background: var(--neo-bg-tertiary);
  color: inherit;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--neo-bg-hover);
  }
}

.compose-drafts__badge {
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.compose-drafts__text {
  font-size: 0.875rem;
  line-height: 1.35;
  color: var(--neo-text-primary);
  overflow-wrap: anywhere;
}

.compose-drafts__discard {
  flex-shrink: 0;
  padding: 0 0.65rem;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--neo-danger, #e5484d);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
}

.compose-drafts__empty-action {
  display: block;
  width: 100%;
  margin-top: 0.35rem;
  min-height: 44px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--neo-link);
  font-weight: 600;
  cursor: pointer;
}

.action-sheet-enter-active,
.action-sheet-leave-active {
  transition: opacity 0.18s ease;

  .action-sheet__panel {
    transition: transform 0.22s ease;
  }
}

.action-sheet-enter-from,
.action-sheet-leave-to {
  opacity: 0;

  .action-sheet__panel {
    transform: translateY(12px);
  }
}
</style>
