<script setup lang="ts">
/**
 * Full-screen / bottom compose sheet — Threads-style New thread modal.
 * Header: Cancel · title · Drafts + More. Footer: Post Options · Post.
 */

import { useComposeSheetStore } from '~/stores/composeSheet'
import { useOverlayStore } from '~/stores/overlay'
import { accountHandle } from '~/composables/useAccountSearch'
import { isRedraftSlot } from '~/composables/useDraft'
import { useToastStore } from '~/stores/toast'
import { useSettingsStore } from '~/stores/settings'
import type { mastodon } from 'masto'
import type RealComposeBox from '~/components/RealComposeBox.vue'

const sheet = useComposeSheetStore()
const overlayStore = useOverlayStore()
const settingsStore = useSettingsStore()
const panelRef = ref<HTMLElement | null>(null)
const composeRef = ref<InstanceType<typeof RealComposeBox> | null>(null)
const sheetOpen = computed(() => sheet.open)
const draftsOpen = ref(false)
const moreOpen = ref(false)

const { viewportStyle, keyboardOpen, onFocusField } = useKeyboardViewport(sheetOpen, {
  lockScroll: true,
})

/** "attachments, poll and scheduled time" */
const listOf = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || ''

const requestClose = async () => {
  const compose = composeRef.value
  if (compose?.isDirty) {
    const extras: string[] = compose.unsavedExtras ?? []
    const canSave = !isRedraftSlot(sheet.draftSlot) && !!compose.hasDraftText
    const extrasNote = extras.length ? ` Your ${listOf(extras)} won’t be saved with it.` : ''
    const choice = await overlayStore.openChoice({
      title: 'Close this post?',
      body: canSave
        ? `Save it as a draft to finish later, or discard it. Drafts keep text, content warning and visibility only.${extrasNote}`
        : extras.length && !compose.hasDraftText
          ? `Your ${listOf(extras)} will be lost.`
          : `Your post will be lost.${extrasNote}`,
      secondaryLabel: canSave ? 'Save draft and close' : undefined,
      confirmLabel: 'Discard',
      danger: true,
    })
    if (choice === 'cancel') return
    if (choice === 'secondary') {
      const failure = compose.saveDraft()
      if (failure) {
        useToastStore().show({ message: failure, duration: 6000 })
        return
      }
    } else {
      compose.discardDraft()
    }
  }
  sheet.hide()
}

useFocusTrap(panelRef, sheetOpen, {
  onEscape: requestClose,
  initialFocus:
    'textarea, .compose-input, #recipient-search-input, .group-pick-sheet__input, .neo-sheet-header__close',
})

const onPosted = (status: mastodon.v1.Status) => {
  // RealComposeBox already fan-outs via emitComposedStatus (including multi-segment chains)
  sheet.posted(status)
}

const onScheduled = (scheduled: mastodon.v1.ScheduledStatus) => {
  let when = scheduled.scheduledAt
  try {
    when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(scheduled.scheduledAt),
    )
  } catch {
    // keep ISO
  }
  useToastStore().show({ message: `Scheduled for ${when}`, duration: 3500 })
  sheet.hide()
}

const sheetTitleId = 'compose-sheet-title'
const isPicking = ref(false)

const footerCanPost = ref(false)
const footerSubmitLabel = ref('Post')
const footerPosting = ref(false)

const syncFooterActions = () => {
  const box = composeRef.value as
    | {
        canPost?: boolean
        submitLabel?: string
        isPosting?: boolean
      }
    | null
  footerCanPost.value = !!box?.canPost
  footerSubmitLabel.value = box?.submitLabel || 'Post'
  footerPosting.value = !!box?.isPosting
}

watch(
  () => [
    composeRef.value?.canPost,
    composeRef.value?.submitLabel,
    composeRef.value?.isPosting,
    sheet.open,
    sheet.instanceKey,
  ],
  syncFooterActions,
  { flush: 'post' },
)

watch(
  () => sheet.open,
  (open) => {
    if (!open) {
      draftsOpen.value = false
      moreOpen.value = false
    }
  },
)

const onFooterPost = () => {
  void composeRef.value?.submit()
}

const openPostOptions = () => {
  composeRef.value?.openPostOptions?.()
}

const openDrafts = () => {
  draftsOpen.value = true
}

const onMoreSelect = async (id: string) => {
  moreOpen.value = false
  if (id === 'drafts') {
    openDrafts()
    return
  }
  if (id === 'settings-drafts') {
    sheet.hide()
    settingsStore.open('posting')
    return
  }
  if (id === 'discard') {
    await requestClose()
  }
}

const moreActions = [
  { id: 'drafts', label: 'Drafts' },
  { id: 'settings-drafts', label: 'Manage drafts in Settings' },
  { id: 'discard', label: 'Discard', danger: true },
]

