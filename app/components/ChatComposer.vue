<script setup lang="ts">
/**
 * Inline DM composer — type in the bar (Threads-style), no sheet.
 * Mentions all participants so group DMs stay accessible on Mastodon.
 */

import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useComposeMedia } from '~/composables/useComposeMedia'
import { COMPOSE_MEDIA_ACCEPT } from '~/utils/composeConstants'
import { isImeEvent } from '~/composables/useComposerCore'
import { useKeyboardBottomInset } from '~/composables/useKeyboardViewport'
import { mapComposeError } from '~/utils/friendlyError'
import { mastodonLength } from '~/utils/mastodonLength'
import { buildDirectBody, normalizeRecipientAccts } from '~/utils/dmHelpers'

const props = withDefaults(
  defineProps<{
    /** Latest status in the thread to reply to */
    inReplyToId: string
    /** Other handles without @ — added on send, not shown in the field */
    recipientAccts?: string[]
    /** @deprecated single-recipient alias */
    recipientAcct?: string | null
    placeholder?: string
    /**
     * When true, sit inside a parent fixed stack (DM context footer) —
     * parent owns keyboard inset + bottom positioning.
     */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  posted: [status: mastodon.v1.Status]
}>()

const statusStore = useStatusStore()
const instancesStore = useInstancesStore()

const content = ref('')
const isSending = ref(false)
const error = ref<string | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

/** Optimistic bubble shown until the server acks (or fails) */
type PendingSend = {
  status: mastodon.v1.Status
  delivery: 'pending' | 'failed'
  body: string
  /** What the user typed (no added mentions) — restored by "Edit" after a failure */
  text: string
  mediaIds: string[]
}
const pendingSend = ref<PendingSend | null>(null)

/** Plain text → bubble HTML: escape markup, keep line breaks */
const escapeForBubble = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

const makeOptimisticStatus = (body: string): mastodon.v1.Status => {
  const me = instancesStore.currentUser
  const now = new Date().toISOString()
  return {
    id: `pending-${Date.now()}`,
    uri: '',
    url: null,
    createdAt: now,
    content: body ? `<p>${escapeForBubble(body)}</p>` : '',
    visibility: 'direct',
    sensitive: false,
    spoilerText: '',
    repliesCount: 0,
    reblogsCount: 0,
    favouritesCount: 0,
    editedAt: null,
    favourited: false,
    reblogged: false,
    muted: false,
    bookmarked: false,
    pinned: false,
    account: me || {
      id: 'me',
      username: 'you',
      acct: 'you',
      displayName: 'You',
      avatar: '',
      avatarStatic: '',
      header: '',
      headerStatic: '',
      note: '',
      url: '',
      followersCount: 0,
      followingCount: 0,
      statusesCount: 0,
      bot: false,
      locked: false,
      createdAt: now,
      emojis: [],
      fields: [],
    },
    mediaAttachments: [],
    mentions: [],
    tags: [],
    emojis: [],
    application: null,
    language: null,
    inReplyToId: props.inReplyToId,
    inReplyToAccountId: null,
    reblog: null,
    poll: null,
    card: null,
    // Placeholder until the server echo replaces it — not every Status field is meaningful
  } as unknown as mastodon.v1.Status
}

const {
  attachments,
  isDragging,
  isUploading,
  hasMedia,
  mediaIds,
  allReady,
  canAddMore,
  addFiles,
  removeAttachment,
  clearAttachments,
  retryUpload,
  setDescription,
  flushAltDescriptions,
  altMax,
  uploadAnnounce,
  onPaste,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
} = useComposeMedia()

const { insetStyle: barStyle, keyboardOpen } = useKeyboardBottomInset()
/** Parent stack lifts with the keyboard when embedded */
const composerStyle = computed(() => (props.embedded ? undefined : barStyle.value))

/**
 * Fixed bar already lifts with --neo-keyboard-inset. Document scrollIntoView
 * yanks the thread under the bar on Android — leave scrolling to the parent.
 */
const onComposerFocus = (_e: FocusEvent) => {
  /* intentional no-op: inset + parent keyboardOpen watcher handle visibility */
}

const maxChars = computed(() => instancesStore.statusMaxCharacters || 500)
const counterAnnounce = ref('')

const mentionList = computed(() =>
  normalizeRecipientAccts([...(props.recipientAccts || []), props.recipientAcct]),
)

/** Mentions are added on send, so they count toward the limit */
const projectedLen = computed(() => mastodonLength(buildDirectBody(content.value, mentionList.value)))

const remaining = computed(() => maxChars.value - projectedLen.value)
const overLimit = computed(() => remaining.value < 0)
const nearLimit = computed(() => !overLimit.value && remaining.value <= 40)

watch([remaining, overLimit, nearLimit], () => {
  if (overLimit.value) {
    counterAnnounce.value = `Over character limit by ${-remaining.value}`
  } else if (nearLimit.value) {
    counterAnnounce.value = `${remaining.value} characters left`
  } else {
    counterAnnounce.value = ''
  }
})

const canSend = computed(() => {
  const hasText = content.value.trim().length > 0
  return (
    (hasText || hasMedia.value) &&
    !isSending.value &&
    !pendingSend.value &&
    !isUploading.value &&
    allReady.value &&
    !overLimit.value &&
    instancesStore.isAuthenticated
  )
})

const autosize = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  const max = keyboardOpen.value ? 96 : 140
  el.style.height = `${Math.min(el.scrollHeight, max)}px`
}

