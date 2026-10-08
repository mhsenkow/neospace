<script setup lang="ts">
/**
 * Full-screen / bottom compose sheet for mobile (+ tab) and DM recipient pick.
 */

import { useComposeSheetStore } from '~/stores/composeSheet'
import { useOverlayStore } from '~/stores/overlay'
import { accountHandle } from '~/composables/useAccountSearch'
import { emitComposedStatus } from '~/composables/useComposedStatus'
import type { mastodon } from 'masto'

const sheet = useComposeSheetStore()
const overlayStore = useOverlayStore()
const panelRef = ref<HTMLElement | null>(null)
const sheetOpen = computed(() => sheet.open)

const { viewportStyle, onFocusField } = useKeyboardViewport(sheetOpen, {
  lockScroll: true,
})

const requestClose = async () => {
  const draft = panelRef.value?.querySelector<HTMLTextAreaElement>('textarea.compose-input, .compose-input')
  const dirty = !!(draft?.value?.trim())
  if (dirty) {
    const ok = await overlayStore.openConfirm({
      title: 'Discard this draft?',
      body: 'Your post will be lost.',
      confirmLabel: 'Discard',
      danger: true,
    })
    if (!ok) return
  }
  sheet.hide()
}

useFocusTrap(panelRef, sheetOpen, {
  onEscape: requestClose,
  // Prefer the composer — Cancel is first in the DOM and stole focus on mobile
  initialFocus: 'textarea, .compose-input, #recipient-search-input, .group-pick-sheet__input, .compose-sheet__close',
})

const onPosted = (status: mastodon.v1.Status) => {
  emitComposedStatus(status)
  sheet.posted(status)
}

const sheetTitleId = 'compose-sheet-title'
const contextExpanded = ref(false)

const isPicking = ref(false)

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
    :viewport-style="viewportStyle"
    @close="requestClose"
  >
    <div
      ref="panelRef"
      class="compose-sheet__inner"
      :style="viewportStyle"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="sheet.pickRecipient ? 'recipient-picker-title' : sheetTitleId"
    >
          <RecipientPicker
            v-if="sheet.pickRecipient"
            @select="onPick"
            @cancel="sheet.hide()"
          />
          <template v-else>
            <NeoSheetHeader
              :title="sheet.title || 'New post'"
              :title-id="sheetTitleId"
              @cancel="requestClose"
            />
            <div class="compose-sheet__body" @focusin="onFocusField">
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
                    @click="contextExpanded = !contextExpanded"
                  >
                    {{ contextExpanded ? 'Show less' : 'Show more' }}
                  </button>
                </div>
              </article>
              <RealComposeBox
                :key="sheet.instanceKey"
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
              />
            </div>
          </template>
    </div>
  </NeoSheet>
</template>

<style lang="scss" scoped>
.compose-sheet__inner {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: inherit;
  overflow: hidden;
}

.compose-sheet__header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.compose-sheet__close {
  min-width: auto;
  min-height: 40px;
  padding: 0.35rem 0.65rem;
  font-size: 0.875rem;
  font-weight: 600;
}

.compose-sheet__title {
  flex: 1;
  text-align: center;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.compose-sheet__spacer {
  width: 4.5rem;
}

.compose-sheet__body {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 0.85rem 0.85rem 0.65rem;
  padding-bottom: max(0.85rem, env(safe-area-inset-bottom, 0px));
  -webkit-overflow-scrolling: touch;
  flex: 1;
  min-height: 0;

  :deep(.compose) {
    flex: 1;
    min-height: 0;
    height: 100%;
    border: none;
    box-shadow: none;
    background: transparent;
    padding: 0;
  }

  :deep(.compose-input-wrap) {
    flex: 1;
    min-height: 10rem;
  }

  :deep(.compose-input) {
    flex: 1;
    min-height: 10rem;
    max-height: none;
    /* ≥16px avoids iOS auto-zoom on focus */
    font-size: 1rem;
    line-height: 1.45;
  }

  :deep(.compose-footer) {
    margin-top: auto;
  }
}

.compose-sheet__context-text--collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.compose-sheet__context-toggle {
  margin: 0.35rem 0 0;
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
  margin: 0 0 0.85rem;
  padding: 0.75rem 0.85rem;
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
}

.compose-sheet__context-text {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--neo-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.compose-sheet-enter-active,
.compose-sheet-leave-active {
  transition: opacity 0.2s ease;

  .compose-sheet__panel {
    transition: transform 0.22s ease;
  }
}

.compose-sheet-enter-from,
.compose-sheet-leave-to {
  opacity: 0;

  .compose-sheet__panel {
    transform: translateY(100%);
  }
}

@media (min-width: 1024px) and (hover: hover) and (pointer: fine) {
  .compose-sheet-enter-from,
  .compose-sheet-leave-to {
    .compose-sheet__panel {
      transform: translateY(12px) scale(0.98);
    }
  }
}
</style>
