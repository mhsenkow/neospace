<script setup lang="ts">
/**
 * Full-screen / bottom compose sheet for mobile (+ tab) and DM recipient pick.
 * Threads-style: Post lives in the header; footer keeps tools + counter.
 */

import { useComposeSheetStore } from '~/stores/composeSheet'
import { useOverlayStore } from '~/stores/overlay'
import { accountHandle } from '~/composables/useAccountSearch'
import { emitComposedStatus } from '~/composables/useComposedStatus'
import type { mastodon } from 'masto'
import type RealComposeBox from '~/components/RealComposeBox.vue'

const sheet = useComposeSheetStore()
const overlayStore = useOverlayStore()
const panelRef = ref<HTMLElement | null>(null)
const composeRef = ref<InstanceType<typeof RealComposeBox> | null>(null)
const sheetOpen = computed(() => sheet.open)

const { viewportStyle, keyboardOpen, onFocusField } = useKeyboardViewport(sheetOpen, {
  lockScroll: true,
})

const requestClose = async () => {
  // Own text, CW or attachments — a prefilled "@handle " or photo-only post counts right
  const compose = composeRef.value
  if (compose?.isDirty) {
    const ok = await overlayStore.openConfirm({
      title: 'Discard this draft?',
      body: 'Your post will be lost.',
      confirmLabel: 'Discard',
      danger: true,
    })
    if (!ok) return
    // Otherwise the autosaved draft reappears next time this composer opens
    compose.discardDraft()
  }
  sheet.hide()
}

useFocusTrap(panelRef, sheetOpen, {
  onEscape: requestClose,
  // Prefer the composer — Cancel is first in the DOM and stole focus on mobile
  initialFocus:
    'textarea, .compose-input, #recipient-search-input, .group-pick-sheet__input, .neo-sheet-header__close',
})

const onPosted = (status: mastodon.v1.Status) => {
  emitComposedStatus(status)
  sheet.posted(status)
}

const sheetTitleId = 'compose-sheet-title'
const contextExpanded = ref(false)

const isPicking = ref(false)

const headerCanPost = ref(false)
const headerSubmitLabel = ref('Post')
const headerPosting = ref(false)

const syncHeaderActions = () => {
  const box = composeRef.value as
    | {
        canPost?: boolean
        submitLabel?: string
        isPosting?: boolean
      }
    | null
  headerCanPost.value = !!box?.canPost
  headerSubmitLabel.value = box?.submitLabel || 'Post'
  headerPosting.value = !!box?.isPosting
}

watch(
  () => [
    composeRef.value?.canPost,
    composeRef.value?.submitLabel,
    composeRef.value?.isPosting,
    sheet.open,
    sheet.instanceKey,
  ],
  syncHeaderActions,
  { flush: 'post' },
)

const onHeaderPost = () => {
  void composeRef.value?.submit()
}

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
      if (existing.unread) await conversations.markRead(existing.id)
      sheet.hide()
      await router.push(`/status/${existing.lastStatus.id}`)
      return
    }
    sheet.continueWithRecipient(accountHandle(account))
  } catch (e: any) {
    const { useToastStore } = await import('~/stores/toast')
    useToastStore().show({
      message: e?.message || 'Couldn’t open that conversation',
    })
  } finally {
    isPicking.value = false
  }
}
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
          :title="sheet.title || 'New post'"
          :title-id="sheetTitleId"
          :title-sr-only="keyboardOpen"
          @cancel="requestClose"
        >
          <template #trailing>
            <button
              type="button"
              class="compose-sheet__header-post neo-btn neo-btn--primary neo-btn--sm"
              :disabled="!headerCanPost"
              :aria-busy="headerPosting || undefined"
              @click="onHeaderPost"
            >
              {{ headerSubmitLabel }}
            </button>
          </template>
        </NeoSheetHeader>
        <div
          class="compose-sheet__body"
          data-keyboard-scroll
          @focusin="onFocusField"
        >
          <article v-if="sheet.contextPost" class="compose-sheet__context">
            <img
              v-if="sheet.contextPost.avatar"
              :src="sheet.contextPost.avatar"
              alt=""
              class="compose-sheet__context-avatar"
            />
            <div class="compose-sheet__context-body">
              <p class="compose-sheet__context-meta">
                <strong>{{ sheet.contextPost.name }}</strong>
                <span>@{{ sheet.contextPost.handle }}</span>
              </p>
              <p
                class="compose-sheet__context-text"
                :class="{ 'compose-sheet__context-text--collapsed': !contextExpanded }"
              >
                {{ sheet.contextPost.text }}
              </p>
              <button
                v-if="sheet.contextPost.text.length > 120"
                type="button"
                class="compose-sheet__context-toggle"
                :aria-expanded="contextExpanded"
                @click="contextExpanded = !contextExpanded"
              >
                {{ contextExpanded ? 'Show less' : 'Show more' }}
              </button>
            </div>
          </article>
          <RealComposeBox
            ref="composeRef"
            :key="sheet.instanceKey"
            submit-in-header
            :initial-text="sheet.initialText || undefined"
            :initial-visibility="sheet.initialVisibility || undefined"
            :initial-group-tag="sheet.groupTag || undefined"
            :placeholder="sheet.placeholder || undefined"
            :title="sheet.title || undefined"
            :in-reply-to-id="sheet.inReplyToId || undefined"
            :quote-url="sheet.quoteUrl || undefined"
            :quote-context="sheet.contextPost && sheet.quoteUrl ? sheet.contextPost : undefined"
            :accept-handoff="!sheet.inReplyToId && !sheet.quoteUrl"
            @posted="onPosted"
            @vue:updated="syncHeaderActions"
          />
        </div>
      </template>
    </div>
  </NeoSheet>