watch(content, () => {
  // Single nextTick — avoid double autosize from @input + watch
  void nextTick(autosize)
})

watch(keyboardOpen, () => {
  void nextTick(autosize)
})

const postBody = async (body: string, ids: string[]) => {
  isSending.value = true
  error.value = null
  try {
    const result = await statusStore.postStatus(body, {
      visibility: 'direct',
      inReplyToId: props.inReplyToId,
      mediaIds: ids,
    })
    // DMs never pass scheduledAt — create always returns a live Status
    if (!('account' in result)) {
      throw new Error('Unexpected response from server')
    }
    pendingSend.value = null
    emit('posted', result)
    textareaRef.value?.focus()
  } catch (e: unknown) {
    error.value = mapComposeError(e, {
      inReplyToId: props.inReplyToId,
      hasMedia: ids.length > 0,
    })
    if (pendingSend.value) {
      pendingSend.value = { ...pendingSend.value, delivery: 'failed' }
    }
  } finally {
    isSending.value = false
  }
}

const send = async () => {
  if (!canSend.value) return
  // Every participant must be mentioned or the direct post won't reach them
  const body = buildDirectBody(content.value, mentionList.value)
  const text = content.value.trim()
  const ids = [...mediaIds.value]
  const optimistic = makeOptimisticStatus(text || body)
  // Set synchronously — canSend now blocks a second Enter / tap (double send)
  pendingSend.value = { status: optimistic, delivery: 'pending', body, text, mediaIds: ids }
  content.value = ''
  // Alt text typed in the last 450ms is still debounced — clearing would drop it
  await flushAltDescriptions().catch(() => {})
  clearAttachments()
  await nextTick(autosize)
  await postBody(body, ids)
}

/** Give up on a failed send: put the text back so it can be edited and resent */
const editFailed = () => {
  const pending = pendingSend.value
  if (!pending || pending.delivery !== 'failed') return
  if (!content.value.trim()) content.value = pending.text
  pendingSend.value = null
  error.value = null
  void nextTick(() => textareaRef.value?.focus())
}

const retryPending = async () => {
  const pending = pendingSend.value
  if (!pending || pending.delivery !== 'failed' || isSending.value) return
  pendingSend.value = { ...pending, delivery: 'pending' }
  await postBody(pending.body, pending.mediaIds)
}

const onKeydown = (e: KeyboardEvent) => {
  if (isImeEvent(e)) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    void send()
  }
}

const pickFiles = () => fileInputRef.value?.click()

const onFileChange = (e: Event) => {
  const input = e.target as HTMLInputElement
  if (input.files?.length) void addFiles(input.files)
  input.value = ''
}

onMounted(() => {
  // Autofocus only with a fine pointer — avoid popping the mobile keyboard
  if (typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches) {
    nextTick(() => textareaRef.value?.focus())
  }
})
</script>

