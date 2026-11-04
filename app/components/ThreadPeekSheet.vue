<script setup lang="ts">
/**
 * Mobile hammock-mode thread peek — existing replies + sticky quick reply.
 * Keeps feed/Flip scroll position; Expand hands off to full ComposeSheet.
 */
import type { mastodon } from 'masto'
import { useOverlayStore } from '~/stores/overlay'
import { useStatusStore } from '~/stores/status'
import { useComposeSheetStore } from '~/stores/composeSheet'
import { useToastStore } from '~/stores/toast'
import { useInstancesStore } from '~/stores/instances'
import { stripHtml } from '~/utils/stripHtml'
import { sanitizeStatusHtml } from '~/utils/sanitizeHtml'
import { logWarn } from '~/utils/log'
import { activeClient } from '~/composables/useMasto'

const REACTION_CHIPS = ['❤️', '🔥', '👏', '😂', '💯'] as const

const overlay = useOverlayStore()
const statusStore = useStatusStore()
const composeSheet = useComposeSheetStore()
const toast = useToastStore()
const instances = useInstancesStore()

const open = computed(() => overlay.threadPeek.open)
const parent = computed(() => overlay.threadPeek.status)
const focusInput = computed(() => overlay.threadPeek.focusInput)

const { viewportStyle, onFocusField } = useKeyboardViewport(open, { lockScroll: true })

const panelRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const draft = ref('')
const replyTargetAcct = ref<string | null>(null)
const sending = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)
const replyId = ref<string | null>(null)
const replies = ref<mastodon.v1.Status[]>([])
const liking = reactive(new Set<string>())

const titleId = 'thread-peek-title'
const parentPreview = computed(() => {
  const s = parent.value
  if (!s) return ''
  return stripHtml(s.content || '').slice(0, 160)
})
const parentHandle = computed(() => parent.value?.account.acct || '')
const placeholder = computed(() => {
  const handle = replyTargetAcct.value || parentHandle.value
  return handle ? `Reply to @${handle}…` : 'Write a reply…'
})

useFocusTrap(panelRef, open, {
  onEscape: () => overlay.closeThreadPeek(),
  // Mounted lazily when peek opens, so focusInput is already set for this session
  initialFocus: overlay.threadPeek.focusInput
    ? '.thread-peek__input'
    : '.thread-peek__close, .thread-peek__input',
})

const formatCount = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

const loadThread = async () => {
  const s = parent.value
  if (!s) return
  loading.value = true
  loadError.value = null
  replies.value = []
  replyId.value = null
  try {
    const resolved = await statusStore.resolveThreadId({
      id: s.id,
      url: s.url || s.uri || null,
    })
    if (!overlay.threadPeek.open || overlay.threadPeek.status?.id !== s.id) return
    if (!resolved) {
      // Fall back to reply-id resolution for posting even if context fails
      const forReply = await statusStore.resolveReplyId({
        id: s.id,
        url: s.url || s.uri || null,
        uri: s.uri,
        sourceInstanceUrl: (s as mastodon.v1.Status & { _instanceUrl?: string })._instanceUrl || null,
      })
      replyId.value = forReply
      if (!forReply) loadError.value = 'Couldn’t load this thread on your server'
      return
    }
    replyId.value = resolved
    const thread = await statusStore.fetchThread(resolved)
    if (!overlay.threadPeek.open || overlay.threadPeek.status?.id !== s.id) return
    replies.value = thread.descendants || []
  } catch (e) {
    logWarn('thread peek load failed', e)
    if (overlay.threadPeek.open) loadError.value = 'Couldn’t load replies'
  } finally {
    loading.value = false
  }
}

watch(
  () => [overlay.threadPeek.open, overlay.threadPeek.status?.id] as const,
  ([isOpen]) => {
    if (!isOpen) {
      draft.value = ''
      replyTargetAcct.value = null
      replies.value = []
      replyId.value = null
      loadError.value = null
      return
    }
    void loadThread()
    if (focusInput.value) {
      nextTick(() => {
        inputRef.value?.focus()
        onFocusField({ target: inputRef.value } as unknown as FocusEvent)
      })
    }
  },
)

