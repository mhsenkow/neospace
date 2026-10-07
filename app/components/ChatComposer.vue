<script setup lang="ts">
/**
 * Inline DM composer — type in the bar (Threads-style), no sheet.
 * Mentions all participants so group DMs stay accessible on Mastodon.
 */

import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useComposeMedia } from '~/composables/useComposeMedia'

const props = defineProps<{
  /** Latest status in the thread to reply to */
  inReplyToId: string
  /** Other handles without @ — added on send, not shown in the field */
  recipientAccts?: string[]
  /** @deprecated single-recipient alias */
  recipientAcct?: string | null
  placeholder?: string
}>()

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

const {
  attachments,
  isUploading,
  hasMedia,
  mediaIds,
  allReady,
  canAddMore,
  addFiles,
  removeAttachment,
  clearAttachments,
  onPaste,
} = useComposeMedia()

const maxChars = computed(() => instancesStore.statusMaxCharacters || 500)

const mentionList = computed(() => {
  const raw = [
    ...(props.recipientAccts || []),
    props.recipientAcct || '',
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    const acct = r.replace(/^@/, '').trim()
    if (!acct) continue
    const key = acct.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(acct)
  }
  return out
})

const mentionPrefix = computed(() =>
  mentionList.value.map((a) => `@${a}`).join(' '),
)

const projectedLen = computed(() => {
  const text = content.value.trim()
  if (!mentionPrefix.value) return text.length
  let overhead = 0
  for (const acct of mentionList.value) {
    const mention = `@${acct}`
    if (!text.toLowerCase().includes(mention.toLowerCase())) {
      overhead += mention.length + 1
    }
  }
  return text.length + overhead
})

const remaining = computed(() => maxChars.value - projectedLen.value)
const overLimit = computed(() => remaining.value < 0)

const canSend = computed(() => {
  const hasText = content.value.trim().length > 0
  return (
    (hasText || hasMedia.value) &&
    !isSending.value &&
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
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`
}

watch(content, () => nextTick(autosize))

const buildBody = () => {
  let text = content.value.trim()
  for (const acct of mentionList.value) {
    const mention = `@${acct}`
    if (!text) {
      text = mention
      continue
    }
    if (!text.toLowerCase().includes(mention.toLowerCase())) {
      text = `${mention} ${text}`
    }
  }
  return text
}

const send = async () => {
  if (!canSend.value) return
  isSending.value = true
  error.value = null
  try {
    const status = await statusStore.postStatus(buildBody(), {
      visibility: 'direct',
      inReplyToId: props.inReplyToId,
      mediaIds: mediaIds.value,
    })
    content.value = ''
    clearAttachments()
    await nextTick(autosize)
    emit('posted', status)
    textareaRef.value?.focus()
  } catch (e: any) {
    const raw = (e?.message || '').toString()
    if (/record not found|not found/i.test(raw)) {
      error.value = 'That conversation isn’t on your account’s server.'
    } else {
      error.value = raw || 'Couldn’t send'
    }
  } finally {
    isSending.value = false
  }
}

const onKeydown = (e: KeyboardEvent) => {
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

/** Keep the bar above the soft keyboard (iOS visualViewport) */
const barStyle = ref<Record<string, string>>({})

const syncKeyboardOffset = () => {
  if (typeof window === 'undefined') return
  const vv = window.visualViewport
  if (!vv) {
    barStyle.value = { bottom: '0px' }
    return
  }
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  barStyle.value = { bottom: `${inset}px` }
}

onMounted(() => {
  syncKeyboardOffset()
  window.visualViewport?.addEventListener('resize', syncKeyboardOffset)
  window.visualViewport?.addEventListener('scroll', syncKeyboardOffset)
  window.addEventListener('resize', syncKeyboardOffset)
  nextTick(() => textareaRef.value?.focus())
})

onUnmounted(() => {
  window.visualViewport?.removeEventListener('resize', syncKeyboardOffset)
  window.visualViewport?.removeEventListener('scroll', syncKeyboardOffset)
  window.removeEventListener('resize', syncKeyboardOffset)
})
</script>

<template>
  <div class="chat-composer" :style="barStyle">
    <div class="chat-composer__inner">
      <div v-if="attachments.length" class="chat-composer__media">
        <div
          v-for="item in attachments"
          :key="item.localId"
          class="chat-composer__thumb"
        >
          <img v-if="item.previewUrl" :src="item.previewUrl" alt="" />
          <button
            type="button"
            class="chat-composer__thumb-x"
            aria-label="Remove"
            @click="removeAttachment(item.localId)"
          >
            <NeoIcon name="x" :size="12" :stroke="2.5" />
          </button>
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
          accept="image/*,video/*,audio/*"
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
            :disabled="isSending"
            enterkeyhint="send"
            aria-label="Message"
            @keydown="onKeydown"
            @paste="onPaste"
            @input="autosize"
          />
        </div>

        <span
          class="chat-composer__count"
          :class="{
            'chat-composer__count--warn': remaining <= 40 && remaining >= 0,
            'chat-composer__count--over': overLimit,
          }"
          :aria-live="overLimit ? 'polite' : 'off'"
        >
          {{ remaining }}
        </span>

        <button
          type="button"
          class="chat-composer__send"
          :class="{ 'chat-composer__send--ready': canSend }"
          :disabled="!canSend"
          :aria-label="isSending ? 'Sending' : 'Send'"
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
  padding: 0.75rem 1rem calc(0.85rem + env(safe-area-inset-bottom, 0px));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(14px);

  @media (min-width: 1024px) {
    left: 64px;
    padding: 0.9rem 1.25rem 1rem;
  }
}

.chat-composer__inner {
  width: 100%;
  max-width: 36rem;
}

.chat-composer__media {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding: 0 0.15rem 0.65rem;
  scrollbar-width: none;
}

.chat-composer__thumb {
  position: relative;
  width: 64px;
  height: 64px;
  flex: 0 0 auto;
  border-radius: 12px;
  overflow: hidden;
  background: var(--neo-bg-tertiary);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.chat-composer__thumb-x {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--neo-text-primary) 72%, transparent);
  color: var(--neo-bg-primary);
  cursor: pointer;
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
    box-shadow: 0 0 0 3px var(--neo-accent-soft);
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
  /* ≥16px avoids iOS auto-zoom on focus */
  font-size: 1rem;
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
  color: var(--neo-text-inverse, #fff);
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
