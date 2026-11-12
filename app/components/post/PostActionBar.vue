<script setup lang="ts">
/**
 * Like · Reply · Repost · Share · Save row of a post card.
 * Pure presentation: counts and flags come from the status, every tap is emitted.
 */
import type { mastodon } from 'masto'
import { formatCompactCount } from '~/utils/formatCount'

defineProps<{
  status: mastodon.v1.Status
  canInteract: boolean
  isFavouriting: boolean
  isBoosting: boolean
  isBookmarking: boolean
  isOpeningReply: boolean
  likePop: boolean
  boostPop: boolean
  bookmarkPop: boolean
}>()

const emit = defineEmits<{
  favourite: []
  reply: []
  boost: []
  share: []
  bookmark: []
  prewarm: []
}>()
</script>

<template>
  <footer class="status-actions" @pointerenter="emit('prewarm')" @focusin="emit('prewarm')">
      <button
        class="status-action status-action--like"
        :class="{
          'status-action--liked': status.favourited,
          'status-action--pop': likePop,
        }"
        :aria-disabled="isFavouriting || undefined"
        :aria-label="(status.favouritesCount ?? 0) > 0 ? `Like, ${formatCompactCount(status.favouritesCount)}` : 'Like'"
        :aria-pressed="!!status.favourited"
        @click.stop="!isFavouriting && emit('favourite')"
      >
        <NeoIcon name="heart" :size="20" :stroke="1.5" :filled="!!status.favourited" />
        <span v-if="(status.favouritesCount ?? 0) > 0" class="status-action__count">{{ formatCompactCount(status.favouritesCount) }}</span>
      </button>

      <button
        class="status-action status-action--reply"
        :aria-label="(status.repliesCount ?? 0) > 0 ? `Reply, ${formatCompactCount(status.repliesCount)}` : 'Reply'"
        :disabled="isOpeningReply"
        @click.stop="emit('reply')"
      >
        <NeoIcon name="message" :size="20" :stroke="1.5" />
        <span v-if="(status.repliesCount ?? 0) > 0" class="status-action__count">{{ formatCompactCount(status.repliesCount) }}</span>
      </button>

      <button
        class="status-action status-action--boost"
        :class="{
          'status-action--boosted': status.reblogged,
          'status-action--boost-pop': boostPop,
        }"
        :aria-disabled="isBoosting || undefined"
        :aria-label="(status.reblogsCount ?? 0) > 0 ? `Repost, ${formatCompactCount(status.reblogsCount)}` : 'Repost'"
        :aria-haspopup="canInteract && !status.reblogged ? 'dialog' : undefined"
        :aria-pressed="!!status.reblogged"
        @click.stop="!isBoosting && emit('boost')"
      >
        <NeoIcon name="reblog" :size="20" :stroke="1.5" />
        <span v-if="(status.reblogsCount ?? 0) > 0" class="status-action__count">{{ formatCompactCount(status.reblogsCount) }}</span>
      </button>

      <button
        class="status-action status-action--share"
        aria-label="Share"
        aria-haspopup="dialog"
        @click.stop="emit('share')"
      >
        <NeoIcon name="share" :size="20" :stroke="1.5" />
      </button>

      <button
        class="status-action status-action--bookmark"
        :class="{
          'status-action--bookmarked': status.bookmarked,
          'status-action--bookmark-pop': bookmarkPop,
        }"
        :aria-disabled="isBookmarking || undefined"
        aria-label="Bookmark"
        :aria-pressed="!!status.bookmarked"
        @click.stop="!isBookmarking && emit('bookmark')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" :fill="status.bookmarked ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
        </svg>
      </button>
  </footer>
</template>

<style lang="scss" scoped>
// ========================================
// Actions - pill-shaped buttons with proper sizing
// ========================================
.status-actions {
  overflow: visible;
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 0.15rem;
  margin-top: 0.5rem;
  margin-left: -0.35rem;
  max-width: 100%;
  min-width: 0;
}