const onPick = async (account: mastodon.v1.Account) => {
  if (isPicking.value) return
  isPicking.value = true
  try {
    const { useConversationsStore } = await import('~/stores/conversations')
    const conversations = useConversationsStore()
    const router = useRouter()
    if (!conversations.conversations.length) {
      await conversations.fetchConversations({ quiet: true })
    }
    const existing = conversations.findDirectWith(account.id)
    if (existing?.lastStatus?.id) {
      if (existing.unread) void conversations.markRead(existing.id)
      sheet.hide()
      await router.push(`/status/${existing.lastStatus.id}`)
      return
    }
    sheet.continueWithRecipient(accountHandle(account))
  } catch (e: any) {
    useToastStore().show({
      message: e?.message || 'Couldn’t open that conversation',
    })
  } finally {
    isPicking.value = false
  }
}

const sheetTitle = computed(() => sheet.title || 'New thread')

const replyPlaceholder = computed(() => {
  if (sheet.placeholder) return sheet.placeholder
  if (sheet.inReplyToId) return 'Share your thoughts…'
  if (sheet.quoteUrl) return 'Add a comment…'
  if (sheet.initialModality === 'media') return 'Add a caption…'
  if (sheet.initialModality === 'voice') return 'Say something…'
  return "What's new?"
})
</script>

<template>
  <NeoSheet
    :open="sheet.open"
    :z-index="200"
    max-height="100%"
    :viewport-style="viewportStyle"
    @close="requestClose"
  >
    <div
      ref="panelRef"
      class="compose-sheet__inner"
      :class="{ 'compose-sheet__inner--keyboard': keyboardOpen }"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="sheet.pickRecipient ? 'recipient-picker-title' : sheetTitleId"
    >
      <RecipientPicker
        v-if="sheet.pickRecipient"
        :keyboard-open="keyboardOpen"
        @select="onPick"
        @cancel="sheet.hide()"
        @focusin="onFocusField"
      />
      <template v-else>
        <NeoSheetHeader
          :title="sheetTitle"
          :title-id="sheetTitleId"
          :title-sr-only="keyboardOpen"
          center-title
          @cancel="requestClose"
        >
          <template #trailing>
            <div class="compose-sheet__header-actions">
              <button
                type="button"
                class="compose-sheet__icon-btn"
                aria-label="Drafts"
                title="Drafts"
                @click="openDrafts"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="13" y2="17" />
                </svg>
              </button>
              <NeoMenu
                v-model:open="moreOpen"
                class="compose-sheet__more"
                label="More compose options"
                align="end"
                teleport
              >
                <NeoIcon name="more" :size="20" :stroke="2" />
                <template #items>
                  <button
                    v-for="action in moreActions"
                    :key="action.id"
                    type="button"
                    role="menuitem"
                    class="compose-sheet__menu-item"
                    :class="{ 'compose-sheet__menu-item--danger': action.danger }"
                    @click="onMoreSelect(action.id)"
                  >
                    {{ action.label }}
                  </button>
                </template>
              </NeoMenu>
            </div>
          </template>
        </NeoSheetHeader>

        <div
          class="compose-sheet__body"
          data-keyboard-scroll
          @focusin="onFocusField"
        >
          <RealComposeBox
            ref="composeRef"
            :key="sheet.instanceKey"
            threads-layout
            submit-in-header
            :initial-text="sheet.initialText || undefined"
            :initial-spoiler="sheet.initialSpoiler || undefined"
            :draft-slot="sheet.draftSlot || undefined"
            :initial-visibility="sheet.initialVisibility || undefined"
            :initial-group-tag="sheet.groupTag || undefined"
            :initial-modality="sheet.initialModality || undefined"
            :placeholder="replyPlaceholder"
            :title="sheetTitle"
            :in-reply-to-id="sheet.inReplyToId || undefined"
            :quote-url="sheet.quoteUrl || undefined"
            :quote-context="sheet.contextPost && sheet.quoteUrl ? sheet.contextPost : undefined"
            :reply-context="sheet.contextPost && !sheet.quoteUrl ? sheet.contextPost : undefined"
            :mention-accts="sheet.mentionAccts || undefined"
            :accept-handoff="!sheet.inReplyToId && !sheet.quoteUrl"
            @posted="onPosted"
            @scheduled="onScheduled"
            @vue:updated="syncFooterActions"
          />
        </div>

        <footer class="compose-sheet__footer">
          <button
            type="button"
            class="compose-sheet__post-options"
            @click="openPostOptions"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
              <line x1="4" y1="21" x2="4" y2="14" />
              <line x1="4" y1="10" x2="4" y2="3" />
              <line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" />
              <line x1="20" y1="21" x2="20" y2="16" />
              <line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" />
              <line x1="9" y1="8" x2="15" y2="8" />
              <line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            <span>Post Options</span>
          </button>
          <button
            type="button"
            class="compose-sheet__footer-post neo-btn neo-btn--primary neo-btn--sm"
            :disabled="!footerCanPost"
            :aria-busy="footerPosting || undefined"
            @click="onFooterPost"
          >
            {{ footerSubmitLabel }}
          </button>
        </footer>
      </template>
    </div>
  </NeoSheet>

  <ComposeDraftsSheet :open="draftsOpen" @close="draftsOpen = false" />