<template>
  <div
    class="chat-composer"
    :class="{
      'chat-composer--dragging': isDragging,
      'chat-composer--keyboard': keyboardOpen,
      'chat-composer--embedded': embedded,
    }"
    :data-keyboard-fixed="embedded ? undefined : true"
    :style="composerStyle"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
  >
    <div class="chat-composer__inner">
      <div v-if="pendingSend" class="chat-composer__pending">
        <MessageBubble
          :status="pendingSend.status"
          mine
          :delivery="pendingSend.delivery"
          @retry="retryPending"
          @edit="editFailed"
        />
      </div>

      <div v-if="attachments.length" class="chat-composer__media">
        <div
          v-for="(item, idx) in attachments"
          :key="item.localId"
          class="chat-composer__attach-wrap"
        >
          <div
            class="chat-composer__thumb"
            :class="{
              'chat-composer__thumb--busy': item.uploading,
              'chat-composer__thumb--error': !!item.error,
            }"
          >
            <video
              v-if="item.file.type.startsWith('video/') && item.previewUrl"
              :src="item.previewUrl"
              preload="metadata"
              muted
              playsinline
            />
            <img
              v-else-if="item.previewUrl"
              :src="item.previewUrl"
              alt=""
            />
            <div v-if="item.uploading" class="chat-composer__thumb-overlay">
              Uploading…
            </div>
            <button
              v-else-if="item.error"
              type="button"
              class="chat-composer__thumb-overlay chat-composer__thumb-overlay--error"
              :aria-label="`Retry upload: ${item.error}`"
              @click="retryUpload(item.localId)"
            >
              {{ item.error }} · retry
            </button>
            <button
              type="button"
              class="chat-composer__thumb-x"
              :aria-label="`Remove attachment ${idx + 1}`"
              @click="removeAttachment(item.localId)"
            >
              <NeoIcon name="x" :size="12" :stroke="2.5" />
            </button>
          </div>
          <label class="chat-composer__alt">
            <span class="chat-composer__alt-label">
              Alt text<span class="sr-only"> for attachment {{ idx + 1 }}</span>
            </span>
            <input
              type="text"
              class="chat-composer__alt-input"
              :maxlength="altMax"
              :disabled="item.uploading"
              :value="item.description"
              placeholder="Alt text"
              @focus="onComposerFocus"
              @input="setDescription(item.localId, ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>
      </div>

      <p v-if="error" class="chat-composer__error" role="alert">{{ error }}</p>

      <div class="chat-composer__row">
        <button
          type="button"
          class="chat-composer__attach"
          aria-label="Add photo"
          :disabled="!canAddMore || isSending"
          @click="pickFiles"
        >
          <NeoIcon name="image" :size="20" :stroke="1.75" />
        </button>
        <input
          ref="fileInputRef"
          type="file"
          :accept="COMPOSE_MEDIA_ACCEPT"
          multiple
          class="chat-composer__file"
          @change="onFileChange"
        />

        <div class="chat-composer__field">
          <textarea
            ref="textareaRef"
            v-model="content"
            class="chat-composer__input"
            rows="1"
            :placeholder="placeholder || 'Message…'"
            :readonly="isSending"
            enterkeyhint="send"
            aria-label="Message"
            aria-describedby="chat-composer-keys"
            :aria-busy="isSending || undefined"
            :aria-invalid="overLimit || undefined"
            @focus="onComposerFocus"
            @keydown="onKeydown"
            @paste="onPaste"
          />
        </div>

        <span id="chat-composer-keys" class="sr-only">
          Enter sends. Shift+Enter adds a new line.
        </span>
        <span class="sr-only" aria-live="polite" aria-atomic="true">{{ counterAnnounce }}</span>
        <span class="sr-only" aria-live="polite" aria-atomic="true">{{ uploadAnnounce }}</span>
        <span
          class="chat-composer__count"
          :class="{
            'chat-composer__count--warn': nearLimit,
            'chat-composer__count--over': overLimit,
          }"
          aria-hidden="true"
        >
          {{ remaining }}
        </span>

        <button
          type="button"
          class="chat-composer__send"
          :class="{ 'chat-composer__send--ready': canSend }"
          :disabled="!canSend"
          :aria-label="isUploading ? 'Uploading' : isSending ? 'Sending' : 'Send'"
          @click="send"
        >
          <FunLoader
            v-if="isSending || isUploading"
            variant="seed"
            :size="28"
            label="Sending"
          />
          <NeoIcon v-else name="send" :size="18" :stroke="2" filled />
        </button>
        <div v-if="$slots.trailing" class="chat-composer__trailing">
          <slot name="trailing" />
        </div>
      </div>

      <p v-if="mentionList.length > 1" class="chat-composer__hint">
        Sending to {{ mentionList.map((a) => `@${a}`).join(', ') }}
      </p>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.chat-composer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  /* Safe area when keyboard closed; :style bottom lifts for overlay keyboards */
  padding: 0.75rem 1rem calc(0.85rem + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  @media (min-width: 1024px) {
    left: var(--neo-sidebar-width, 248px);
    padding: 0.9rem 1.25rem 1rem;
  }

  &--embedded {
    position: relative;
    left: auto;
    right: auto;
    bottom: auto;
    z-index: auto;
    padding: 0.65rem 0 0.35rem;
    border-top: none;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;

    @media (min-width: 1024px) {
      left: auto;
      padding: 0.65rem 0 0.35rem;
    }
  }

  &--dragging {
    outline: 2px dashed var(--neo-accent);
    outline-offset: -4px;
  }

  &--keyboard {
    padding: 0.4rem 0.65rem 0.4rem;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;

    .chat-composer__hint {
      display: none;
    }

    .chat-composer__media {
      padding-bottom: 0.35rem;
      gap: 0.4rem;
    }

    .chat-composer__attach-wrap,
    .chat-composer__thumb {
      width: 64px;
    }

    .chat-composer__thumb {
      height: 48px;
      border-radius: 8px;
    }

    .chat-composer__input {
      max-height: 96px;
    }

    .chat-composer__count:not(.chat-composer__count--warn):not(.chat-composer__count--over) {
      display: none;
    }
  }
}

