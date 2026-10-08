<script setup lang="ts">
/**
 * Edward Mode peek — heart / boost / reply / follow / join from the stream.
 */

import type { ExtendedStatus } from '~/stores/instances'
import { useInstancesStore } from '~/stores/instances'
import { useStatusStore } from '~/stores/status'
import { useToastStore } from '~/stores/toast'
import { useGroupsStore } from '~/stores/groups'
import { useComposeSheetStore, type ComposeContextPost } from '~/stores/composeSheet'
import { useEdwardStore } from '~/stores/edward'
import { usePostActions } from '~/composables/usePostActions'
import { activeClient } from '~/composables/useMasto'
import { sanitizeDisplayName, sanitizeStatusHtml, stripHtml } from '~/utils/sanitizeHtml'
import { emojify, emojiUrlSet } from '~/utils/emojify'
import { faceSpecFor, MOOD_GLYPH } from '~/utils/edwardFaces'
import { accountLooksBot, statusKind } from '~/utils/edwardSemantics'
import NeoIcon from '~/components/NeoIcon.vue'

const props = defineProps<{
  status: ExtendedStatus
}>()

const emit = defineEmits<{
  close: []
  openThread: []
  openProfile: [acct: string]
}>()

const instancesStore = useInstancesStore()
const statusStore = useStatusStore()
const toastStore = useToastStore()
const groupsStore = useGroupsStore()
const composeSheet = useComposeSheetStore()
const edward = useEdwardStore()
const panelEl = ref<HTMLElement | null>(null)

const body = computed(() => props.status.reblog || props.status)
const isBoost = computed(() => !!props.status.reblog)
const displayName = computed(
  () =>
    body.value.account?.displayName ||
    body.value.account?.username ||
    body.value.account?.acct ||
    'someone',
)
/** Display name with the account's custom emoji, sanitized like everywhere else */
const safeDisplayName = computed(() => {
  const emojis = body.value.account?.emojis || []
  return sanitizeDisplayName(emojify(displayName.value, emojis), emojiUrlSet(emojis))
})
const acct = computed(() => (body.value.account?.acct || '').replace(/^@/, ''))
const avatar = computed(() => body.value.account?.avatar || body.value.account?.avatarStatic || '')
const safeHtml = computed(() => sanitizeStatusHtml(body.value.content || ''))
const spoiler = computed(() => (body.value.spoilerText || '').trim())
const media = computed(() => body.value.mediaAttachments || [])
const statusUrl = computed(() => body.value.url || body.value.uri || props.status.url || props.status.uri || null)
const topTag = computed(() => {
  const t = (body.value.tags || [])
    .map((x) => (x?.name || '').replace(/^#/, '').trim())
    .filter(Boolean)[0]
  return t || null
})
const plainPreview = computed(() => stripHtml(body.value.content || '').slice(0, 280))

const badges = computed(() => {
  const b: ('media' | 'poll' | 'cw' | 'link' | 'bot')[] = []
  if ((body.value.mediaAttachments?.length || 0) > 0) b.push('media')
  if (body.value.poll) b.push('poll')
  if (body.value.sensitive || spoiler.value) b.push('cw')
  if (body.value.card?.url) b.push('link')
  if (accountLooksBot(body.value.account)) b.push('bot')
  return b
})

const face = computed(() =>
  faceSpecFor({
    kind: statusKind(props.status),
    badges: badges.value,
    engagement:
      (body.value.favouritesCount || 0) +
      (body.value.reblogsCount || 0) +
      (body.value.repliesCount || 0),
    text: plainPreview.value,
    hasCard: !!body.value.card?.url,
    isBot: accountLooksBot(body.value.account),
    mentionCount: body.value.mentions?.length || 0,
    tagCount: body.value.tags?.length || 0,
  }),
)

const canAuth = computed(() => instancesStore.hasAuthenticatedInstance)

const requireAuth = () => {
  if (canAuth.value) return true
  toastStore.show({ message: 'Sign in to do that', duration: 3200 })
  return false
}

/**
 * Content warnings / sensitive media stay folded until asked — the firehose
 * is strangers' posts, so honor what the author (or their server) flagged.
 */
const needsReveal = computed(() => !!spoiler.value || !!body.value.sensitive)
const revealed = ref(false)

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

const followBusy = ref(false)
const following = ref(false)
const followRequested = ref(false)
const joinBusy = ref(false)
const joinedTag = ref(false)
const replyBusy = ref(false)

const followLabel = computed(() => {
  if (!canAuth.value) return 'follow'
  if (following.value) return 'following'
  if (followRequested.value) return 'requested'
  return 'follow'
})

const refreshRelationship = async () => {
  if (!canAuth.value || !acct.value) return
  try {
    const client = activeClient()
    const found = await client.v1.accounts.lookup({ acct: acct.value })
    const rels = await client.v1.accounts.relationships.fetch({ id: [found.id] })
    const rel = rels[0]
    following.value = !!rel?.following
    followRequested.value = !!rel?.requested
  } catch {
    /* soft */
  }
}

const handleFollow = async () => {
  if (!requireAuth() || followBusy.value || !acct.value) return
  followBusy.value = true
  try {
    const client = activeClient()
    const found = await client.v1.accounts.lookup({ acct: acct.value })
    if (following.value || followRequested.value) {
      await client.v1.accounts.$select(found.id).unfollow()
      following.value = false
      followRequested.value = false
      toastStore.show({ message: `Unfollowed @${acct.value}`, duration: 2200 })
    } else {
      const rel = await client.v1.accounts.$select(found.id).follow()
      following.value = !!rel.following
      followRequested.value = !!rel.requested
      toastStore.show({
        message: rel.requested ? `Requested @${acct.value}` : `Following @${acct.value}`,
        duration: 2200,
      })
    }
  } catch {
    toastStore.show({ message: 'Couldn’t update follow', duration: 3200 })
  } finally {
    followBusy.value = false
  }
}

const handleJoinTag = async () => {
  if (!requireAuth() || !topTag.value || joinBusy.value) return
  joinBusy.value = true
  try {
    if (joinedTag.value) {
      await groupsStore.leaveGroup(topTag.value)
      joinedTag.value = false
      toastStore.show({ message: `Left #${topTag.value}`, duration: 2200 })
    } else {
      await groupsStore.joinGroup(topTag.value)
      joinedTag.value = true
      toastStore.show({ message: `Joined #${topTag.value}`, duration: 2200 })
    }
  } catch {
    toastStore.show({ message: 'Couldn’t update group', duration: 3200 })
  } finally {
    joinBusy.value = false
  }
}

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

const handleReply = async () => {
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
        message: 'Couldn’t find that post on your account’s server.',
        duration: 4200,
      })
      return
    }
    const handle = acct.value
    const isDm = body.value.visibility === 'direct'
    // Recess Edward so compose sheet sits on top
    edward.setRecessed(true)
    composeSheet.show({
      title: isDm ? 'Message' : 'Reply',
      placeholder: isDm ? `Message @${handle}…` : `Reply to @${handle}…`,
      initialText: handle ? `@${handle} ` : '',
      inReplyToId: replyId,
      visibility: isDm ? 'direct' : body.value.visibility,
      contextPost: contextFromStatus(),
      onPosted: () => {
        body.value.repliesCount = (body.value.repliesCount || 0) + 1
        toastStore.show({ message: 'Reply posted!!', duration: 2800 })
        edward.setRecessed(false)
      },
    })
  } finally {
    replyBusy.value = false
  }
}