const openFullThread = () => {
  const s = parent.value
  if (!s?.id) return
  const url = s.url || s.uri
  // Prefer the resolved home-server id so the full page doesn't re-resolve from a
  // foreign status id (peek → full continuity).
  const id = replyId.value || s.id
  const draftText = draft.value.trim()
  overlay.closeThreadPeek()
  void navigateTo({
    path: `/status/${id}`,
    query: {
      ...(url ? { url } : {}),
      ...(draftText ? { compose: '1', draft: draftText.slice(0, 500) } : {}),
    },
  })
}

const setReplyTarget = (acct: string) => {
  replyTargetAcct.value = acct
  const mention = `@${acct}`
  if (!draft.value.includes(mention)) {
    draft.value = draft.value.trim() ? `${draft.value.trim()} ${mention} ` : `${mention} `
  }
  nextTick(() => inputRef.value?.focus())
}

const buildReplyText = (raw: string) => {
  const text = raw.trim()
  if (!text) return ''
  // Public replies mention on send (same as RealPostCard openReplyComposer)
  const handle = parentHandle.value
  if (!handle) return text
  const mention = `@${handle}`
  if (text.includes(mention) || replyTargetAcct.value) return text
  return `${mention} ${text}`
}

const sendReply = async (raw: string) => {
  if (sending.value || !instances.hasAuthenticatedInstance) {
    if (!instances.hasAuthenticatedInstance) void navigateTo('/login')
    return
  }
  const text = buildReplyText(raw)
  if (!text) return
  let inReplyToId = replyId.value
  if (!inReplyToId && parent.value) {
    inReplyToId = await statusStore.resolveReplyId({
      id: parent.value.id,
      url: parent.value.url || parent.value.uri || null,
      uri: parent.value.uri,
      sourceInstanceUrl:
        (parent.value as mastodon.v1.Status & { _instanceUrl?: string })._instanceUrl || null,
    })
    replyId.value = inReplyToId
  }
  if (!inReplyToId) {
    toast.show({ message: 'Couldn’t find this post on your server to reply', duration: 4000 })
    return
  }
  sending.value = true
  try {
    const created = await statusStore.postStatus(text, {
      inReplyToId,
      visibility: parent.value?.visibility === 'direct' ? 'direct' : parent.value?.visibility || 'public',
    })
    if ('scheduledAt' in created) {
      toast.show({ message: 'Reply scheduled', duration: 2800 })
    } else {
      replies.value = [...replies.value, created]
      if (parent.value) {
        parent.value.repliesCount = (parent.value.repliesCount || 0) + 1
      }
      overlay.notifyThreadPeekReplied(created)
      draft.value = ''
      replyTargetAcct.value = null
      toast.show({ message: 'Reply posted', duration: 2200 })
    }
  } catch (e) {
    toast.show({
      message: e instanceof Error ? e.message : 'Couldn’t post reply',
      duration: 4000,
    })
  } finally {
    sending.value = false
  }
}

const onSend = () => void sendReply(draft.value)

const onChip = (emoji: string) => {
  if (draft.value.trim()) {
    draft.value = `${draft.value.trim()} ${emoji}`
    return
  }
  void sendReply(emoji)
}

const expandToCompose = () => {
  const s = parent.value
  if (!s) return
  const handle = parentHandle.value
  const isDm = s.visibility === 'direct'
  const text = draft.value
  overlay.closeThreadPeek()
  composeSheet.show({
    title: isDm ? 'Message' : 'New thread',
    placeholder: isDm ? `Message @${handle}…` : 'Share your thoughts…',
    initialText: text || (isDm ? `@${handle} ` : ''),
    mentionAccts: isDm || text.includes(`@${handle}`) ? undefined : handle ? [handle] : undefined,
    inReplyToId: replyId.value || undefined,
    visibility: isDm ? 'direct' : s.visibility,
    contextPost: {
      id: s.id,
      name: s.account.displayName || s.account.username,
      handle: s.account.acct,
      avatar: s.account.avatar,
      text: stripHtml(s.content).slice(0, 280),
      url: s.url || s.uri,
    },
    onPosted: (created) => {
      overlay.notifyThreadPeekReplied(created)
    },
  })
}