.status-action {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.45rem 0.5rem;
  min-height: 40px;
  min-width: 40px;
  justify-content: center;
  flex-shrink: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition:
    background-color var(--neo-dur-instant, 90ms) var(--neo-ease-out),
    color var(--neo-dur-quick, 160ms) var(--neo-ease-out),
    transform var(--neo-dur-instant, 90ms) var(--neo-ease-spring);
  line-height: 1;
  -webkit-tap-highlight-color: transparent;

  svg,
  .neo-icon {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    transform-origin: center;
    transition: transform var(--neo-dur-quick, 160ms) var(--neo-ease-spring);
  }

  @include hover(':not(:disabled)') {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
  }

  &:active:not(:disabled) {
    transition-duration: var(--neo-dur-instant, 90ms);
    transform: translateY(var(--neo-anticipate-y, 1.5px))
      scale3d(var(--neo-press-squash-x, 1.07), var(--neo-press-squash-y, 0.9), 1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  // Liked = theme's like color (Braun accent unless a theme sets --neo-like)
  &--liked {
    color: var(--neo-like, var(--neo-accent));

    svg {
      stroke: var(--neo-like, var(--neo-accent));
      fill: var(--neo-like, var(--neo-accent));
    }

    @include hover(':not(:disabled)') {
      background: color-mix(in srgb, var(--neo-like, var(--neo-accent)) 12%, transparent);
      color: var(--neo-like, var(--neo-accent));
    }
  }

  &--pop .neo-icon,
  &--pop svg {
    animation: like-pop var(--neo-dur-celebrate, 440ms) var(--neo-ease-bounce) both;
  }

  &--pop .status-action__count,
  &--boost-pop .status-action__count {
    animation: count-tick-pop var(--neo-dur-normal, 240ms) var(--neo-ease-spring)
      var(--neo-delay-secondary, 50ms) both;
  }

  &--share {
    @include hover(':not(:disabled)') {
      .neo-icon {
        transform: translate(2px, -2px) scale(1.06);
      }
    }

    &:active:not(:disabled) .neo-icon {
      transform: translate(-1px, 1px) scale(0.9);
    }
  }

  &--reply {
    @include hover(':not(:disabled)') {
      .neo-icon {
        transform: rotate(-10deg) translateY(-1.5px) scale(1.06);
      }
    }

    &:active:not(:disabled) .neo-icon {
      transform: rotate(4deg) translateY(1px) scale(0.9);
    }
  }

  @media (max-width: 1023px) {
    min-height: 48px;
    min-width: 48px;
    padding: 0.55rem 0.6rem;

    svg {
      width: 22px;
      height: 22px;
    }

    &--boost .status-action__count,
    &--reply .status-action__count,
    &--like .status-action__count {
      font-size: 0.6875rem;
      opacity: 0.75;
    }
  }

  // Trailing Save — LoomSpace improves on Threads by keeping 1-tap bookmark
  &--bookmark {
    margin-left: auto;
  }

  // Boosted = success green (instrument, not Twitter)
  &--bookmarked {
    color: var(--neo-accent);

    svg {
      stroke: var(--neo-accent);
      fill: var(--neo-accent);
    }
  }

  &--bookmark-pop svg {
    animation: bookmark-snap var(--neo-dur-normal, 240ms) var(--neo-ease-spring) both;
  }

  &--boosted {
    color: var(--neo-boost, var(--neo-success));

    svg,
    .neo-icon {
      stroke: var(--neo-boost, var(--neo-success));
    }

    @include hover(':not(:disabled)') {
      background: color-mix(in srgb, var(--neo-boost, var(--neo-success)) 12%, transparent);
      color: var(--neo-boost, var(--neo-success));
    }
  }

  &--boost-pop svg,
  &--boost-pop .neo-icon {
    animation: repost-spin var(--neo-dur-normal, 240ms) var(--neo-ease-spring) both;
  }

  // Reply active = accent blue
  &--replying {
    color: var(--neo-accent);

    svg {
      stroke: var(--neo-accent);
    }

    @include hover(':not(:disabled)') {
      background: var(--neo-accent-soft);
      color: var(--neo-accent);
    }
  }

  &__count {
    font-size: 0.8125rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: inherit;
  }
}

@keyframes like-pop {
  0% {
    transform: scale(1) rotate(0deg);
  }
  18% {
    /* Principle 2: Anticipation dip & wind-back */
    transform: translateY(var(--neo-anticipate-y, 2px)) scale3d(1.12, 0.78, 1) rotate(-10deg);
  }
  52% {
    /* Principle 1, 7 & 10: Stretch along upward arc with overshoot */
    transform: translate(calc(var(--neo-arc-x, 8px) * 0.25), calc(var(--neo-arc-y, -10px) * 0.45))
      scale3d(calc(var(--neo-overshoot-scale, 1.2) * 0.96), var(--neo-overshoot-scale, 1.2), 1)
      rotate(7deg);
  }
  78% {
    /* Principle 5: Follow-through settle */
    transform: translateY(1px) scale3d(1.04, 0.95, 1) rotate(-2deg);
  }
  100% {
    transform: scale(1) translateY(0) rotate(0deg);
  }
}

@keyframes repost-spin {
  0% {
    transform: rotate(0deg) scale(1);
  }
  18% {
    /* Principle 2: Anticipation wind-back */
    transform: rotate(-22deg) scale3d(1.08, 0.88, 1);
  }
  58% {
    /* Principle 10: Overshoot spin */
    transform: rotate(196deg) scale(var(--neo-overshoot-scale, 1.18));
  }
  82% {
    transform: rotate(175deg) scale(0.97);
  }
  100% {
    transform: rotate(180deg) scale(1);
  }
}

@keyframes bookmark-snap {
  0% {
    transform: scale3d(1, 1, 1) translateY(0);
  }
  20% {
    /* Pull-down stretch */
    transform: scale3d(0.86, 1.28, 1) translateY(3px);
  }
  56% {
    /* Elastic upward snap */
    transform: scale3d(1.1, 0.88, 1) translateY(-2.5px);
  }
  80% {
    transform: scale3d(0.97, 1.04, 1) translateY(0.5px);
  }
  100% {
    transform: scale3d(1, 1, 1) translateY(0);
  }
}

@keyframes count-tick-pop {
  0% {
    transform: translateY(3px) scale(0.88);
    opacity: 0.65;
  }
  55% {
    transform: translateY(-2px) scale(1.1);
    opacity: 1;
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-action--pop .neo-icon,
  .status-action--pop svg,
  .status-action--boost-pop .neo-icon,
  .status-action--boost-pop svg,
  .status-action--bookmark-pop svg {
    animation: none !important;
  }
}

:global(.status-card--reduce-motion) {
  .status-action {
    transition: none !important;
    animation: none !important;
  }

  .status-action--pop .neo-icon,
  .status-action--pop svg {
    animation: none !important;
  }
}

:global(.chaos-active) {
  .status-action--liked,
  .status-action--boosted,
  .status-action--bookmarked {
    text-shadow: 0 0 10px currentColor;
  }
}
</style>
