<script setup lang="ts">
/**
 * Quick actions for the watched Edward face — heart / boost / stash / yap / beam / ghost / shape.
 */

import type { ExtendedStatus } from '~/stores/instances'
import { useInstancesStore } from '~/stores/instances'
import { useStatusStore } from '~/stores/status'
import { useToastStore } from '~/stores/toast'
import { useComposeSheetStore, type ComposeContextPost } from '~/stores/composeSheet'
import { useEdwardStore } from '~/stores/edward'
import { usePostActions } from '~/composables/usePostActions'
import { activeClient } from '~/composables/useMasto'
import { stripHtml } from '~/utils/sanitizeHtml'
import { lookupAcctFor } from '~/utils/edwardSemantics'
import NeoIcon from '~/components/NeoIcon.vue'

const props = defineProps<{
  status: ExtendedStatus
  /** inline: row under the deck preview · rail: desktop right-hand list */
  variant?: 'inline' | 'rail'
}>()

const instancesStore = useInstancesStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()
const composeSheet = useComposeSheetStore()
const edward = useEdwardStore()

const body = computed(() => props.status.reblog || props.status)
const statusUrl = computed(
  () => body.value.url || body.value.uri || props.status.url || props.status.uri || null,
)
const acct = computed(() => (body.value.account?.acct || '').replace(/^@/, ''))

const canAuth = computed(() => instancesStore.hasAuthenticatedInstance)
const requireAuth = () => {
  if (canAuth.value) return true
  toastStore.show({ message: 'Sign in to do that!!', duration: 3200 })
  return false
}

const {
  isFavouriting,
  isBoosting,
  isBookmarking,
  likePop,
  handleFavourite,
  toggleBoost,
  handleBookmark,
} = usePostActions({
  displayStatus: body,
  statusUrl,
  requireAuth,
  sourceInstanceUrl: computed(() => props.status._instanceUrl || null),
})

const replyBusy = ref(false)
const ghostBusy = ref(false)
const shapeBusy = ref(false)
const beamed = ref(false)
const ghosted = ref(false)
const shaped = ref(false)

// The live deck swaps posts constantly — reset per-post flags (usePostActions
// drops its own resolved id/client when the post changes).
watch(
  () => props.status.id,
  () => {
    beamed.value = false
    ghosted.value = false
    shaped.value = false
  },
)

const contextFromStatus = (): ComposeContextPost => {
  const s = body.value
  return {
    id: s.id,
    name: s.account?.displayName || s.account?.username || 'someone',
    handle: s.account?.acct || '',
    avatar: s.account?.avatar,
    text: stripHtml(s.content || '').slice(0, 280),
    url: statusUrl.value,
  }
}

const handleYap = async () => {
  if (!requireAuth() || replyBusy.value) return
  replyBusy.value = true
  try {
    const replyId = await statusStore.resolveReplyId({
      id: body.value.id,
      url: statusUrl.value,
      sourceInstanceUrl: props.status._instanceUrl || null,
    })
    if (!replyId) {
      toastStore.show({
        message: 'Couldn’t find that post on your server',
        duration: 4200,
      })
      return
    }
    const handle = acct.value
    const isDm = body.value.visibility === 'direct'
    edward.setRecessed(true)
    composeSheet.show({
      title: isDm ? 'Message' : 'Yap',
      placeholder: isDm ? `Message @${handle}…` : `Yap at @${handle}…`,
      initialText: handle ? `@${handle} ` : '',
      inReplyToId: replyId,
      visibility: isDm ? 'direct' : body.value.visibility,
      contextPost: contextFromStatus(),
      onPosted: () => {
        body.value.repliesCount = (body.value.repliesCount || 0) + 1
        toastStore.show({ message: 'Yapped!!', duration: 2800 })
        edward.setRecessed(false)
      },
    })
  } finally {
    replyBusy.value = false
  }
}

const handleBeam = async () => {
  const url = statusUrl.value
  if (!url) {
    toastStore.show({ message: 'No link to beam', duration: 2200 })
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    beamed.value = true
    toastStore.show({ message: 'Beamed to clipboard!!', duration: 2200 })
  } catch {
    toastStore.show({ message: 'Couldn’t copy link', duration: 2800 })
  }
}

const resolveAccountId = async (): Promise<{ client: ReturnType<typeof activeClient>; id: string } | null> => {
  if (!acct.value) return null
  try {
    const client = activeClient()
    const found = await client.v1.accounts.lookup({
      acct: lookupAcctFor(
        acct.value,
        body.value.account?.url,
        props.status._instanceUrl,
        instancesStore.activeAccount?.url,
      ),
    })
    return { client, id: found.id }
  } catch {
    return null
  }
}

