/**
 * Compose poll state — options, duration, validity against the server's advertised
 * limits, and the add / remove (with confirm) flow. Persisted with drafts by the
 * caller as a scalar snapshot; media still is not.
 */

import type { Ref } from 'vue'
import { POLL_MIN_OPTIONS } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'
import { useOverlayStore } from '~/stores/overlay'
import { scrollFieldIntoKeyboardView } from '~/composables/useKeyboardViewport'

const POLL_DURATION_CHOICES = [
  { seconds: 5 * 60, label: '5 minutes' },
  { seconds: 30 * 60, label: '30 minutes' },
  { seconds: 60 * 60, label: '1 hour' },
  { seconds: 6 * 60 * 60, label: '6 hours' },
  { seconds: 24 * 60 * 60, label: '1 day' },
  { seconds: 3 * 24 * 60 * 60, label: '3 days' },
  { seconds: 7 * 24 * 60 * 60, label: '7 days' },
] as const

const formatPollSeconds = (secs: number) => {
  if (secs % 86400 === 0) return `${secs / 86400} day${secs === 86400 ? '' : 's'}`
  if (secs % 3600 === 0) return `${secs / 3600} hour${secs === 3600 ? '' : 's'}`
  return `${Math.max(1, Math.round(secs / 60))} minutes`
}

export function useComposePoll(opts: {
  /** Status text (the poll hint asks for a question above the options) */
  content: Ref<string>
  hasMedia: Ref<boolean>
  isPosting: Ref<boolean>
  scrollBehavior: () => ScrollBehavior
}) {
  const { content, hasMedia, isPosting, scrollBehavior } = opts
  const instancesStore = useInstancesStore()
  const overlayStore = useOverlayStore()

  // Server-advertised limits (poll options, option length, duration bounds) — Mastodon defaults otherwise
  const pollLimits = computed(() => instancesStore.composePollLimits)
  const POLL_MAX_OPTIONS_LIVE = computed(() => pollLimits.value.maxOptions)
  /** Only durations the selected server accepts; its own bounds are offered if none of the presets fit */
  const POLL_DURATIONS = computed(() => {
    const { minExpiration: min, maxExpiration: max } = pollLimits.value
    const fit: { seconds: number; label: string }[] = POLL_DURATION_CHOICES.filter(
      (d) => d.seconds >= min && d.seconds <= max,
    ).map((d) => ({ ...d }))
    if (!fit.length) {
      fit.push({ seconds: min, label: formatPollSeconds(min) })
      if (max !== min) fit.push({ seconds: max, label: formatPollSeconds(max) })
    }
    return fit
  })
  const showPoll = ref(false)
  const pollOptions = ref<string[]>(['', ''])
  const pollDuration = ref<number>(24 * 60 * 60)
  const pollMultiple = ref(false)
  const pollHideTotals = ref(false)
  const canHidePollTotals = computed(
    () => instancesStore.serverCapabilities.software === 'mastodon',
  )
  const pollEditorRef = ref<{ focusFirst: () => void; firstInput: () => HTMLInputElement | null } | null>(
    null,
  )

  const filledPollOptions = computed(() =>
    pollOptions.value.map((o) => o.trim()).filter(Boolean),
  )
  const pollHasDuplicates = computed(() => {
    const options = filledPollOptions.value
    return new Set(options.map((o) => o.toLowerCase())).size !== options.length
  })
  const pollTooLong = computed(() =>
    filledPollOptions.value.some((o) => [...o].length > pollLimits.value.maxCharactersPerOption),
  )
  /** 2–N distinct, non-empty options within the server's length / duration limits */
  const pollValid = computed(() => {
    if (!showPoll.value) return true
    const n = filledPollOptions.value.length
    return (
      n >= POLL_MIN_OPTIONS &&
      n <= POLL_MAX_OPTIONS_LIVE.value &&
      !pollTooLong.value &&
      POLL_DURATIONS.value.some((d) => d.seconds === pollDuration.value) &&
      !pollHasDuplicates.value
    )
  })
  const pollError = computed(() => {
    if (!showPoll.value) return ''
    if (hasMedia.value) return 'Polls can’t include photos or video — remove one.'
    if (pollHasDuplicates.value) return 'Poll options must be different.'
    if (pollTooLong.value) {
      return `Poll options can be at most ${pollLimits.value.maxCharactersPerOption} characters on this server.`
    }
    return ''
  })
  const pollHint = computed(() => {
    if (!showPoll.value || pollError.value) return ''
    if (filledPollOptions.value.length < POLL_MIN_OPTIONS) return 'Add at least two options.'
    if (!content.value.trim()) return 'Add a question above your poll.'
    return 'Ready to post when you’re happy with the choices.'
  })

  // Account switch / metadata refresh can drop the chosen duration out of range — snap to the nearest allowed
  watch(
    POLL_DURATIONS,
    (list) => {
      if (list.some((d) => d.seconds === pollDuration.value)) return
      pollDuration.value = list.reduce((best, d) =>
        Math.abs(d.seconds - pollDuration.value) < Math.abs(best.seconds - pollDuration.value) ? d : best,
      ).seconds
    },
    { immediate: true },
  )

  const resetPoll = () => {
    showPoll.value = false
    pollOptions.value = ['', '']
    pollDuration.value = POLL_DURATIONS.value.some((d) => d.seconds === 24 * 60 * 60)
      ? 24 * 60 * 60
      : (POLL_DURATIONS.value[POLL_DURATIONS.value.length - 1]?.seconds ?? 24 * 60 * 60)
    pollMultiple.value = false
    pollHideTotals.value = false
  }

  const focusPollEditor = () => {
    nextTick(() => {
      pollEditorRef.value?.focusFirst()
      const el = pollEditorRef.value?.firstInput()
      if (el) scrollFieldIntoKeyboardView(el, { behavior: scrollBehavior() })
    })
  }

  const togglePoll = async () => {
    if (isPosting.value) return
    if (showPoll.value) {
      const dirty =
        filledPollOptions.value.length > 0 || pollMultiple.value || pollHideTotals.value
      if (dirty) {
        const ok = await overlayStore.openConfirm({
          title: 'Remove poll?',
          body: 'Your poll options will be discarded.',
          confirmLabel: 'Remove',
          danger: true,
        })
        if (!ok) return
      }
      resetPoll()
      return
    }
    if (hasMedia.value) return
    showPoll.value = true
    focusPollEditor()
  }

  return {
    pollLimits,
    POLL_MAX_OPTIONS_LIVE,
    POLL_DURATIONS,
    showPoll,
    pollOptions,
    pollDuration,
    pollMultiple,
    pollHideTotals,
    canHidePollTotals,
    pollEditorRef,
    filledPollOptions,
    pollValid,
    pollError,
    pollHint,
    resetPoll,
    togglePoll,
  }
}
