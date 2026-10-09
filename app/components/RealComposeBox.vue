<script setup lang="ts">
/**
 * Compose — Threads-easy posting: drag/drop, paste, previews, Cmd+Enter
 */

import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useSettingsStore } from '~/stores/settings'
import { useComposeHandoffStore } from '~/stores/composeHandoff'
import { useComposeMedia } from '~/composables/useComposeMedia'
import { COMPOSE_MEDIA_ACCEPT } from '~/utils/composeConstants'
import { isImeEvent } from '~/composables/useComposerCore'
import { useDraft } from '~/composables/useDraft'
import { mastodonLength } from '~/utils/mastodonLength'
import { accountHandle, useAccountSearch } from '~/composables/useAccountSearch'
import { useOverlayStore } from '~/stores/overlay'
import { httpStatusFrom, mapComposeError } from '~/utils/friendlyError'
import type { mastodon } from 'masto'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'

const isApplePlatform = (() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
    ?.platform || navigator.platform || ''
  return /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS|iPhone|iPad|iPod/i.test(ua)
})()
const submitModHint = isApplePlatform ? '⌘↵' : 'Ctrl+Enter'
const submitKeyshortcuts = isApplePlatform ? 'Meta+Enter' : 'Control+Enter'

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const props = withDefaults(
  defineProps<{
    /** When set, posts as a reply to this status */
    inReplyToId?: string
    /** Append this URL when quoting (fediverse-friendly quote) */
    quoteUrl?: string
    /** Quoted post preview + local id for quoted_status_id when supported */
    quoteContext?: {
      id?: string
      name: string
      handle: string
      avatar?: string | null
      text: string
    } | null
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
    /** Keep the group tag locked (no picker) — group page compose */
    lockGroup?: boolean
    /**
     * Absorb Loom / cross-app handoff drafts.
     * Only one visible composer should accept — mobile sheet vs desktop column.
     */
    acceptHandoff?: boolean
    /** Soft-disable (reply dock resolving, etc.) — keeps layout, blocks input/submit */
    disabled?: boolean
    /**
     * Handles to mention on send (not shown in the field) — Threads-style reply /
     * ChatComposer pattern so the field stays empty and readable.
     */
    mentionAccts?: string[]
    /** Hide the footer Post button — parent shows it in sheet header instead */
    submitInHeader?: boolean
  }>(),
  {
    placeholder: "What's new?",
    title: "What's new?",
    compact: false,
    lockGroup: false,
    acceptHandoff: true,
    disabled: false,
    submitInHeader: false,
  },
)

const emit = defineEmits<{
  posted: [status: mastodon.v1.Status]
}>()

const statusStore = useStatusStore()
const instancesStore = useInstancesStore()
const settingsStore = useSettingsStore()
const handoffStore = useComposeHandoffStore()
const overlayStore = useOverlayStore()

const content = ref(props.initialText || '')
const spoilerText = ref('')
const visibility = ref<'public' | 'unlisted' | 'private' | 'direct'>(
  props.initialVisibility || settingsStore.defaultVisibility,
)
/** datetime-local value (local wall clock); empty = post now */
const scheduledLocal = ref('')
const showCW = ref(false)
const markSensitive = ref(settingsStore.defaultSensitive)
const postLanguage = ref(settingsStore.defaultLanguage)
const isPosting = ref(false)
const error = ref<string | null>(null)
const handoffNotice = ref<string | null>(null)
let handoffNoticeTimer: ReturnType<typeof setTimeout> | null = null
const textareaRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const composeMediaRef = ref<HTMLElement | null>(null)
const composeFocused = ref(false)
const reduceMotion = usePrefersReducedMotion()
/** Smooth scroll unless the user asked for less motion */
const scrollBehavior = (): ScrollBehavior => (reduceMotion.value ? 'auto' : 'smooth')