</template>

<style lang="scss" scoped>
.compose-sheet__inner {
  --compose-pad-x: 0.85rem;
  --compose-pad-y: 0.65rem;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: inherit;
  overflow: hidden;
}

.compose-sheet__header-actions {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.compose-sheet__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: none;
  border-radius: var(--neo-radius-sm, 4px);
  background: transparent;
  color: var(--neo-text-secondary);
  cursor: pointer;
  touch-action: manipulation;

  &:hover,
  &:focus-visible {
    background: var(--neo-bg-hover);
    color: var(--neo-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }
}

.compose-sheet__more {
  :deep(.neo-menu__trigger) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: none;
    border-radius: var(--neo-radius-sm, 4px);
    background: transparent;
    color: var(--neo-text-secondary);
    cursor: pointer;

    &:hover,
    &:focus-visible {
      background: var(--neo-bg-hover);
      color: var(--neo-text-primary);
    }
  }
}

.compose-sheet__menu-item {
  display: block;
  width: 100%;
  min-height: 40px;
  padding: 0.55rem 0.85rem;
  border: none;
  background: transparent;
  color: var(--neo-text-primary);
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--neo-bg-hover);
  }

  &--danger {
    color: var(--neo-danger, #e5484d);
  }
}

.compose-sheet__inner--keyboard {
  --compose-pad-x: 0.65rem;
  --compose-pad-y: 0.4rem;

  :deep(.compose-header),
  :deep(.compose-thread__author) {
    gap: 0.35rem;
    margin-bottom: 0.1rem;
  }

  :deep(.compose-avatar) {
    width: 28px;
    height: 28px;
  }

  :deep(.compose-input-wrap),
  :deep(.compose-input) {
    flex: 1 1 auto;
    min-height: 3.25rem;
  }

  :deep(.compose-media) {
    gap: 0.4rem;
  }

  :deep(.compose-media__item) {
    grid-template-columns: 56px minmax(0, 1fr);
  }

  :deep(.compose-handoff) {
    padding: 0.3rem 0.45rem;
    font-size: 0.75rem;
  }

  .compose-sheet__footer {
    padding: 0.4rem var(--compose-pad-x);
    padding-bottom: max(0.4rem, env(safe-area-inset-bottom, 0px));
  }

  :deep(.compose-counter) {
    font-size: 0.6875rem;
  }
}

.compose-sheet__body {
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--compose-pad-y) var(--compose-pad-x);
  padding-bottom: 0.5rem;
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-height: 0;

  :deep(.compose) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: auto;
    border: none;
    box-shadow: none;
    background: transparent;
    padding: 0;
  }

  :deep(.compose-input-wrap) {
    flex: 1 1 auto;
    min-height: 5.5rem;
  }

  :deep(.compose-input) {
    flex: 1;
    min-height: 5.5rem;
    max-height: none;
    font-size: max(16px, 1rem);
    line-height: 1.45;
  }

  :deep(.compose-footer) {
    position: static;
    margin: 0;
    padding: 0.35rem 0 0;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-top: none;
  }
}

.compose-sheet__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-shrink: 0;
  padding: 0.65rem var(--compose-pad-x);
  padding-bottom: max(0.65rem, env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--neo-border-color);
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
}

.compose-sheet__post-options {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 40px;
  padding: 0.35rem 0.15rem;
  border: none;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;

  &:hover,
  &:focus-visible {
    color: var(--neo-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }
}

.compose-sheet__footer-post {
  min-width: 4.5rem;
  min-height: 36px;
  padding-inline: 1rem;
  font-weight: 700;
  border-radius: 10px;
  touch-action: manipulation;

  &:disabled {
    opacity: 0.4;
  }
}

/* Phone landscape: keep footer + textarea usable above soft keyboard */
@media (max-height: 500px) and (orientation: landscape) {
  .compose-sheet__inner {
    --compose-pad-x: 0.55rem;
    --compose-pad-y: 0.25rem;
  }

  .compose-sheet__body {
    padding-bottom: 0.25rem;

    :deep(.compose-input-wrap),
    :deep(.compose-input) {
      min-height: 3rem;
    }
  }

  .compose-sheet__footer {
    min-height: 38px;
    padding: 0.25rem var(--compose-pad-x);
    padding-bottom: max(0.25rem, env(safe-area-inset-bottom, 0px));
  }

  .compose-sheet__post-options {
    min-height: 36px;
    padding: 0.2rem 0.1rem;
  }

  .compose-sheet__footer-post {
    min-height: 34px;
  }
}
</style>