/** ghost = mute — out of my stream, not forever-banish */
const handleGhost = async () => {
  if (!requireAuth() || ghostBusy.value || ghosted.value) return
  ghostBusy.value = true
  // Captured up front: the deck can swap posts while the lookup is in flight
  const who = acct.value
  const postId = props.status.id
  try {
    const ctx = await resolveAccountId()
    if (!ctx) {
      toastStore.show({ message: 'Couldn’t find that account', duration: 3200 })
      return
    }
    await ctx.client.v1.accounts.$select(ctx.id).mute()
    if (props.status.id === postId) ghosted.value = true
    toastStore.show({ message: `Ghosted @${who}`, duration: 2600 })
    // Out of the stream now, not just on the next refresh
    edward.dropAuthor(who)
  } catch {
    toastStore.show({ message: 'Couldn’t ghost', duration: 3200 })
  } finally {
    ghostBusy.value = false
  }
}

/** shape = block — Radical Edward “get out of my face” */
const handleShape = async () => {
  if (!requireAuth() || shapeBusy.value || shaped.value) return
  if (typeof window !== 'undefined' && !window.confirm(`Shape (block) @${acct.value}?`)) {
    return
  }
  shapeBusy.value = true
  const who = acct.value
  const postId = props.status.id
  try {
    const ctx = await resolveAccountId()
    if (!ctx) {
      toastStore.show({ message: 'Couldn’t find that account', duration: 3200 })
      return
    }
    await ctx.client.v1.accounts.$select(ctx.id).block()
    if (props.status.id === postId) shaped.value = true
    toastStore.show({ message: `Shaped @${who}!!`, duration: 2600 })
    edward.dropAuthor(who)
  } catch {
    toastStore.show({ message: 'Couldn’t shape', duration: 3200 })
  } finally {
    shapeBusy.value = false
  }
}

watch(
  () => composeSheet.open,
  (open) => {
    if (!open && edward.recessed) edward.setRecessed(false)
  },
)

// ── Toolbar roving tabindex: one Tab stop, arrows move between actions ──
const toolbarEl = ref<HTMLElement | null>(null)
let rovingBtn: HTMLButtonElement | null = null

const toolbarButtons = () =>
  Array.from(toolbarEl.value?.querySelectorAll<HTMLButtonElement>('.edward-watch-actions__btn') ?? [])

const setRoving = (btn: HTMLButtonElement | null) => {
  rovingBtn = btn
  for (const b of toolbarButtons()) b.tabIndex = b === btn ? 0 : -1
}

/** Keep exactly one enabled button tabbable (actions disable themselves, e.g. ghosted) */
const syncRoving = () => {
  const enabled = toolbarButtons().filter((b) => !b.disabled)
  setRoving(rovingBtn && enabled.includes(rovingBtn) ? rovingBtn : enabled[0] ?? null)
}

onMounted(syncRoving)
onUpdated(syncRoving)

const onToolbarFocusin = (e: FocusEvent) => {
  const btn = (e.target as HTMLElement | null)?.closest?.('.edward-watch-actions__btn')
  if (btn instanceof HTMLButtonElement) setRoving(btn)
}

const onToolbarKeydown = (e: KeyboardEvent) => {
  const vertical = props.variant === 'rail'
  const nextKey = vertical ? 'ArrowDown' : 'ArrowRight'
  const prevKey = vertical ? 'ArrowUp' : 'ArrowLeft'
  if (e.key !== nextKey && e.key !== prevKey && e.key !== 'Home' && e.key !== 'End') return
  const enabled = toolbarButtons().filter((b) => !b.disabled)
  if (!enabled.length) return
  const cur = enabled.indexOf(document.activeElement as HTMLButtonElement)
  let i: number
  if (e.key === 'Home') i = 0
  else if (e.key === 'End') i = enabled.length - 1
  else if (e.key === nextKey) i = (cur + 1) % enabled.length
  else i = (cur - 1 + enabled.length) % enabled.length
  e.preventDefault()
  const target = enabled[i]!
  setRoving(target)
  target.focus()
}
</script>