.chat-composer__inner {
  width: 100%;
  max-width: 36rem;
}

.chat-composer__pending {
  margin: 0 0 0.55rem;
  pointer-events: auto;
}

.chat-composer__media {
  display: flex;
  gap: 0.65rem;
  overflow-x: auto;
  padding: 0 0.15rem 0.65rem;
  scrollbar-width: none;
}

.chat-composer__attach-wrap {
  flex: 0 0 auto;
  width: 88px;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.chat-composer__thumb {
  position: relative;
  width: 88px;
  height: 64px;
  border-radius: 12px;
  overflow: hidden;
  background: var(--neo-bg-tertiary);

  img,
  video {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.chat-composer__thumb-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  border: none;
  background: color-mix(in srgb, var(--neo-bg-primary) 72%, transparent);
  color: var(--neo-text-primary);
  font-size: 0.625rem;
  font-weight: 600;
  text-align: center;
  line-height: 1.2;
  cursor: default;

  &--error {
    background: color-mix(in srgb, var(--neo-danger, #c44) 78%, transparent);
    color: var(--neo-text-on-accent, #fff);
    cursor: pointer;
  }
}

.chat-composer__thumb-x {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--neo-text-primary) 72%, transparent);
  color: var(--neo-bg-primary);
  cursor: pointer;
  z-index: 1;
}

/* Visible label — placeholder alone disappears once typing starts */
.chat-composer__alt-label {
  display: block;
  margin-bottom: 0.15rem;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1.2;
  color: var(--neo-text-secondary);
}

.chat-composer__alt-input {
  width: 100%;
  box-sizing: border-box;
  margin: 0;
  padding: 0.2rem 0.35rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 6px;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-primary);
  font: inherit;
  font-size: 0.6875rem;
  line-height: 1.2;

  &::placeholder {
    color: var(--neo-text-muted);
  }
}

.chat-composer__error {
  margin: 0 0 0.45rem 0.15rem;
  font-size: 0.8125rem;
  color: var(--neo-danger);
}

.chat-composer__hint {
  margin: 0.4rem 0 0 3.4rem;
  font-size: 0.6875rem;
  color: var(--neo-text-quaternary);
}

.chat-composer__row {
  display: flex;
  align-items: flex-end;
  gap: 0.45rem;
}

.chat-composer__trailing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  align-self: center;
  margin-left: -0.15rem;
}

.chat-composer__attach {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid var(--neo-border-color);
  border-radius: 50%;
  background: var(--neo-bg-secondary);
  color: var(--neo-text-primary);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;

  &:hover:not(:disabled) {
    background: var(--neo-bg-hover);
    border-color: var(--neo-text-muted);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.chat-composer__file {
  display: none;
}

.chat-composer__field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 0.45rem 0.95rem;
  border-radius: 12px;
  background: var(--neo-bg-tertiary);
  border: 1.5px solid var(--neo-border-color);
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
  box-sizing: border-box;

  &:focus-within {
    border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
    outline: 2px solid var(--neo-focus);
    outline-offset: 1px;
  }
}

.chat-composer__input {
  display: block;
  width: 100%;
  max-height: 140px;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--neo-text-primary);
  font: inherit;
  /* Absolute 16px — root rem is 15px; iOS zooms anything smaller */
  font-size: max(16px, 1rem);
  line-height: 1.35;
  resize: none;
  outline: none;
  /* Soft keyboards: Enter sends; Shift+Enter still available on hardware */
  touch-action: manipulation;

  &::placeholder {
    color: var(--neo-text-muted);
  }
}

.chat-composer__count {
  flex-shrink: 0;
  align-self: center;
  min-width: 1.5rem;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: var(--neo-text-quaternary);
  text-align: right;
  line-height: 1;

  &--warn {
    color: var(--neo-text-secondary);
  }

  &--over {
    color: var(--neo-danger, #c44);
    font-weight: 700;
  }
}

.chat-composer__send {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--neo-accent) 35%, var(--neo-bg-tertiary));
  color: var(--neo-text-on-accent, #fff);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.12s ease, opacity 0.12s ease;

  &--ready {
    background: var(--neo-accent);

    &:hover:not(:disabled) {
      filter: brightness(1.06);
    }

    &:active:not(:disabled) {
      transform: scale(0.96);
    }
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}
</style>
