<script setup lang="ts">
/**
 * Poll on a post card: vote controls while open and unvoted (when signed in),
 * results otherwise. The parent resolves the poll on the voter's server and
 * performs the vote — this component only collects the choice.
 */
import type { mastodon } from 'masto'
import { emojify, type EmojiInput } from '~/utils/emojify'

const props = defineProps<{
  poll: mastodon.v1.Poll
  /** Signed in — guests only ever see results */
  canVote: boolean
  /** A vote request is in flight */
  voting?: boolean
  /** Custom emoji allowlist for option labels (`:shortcode:`) */
  emojis?: EmojiInput[] | null
  /** Flip-card layout tweaks owned here instead of the post card */
  layout?: 'default' | 'flip' | 'flip-media'
}>()

const optionHtml = (title: string) => emojify(title, props.emojis, { escape: true })

const emit = defineEmits<{
  vote: [choices: number[]]
}>()

const groupName = `poll-${useId()}`
const selected = ref<number[]>([])

// Shared clock: Date.now() inside a computed isn't reactive, so tick while the poll is open
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | null = null
const expiresAtMs = computed(() => {
  const at = props.poll.expiresAt ? Date.parse(props.poll.expiresAt) : NaN
  return Number.isFinite(at) ? at : null
})
const isClosed = computed(
  () => !!props.poll.expired || (expiresAtMs.value !== null && expiresAtMs.value <= now.value),
)
onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now()
    if (isClosed.value && tick) {
      clearInterval(tick)
      tick = null
    }
  }, 30_000)
})
onUnmounted(() => {
  if (tick) clearInterval(tick)
})

const instances = useInstancesStore()

const showVoting = computed(() => props.canVote && !isClosed.value && !props.poll.voted)

// Picks belong to the account that made them — switching accounts starts clean
watch(
  () => instances.activeAccountId,
  () => {
    selected.value = []
  },
)

// A refreshed poll (another card, server update) invalidates stale picks
watch(
  () => props.poll.id,
  () => {
    selected.value = []
  },
)

const denominator = computed(() => {
  const voters = props.poll.votersCount ?? props.poll.votesCount
  if (voters != null && voters > 0) return voters
  return props.poll.options.reduce((sum, o) => sum + (o.votesCount || 0), 0)
})

/** Multiple-choice polls count people (votersCount) separately from selections */
const totalLabel = computed(() => {
  const voters = props.poll.votersCount
  if (props.poll.multiple && voters != null) {
    return `${voters.toLocaleString()} ${voters === 1 ? 'person' : 'people'}`
  }
  return `${denominator.value.toLocaleString()} ${denominator.value === 1 ? 'vote' : 'votes'}`
})

const percent = (votes: number | null | undefined) => {
  if (!denominator.value) return 0
  return Math.round(((votes || 0) / denominator.value) * 100)
}

/** Servers hide counts until the poll closes (votesCount null) */
const countsHidden = computed(() => props.poll.options.every((o) => o.votesCount == null))

const isOwnVote = (idx: number) => !!props.poll.ownVotes?.includes(idx)

const toggle = (idx: number) => {
  if (props.poll.multiple) {
    selected.value = selected.value.includes(idx)
      ? selected.value.filter((i) => i !== idx)
      : [...selected.value, idx]
  } else {
    selected.value = [idx]
  }
}

const submit = () => {
  if (!selected.value.length || props.voting || !showVoting.value) return
  emit('vote', [...selected.value].sort((a, b) => a - b))
}