const toggleLike = async (status: mastodon.v1.Status) => {
  if (!instances.hasAuthenticatedInstance || liking.has(status.id)) return
  liking.add(status.id)
  const want = !status.favourited
  status.favourited = want
  status.favouritesCount = Math.max(0, (status.favouritesCount || 0) + (want ? 1 : -1))
  try {
    const client = activeClient()
    if (want) await client.v1.statuses.$select(status.id).favourite()
    else await client.v1.statuses.$select(status.id).unfavourite()
  } catch {
    status.favourited = !want
    status.favouritesCount = Math.max(0, (status.favouritesCount || 0) + (want ? -1 : 1))
    toast.show({ message: 'Couldn’t update like', duration: 2800 })
  } finally {
    liking.delete(status.id)
  }
}

const onInputKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}
</script>

<template>
  <NeoSheet
    :open="open"
    desktop-width="compact"
    max-height="min(88dvh, 100%)"
    :viewport-style="viewportStyle"
    @close="overlay.closeThreadPeek()"
  >
    <div
      v-if="parent"
      ref="panelRef"
      class="thread-peek"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="titleId"
    >
      <header class="thread-peek__head">
        <h2 :id="titleId" class="thread-peek__title">Replies</h2>
        <button type="button" class="thread-peek__full" @click="openFullThread">
          Open full thread
        </button>
        <button
          type="button"
          class="thread-peek__close"
          aria-label="Close"
          @click="overlay.closeThreadPeek()"
        >
          <NeoIcon name="x" :size="18" :stroke="2" />
        </button>
      </header>

      <div class="thread-peek__parent">
        <img
          v-if="parent.account.avatar"
          :src="parent.account.avatar"
          alt=""
          class="thread-peek__avatar"
          loading="lazy"
          decoding="async"
        />
        <div class="thread-peek__parent-body">
          <p class="thread-peek__meta">
            <strong>{{ parent.account.displayName || parent.account.username }}</strong>
            <span>@{{ parent.account.acct }}</span>
          </p>
          <p class="thread-peek__preview">{{ parentPreview }}</p>
        </div>
      </div>

      <div class="thread-peek__list" data-keyboard-scroll>
        <p v-if="loading" class="thread-peek__hint">Loading replies…</p>
        <p v-else-if="loadError" class="thread-peek__hint thread-peek__hint--err">{{ loadError }}</p>
        <p v-else-if="!replies.length" class="thread-peek__hint">No replies yet — be the first.</p>
        <article v-for="reply in replies" :key="reply.id" class="thread-peek__reply">
          <img
            v-if="reply.account.avatar"
            :src="reply.account.avatar"
            alt=""
            class="thread-peek__avatar thread-peek__avatar--sm"
            loading="lazy"
            decoding="async"
          />
          <div class="thread-peek__reply-body">
            <p class="thread-peek__meta">
              <strong>{{ reply.account.displayName || reply.account.username }}</strong>
              <span>@{{ reply.account.acct }}</span>
            </p>
            <div class="thread-peek__content" v-html="sanitizeStatusHtml(reply.content || '')" />
            <div class="thread-peek__reply-actions">
              <button
                type="button"
                class="thread-peek__action"
                :class="{ 'thread-peek__action--on': reply.favourited }"
                :aria-pressed="!!reply.favourited"
                :aria-label="reply.favourited ? 'Unlike' : 'Like'"
                @click="toggleLike(reply)"
              >
                <NeoIcon name="heart" :size="16" :stroke="1.75" :filled="!!reply.favourited" />
                <span v-if="(reply.favouritesCount || 0) > 0">{{ formatCount(reply.favouritesCount || 0) }}</span>
              </button>
              <button
                type="button"
                class="thread-peek__action"
                :aria-label="`Reply to @${reply.account.acct}`"
                @click="setReplyTarget(reply.account.acct)"
              >
                <NeoIcon name="message" :size="16" :stroke="1.75" />
                Reply
              </button>
            </div>
          </div>
        </article>
      </div>

      <footer class="thread-peek__composer" data-keyboard-footer>
        <div v-if="!draft.trim()" class="thread-peek__chips" role="group" aria-label="Quick reactions">
          <button
            v-for="chip in REACTION_CHIPS"
            :key="chip"
            type="button"
            class="thread-peek__chip"
            :disabled="sending"
            @click="onChip(chip)"
          >
            {{ chip }}
          </button>
        </div>
        <div class="thread-peek__row">
          <button
            type="button"
            class="thread-peek__expand"
            aria-label="Open full composer"
            title="Add media, CW, or more options"
            @click="expandToCompose"
          >
            <NeoIcon name="edit" :size="18" :stroke="1.75" />
          </button>
          <textarea
            ref="inputRef"
            v-model="draft"
            class="thread-peek__input"
            rows="1"
            :placeholder="placeholder"
            :aria-label="placeholder"
            enterkeyhint="send"
            @focus="onFocusField"
            @keydown="onInputKeydown"
          />
          <button
            type="button"
            class="neo-btn neo-btn--primary neo-btn--sm thread-peek__send"
            :disabled="sending || !draft.trim()"
            @click="onSend"
          >
            {{ sending ? '…' : 'Send' }}
          </button>
        </div>
      </footer>
    </div>
  </NeoSheet>