/** Keep the field above the soft keyboard — sheets own their scrollport. */
const onComposeFocus = () => {
  composeFocused.value = true
  if (typeof window === 'undefined' || !textareaRef.value) return
  // Compose sheet / fixed docks: parent keyboard helpers already pin + inset
  if (textareaRef.value.closest('.compose-sheet, .chat-composer, [data-keyboard-fixed]')) return
  window.setTimeout(() => {
    if (!textareaRef.value) return
    scrollFieldIntoKeyboardView(textareaRef.value, { behavior: scrollBehavior() })
  }, 280)
}
const selectedGroupTag = ref<string | null>(
  props.initialGroupTag ? props.initialGroupTag.replace(/^#/, '') : null,
)
// Unique per composer — the sheet can open over a page composer (groups, thread)
const mentionListId = `compose-mention-list-${useId()}`
const counterAnnounce = ref('')

/** Only lock the visibility control when compose started as a DM */
const isLockedDirect = computed(() => props.initialVisibility === 'direct')

const composeAriaLabel = computed(() => {
  if (props.inReplyToId) return props.title || 'Write a reply'
  if (props.quoteUrl) return props.title || 'Write a quote post'
  if (props.initialVisibility === 'direct') return props.title || 'Write a direct message'
  return props.title || props.placeholder || 'Write a post'
})

const hasSchedule = computed(() => !!scheduledLocal.value.trim())

const submitAriaLabel = computed(() => {
  if (isPosting.value) {
    if (hasSchedule.value) return 'Scheduling'
    return props.inReplyToId ? 'Sending reply' : 'Posting'
  }
  if (isUploading.value) return 'Uploading attachments'
  if (hasSchedule.value) return 'Schedule post'
  if (props.compact) return props.inReplyToId ? 'Send reply' : 'Post'
  return props.inReplyToId ? 'Reply' : 'Post'
})

/** Mastodon requires ≥5 minutes ahead — expose a floor for the picker */
const scheduleMinLocal = computed(() => {
  const d = new Date(Date.now() + 5 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
})

const scheduledAtIso = computed(() => {
  const local = scheduledLocal.value.trim()
  if (!local) return undefined
  const when = new Date(local)
  if (!Number.isFinite(when.getTime())) return undefined
  return when.toISOString()
})

const isScheduledResult = (
  result: mastodon.v1.Status | mastodon.v1.ScheduledStatus,
): result is mastodon.v1.ScheduledStatus =>
  'scheduledAt' in result && typeof (result as mastodon.v1.ScheduledStatus).scheduledAt === 'string' && !('account' in result)

/** Current post is a private mention/DM (locked or user-chosen) */
const isDirectCompose = computed(
  () => isLockedDirect.value || visibility.value === 'direct',
)

const showGroupPicker = computed(
  () => !isDirectCompose.value && !props.compact && !props.lockGroup,
)

const draftKey = computed(() => {
  // Per conversation / recipient: one shared 'dm' slot restored Alice's private
  // draft into a message to Bob.
  if (props.initialVisibility === 'direct') {
    const to = props.inReplyToId || (props.initialText || '').trim().toLowerCase()
    return to ? `dm:${to}` : 'dm'
  }
  if (props.inReplyToId) return `reply:${props.inReplyToId}`
  if (props.quoteUrl) return `quote:${props.quoteUrl}`
  const tag = props.initialGroupTag?.replace(/^#/, '').trim()
  if (tag) return `group:${tag}`
  return 'new'
})

const {
  text: draftText,
  spoiler: draftSpoiler,
  visibility: draftVisibility,
  restore: restoreDraft,
  clear: clearDraft,
  scheduleSave: scheduleDraftSave,
} = useDraft(draftKey)

const applyDraft = () => {
  if (draftText.value) {
    content.value = draftText.value
  }
  if (draftSpoiler.value) {
    spoilerText.value = draftSpoiler.value
    showCW.value = true
  }
  if (draftVisibility.value && !isLockedDirect.value) {
    visibility.value = draftVisibility.value
  }
}

const persistDraft = () => {
  // The prefilled "@handle " alone isn't a draft (and kept a junk key per reply)
  draftText.value =
    content.value.trim() === (props.initialText || '').trim() ? '' : content.value
  draftSpoiler.value = showCW.value ? spoilerText.value : ''
  draftVisibility.value = visibility.value
  scheduleDraftSave()
}

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
  clearHandoffAttachments,
  uploadAnnounce,
  retryUpload,
  setDescription,
  flushAltDescriptions,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onPaste,
} = useComposeMedia()

/** Typed something beyond the reply's prefilled @mention */
const hasOwnContent = computed(() => {
  const text = content.value.trim()
  return !!text && text !== (props.initialText || '').trim()
})

/** Screen-reader confirmation — the form just resets on success otherwise */
const postAnnounce = ref('')
let postAnnounceTimer: ReturnType<typeof setTimeout> | null = null
const announcePosted = (message: string) => {
  postAnnounce.value = message
  if (postAnnounceTimer) clearTimeout(postAnnounceTimer)
  postAnnounceTimer = setTimeout(() => {
    postAnnounce.value = ''
  }, 4000)
}
onBeforeUnmount(() => {
  if (postAnnounceTimer) clearTimeout(postAnnounceTimer)
})

/** Threads pill: stay one row until you engage */
const compactExpanded = computed(
  () =>
    !props.compact ||
    composeFocused.value ||
    hasOwnContent.value ||
    hasMedia.value ||
    showCW.value ||
    !!error.value ||
    !!handoffNotice.value,
)

const maxLength = computed(() => instancesStore.statusMaxCharacters)

const groupTagSuffix = computed(() => {
  const tag = selectedGroupTag.value?.replace(/^#/, '').trim()
  if (!tag || isDirectCompose.value) return ''
  const already = new RegExp(`(?:^|\\s)#${escapeRegExp(tag)}(?=$|\\s|[\\p{P}\\p{S}])`, 'iu').test(
    content.value,
  )
  return already ? '' : ` #${tag}`
})

const effectiveMaxLength = computed(() => maxLength.value - groupTagSuffix.value.length)
/** Mentions added on send (not shown) still count toward the limit */
const mentionPrefixLen = computed(() => {
  let scratch = content.value.trim()
  let added = 0
  for (const raw of props.mentionAccts || []) {
    const acct = raw.replace(/^@/, '').trim()
    if (!acct) continue
    const mention = `@${acct}`
    const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const already = new RegExp(
      `(?:^|[\\s\\u200B])${escaped}(?=$|[\\s\\u200B]|[^\\w.])`,
      'i',
    ).test(` ${scratch} `)
    if (!already) {
      added += mastodonLength(mention) + (scratch ? 1 : 0)
      scratch = scratch ? `${mention} ${scratch}` : mention
    }
  }
  return added
})

/** Count status body + quote URL + CW the way Mastodon weighs characters */
const characterCount = computed(() => {
  let body = content.value
  const quote = props.quoteUrl?.trim()
  if (quote && !body.includes(quote)) {
    body = `${body.trim()}${body.trim() ? '\n\n' : ''}${quote}`
  }
  const cw = showCW.value ? spoilerText.value : ''
  return mastodonLength(body) + mentionPrefixLen.value + (cw ? mastodonLength(cw) : 0)
})
const isOverLimit = computed(() => characterCount.value > effectiveMaxLength.value)
const isNearLimit = computed(
  () => characterCount.value > effectiveMaxLength.value * 0.9 && !isOverLimit.value,
)
const missingAltCount = computed(
  () =>
    attachments.value.filter(
      (a) => !a.uploading && !a.error && a.remoteId && !a.description?.trim(),
    ).length,
)
const canPost = computed(() => {
  const hasText = content.value.trim().length > 0
  const hasQuote = !!props.quoteUrl
  return (
    (hasText || hasMedia.value || hasQuote) &&
    !isOverLimit.value &&
    !isPosting.value &&
    !isUploading.value &&
    !props.disabled &&
    allReady.value &&
    instancesStore.isAuthenticated
  )
})

const inputLocked = computed(() => isPosting.value || props.disabled)

const postingAs = computed(() => {
  const account = instancesStore.activeAccount
  if (!account?.user) return null
  const acct = account.user.acct || account.user.username
  const host = account.url.replace(/^https?:\/\//, '')
  return acct.includes('@') ? `@${acct}` : `@${acct}@${host}`
})

/** Media / reply IDs belong to the active server — switching mid-compose breaks the post */
const canSwitchPostingAccount = computed(
  () =>
    instancesStore.authenticatedInstances.length > 1 &&
    !hasMedia.value &&
    !isUploading.value &&
    !props.inReplyToId,
)

const cyclePostingAccount = () => {
  if (!canSwitchPostingAccount.value) return
  instancesStore.cycleActiveAccount()
}

watch([characterCount, isOverLimit, isNearLimit], () => {
  if (isOverLimit.value) {
    counterAnnounce.value = `Over character limit by ${characterCount.value - effectiveMaxLength.value}`
  } else if (isNearLimit.value) {
    counterAnnounce.value = `${effectiveMaxLength.value - characterCount.value} characters left`
  } else {
    counterAnnounce.value = ''
  }
})

const visibilityOptions = [
  { value: 'public', label: 'Public', icon: '🌐' },
  { value: 'unlisted', label: 'Unlisted', icon: '🔓' },
  { value: 'private', label: 'Followers only', icon: '🔒' },
  { value: 'direct', label: 'Direct', icon: '✉️' },
] as const

const BASE_LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
] as const

const languageOptions = computed(() => {
  const cur = postLanguage.value
  if (cur && !BASE_LANGUAGE_OPTIONS.some((o) => o.code === cur)) {
    return [{ code: cur, label: cur.toUpperCase() }, ...BASE_LANGUAGE_OPTIONS]
  }
  return [...BASE_LANGUAGE_OPTIONS]
})

const mentionFlipUp = ref(false)

const syncMentionPlacement = () => {
  if (typeof window === 'undefined' || !mentionOpen.value) return
  const ta = textareaRef.value
  if (!ta) return
  const rect = ta.getBoundingClientRect()
  const vv = window.visualViewport
  const viewportBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  mentionFlipUp.value = viewportBottom - rect.bottom < 240
}

const resetForm = () => {
  content.value = props.inReplyToId && props.initialText ? props.initialText : ''
  spoilerText.value = ''
  showCW.value = false
  markSensitive.value = settingsStore.defaultSensitive
  visibility.value = props.initialVisibility || settingsStore.defaultVisibility
  scheduledLocal.value = ''
  selectedGroupTag.value = props.initialGroupTag
    ? props.initialGroupTag.replace(/^#/, '')
    : null
  clearAttachments()
  error.value = null
  closeMentions()
}

const clearSchedule = () => {
  scheduledLocal.value = ''
}

const formatScheduleAnnounce = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
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
/** Only claim "expanded" while the listbox element actually exists */
const mentionListShown = computed(
  () => mentionOpen.value && (mentionSearching.value || mentionResults.value.length > 0),
)
// Fresh results can be shorter than the old list — keep the highlight on a real row
watch(mentionResults, (list) => {
  if (mentionIndex.value >= list.length) mentionIndex.value = 0
})
const activeMentionId = computed(() => {
  const pick = mentionResults.value[mentionIndex.value]
  return pick ? `${mentionListId}-${pick.id}` : undefined
})

const submitShortcutTitle = computed(() => {
  if (isUploading.value) return 'Waiting for uploads…'
  if (props.inReplyToId) return `Reply (${submitModHint})`
  if (isDirectCompose.value) return `Send (${submitModHint})`
  return `Post (${submitModHint})`
})

const closeMentions = () => {
  mentionOpen.value = false
  mentionFlipUp.value = false
  mentionIndex.value = 0
  mentionAt.value = -1
  clearMentions()
}

const getMentionContext = () => {
  const el = textareaRef.value
  const caret = el?.selectionStart ?? content.value.length
  const before = content.value.slice(0, caret)
  const m = before.match(/(?:^|[\s([{“"'‘])@([a-zA-Z0-9_.@/-]*)$/)
  if (!m) return null
  const query = m[1] ?? ''
  const start = before.length - query.length - 1
  return { start, query, caret }
}

const syncMentions = (opts?: { resetIndex?: boolean }) => {
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
  const queryChanged = mentionAt.value !== ctx.start || !mentionOpen.value
  mentionAt.value = ctx.start
  mentionOpen.value = true
  if (opts?.resetIndex !== false && queryChanged) {
    mentionIndex.value = 0
  }
  searchMentions(ctx.query)
  nextTick(syncMentionPlacement)
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
      markSensitive.value = sensitive
    }
  },
)

const prependMentions = (text: string) => {
  let body = text.trim()
  const accts = (props.mentionAccts || [])
    .map((a) => a.replace(/^@/, '').trim())
    .filter(Boolean)
  for (const acct of accts) {
    const mention = `@${acct}`
    const escaped = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const already = new RegExp(
      `(?:^|[\\s\\u200B])${escaped}(?=$|[\\s\\u200B]|[^\\w.])`,
      'i',
    ).test(` ${body} `)
    if (!already) body = body ? `${mention} ${body}` : mention
  }
  return body
}

const handlePost = async () => {
  if (!canPost.value) return

  if (missingAltCount.value > 0) {
    const ok = await overlayStore.openConfirm({
      title: 'Add image descriptions?',
      body:
        missingAltCount.value === 1
          ? 'One image has no alt text. Post anyway?'
          : `${missingAltCount.value} images have no alt text. Post anyway?`,
      confirmLabel: 'Post without alt',
    })
    // The world may have moved while the dialog was up (another submit, upload error)
    if (!ok || !canPost.value) return
  }

  isPosting.value = true
  error.value = null

  try {
    let body = prependMentions(content.value)
    const quote = props.quoteUrl?.trim()
    if (quote && !body.includes(quote)) {
      body = `${body.trim()}\n\n${quote}`
    }
    const tag = selectedGroupTag.value?.replace(/^#/, '').trim()
    // Never append community tags to private messages
    if (tag && visibility.value !== 'direct' && props.initialVisibility !== 'direct') {
      const hasTag = new RegExp(`(?:^|\\s)#${escapeRegExp(tag)}(?=$|\\s|[\\p{P}\\p{S}])`, 'iu').test(body)
      if (!hasTag) body = `${body.trim()} #${tag}`.trim()
    }

    await flushAltDescriptions()
    const postVisibility: typeof visibility.value =
      props.initialVisibility === 'direct' || visibility.value === 'direct'
        ? 'direct'
        : visibility.value

    if (hasSchedule.value && !scheduledAtIso.value) {
      throw new Error('Pick a valid schedule time')
    }

    const quotedStatusId = props.quoteContext?.id?.trim() || undefined
    const postOpts = {
      visibility: postVisibility,
      spoilerText: showCW.value ? spoilerText.value : undefined,
      mediaIds: mediaIds.value,
      sensitive: markSensitive.value || undefined,
      inReplyToId: props.inReplyToId,
      language: postLanguage.value || undefined,
      scheduledAt: scheduledAtIso.value,
    }

    let result: mastodon.v1.Status | mastodon.v1.ScheduledStatus
    try {
      result = await statusStore.postStatus(body, {
        ...postOpts,
        quotedStatusId,
      })
    } catch (e: unknown) {
      // Native quotes aren't universal — fall back to the URL already in the body
      const code = httpStatusFrom(e)
      if (quotedStatusId && (code === 404 || code === 422)) {
        result = await statusStore.postStatus(body, postOpts)
      } else {
        throw e
      }
    }
    clearDraft()
    resetForm()
    if (isScheduledResult(result)) {
      announcePosted(`Scheduled for ${formatScheduleAnnounce(result.scheduledAt)}`)
    } else {
      emit('posted', result)
      announcePosted(props.inReplyToId ? 'Reply posted' : 'Posted')
    }
    nextTick(() => {
      textareaRef.value?.focus()
      if (props.initialText && content.value === props.initialText) {
        const len = content.value.length
        textareaRef.value?.setSelectionRange(len, len)
      }
    })
  } catch (e: unknown) {
    error.value = mapComposeError(e, {
      inReplyToId: props.inReplyToId,
      quotedStatusId: props.quoteContext?.id,
      hasMedia: mediaIds.value.length > 0,
    })
  } finally {
    isPosting.value = false
  }
}

const submitLabel = computed(() => {
  if (isPosting.value) {
    if (hasSchedule.value) return 'Scheduling…'
    return props.inReplyToId ? 'Sending…' : 'Posting…'
  }
  if (isUploading.value) return 'Uploading…'
  if (hasSchedule.value) return 'Schedule'
  if (props.inReplyToId) return 'Reply'
  if (isDirectCompose.value) return 'Send'
  return 'Post'
})

const cwInputRef = ref<HTMLInputElement | null>(null)

const toggleCW = () => {
  showCW.value = !showCW.value
  if (!showCW.value) spoilerText.value = ''
  else nextTick(() => cwInputRef.value?.focus())
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
  if (isImeEvent(e)) return
  if (mentionOpen.value && mentionResults.value.length) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      mentionIndex.value = (mentionIndex.value + 1) % mentionResults.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      mentionIndex.value =
        (mentionIndex.value - 1 + mentionResults.value.length) % mentionResults.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      const pick = mentionResults.value[mentionIndex.value]
      if (pick) insertMention(pick)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeMentions()
      return
    }
  }
  // Compact reply / Threads pill: Enter sends (Shift+Enter keeps a newline)
  if (props.compact && e.key === 'Enter' && !e.shiftKey && !(e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    void handlePost()
    return
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void handlePost()
  }
}

const onComposeInput = () => {
  syncMentions({ resetIndex: true })
}

const onMentionKeyup = (e: KeyboardEvent) => {
  // Don't reset arrow selection when navigating the popup
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(e.key)) return
  if (isImeEvent(e)) return
  syncMentions({ resetIndex: true })
}

const focusComposer = () => {
  textareaRef.value?.focus()
}

/** True when `next` looks like the same handoff plus a page/story URL (or is simply fuller). */
const handoffIsUpgrade = (current: string, next: string): boolean => {
  if (next.length <= current.length) return false
  const urlIn = (s: string) => /https?:\/\/\S+/i.test(s)
  if (urlIn(next) && !urlIn(current)) return true
  // Same first line (title / lead) → treat as the postMessage upgrade of the query caption
  const first = (s: string) => s.split(/\n/)[0]?.trim() || ''
  return !!first(current) && first(current) === first(next)
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
  // Prefer handoff text; keep existing if user already typed and draft is media-only.
  // bruh often lands a short query caption first, then upgrades with caption + page link —
  // replace when the new draft is a strict upgrade of what's already in the box.
  if (draft.text) {
    const current = content.value.trim()
    const next = draft.text.trim()
    if (!current) {
      content.value = draft.text
    } else if (next === current || current.includes(next)) {
      /* already have it (or a longer version) */
    } else if (next.includes(current) || handoffIsUpgrade(current, next)) {
      content.value = draft.text
    } else {
      content.value = `${current}\n\n${draft.text}`
    }
  }
  // Replace prior handoff media only — keep attachments the user added themselves
  if (draft.files.length) {
    clearHandoffAttachments()
    await addFiles(draft.files, draft.descriptions, { source: 'handoff' })
  }
  if (handoffNoticeTimer) {
    clearTimeout(handoffNoticeTimer)
    handoffNoticeTimer = null
  }
  handoffNotice.value = draft.notice
  await nextTick()
  const ta = textareaRef.value
  if (ta) {
    // preventScroll: browser default scroll fights the sheet's visualViewport pin (bruh/loom)
    if (document.activeElement !== ta) ta.focus({ preventScroll: true })
    const len = content.value.length
    ta.setSelectionRange(len, len)
    window.setTimeout(() => {
      scrollFieldIntoKeyboardView(ta, { behavior: scrollBehavior() })
    }, 320)
  }
  // After media attaches, keep chart + caption in view above the keyboard / Post bar
  if (draft.files.length) {
    await nextTick()
    if (composeMediaRef.value) {
      scrollFieldIntoKeyboardView(composeMediaRef.value, { behavior: scrollBehavior() })
    }
  }
}

watch(
  () => handoffStore.hasPending,
  (ready) => {
    if (ready) void applyHandoff()
  },
)

watch([content, spoilerText, visibility, showCW], () => {
  persistDraft()
})

const dismissHandoffNotice = () => {
  handoffNotice.value = null
  if (handoffNoticeTimer) {
    clearTimeout(handoffNoticeTimer)
    handoffNoticeTimer = null
  }
}

onMounted(() => {
  restoreDraft()
  applyDraft()
  // Compact reply dock: don't auto-focus (avoids keyboard jump on open).
  // Full reply compose with prefill: caret after mentions.
  if (props.inReplyToId && props.initialText && !props.compact) {
    nextTick(() => {
      const ta = textareaRef.value
      if (!ta) return
      ta.focus({ preventScroll: true })
      const len = content.value.length
      ta.setSelectionRange(len, len)
      window.setTimeout(() => {
        scrollFieldIntoKeyboardView(ta, { behavior: scrollBehavior() })
      }, 320)
    })
  }
  void applyHandoff()
})

onUnmounted(() => {
  if (handoffNoticeTimer) clearTimeout(handoffNoticeTimer)
})

defineExpose({
  submit: handlePost,
  canPost,
  isPosting,
  submitLabel,
  /** Anything the user would lose by closing — own text, CW, or attachments */
  isDirty: computed(
    () => hasOwnContent.value || hasMedia.value || (showCW.value && !!spoilerText.value.trim()),
  ),
  /** Confirmed "Discard" — drop the saved draft too, or it comes back next open */
  discardDraft: () => clearDraft(),
})
</script>

<template>
  <div
    class="compose neo-card"
    :class="{
      'compose--dragging': isDragging,
      'compose--compact': compact,
      'compose--expanded': compactExpanded,
      'compose--header-submit': submitInHeader,
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

    <!-- Threads pill: avatar · field with Send tucked inside -->
    <div v-if="compact" class="compose-pill" @click.stop>
      <img
        v-if="instancesStore.userAvatar"
        :src="instancesStore.userAvatar"
        alt=""
        class="compose-avatar neo-avatar"
      />
      <div class="compose-input-wrap compose-input-wrap--send">
        <textarea
          ref="textareaRef"
          v-model="content"
          class="compose-input neo-input"
          :placeholder="placeholder"
          rows="1"
          enterkeyhint="send"
          autocapitalize="sentences"
          :readonly="inputLocked"
          :aria-busy="isPosting || isUploading || props.disabled || undefined"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="mentionListShown"
          :aria-controls="mentionListShown ? mentionListId : undefined"
          :aria-activedescendant="mentionListShown ? activeMentionId : undefined"
          :aria-invalid="isOverLimit"
          :aria-label="composeAriaLabel"
          :aria-keyshortcuts="compact ? 'Enter' : submitKeyshortcuts"
          @focus="onComposeFocus"
          @blur="composeFocused = false"
          @paste="onPaste"
          @keydown="onKeydown"
          @input="onComposeInput"
          @click="syncMentions()"
          @keyup="onMentionKeyup"
        />
        <ComposeAutocomplete
          v-if="mentionOpen"
          :id="mentionListId"
          :results="mentionResults"
          :searching="mentionSearching"
          :active-index="mentionIndex"
          :flip-up="mentionFlipUp"
          @select="insertMention"
        />
        <button
          type="button"
          class="compose-send"
          :class="{ 'compose-send--ready': canPost }"
          :disabled="!canPost"
          :aria-label="submitAriaLabel"
          :title="compact ? (inReplyToId ? 'Send reply · Enter' : 'Post · Enter') : submitShortcutTitle"
          @click.stop="handlePost"
        >
          <FunLoader
            v-if="isPosting || isUploading"
            variant="seed"
            :size="26"
            :label="isUploading ? 'Uploading' : 'Sending'"
          />
          <NeoIcon v-else name="send" :size="17" :stroke="2" filled />
        </button>
      </div>
    </div>

    <template v-else>
      <div v-if="!inReplyToId && !quoteUrl" class="compose-header" @click.stop>
        <img
          v-if="instancesStore.userAvatar"
          :src="instancesStore.userAvatar"
          alt=""
          class="compose-avatar neo-avatar"
        />
        <div class="compose-heading">
          <div class="compose-title-row">
            <button
              v-if="instancesStore.authenticatedInstances.length > 1"
              type="button"
              class="compose-title compose-title--btn"
              title="Switch account"
              aria-label="Switch posting account"
              :disabled="!canSwitchPostingAccount"
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
          enterkeyhint="enter"
          autocapitalize="sentences"
          :readonly="inputLocked"
          :aria-busy="isPosting || isUploading || props.disabled || undefined"
          role="combobox"
          aria-autocomplete="list"
          :aria-expanded="mentionListShown"
          :aria-controls="mentionListShown ? mentionListId : undefined"
          :aria-activedescendant="mentionListShown ? activeMentionId : undefined"
          :aria-invalid="isOverLimit"
          :aria-label="composeAriaLabel"
          :aria-keyshortcuts="submitKeyshortcuts"
          @focus="onComposeFocus"
          @blur="composeFocused = false"
          @paste="onPaste"
          @keydown="onKeydown"
          @input="onComposeInput"
          @click="syncMentions()"
          @keyup="onMentionKeyup"
        />

        <ComposeAutocomplete
          v-if="mentionOpen"
          :id="mentionListId"
          :results="mentionResults"
          :searching="mentionSearching"
          :active-index="mentionIndex"
          :flip-up="mentionFlipUp"
          @select="insertMention"
        />
      </div>
    </template>

    <article v-if="quoteUrl && quoteContext" class="compose-quote" @click.stop>
      <img
        v-if="quoteContext.avatar"
        :src="quoteContext.avatar"
        alt=""
        class="compose-quote__avatar"
      />
      <div class="compose-quote__body">
        <p class="compose-quote__meta">
          <strong>{{ quoteContext.name }}</strong>
          <span>@{{ quoteContext.handle }}</span>
        </p>
        <p class="compose-quote__text">{{ quoteContext.text }}</p>
      </div>
    </article>

    <div v-if="showCW" class="compose-cw" @click.stop>
      <input
        ref="cwInputRef"
        v-model="spoilerText"
        type="text"
        class="compose-cw-input neo-input"
        placeholder="Content warning"
        aria-label="Content warning"
        :readonly="isPosting"
      />
    </div>

    <!-- Media previews -->
    <div v-if="attachments.length" ref="composeMediaRef" class="compose-media" @click.stop>
      <div
        v-for="(item, mediaIndex) in attachments"
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
          alt=""
          class="compose-media__thumb"
        />
        <div v-else class="compose-media__video">
          <span aria-hidden="true">🎬</span>
          <span class="compose-media__video-name">{{ item.file.name }}</span>
        </div>
        <div v-if="item.uploading" class="compose-media__overlay">Uploading…</div>
        <button
          v-else-if="item.error"
          type="button"
          class="compose-media__overlay compose-media__overlay--error"
          @click="retryUpload(item.localId)"
        >
          {{ item.error }} · retry
        </button>
        <button
          type="button"
          class="compose-media__remove"
          :aria-label="`Remove image ${mediaIndex + 1}`"
          :disabled="isPosting"
          @click="removeAttachment(item.localId)"
        >
          <NeoIcon name="x" :size="12" :stroke="2.5" />
        </button>
        <span
          v-if="!item.uploading && !item.error && item.remoteId && !item.description?.trim()"
          class="compose-media__alt-badge"
          title="Missing alt text"
        >
          ALT
        </span>
        <label class="compose-media__alt">
          <span class="compose-media__alt-label">Alt text</span>
          <textarea
            class="compose-media__alt-input"
            rows="2"
            :maxlength="altMax"
            :disabled="isPosting"
            :value="item.description"
            placeholder="Describe this image for screen readers"
            @input="setDescription(item.localId, ($event.target as HTMLTextAreaElement).value)"
            @click.stop
          />
        </label>
      </div>
    </div>

    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ postAnnounce || uploadAnnounce }}</p>

    <div v-if="handoffNotice" class="compose-handoff" role="status">
      <span>{{ handoffNotice }}</span>
      <button type="button" class="compose-handoff__dismiss" @click="dismissHandoffNotice">Dismiss</button>
    </div>

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
          tabindex="-1"
          aria-hidden="true"
          :accept="COMPOSE_MEDIA_ACCEPT"
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
          <span aria-hidden="true">CW</span>
        </button>

        <!-- Compact replies inherit parent visibility — don't crowd the dock -->
        <div v-if="!isLockedDirect && !compact" class="compose-visibility">
          <select
            v-model="visibility"
            class="compose-visibility-select"
            :disabled="isPosting"
            aria-label="Post visibility"
          >
            <option v-for="opt in visibilityOptions" :key="opt.value" :value="opt.value">
              {{ opt.icon }} {{ opt.label }}
            </option>
          </select>
        </div>
        <span
          v-else-if="isLockedDirect && !compact"
          class="compose-visibility-lock"
          title="Only mentioned people can see this"
        >
          <NeoIcon name="message" :size="14" :stroke="2" />
          Direct
        </span>

        <!-- Place this cell in time — Mastodon scheduled_at (≥5 min) -->
        <div v-if="!compact" class="compose-schedule">
          <label class="compose-schedule__field">
            <span class="sr-only">Schedule for</span>
            <input
              v-model="scheduledLocal"
              type="datetime-local"
              class="compose-schedule-input"
              :min="scheduleMinLocal"
              :disabled="isPosting"
              :aria-label="hasSchedule ? 'Scheduled post time' : 'Schedule post for later'"
              title="Schedule — place this cell in time"
            />
          </label>
          <button
            v-if="hasSchedule"
            type="button"
            class="compose-schedule__clear"
            :disabled="isPosting"
            aria-label="Clear schedule — post now"
            title="Post now"
            @click="clearSchedule"
          >
            ×
          </button>
        </div>

        <label v-if="!isDirectCompose && !compact" class="compose-language">
          <span class="sr-only">Post language</span>
          <select
            v-model="postLanguage"
            class="compose-language-select"
            :disabled="isPosting"
            aria-label="Post language"
          >
            <option
              v-for="opt in languageOptions"
              :key="opt.code"
              :value="opt.code"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>

        <span v-if="hasMedia" class="compose-media-count">
          {{ attachments.length }}/{{ maxAttachments }}
          <span v-if="missingAltCount" class="compose-media-count__alt" title="Images need descriptions">
            · {{ missingAltCount }} missing ALT
          </span>
        </span>
      </div>

      <div class="compose-actions">
        <span
          class="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >{{ counterAnnounce }}</span>
        <span
          class="compose-counter"
          :class="{
            'compose-counter--warning': isNearLimit,
            'compose-counter--error': isOverLimit,
            'compose-counter--quiet': !isNearLimit && !isOverLimit && (compact || submitInHeader),
          }"
          aria-hidden="true"
        >
          {{ characterCount }}/{{ effectiveMaxLength }}
        </span>

        <button
          v-if="!compact && !submitInHeader"
          type="button"
          class="compose-submit neo-btn neo-btn--primary"
          :disabled="!canPost"
          :aria-label="submitAriaLabel"
          :title="submitShortcutTitle"
          :aria-keyshortcuts="submitKeyshortcuts"
          @click="handlePost"
        >
          {{ submitLabel }}
        </button>
      </div>
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

  &:focus-within {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--neo-accent) 55%, transparent);
  }

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

    .compose-input-wrap--send {
      position: relative;
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
      min-height: 2.75rem;
    }

    .compose-input {
      flex: 1;
      min-width: 0;
      min-height: 0;
      padding: 0.5rem 0.15rem 0.5rem 0;
      /* Room for the in-field send control (44px touch target) */
      padding-right: 3rem;
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

    .compose-send {
      position: absolute;
      right: 0.1rem;
      bottom: 0.15rem;
      width: 2.15rem;
      height: 2.15rem;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 50%;
      background: color-mix(in srgb, var(--neo-accent) 32%, var(--neo-bg-tertiary));
      color: var(--neo-text-on-accent, #fff);
      cursor: pointer;
      transition:
        background 0.14s ease,
        transform 0.12s ease,
        opacity 0.12s ease;

      &--ready {
        background: var(--neo-accent);

        &:hover:not(:disabled) {
          filter: brightness(1.06);
        }

        &:active:not(:disabled) {
          transform: scale(0.94);
        }
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.5;
      }
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
    color: var(--neo-text-secondary);
  }
}

.compose-media {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.compose-media__item {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
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
  min-width: 24px;
  min-height: 24px;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  font-size: 1rem;
  line-height: 1;
  color: var(--neo-text-on-accent, #fff);
  background: color-mix(in srgb, var(--neo-text-primary) 65%, transparent);
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

.compose-media__alt-badge {
  position: absolute;
  top: 0.35rem;
  left: 0.65rem;
  z-index: 1;
  padding: 0.1rem 0.35rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--neo-text-on-accent, #fff);
  background: var(--neo-danger, #c62828);
  border-radius: 3px;
  pointer-events: none;
}

.compose-media__alt {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.compose-media-count__alt {
  color: var(--neo-danger);
  font-weight: 600;
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
    color: var(--neo-text-secondary);
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

.compose-quote {
  display: flex;
  gap: 0.65rem;
  margin: 0 0 0.25rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--neo-radius-md, 12px);
  background: var(--neo-bg-tertiary);
  border: 1px solid var(--neo-border-color);
}

.compose-quote__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.compose-quote__body {
  min-width: 0;
  flex: 1;
}

.compose-quote__meta {
  margin: 0 0 0.2rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);

  strong {
    color: var(--neo-text-primary);
    font-weight: 600;
  }

  // Long remote handles wrap at 320px instead of widening the composer
  strong,
  span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.compose-quote__text {
  overflow-wrap: anywhere;
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.35;
  color: var(--neo-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.compose-language-select {
  min-height: 24px;
  font-size: 0.75rem;
  padding: 0.2rem 0.35rem;
  border-radius: var(--neo-radius-sm, 6px);
  border: 1px solid var(--neo-border-color);
  background: var(--neo-bg-secondary);
  color: var(--neo-text-secondary);
}

.compose-handoff {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  background: var(--neo-accent-soft);
  border: 1px solid color-mix(in srgb, var(--neo-accent) 35%, transparent);
  border-radius: var(--neo-radius-md);
  color: var(--neo-accent);
  font-size: 0.8125rem;
}

.compose-handoff__dismiss {
  flex-shrink: 0;
  min-height: 24px;
  padding: 0.125rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--neo-accent) 40%, transparent);
  border-radius: var(--neo-radius-sm);
  background: transparent;
  color: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}

.compose-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: nowrap;
  flex-shrink: 0;
  margin-top: auto;
  padding-top: 0.35rem;
  border-top: 1px solid var(--neo-border-color);
  cursor: default;

  /* Threads sheet: tools left, counter right — Post lives in the header */
  .compose--header-submit & {
    flex-wrap: wrap;
    row-gap: 0.35rem;
  }
}

.compose-tools {
  display: flex;
  align-items: center;
  gap: 0.15rem;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
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

.compose-schedule {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  margin-left: 0.25rem;
  flex-shrink: 0;
}

.compose-schedule-input {
  max-width: 11.5rem;
  padding: 0.3rem 0.35rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.6875rem;
  background-color: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-chrome, var(--neo-radius-md));
  color-scheme: inherit;

  &:focus {
    outline: none;
    border-color: var(--neo-accent);
  }

  &:not(:placeholder-shown),
  &:valid:not([value='']) {
    border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
  }
}

.compose-schedule__clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: var(--neo-radius-sm);
  background: transparent;
  color: var(--neo-text-muted);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: var(--neo-text-primary);
    background: var(--neo-bg-tertiary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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
  justify-content: flex-end;
  gap: 0.55rem;
  flex-shrink: 0;
}

.compose-counter {
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &--warning {
    color: var(--neo-warning);
  }

  &--error {
    color: var(--neo-danger);
    font-weight: 600;
  }

  /* Quiet until you're near the limit — less chrome in reply docks / sheet footers */
  &--quiet {
    opacity: 0.55;
  }
}

.compose-submit {
  min-width: 4.5rem;
  flex-shrink: 0;
}

.compose-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