const closesLabel = computed(() => {
  if (isClosed.value) return 'Closed'
  const at = expiresAtMs.value
  if (at === null) return 'Open'
  const mins = Math.max(1, Math.round((at - now.value) / 60000))
  if (mins < 60) return `Closes in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `Closes in ${hours}h`
  return `Closes in ${Math.round(hours / 24)}d`
})
</script>

<template>
  <div
    class="status-poll"
    :class="{
      'status-poll--flip': layout === 'flip',
      'status-poll--flip-media': layout === 'flip-media',
    }"
    @click.stop
  >
    <form v-if="showVoting" class="status-poll-form" @submit.prevent="submit">
      <fieldset class="status-poll-fieldset" :disabled="voting">
        <legend class="sr-only">
          {{ poll.multiple ? 'Poll — choose one or more options' : 'Poll — choose one option' }}
        </legend>
        <label
          v-for="(option, optionIdx) in poll.options"
          :key="optionIdx"
          class="status-poll-option status-poll-option--choice"
          :class="{ 'status-poll-option--selected': selected.includes(optionIdx) }"
        >
          <input
            class="status-poll-input"
            :type="poll.multiple ? 'checkbox' : 'radio'"
            :name="groupName"
            :checked="selected.includes(optionIdx)"
            @change="toggle(optionIdx)"
          />
          <span class="status-poll-title" v-html="optionHtml(option.title)" />
        </label>
      </fieldset>
      <div class="status-poll-actions">
        <button
          type="submit"
          class="neo-btn neo-btn--primary neo-btn--sm"
          :disabled="!selected.length || voting"
          :aria-busy="voting || undefined"
        >
          {{ voting ? 'Voting…' : 'Vote' }}
        </button>
        <span class="status-poll-info">
          {{ poll.multiple ? 'Select all that apply · ' : '' }}{{ closesLabel }}
        </span>
      </div>
    </form>

    <template v-else>
      <div
        v-for="(option, optionIdx) in poll.options"
        :key="optionIdx"
        class="status-poll-option"
        :role="countsHidden ? undefined : 'meter'"
        :aria-valuenow="countsHidden ? undefined : percent(option.votesCount)"
        :aria-valuemin="countsHidden ? undefined : 0"
        :aria-valuemax="countsHidden ? undefined : 100"
        :aria-label="
          countsHidden
            ? undefined
            : `${option.title}: ${percent(option.votesCount)}%${isOwnVote(optionIdx) ? ' (your vote)' : ''}`
        "
      >
        <span class="status-poll-title">
          <span v-html="optionHtml(option.title)" />
          <span v-if="isOwnVote(optionIdx)" class="status-poll-own" aria-hidden="true">✓</span>
          <span v-if="countsHidden && isOwnVote(optionIdx)" class="sr-only">(your vote)</span>
        </span>
        <span v-if="!countsHidden" class="status-poll-votes">
          {{ percent(option.votesCount) }}%
          <span class="status-poll-votes__count">({{ option.votesCount ?? 0 }})</span>
        </span>
        <div
          v-if="!countsHidden"
          class="status-poll-bar"
          :style="{ width: `${percent(option.votesCount)}%` }"
        />
      </div>
      <p class="status-poll-info">
        <template v-if="!countsHidden">
          {{ totalLabel }} ·
        </template>
        <template v-else>Results hidden until the poll closes · </template>
        {{ closesLabel }}
        <template v-if="poll.voted"> · You voted</template>
      </p>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.status-poll {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.status-poll-form,
.status-poll-fieldset {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.status-poll-option {
  position: relative;
  padding: 0.5rem 0.75rem;
  background-color: var(--neo-bg-tertiary);
  border-radius: var(--neo-radius-md, 8px);
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  overflow: hidden;
  font-size: 0.875rem;
}

.status-poll-option--choice {
  align-items: center;
  justify-content: flex-start;
  min-height: 44px;
  cursor: pointer;
  border: 1px solid var(--neo-border-color);

  &:focus-within {
    outline: 2px solid var(--neo-focus);
    outline-offset: 1px;
  }
}

.status-poll-option--selected {
  border-color: var(--neo-accent);
  background-color: var(--neo-accent-soft);
}

.status-poll-input {
  flex-shrink: 0;
  margin: 0;
  accent-color: var(--neo-accent);
}

.status-poll-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  background-color: var(--neo-accent-soft);
  z-index: 0;
}

.status-poll-title,
.status-poll-votes {
  position: relative;
  z-index: 1;
}

// Long option text (URLs, handles) wraps instead of pushing the % off the card
.status-poll-title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.status-poll-own {
  margin-left: 0.25rem;
  color: var(--neo-accent);
  font-weight: 700;
}

.status-poll-votes {
  flex-shrink: 0;
  white-space: nowrap;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
}

.status-poll-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.status-poll-info {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.status-poll-title :deep(.emoji) {
  height: 1.1em;
  width: 1.1em;
  vertical-align: -0.15em;
  object-fit: contain;
}

/* Flip card layout — parent flex column sets order on the poll root */
.status-poll--flip {
  order: 3;
  margin: 1rem 0 0;
  width: 100%;
  max-width: var(--flip-max, none);
  text-align: left;
}

.status-poll--flip-media {
  order: 3;
  max-width: 40rem;
  width: 100%;
  margin-inline: auto;
  padding-inline: 1.25rem 4.5rem;
  box-sizing: border-box;
}
</style>