</template>

<style scoped lang="scss">
.thread-peek {
  display: flex;
  flex-direction: column;
  min-height: min(56dvh, 420px, 100%);
  max-height: 100%;
  min-width: 0;
}

.thread-peek__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 0.85rem 0.55rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.thread-peek__title {
  margin: 0;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.thread-peek__full {
  margin-left: auto;
  border: none;
  background: none;
  padding: 0.25rem 0.35rem;
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-accent);
  cursor: pointer;
}

.thread-peek__close {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
  cursor: pointer;
}

.thread-peek__parent {
  display: flex;
  gap: 0.65rem;
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid var(--neo-border-color);
  flex-shrink: 0;
}

.thread-peek__avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;

  &--sm {
    width: 1.85rem;
    height: 1.85rem;
  }
}

.thread-peek__parent-body,
.thread-peek__reply-body {
  min-width: 0;
  flex: 1;
}

.thread-peek__meta {
  margin: 0 0 0.2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.45rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);

  strong {
    color: var(--neo-text-primary);
    font-weight: 650;
  }
}

.thread-peek__preview {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--neo-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.thread-peek__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 0.35rem 0.85rem 0.75rem;
}

.thread-peek__hint {
  margin: 1rem 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--neo-text-muted);

  &--err {
    color: var(--neo-danger, #e11d48);
  }
}

.thread-peek__reply {
  display: flex;
  gap: 0.55rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid color-mix(in srgb, var(--neo-border-color) 70%, transparent);

  &:last-child {
    border-bottom: none;
  }
}

.thread-peek__content {
  font-size: 0.9rem;
  line-height: 1.45;
  color: var(--neo-text-primary);
  overflow-wrap: anywhere;

  :deep(p) {
    margin: 0 0 0.35rem;

    &:last-child {
      margin-bottom: 0;
    }
  }

  :deep(a) {
    color: var(--neo-accent);
  }
}

.thread-peek__reply-actions {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

.thread-peek__action {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 2rem;
  padding: 0.2rem 0.45rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-muted);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;

  &--on {
    color: var(--neo-like, #ff3040);
  }
}

.thread-peek__composer {
  flex-shrink: 0;
  border-top: 1px solid var(--neo-border-color);
  padding: 0.55rem 0.75rem calc(0.55rem + env(safe-area-inset-bottom, 0px));
  background: var(--neo-bg-primary);
}

.thread-peek__chips {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

.thread-peek__chip {
  flex-shrink: 0;
  min-width: 2.4rem;
  min-height: 2.25rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: var(--neo-bg-secondary);
  font-size: 1.05rem;
  cursor: pointer;
}

.thread-peek__row {
  display: flex;
  align-items: flex-end;
  gap: 0.4rem;
}

.thread-peek__expand {
  display: grid;
  place-items: center;
  width: 2.4rem;
  height: 2.4rem;
  flex-shrink: 0;
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
  cursor: pointer;
}

.thread-peek__input {
  flex: 1;
  min-width: 0;
  min-height: 2.4rem;
  max-height: 6.5rem;
  resize: none;
  padding: 0.55rem 0.7rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-primary);
  font: inherit;
  font-size: 0.9375rem;
  line-height: 1.35;
}

.thread-peek__send {
  flex-shrink: 0;
  min-height: 2.4rem;
}
</style>
