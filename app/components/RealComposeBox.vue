<script setup lang="ts">
/**
 * Compose — Threads-easy posting: drag/drop, paste, previews, Cmd+Enter
 */

import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { useComposeHandoffStore } from '~/stores/composeHandoff'
import { useComposeMedia } from '~/composables/useComposeMedia'
import { accountHandle, useAccountSearch } from '~/composables/useAccountSearch'
import type { mastodon } from 'masto'

const props = withDefaults(
  defineProps<{
    /** When set, posts as a reply to this status */
    inReplyToId?: string
    /** Append this URL when quoting (fediverse-friendly quote) */
    quoteUrl?: string
    placeholder?: string
    title?: string
    /** Slimmer chrome for sticky thread reply bars */
    compact?: boolean
    /** Prefill (e.g. @acct) — applied once on mount */
    initialText?: string
    /** Override default posting visibility (e.g. direct for DMs) */
    initialVisibility?: 'public' | 'unlisted' | 'private' | 'direct'
    /** Threads-style group/hashtag to tag on post */
    initialGroupTag?: string | null
    /**
     * Absorb Loom / cross-app handoff drafts.
     * Only one visible composer should accept — mobile sheet vs desktop column.
     */
    acceptHandoff?: boolean
  }>(),
  {
    placeholder: "What's new?",
    title: "What's new?",
    compact: false,
    acceptHandoff: true,
  },
)

const emit = defineEmits<{
  posted: [status: mastodon.v1.Status]
}>()

const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const handoffStore = useComposeHandoffStore()