</template>

<style lang="scss" scoped>
.compose-sheet__inner {
  --compose-pad-x: 0.75rem;
  --compose-pad-y: 0.65rem;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: inherit;
  overflow: hidden;
}

.compose-sheet__header-post {
  min-width: 4.25rem;
  min-height: 36px;
  padding-inline: 0.9rem;
  font-weight: 700;
  touch-action: manipulation;

  &:disabled {
    opacity: 0.45;
  }
}

.compose-sheet__inner--keyboard {
  --compose-pad-x: 0.65rem;
  --compose-pad-y: 0.4rem;

  // Soft keyboard — reclaim chrome so the textarea + Post bar stay usable
  .compose-sheet__context {
    margin-bottom: 0.4rem;
    padding: 0.4rem 0.5rem;
    gap: 0.4rem;
  }

  .compose-sheet__context-avatar {
    width: 28px;
    height: 28px;
  }

  .compose-sheet__context-text,
  .compose-sheet__context-text--collapsed {
    -webkit-line-clamp: 1;
  }

  .compose-sheet__context-toggle {
    display: none;
  }

  :deep(.compose-header) {
    gap: 0.4rem;
    margin-bottom: 0.1rem;
  }

  :deep(.compose-avatar) {
    width: 28px;
    height: 28px;
  }

  :deep(.compose-title) {
    font-size: 0.8125rem;
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

  :deep(.compose-media__alt-input) {
    min-height: 2rem;
    max-height: 3rem;
  }

  :deep(.compose-handoff) {
    padding: 0.3rem 0.45rem;
    font-size: 0.75rem;
  }

  :deep(.compose-footer) {
    padding: 0.35rem var(--compose-pad-x);
    padding-bottom: 0.35rem;
    gap: 0.35rem;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }

  :deep(.compose-language),
  :deep(.compose-media-count) {
    display: none;
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
  padding-bottom: 0;
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
    min-height: 7rem;
  }

  :deep(.compose-input) {
    flex: 1;
    min-height: 7rem;
    max-height: none;
    /* Absolute 16px — root rem is 15px; iOS zooms anything smaller */
    font-size: max(16px, 1rem);
    line-height: 1.45;
  }

  :deep(.compose-footer) {
    position: sticky;
    bottom: 0;
    z-index: 2;
    margin-top: auto;
    margin-inline: calc(-1 * var(--compose-pad-x));
    padding: 0.5rem var(--compose-pad-x);
    padding-bottom: max(0.5rem, env(safe-area-inset-bottom, 0px));
    background: color-mix(in srgb, var(--neo-bg-primary) 94%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 1px solid var(--neo-border-color);
  }
}

.compose-sheet__context-text--collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.compose-sheet__context-toggle {
  min-height: 24px;
  margin: 0.25rem 0 0;
  padding: 0;
  border: none;
  background: none;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-link);
  cursor: pointer;
}

.compose-sheet__context {
  display: flex;
  gap: 0.65rem;
  margin: 0 0 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: 12px;
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
}

.compose-sheet__context-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.compose-sheet__context-body {
  min-width: 0;
  flex: 1;
}

.compose-sheet__context-meta {
  margin: 0 0 0.25rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);

  strong {
    color: var(--neo-text-primary);
    font-weight: 600;
  }

  // Long remote handles wrap at 320px instead of widening the sheet
  strong,
  span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.compose-sheet__context-text {
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--neo-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