const onBackdrop = (e: MouseEvent) => {
  if (e.target === e.currentTarget) emit('close')
}

watch(
  () => composeSheet.open,
  (open) => {
    if (!open && edward.recessed) edward.setRecessed(false)
  },
)

const syncJoined = () => {
  joinedTag.value =
    !!topTag.value &&
    canAuth.value &&
    groupsStore.followedTags.some((t) => t.name?.toLowerCase() === topTag.value!.toLowerCase())
}

// Keep Tab inside the peek; Edward's own key handler owns Escape
useFocusTrap(panelEl, ref(true), { initialFocus: '.edward-modal__x' })

onMounted(() => {
  void refreshRelationship()
  syncJoined()
})

// Same modal, different post (watch deck / keyboard): reset per-post state
watch(
  () => props.status.id,
  () => {
    revealed.value = false
    following.value = false
    followRequested.value = false
    void refreshRelationship()
    syncJoined()
  },
)
</script>

<template>
  <div
    class="edward-modal"
    role="presentation"
    @click="onBackdrop"
  >
    <div
      ref="panelEl"
      class="edward-modal__panel"
      role="dialog"
      aria-modal="true"
      aria-label="Thought"
      tabindex="-1"
      @click.stop
    >
      <header class="edward-modal__head">
        <button
          type="button"
          class="edward-modal__who"
          :aria-label="acct ? `Open profile @${acct}` : 'Open profile'"
          @click="acct && emit('openProfile', acct)"
        >
          <img
            v-if="avatar"
            class="edward-modal__avatar"
            :src="avatar"
            alt=""
            width="40"
            height="40"
            loading="lazy"
          >
          <div class="edward-modal__meta">
            <span class="edward-modal__name" v-html="safeDisplayName" />
            <span v-if="acct" class="edward-modal__acct">@{{ acct }}</span>
            <span class="edward-modal__mood">
              <span aria-hidden="true">{{ MOOD_GLYPH[face.mood] }}</span>
              {{ face.why }}
            </span>
            <span v-if="isBoost" class="edward-modal__boost">boosted</span>
          </div>
        </button>
        <button
          type="button"
          class="edward-modal__x"
          aria-label="Close"
          @click="emit('close')"
        >
          <NeoIcon name="x" :size="16" :stroke="2" />
        </button>
      </header>

      <div v-if="needsReveal" class="edward-modal__cw">
        <span>{{ spoiler || 'Sensitive content' }}</span>
        <button
          type="button"
          class="edward-modal__cw-toggle"
          :aria-expanded="revealed"
          @click="revealed = !revealed"
        >
          {{ revealed ? 'hide' : 'show' }}
        </button>
      </div>

      <template v-if="!needsReveal || revealed">
      <div
        v-if="safeHtml"
        class="edward-modal__content"
        v-html="safeHtml"
      />
      <p v-else class="edward-modal__content edward-modal__content--plain">
        {{ plainPreview }}
      </p>
      </template>

      <div v-if="media.length && (!needsReveal || revealed)" class="edward-modal__media">
        <img
          v-for="(m, i) in media.slice(0, 4)"
          :key="m.id || i"
          :src="(m.previewUrl || m.url) ?? undefined"
          :alt="m.description || ''"
          loading="lazy"
        >
      </div>

      <!-- Primary reaction row -->
      <div class="edward-modal__react" role="toolbar" aria-label="React">
        <button
          type="button"
          class="edward-modal__react-btn"
          :class="{
            'is-on': body.favourited,
            'is-pop': likePop,
          }"
          :disabled="isFavouriting"
          :aria-pressed="!!body.favourited"
          :aria-label="`Heart, ${body.favouritesCount ?? 0}`"
          @click="handleFavourite()"
        >
          <NeoIcon name="heart" :size="15" :stroke="1.85" :filled="!!body.favourited" />
          <em>{{ body.favouritesCount ?? 0 }}</em>
        </button>
        <button
          type="button"
          class="edward-modal__react-btn"
          :class="{ 'is-on': body.reblogged }"
          :disabled="isBoosting"
          :aria-pressed="!!body.reblogged"
          :aria-label="`Boost, ${body.reblogsCount ?? 0}`"
          @click="toggleBoost(!body.reblogged)"
        >
          <NeoIcon name="reblog" :size="15" :stroke="1.85" />
          <em>{{ body.reblogsCount ?? 0 }}</em>
        </button>
        <button
          type="button"
          class="edward-modal__react-btn"
          :disabled="replyBusy"
          :aria-label="`Reply, ${body.repliesCount ?? 0}`"
          @click="handleReply()"
        >
          <NeoIcon name="message" :size="15" :stroke="1.85" />
          <em>{{ body.repliesCount ?? 0 }}</em>
        </button>
        <button
          type="button"
          class="edward-modal__react-btn"
          :class="{ 'is-on': body.bookmarked }"
          :disabled="isBookmarking"
          :aria-pressed="!!body.bookmarked"
          aria-label="Bookmark"
          @click="handleBookmark()"
        >
          <NeoIcon name="bookmark" :size="15" :stroke="1.85" :filled="!!body.bookmarked" />
        </button>
      </div>

      <!-- Discovery / go actions -->
      <footer class="edward-modal__foot">
        <div class="edward-modal__discover">
          <button
            type="button"
            class="edward-modal__btn"
            :class="{ 'is-on': following || followRequested }"
            :disabled="followBusy || !acct"
            @click="handleFollow()"
          >
            {{ followLabel }}
          </button>
          <button
            v-if="acct"
            type="button"
            class="edward-modal__btn"
            @click="emit('openProfile', acct)"
          >
            profile
          </button>
          <button
            v-if="topTag"
            type="button"
            class="edward-modal__btn"
            :class="{ 'is-on': joinedTag }"
            :disabled="joinBusy"
            @click="handleJoinTag()"
          >
            {{ joinedTag ? 'joined' : 'join' }} #{{ topTag }}
          </button>
        </div>
        <div class="edward-modal__actions">
          <button type="button" class="edward-modal__btn" @click="emit('close')">
            stay
          </button>
          <button
            type="button"
            class="edward-modal__btn edward-modal__btn--primary"
            @click="emit('openThread')"
          >
            open thread ≫
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.edward-modal {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem;
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
  background: color-mix(in srgb, #06040e 55%, transparent);
  backdrop-filter: blur(6px);

  @media (min-width: 640px) {
    align-items: center;
  }
}

.edward-modal__panel {
  width: min(460px, 100%);
  max-height: min(82vh, 680px);
  max-height: min(82dvh, 680px);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 1rem 1.1rem 1.05rem;
  background: color-mix(in srgb, #12081c 94%, #ffe566 6%);
  border: 2px solid #ffe566;
  border-radius: 4px;
  box-shadow:
    4px 4px 0 #ff7eb3,
    0 16px 48px color-mix(in srgb, #000 50%, transparent);
  color: #fff8d6;
  font-family: 'Courier New', ui-monospace, monospace;
  outline: none;

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }
}

.edward-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.edward-modal__who {
  display: flex;
  gap: 0.65rem;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 2px;

  &:hover .edward-modal__name,
  &:focus-visible .edward-modal__name {
    color: #ffe566;
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 2px;
  }
}

.edward-modal__avatar {
  width: 40px;
  height: 40px;
  border-radius: 2px;
  object-fit: cover;
  flex-shrink: 0;
  background: #1a1420;
  border: 1px solid #ffe566;
}

.edward-modal__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.edward-modal__name {
  font-size: 0.9375rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #fff;

  // Custom emoji from emojify()
  :deep(img.emoji) {
    height: 1.1em;
    width: auto;
    vertical-align: -0.2em;
    display: inline;
  }
}

.edward-modal__acct {
  font-size: 0.75rem;
  color: color-mix(in srgb, #fff8d6 55%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edward-modal__mood {
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #ff7eb3;
}

.edward-modal__boost {
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #b794f6;
}

.edward-modal__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: color-mix(in srgb, #fff8d6 70%, transparent);
  line-height: 1;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: #ffe566;
    background: color-mix(in srgb, #fff 8%, transparent);
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }
}

.edward-modal__cw {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
  margin: 0 0 0.65rem;
  padding: 0.4rem 0.55rem;
  font-size: 0.75rem;
  background: color-mix(in srgb, #f2ad52 12%, transparent);
  border: 1px solid color-mix(in srgb, #f2ad52 35%, transparent);
  border-radius: 2px;
  color: #f2ad52;
}

.edward-modal__cw-toggle {
  flex-shrink: 0;
  min-height: 2rem;
  padding: 0.2rem 0.65rem;
  border: 1px solid #f2ad52;
  border-radius: 2px;
  background: transparent;
  color: #f2ad52;
  font-family: inherit;
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: lowercase;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: #f2ad52;
    color: #1a1420;
  }
}

.edward-modal__content {
  margin: 0 0 0.85rem;
  font-size: 0.875rem;
  line-height: 1.45;
  word-break: break-word;
  color: #fff8d6;

  :deep(a) {
    color: #59d1e0;
  }

  :deep(p) {
    margin: 0 0 0.5em;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &--plain {
    color: color-mix(in srgb, #fff8d6 85%, transparent);
  }
}

.edward-modal__media {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-bottom: 0.85rem;

  img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 2px;
    background: #1a1420;
  }
}

.edward-modal__react {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.35rem;
  margin-bottom: 0.75rem;
}

.edward-modal__react-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  min-height: 52px;
  padding: 0.35rem;
  border: 2px solid color-mix(in srgb, #ffe566 45%, transparent);
  border-radius: 3px;
  background: color-mix(in srgb, #1a1420 80%, transparent);
  color: #fff8d6;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;

  span {
    font-size: 1.15rem;
    line-height: 1;
  }

  em {
    font-style: normal;
    font-size: 0.625rem;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: #ffe566;
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  &.is-on {
    border-color: #ff7eb3;
    background: color-mix(in srgb, #ff7eb3 22%, #1a1420);
    color: #ffd0e4;
  }

  &.is-pop {
    transform: scale(1.08);
  }
}

.edward-modal__foot {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding-top: 0.65rem;
  border-top: 1px dashed color-mix(in srgb, #ffe566 35%, transparent);
}

.edward-modal__discover,
.edward-modal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.edward-modal__actions {
  justify-content: flex-end;
}

.edward-modal__btn {
  padding: 0.4rem 0.7rem;
  border: 1px solid color-mix(in srgb, #ffe566 45%, transparent);
  border-radius: 2px;
  background: transparent;
  color: #fff8d6;
  font-family: inherit;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: #59d1e0;
    color: #fff;
  }

  &:focus-visible {
    outline: 2px solid #59d1e0;
    outline-offset: 1px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.is-on {
    border-color: #ff7eb3;
    color: #ffd0e4;
  }

  &--primary {
    background: color-mix(in srgb, #ffe566 18%, transparent);
    border-color: #ffe566;
    color: #ffe566;
    box-shadow: 2px 2px 0 #ff7eb3;
  }
}
</style>