const content = ref(props.initialText || '')
const spoilerText = ref('')
const visibility = ref<'public' | 'unlisted' | 'private' | 'direct'>(
  props.initialVisibility || settingsStore.defaultVisibility,
)
const showCW = ref(settingsStore.defaultSensitive)
const isPosting = ref(false)
const error = ref<string | null>(null)
const handoffNotice = ref<string | null>(null)
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const composeFocused = ref(false)
const selectedGroupTag = ref<string | null>(
  props.initialGroupTag ? props.initialGroupTag.replace(/^#/, '') : null,
)

/** Locked private message compose — don't let people accidentally go public */
const isDirectCompose = computed(
  () => props.initialVisibility === 'direct' || visibility.value === 'direct',
)

const showGroupPicker = computed(() => !isDirectCompose.value && !props.compact)

const {
  attachments,
  isDragging,
  isUploading,
  hasMedia,
  mediaIds,
  allReady,
  canAddMore,
  maxAttachments,
  altMax,
  addFiles,
  removeAttachment,
  clearAttachments,
  retryUpload,
  setDescription,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onPaste,
} = useComposeMedia()

/** Threads pill: stay one row until you engage */
const compactExpanded = computed(
  () =>
    !props.compact ||
    composeFocused.value ||
    !!content.value.trim() ||
    hasMedia.value ||
    showCW.value ||
    !!error.value ||
    !!handoffNotice.value,
)

const maxLength = computed(() => instancesStore.statusMaxCharacters)

const groupTagSuffix = computed(() => {
  const tag = selectedGroupTag.value?.replace(/^#/, '').trim()
  if (!tag) return ''
  const already = new RegExp(`(?:^|\\s)#${tag}\\b`, 'i').test(content.value)
  return already ? '' : ` #${tag}`
})

const effectiveMaxLength = computed(() => maxLength.value - groupTagSuffix.value.length)
const characterCount = computed(() => content.value.length)
const isOverLimit = computed(() => characterCount.value > effectiveMaxLength.value)
const canPost = computed(() => {
  const hasText = content.value.trim().length > 0
  const hasQuote = !!props.quoteUrl
  return (
    (hasText || hasMedia.value || hasQuote) &&
    !isOverLimit.value &&
    !isPosting.value &&
    !isUploading.value &&
    allReady.value &&
    instancesStore.isAuthenticated
  )
})

const postingAs = computed(() => {
  const account = instancesStore.activeAccount
  if (!account?.user) return null
  const acct = account.user.acct || account.user.username
  const host = account.url.replace(/^https?:\/\//, '')
  return acct.includes('@') ? `@${acct}` : `@${acct}@${host}`
})

const canSwitchPostingAccount = computed(
  () => instancesStore.authenticatedInstances.length > 1,
)

const cyclePostingAccount = () => {
  if (!canSwitchPostingAccount.value) return
  instancesStore.cycleActiveAccount()
}

const visibilityOptions = [
  { value: 'public', label: 'Public' },
  { value: 'unlisted', label: 'Unlisted' },
  { value: 'private', label: 'Followers' },
  { value: 'direct', label: 'Mentioned' },
] as const

const resetForm = () => {
  content.value = props.inReplyToId && props.initialText ? props.initialText : ''
  spoilerText.value = ''
  showCW.value = settingsStore.defaultSensitive
  visibility.value = props.initialVisibility || settingsStore.defaultVisibility
  selectedGroupTag.value = props.initialGroupTag
    ? props.initialGroupTag.replace(/^#/, '')
    : null
  clearAttachments()
  error.value = null
  closeMentions()
}

/** @-mention autocomplete */
const {
  results: mentionResults,
  isSearching: mentionSearching,
  search: searchMentions,
  clear: clearMentions,
} = useAccountSearch()
const mentionOpen = ref(false)
const mentionIndex = ref(0)
const mentionAt = ref(-1)

const closeMentions = () => {
  mentionOpen.value = false
  mentionIndex.value = 0
  mentionAt.value = -1
  clearMentions()
}

const getMentionContext = () => {
  const el = textareaRef.value
  const caret = el?.selectionStart ?? content.value.length
  const before = content.value.slice(0, caret)
  const m = before.match(/(?:^|[\s([{“"'‘])@([a-zA-Z0-9_./-]*)$/)
  if (!m) return null
  const query = m[1] ?? ''
  const start = before.length - query.length - 1
  return { start, query, caret }
}

const syncMentions = () => {
  if (!instancesStore.isAuthenticated) {
    closeMentions()
    return
  }
  const ctx = getMentionContext()
  if (!ctx) {
    closeMentions()
    return
  }
  // Don't pop open on a lone @ with zero chars unless user is typing into a mention
  mentionAt.value = ctx.start
  mentionOpen.value = true
  mentionIndex.value = 0
  searchMentions(ctx.query)
}

const insertMention = (account: mastodon.v1.Account) => {
  const ctx = getMentionContext()
  if (!ctx) return
  const handle = accountHandle(account)
  const before = content.value.slice(0, ctx.start)
  const after = content.value.slice(ctx.caret)
  content.value = `${before}${handle} ${after}`
  closeMentions()
  nextTick(() => {
    const pos = before.length + handle.length + 1
    textareaRef.value?.focus()
    textareaRef.value?.setSelectionRange(pos, pos)
  })
}

watch(
  () => [settingsStore.defaultVisibility, settingsStore.defaultSensitive] as const,
  ([vis, sensitive]) => {
    // Only apply defaults when compose is empty (don't yank mid-draft)
    if (!content.value.trim() && !hasMedia.value && !isPosting.value) {
      visibility.value = vis
      showCW.value = sensitive
    }
  },
)

const handlePost = async () => {
  if (!canPost.value) return

  isPosting.value = true
  error.value = null

  try {
    let body = content.value
    const quote = props.quoteUrl?.trim()
    if (quote && !body.includes(quote)) {
      body = `${body.trim()}\n\n${quote}`
    }
    const tag = selectedGroupTag.value?.replace(/^#/, '').trim()
    if (tag) {
      const hasTag = new RegExp(`(?:^|\\s)#${tag}\\b`, 'i').test(body)
      if (!hasTag) body = `${body.trim()} #${tag}`.trim()
    }

    const status = await statusStore.postStatus(body, {
      visibility: props.initialVisibility === 'direct' ? 'direct' : visibility.value,
      spoilerText: showCW.value ? spoilerText.value : undefined,
      mediaIds: mediaIds.value,
      sensitive: showCW.value || undefined,
      inReplyToId: props.inReplyToId,
    })
    resetForm()
    emit('posted', status)
    nextTick(() => {
      textareaRef.value?.focus()
      if (props.initialText && content.value === props.initialText) {
        const len = content.value.length
        textareaRef.value?.setSelectionRange(len, len)
      }
    })
  } catch (e: any) {
    const raw = (e?.message || '').toString()
    // Mastodon returns this when in_reply_to_id isn't on the posting server
    if (/record not found|not found/i.test(raw) && props.inReplyToId) {
      error.value = 'That post isn’t on your account’s server — try opening the thread and replying there.'
    } else {
      error.value = raw || 'Failed to post'
    }
  } finally {
    isPosting.value = false
  }
}

const toggleCW = () => {
  showCW.value = !showCW.value
  if (!showCW.value) spoilerText.value = ''
}

const openFilePicker = () => {
  if (!canAddMore.value || isPosting.value) return
  fileInputRef.value?.click()
}

const onFilePicked = async (e: Event) => {
  const input = e.target as HTMLInputElement
  await addFiles(input.files)
  input.value = ''
}

const onKeydown = (e: KeyboardEvent) => {
  if (mentionOpen.value && mentionResults.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      mentionIndex.value = (mentionIndex.value + 1) % mentionResults.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      mentionIndex.value =
        (mentionIndex.value - 1 + mentionResults.value.length) % mentionResults.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      const pick = mentionResults.value[mentionIndex.value]
      if (pick) insertMention(pick)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      closeMentions()
      return
    }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    handlePost()
  }
}

const onComposeInput = () => {
  syncMentions()
}

const focusComposer = () => {
  textareaRef.value?.focus()
}

const applyHandoff = async () => {
  // Only the active composer absorbs Loom shares — not reply bars / hidden mounts
  if (
    !props.acceptHandoff ||
    props.inReplyToId ||
    !handoffStore.hasPending
  ) {
    return
  }
  const draft = handoffStore.take()
  if (!draft) return
  // Prefer handoff text; keep existing if user already typed and draft is media-only
  if (draft.text && (!content.value.trim() || draft.files.length)) {
    content.value = draft.text
  }
  // Replace any prior handoff media so retries don't stack duplicates
  if (draft.files.length) {
    clearAttachments()
    await addFiles(draft.files, draft.descriptions)
  }
  handoffNotice.value = draft.notice
  if (handoffNotice.value) {
    window.setTimeout(() => {
      handoffNotice.value = null
    }, 9000)
  }
  await nextTick()
  const ta = textareaRef.value
  if (ta) {
    ta.focus()
    const len = content.value.length
    ta.setSelectionRange(len, len)
    ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  // After media attaches, keep chart + caption in view above the keyboard / Post bar
  if (draft.files.length) {
    await nextTick()
    document
      .querySelector('.compose-sheet .compose-media, .compose-media')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

watch(
  () => handoffStore.hasPending,
  (ready) => {
    if (ready) void applyHandoff()
  },
)

onMounted(() => {
  if (props.inReplyToId && props.initialText) {
    nextTick(() => {
      textareaRef.value?.focus()
      const len = content.value.length
      textareaRef.value?.setSelectionRange(len, len)
    })
  }
  void applyHandoff()
})
</script>

<template>
  <div
    class="compose neo-card"
    :class="{
      'compose--dragging': isDragging,
      'compose--compact': compact,
      'compose--expanded': compactExpanded,
    }"
    @dragenter="onDragEnter"
    @dragleave="onDragLeave"
    @dragover="onDragOver"
    @drop="onDrop"
    @click="focusComposer"
  >
    <div
      v-if="isDragging"
      class="compose-drop"
      aria-hidden="true"
    >
      <span class="compose-drop__icon"><NeoIcon name="image" :size="36" :stroke="1.5" /></span>
      <span class="compose-drop__label">Drop photos to add</span>
    </div>

    <!-- Threads pill: avatar · What's new? · Post -->
    <div v-if="compact" class="compose-pill" @click.stop>
      <img
        v-if="instancesStore.userAvatar"
        :src="instancesStore.userAvatar"
        :alt="instancesStore.userDisplayName"
        class="compose-avatar neo-avatar"
      />
      <div class="compose-input-wrap">
        <textarea
          ref="textareaRef"
          v-model="content"
          class="compose-input neo-input"
          :placeholder="placeholder"
          rows="1"
          :disabled="isPosting"
          :aria-label="title || placeholder || 'Write a post'"
          @focus="composeFocused = true"
          @blur="composeFocused = false"
          @paste="onPaste"
          @keydown="onKeydown"
          @input="onComposeInput"
          @click="syncMentions"
          @keyup="syncMentions"
        />
        <div
          v-if="mentionOpen && (mentionResults.length || mentionSearching)"
          class="compose-mentions"
          role="listbox"
          aria-label="Mention suggestions"
        >
          <p v-if="mentionSearching && !mentionResults.length" class="compose-mentions__status">
            Looking up…
          </p>
          <button
            v-for="(account, idx) in mentionResults"
            :key="account.id"
            type="button"
            class="compose-mentions__item"
            :class="{ 'compose-mentions__item--active': idx === mentionIndex }"
            role="option"
            :aria-selected="idx === mentionIndex"
            @mousedown.prevent="insertMention(account)"
          >
            <img :src="account.avatar" alt="" class="compose-mentions__avatar" />
            <span class="compose-mentions__meta">
              <span class="compose-mentions__name">{{ account.displayName || account.username }}</span>
              <span class="compose-mentions__acct">{{ accountHandle(account) }}</span>
            </span>
          </button>
        </div>
      </div>
      <button
        type="button"
        class="compose-submit neo-btn neo-btn--primary"
        :disabled="!canPost"
        :title="isUploading ? 'Waiting for uploads…' : inReplyToId ? 'Reply (⌘↵)' : 'Post (⌘↵)'"
        @click="handlePost"
      >
        <span v-if="isPosting">{{ inReplyToId ? 'Replying…' : 'Posting…' }}</span>
        <span v-else-if="isUploading">…</span>
        <span v-else>{{ inReplyToId ? 'Reply' : 'Post' }}</span>
      </button>
    </div>

    <template v-else>
      <div v-if="!inReplyToId && !quoteUrl" class="compose-header" @click.stop>
        <img
          v-if="instancesStore.userAvatar"
          :src="instancesStore.userAvatar"
          :alt="instancesStore.userDisplayName"
          class="compose-avatar neo-avatar"
        />
        <div class="compose-heading">
          <div class="compose-title-row">
            <button
              v-if="canSwitchPostingAccount"
              type="button"
              class="compose-title compose-title--btn"
              title="Switch account"
              aria-label="Switch posting account"
              @click="cyclePostingAccount"
            >
              {{ instancesStore.userDisplayName || postingAs || 'You' }}
            </button>
            <span v-else class="compose-title">
              {{ instancesStore.userDisplayName || postingAs || title }}
            </span>
            <ComposeGroupPicker
              v-if="showGroupPicker"
              v-model="selectedGroupTag"
              inline
            />
          </div>
        </div>
      </div>

      <div class="compose-input-wrap" @click.stop>
        <textarea
          ref="textareaRef"
          v-model="content"
          class="compose-input neo-input"
          :placeholder="placeholder"
          :rows="3"
          :disabled="isPosting"
          :aria-label="title || placeholder || 'Write a post'"
          @paste="onPaste"
          @keydown="onKeydown"
          @input="onComposeInput"
          @click="syncMentions"
          @keyup="syncMentions"
        />

        <div
          v-if="mentionOpen && (mentionResults.length || mentionSearching)"
          class="compose-mentions"
          role="listbox"
          aria-label="Mention suggestions"
        >
          <p v-if="mentionSearching && !mentionResults.length" class="compose-mentions__status">
            Looking up…
          </p>
          <button
            v-for="(account, idx) in mentionResults"
            :key="account.id"
            type="button"
            class="compose-mentions__item"
            :class="{ 'compose-mentions__item--active': idx === mentionIndex }"
            role="option"
            :aria-selected="idx === mentionIndex"
            @mousedown.prevent="insertMention(account)"
          >
            <img :src="account.avatar" alt="" class="compose-mentions__avatar" />
            <span class="compose-mentions__meta">
              <span class="compose-mentions__name">{{ account.displayName || account.username }}</span>
              <span class="compose-mentions__acct">{{ accountHandle(account) }}</span>
            </span>
          </button>
        </div>
      </div>
    </template>

    <div v-if="showCW" class="compose-cw" @click.stop>
      <input
        v-model="spoilerText"
        type="text"
        class="compose-cw-input neo-input"
        placeholder="Content warning"
        aria-label="Content warning"
        :disabled="isPosting"
      />
    </div>

    <!-- Media previews -->
    <div v-if="attachments.length" class="compose-media" @click.stop>
      <div
        v-for="item in attachments"
        :key="item.localId"
        class="compose-media__item"
        :class="{
          'compose-media__item--busy': item.uploading,
          'compose-media__item--error': !!item.error,
        }"
      >
        <img
          v-if="item.file.type.startsWith('image/')"
          :src="item.previewUrl"
          :alt="item.description || ''"
          class="compose-media__thumb"
        />
        <div v-else class="compose-media__video">
          <span>🎬</span>
          <span class="compose-media__video-name">{{ item.file.name }}</span>
        </div>
        <div v-if="item.uploading" class="compose-media__overlay">Uploading…</div>
        <div
          v-else-if="item.error"
          class="compose-media__overlay compose-media__overlay--error"
          role="button"
          tabindex="0"
          title="Tap to retry upload"
          @click="retryUpload(item.localId)"
          @keydown.enter="retryUpload(item.localId)"
        >
          {{ item.error }} · retry
        </div>
        <button
          type="button"
          class="compose-media__remove"
          aria-label="Remove"
          :disabled="isPosting"
          @click="removeAttachment(item.localId)"
        >
          <NeoIcon name="x" :size="12" :stroke="2.5" />
        </button>
        <label class="compose-media__alt">
          <span class="compose-media__alt-label">Alt text</span>
          <textarea
            class="compose-media__alt-input"
            rows="2"
            :maxlength="altMax"
            :disabled="isPosting || item.uploading"
            :value="item.description"
            placeholder="Describe this image for screen readers"
            @input="setDescription(item.localId, ($event.target as HTMLTextAreaElement).value)"
            @click.stop
          />
        </label>
      </div>
    </div>

    <div v-if="handoffNotice" class="compose-handoff" role="status">{{ handoffNotice }}</div>

    <div
      v-if="error"
      class="compose-error"
      role="alert"
      @click.stop
    >{{ error }}</div>

    <div v-if="!compact || compactExpanded" class="compose-footer" @click.stop>
      <div class="compose-tools">
        <input
          ref="fileInputRef"
          type="file"
          class="compose-file"
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime"
          multiple
          @change="onFilePicked"
        />
        <button
          type="button"
          class="compose-tool"
          aria-label="Add photo"
          title="Add photo"
          :disabled="!canAddMore || isPosting"
          @click="openFilePicker"
        >
          <NeoIcon name="image" :size="18" :stroke="1.75" />
        </button>
        <button
          type="button"
          class="compose-tool"
          :class="{ 'compose-tool--active': showCW }"
          aria-label="Content warning"
          title="Content warning"
          :aria-pressed="showCW"
          :disabled="isPosting"
          @click="toggleCW"
        >
          CW
        </button>

        <div v-if="!isDirectCompose" class="compose-visibility">
          <select
            v-model="visibility"
            class="compose-visibility-select"
            :disabled="isPosting"
            aria-label="Post visibility"
          >
            <option v-for="opt in visibilityOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>
        <span v-else class="compose-visibility-lock" title="Only mentioned people can see this">
          <NeoIcon name="lock" :size="14" :stroke="2" />
          Private
        </span>

        <span v-if="hasMedia" class="compose-media-count">
          {{ attachments.length }}/{{ maxAttachments }}
        </span>
      </div>

      <div v-if="!compact" class="compose-actions">
        <span
          class="compose-counter"
          :class="{
            'compose-counter--warning': characterCount > effectiveMaxLength * 0.9,
            'compose-counter--error': isOverLimit,
          }"
          :aria-live="isOverLimit ? 'assertive' : 'off'"
        >
          <span class="sr-only" v-if="isOverLimit">Character limit exceeded. </span>
          {{ characterCount }}/{{ effectiveMaxLength }}
        </span>

        <button
          type="button"
          class="compose-submit neo-btn neo-btn--primary"
          :disabled="!canPost"
          :title="isUploading ? 'Waiting for uploads…' : isDirectCompose ? 'Send (⌘↵)' : 'Post (⌘↵)'"
          @click="handlePost"
        >
          <span v-if="isPosting">{{ isDirectCompose ? 'Sending…' : 'Posting…' }}</span>
          <span v-else-if="isUploading">Uploading…</span>
          <span v-else>{{ isDirectCompose ? 'Send' : 'Post' }}</span>
        </button>
      </div>
      <span
        v-else
        class="compose-counter"
        :class="{
          'compose-counter--warning': characterCount > effectiveMaxLength * 0.9,
          'compose-counter--error': isOverLimit,
        }"
      >
        {{ characterCount }}/{{ effectiveMaxLength }}
      </span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.compose {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 100%;
  /* Don't clip textarea glyphs against rounded card corners */
  overflow: visible;
  box-sizing: border-box;
  cursor: text;

  &--dragging {
    overflow: hidden;
    border-color: var(--neo-accent);
    background: color-mix(in srgb, var(--neo-accent) 6%, var(--neo-bg-card));
  }

  &--compact {
    gap: 0;
    padding: 0;
    background: transparent;
    border: none;
    box-shadow: none;
    border-radius: 0;
    /* Avoid clipping multiline text against rounded corners */
    overflow: visible;

    .compose-pill {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      padding: 0.4rem 0.45rem 0.4rem 0.5rem;
      border: 1px solid var(--neo-border-color);
      border-radius: 12px;
      background: var(--neo-bg-card, var(--neo-bg-secondary));
      transition:
        border-radius 0.18s ease,
        border-color 0.18s ease,
        background-color 0.18s ease,
        padding 0.18s ease;
    }

    .compose-avatar {
      width: 32px;
      height: 32px;
      margin-top: 0.1rem;
    }

    .compose-input-wrap {
      flex: 1;
      min-width: 0;
    }

    .compose-input {
      min-height: 0;
      padding: 0.35rem 0;
      border: none;
      background: transparent;
      box-shadow: none;
      // ≥16px absolute — stops iOS/iPad focus zoom (root rem is 15px)
      font-size: max(16px, 1rem);
      line-height: 1.35;
      resize: none;
      field-sizing: content;
      max-height: 6.5rem;

      &:focus {
        outline: none;
      }
    }

    .compose-submit {
      flex-shrink: 0;
      align-self: flex-start;
      margin-top: 0.05rem;
      min-height: 32px;
      padding: 0.3rem 0.85rem;
      border-radius: 10px;
      font-size: 0.8125rem;
    }

    .compose-counter {
      margin-left: auto;
      font-size: 0.75rem;
      color: var(--neo-text-muted);
    }
  }

  /* Expanded: one shell so the rule is a seam, not a floating stroke */
  &--compact.compose--expanded {
    gap: 0;
    padding: 0.5rem 0.6rem 0.4rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card, var(--neo-bg-secondary));
    box-shadow: none;
    overflow: visible;

    .compose-pill {
      border: none;
      border-radius: 0;
      background: transparent;
      padding: 0.05rem 0 0.5rem;
    }

    .compose-cw {
      margin: 0 0 0.45rem;
    }

    .compose-cw-input {
      border-radius: 10px;
    }

    .compose-media {
      margin: 0 0 0.45rem;
    }

    .compose-error,
    .compose-handoff {
      margin: 0 0 0.45rem;
    }

    .compose-footer {
      margin-top: 0;
      padding: 0.4rem 0 0.05rem;
      border-top: 1px solid color-mix(in srgb, var(--neo-border-color) 85%, transparent);
    }

    .compose-visibility-select {
      border-radius: 10px;
    }
  }

  &--compact:not(.compose--expanded) {
    .compose-footer {
      display: none;
    }
  }
}

.compose-drop {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  background: color-mix(in srgb, var(--neo-bg-card) 88%, var(--neo-accent));
  border: 2px dashed var(--neo-accent);
  border-radius: inherit;
  pointer-events: none;

  &__icon {
    font-size: 1.75rem;
  }

  &__label {
    font-family: var(--neo-font-family-ui);
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--neo-accent);
  }
}

.compose-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  cursor: default;
  flex-shrink: 0;
}

.compose-heading {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.compose-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem 0.55rem;
  min-width: 0;
}

.compose-avatar {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
}

.compose-title {
  font-family: var(--neo-font-family-ui);
  font-size: 0.9375rem;
  font-weight: 650;
  color: var(--neo-text-primary);
  letter-spacing: -0.01em;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &--btn {
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: inherit;
    font-weight: inherit;
    color: inherit;
    letter-spacing: inherit;
    text-align: left;

    &:hover {
      color: var(--neo-accent);
    }
  }
}

.compose-as {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;

  &--switch {
    cursor: pointer;
    color: var(--neo-text-secondary);

    &:hover {
      color: var(--neo-accent);
    }
  }

  &__hint {
    flex-shrink: 0;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: var(--neo-bg-tertiary);
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--neo-text-muted);
  }
}

.compose-cw-input {
  background-color: var(--neo-bg-tertiary);
  border-color: var(--neo-warning);
}

.compose-input-wrap {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.compose-mentions {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 0.25rem);
  z-index: 30;
  max-height: 220px;
  overflow-y: auto;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  box-shadow: var(--neo-shadow-lg);
}

.compose-mentions__status {
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.compose-mentions__item {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  min-height: 48px;

  &:hover,
  &--active {
    background: var(--neo-bg-tertiary);
  }
}

.compose-mentions__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.compose-mentions__meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.05rem;
}

.compose-mentions__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compose-mentions__acct {
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.compose-input {
  resize: none;
  flex: 1;
  min-height: 8rem;
  max-height: none;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border: none;
  background: transparent;
  /* Horizontal inset so text clears rounded corners / bubble radius */
  padding: 0.45rem 0.65rem;
  border-radius: 10px;
  font-size: 1.0625rem;
  line-height: 1.45;
  field-sizing: content;

  &:focus {
    outline: none;
    box-shadow: none;
    border: none;
  }

  &::placeholder {
    color: var(--neo-text-disabled);
  }
}

.compose-media {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.compose-media__item {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 0.65rem;
  align-items: start;
  position: relative;
  padding: 0.5rem;
  border-radius: var(--neo-radius-md);
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);

  &--busy,
  &--error {
    .compose-media__thumb {
      opacity: 0.55;
    }
  }
}

.compose-media__thumb {
  width: 96px;
  height: 96px;
  object-fit: cover;
  display: block;
  border-radius: calc(var(--neo-radius-md) - 2px);
}

.compose-media__video {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  width: 96px;
  height: 96px;
  padding: 0.5rem;
  font-size: 1.25rem;
  border-radius: calc(var(--neo-radius-md) - 2px);
  background: var(--neo-bg-secondary);
}

.compose-media__video-name {
  font-size: 0.625rem;
  color: var(--neo-text-muted);
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.compose-media__overlay {
  position: absolute;
  left: 0.5rem;
  top: 0.5rem;
  width: 96px;
  height: 96px;
  display: grid;
  place-items: center;
  padding: 0.35rem;
  font-size: 0.6875rem;
  font-weight: 600;
  text-align: center;
  color: var(--neo-text-primary);
  background: color-mix(in srgb, var(--neo-bg-card) 55%, transparent);
  backdrop-filter: blur(2px);
  border-radius: calc(var(--neo-radius-md) - 2px);

  &--error {
    color: var(--neo-danger);
  }
}

.compose-media__remove {
  position: absolute;
  top: 0.35rem;
  left: calc(0.5rem + 96px - 1.65rem);
  width: 1.5rem;
  height: 1.5rem;
  display: grid;
  place-items: center;
  font-size: 1rem;
  line-height: 1;
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
  border: none;
  border-radius: 50%;
  cursor: pointer;
  z-index: 1;

  &:hover {
    background: rgba(0, 0, 0, 0.85);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.compose-media__alt {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.compose-media__alt-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.compose-media__alt-input {
  width: 100%;
  min-height: 3.25rem;
  padding: 0.45rem 0.55rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--neo-text-primary);
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-md);
  resize: vertical;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }

  &:disabled {
    opacity: 0.6;
  }

  &::placeholder {
    color: var(--neo-text-disabled);
  }
}

.compose-error {
  padding: 0.65rem 0.75rem;
  background-color: var(--neo-danger-soft);
  border: 1px solid color-mix(in srgb, var(--neo-danger) 35%, transparent);
  border-radius: var(--neo-radius-md);
  color: var(--neo-danger);
  font-size: 0.8125rem;
  cursor: default;
}

.compose-handoff {
  padding: 0.65rem 0.75rem;
  background: var(--neo-accent-soft);
  border: 1px solid color-mix(in srgb, var(--neo-accent) 35%, transparent);
  border-radius: var(--neo-radius-md);
  color: var(--neo-accent);
  font-size: 0.8125rem;
}

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 0.35rem;
  border-top: 1px solid var(--neo-border-color);
  cursor: default;
}

.compose-tools {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex-wrap: wrap;
}

.compose-file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
}

.compose-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.25rem;
  height: 2.25rem;
  padding: 0 0.5rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--neo-text-secondary);
  background: transparent;
  border: none;
  border-radius: var(--neo-radius-chrome, var(--neo-radius-md));
  cursor: pointer;
  transition: background-color var(--neo-transition-fast), color var(--neo-transition-fast);

  &:hover:not(:disabled) {
    color: var(--neo-accent);
    background-color: var(--neo-accent-soft);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &--active {
    color: var(--neo-text-primary);
    background-color: color-mix(in srgb, var(--neo-warning) 35%, transparent);
  }
}

.compose-visibility {
  margin-left: 0.25rem;
}

.compose-visibility-lock {
  margin-left: 0.25rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-muted);
  white-space: nowrap;
  padding: 0 0.35rem;
}

.compose-visibility-select {
  padding: 0.35rem 0.45rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.75rem;
  background-color: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-chrome, var(--neo-radius-md));
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }
}

.compose-media-count {
  margin-left: 0.35rem;
  font-size: 0.6875rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;
}

.compose-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.compose-counter {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;

  &--warning {
    color: var(--neo-warning);
  }

  &--error {
    color: var(--neo-danger);
    font-weight: 600;
  }
}

.compose-submit {
  min-width: 5.5rem;
}

.compose-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