<template>
  <div
    class="edward-watch-actions"
    :class="{ 'edward-watch-actions--rail': variant === 'rail' }"
    ref="toolbarEl"
    role="toolbar"
    :aria-orientation="variant === 'rail' ? 'vertical' : 'horizontal'"
    aria-label="Actions on watched post"
    @keydown="onToolbarKeydown"
    @focusin="onToolbarFocusin"
    @click.stop
    @pointerdown.stop
  >
    <button
      type="button"
      class="edward-watch-actions__btn"
      :class="{ 'is-on': body.favourited, 'is-pop': likePop }"
      :disabled="isFavouriting"
      :aria-pressed="!!body.favourited"
      aria-label="Heart"
      title="heart"
      @click="handleFavourite()"
    >
      <NeoIcon name="heart" :size="15" :stroke="1.9" :filled="!!body.favourited" />
      <span>heart</span>
    </button>

    <button
      type="button"
      class="edward-watch-actions__btn"
      :class="{ 'is-on': body.reblogged }"
      :disabled="isBoosting"
      :aria-pressed="!!body.reblogged"
      aria-label="Boost"
      title="boost"
      @click="toggleBoost(!body.reblogged)"
    >
      <NeoIcon name="reblog" :size="15" :stroke="1.9" />
      <span>boost</span>
    </button>

    <button
      type="button"
      class="edward-watch-actions__btn"
      :class="{ 'is-on': body.bookmarked }"
      :disabled="isBookmarking"
      :aria-pressed="!!body.bookmarked"
      aria-label="Stash"
      title="stash · save"
      @click="handleBookmark()"
    >
      <NeoIcon name="bookmark" :size="15" :stroke="1.9" :filled="!!body.bookmarked" />
      <span>stash</span>
    </button>

    <button
      type="button"
      class="edward-watch-actions__btn"
      :disabled="replyBusy"
      aria-label="Yap reply"
      title="yap · reply"
      @click="handleYap()"
    >
      <NeoIcon name="message" :size="15" :stroke="1.9" />
      <span>yap</span>
    </button>

    <button
      type="button"
      class="edward-watch-actions__btn"
      :class="{ 'is-on': beamed }"
      aria-label="Beam link"
      title="beam · copy link"
      @click="handleBeam()"
    >
      <NeoIcon name="share" :size="15" :stroke="1.9" />
      <span>beam</span>
    </button>

    <button
      type="button"
      class="edward-watch-actions__btn edward-watch-actions__btn--ghost"
      :class="{ 'is-on': ghosted }"
      :disabled="ghostBusy || ghosted || !acct"
      :aria-label="ghosted ? 'Ghosted (muted)' : 'Ghost (mute)'"
      title="ghost · mute"
      @click="handleGhost()"
    >
      <NeoIcon name="eye-off" :size="15" :stroke="1.9" />
      <span>{{ ghosted ? 'ghosted' : 'ghost' }}</span>
    </button>

    <button
      type="button"
      class="edward-watch-actions__btn edward-watch-actions__btn--shape"
      :class="{ 'is-on': shaped }"
      :disabled="shapeBusy || shaped || !acct"
      :aria-label="shaped ? 'Shaped (blocked)' : 'Shape (block)'"
      title="shape · block"
      @click="handleShape()"
    >
      <NeoIcon name="ban" :size="15" :stroke="1.9" />
      <span>{{ shaped ? 'shaped' : 'shape' }}</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.edward-watch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
  margin-top: 0.45rem;
  padding-top: 0.4rem;
  border-top: 1px dashed color-mix(in srgb, #59d1e0 40%, transparent);
}

.edward-watch-actions__btn {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  padding: 0.28rem 0.45rem;
  border: 1px solid color-mix(in srgb, #ffe566 45%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, #1a1420 88%, transparent);
  color: #fff8d6;
  font-family: inherit;
  font-size: 0.5625rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease,
    transform 0.12s ease;

  &:hover:not(:disabled),
  &:focus-visible:not(:disabled) {
    border-color: #ffe566;
    color: #ffe566;
    background: color-mix(in srgb, #ffe566 14%, #1a1420);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }

  &.is-on {
    border-color: #ff7eb3;
    color: #ff7eb3;
    background: color-mix(in srgb, #ff7eb3 18%, #1a1420);
  }

  &.is-pop {
    animation: edward-heart-pop 0.35s ease;
  }

  @media (pointer: coarse) {
    flex-shrink: 0;
    min-height: 2.25rem;
    padding-inline: 0.6rem;
  }

  &--ghost.is-on {
    border-color: #59d1e0;
    color: #59d1e0;
    background: color-mix(in srgb, #59d1e0 16%, #1a1420);
  }

  &--shape.is-on {
    border-color: #ff5a5a;
    color: #ff5a5a;
    background: color-mix(in srgb, #ff5a5a 16%, #1a1420);
  }
}

/* Desktop rail: one action per line, label-first, easy to aim at */
.edward-watch-actions--rail {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  border-top: 0;

  .edward-watch-actions__btn {
    justify-content: flex-start;
    gap: 0.55rem;
    width: 100%;
    min-height: 2.25rem;
    padding: 0.45rem 0.7rem;
    font-size: 0.6875rem;
  }
}

@keyframes edward-heart-pop {
  0% {
    transform: scale(1);
  }
  40% {
    transform: scale(1.12);
  }
  100% {
    transform: scale(1);
  }
}
</style>
