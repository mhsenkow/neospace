<script setup lang="ts">
/**
 * One hashtag in Explore — 7-day trend, reach, and follow.
 */
import type { mastodon } from 'masto'
import SearchHighlight from '~/components/search/SearchHighlight.vue'
import SearchSparkline from '~/components/search/SearchSparkline.vue'
import { tagHistorySummary } from '~/utils/hashtag'

const props = withDefaults(
  defineProps<{
    tag: mastodon.v1.Tag
    following?: boolean
    canFollow?: boolean
    terms?: string[]
    featured?: boolean
  }>(),
  { following: false, canFollow: false, terms: () => [], featured: false },
)

const emit = defineEmits<{ follow: [tag: mastodon.v1.Tag, e: Event]; open: [] }>()

const slug = computed(() => props.tag.name.replace(/^#/, ''))
const summary = computed(() => tagHistorySummary(props.tag) || 'No posts this week')
</script>

<template>
  <article class="search-tag" :class="{ 'search-tag--featured': featured }">
    <NuxtLink :to="`/groups/${encodeURIComponent(slug)}`" class="search-tag__link" @click="emit('open')">
      <span class="search-tag__text">
        <strong>#<SearchHighlight :text="slug" :terms="terms" /></strong>
        <span class="search-tag__meta">{{ summary }}</span>
      </span>
      <SearchSparkline :history="tag.history" />
    </NuxtLink>
    <button
      v-if="canFollow"
      type="button"
      class="neo-btn neo-btn--sm"
      :class="following ? 'neo-btn--secondary' : 'neo-btn--ghost'"
      :aria-pressed="following"
      :aria-label="`${following ? 'Unfollow' : 'Follow'} #${slug}`"
      @click="emit('follow', tag, $event)"
    >
      {{ following ? 'Following' : 'Follow' }}
    </button>
  </article>
</template>

<style scoped lang="scss">
.search-tag {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--neo-border-color);

  &--featured {
    padding: 0.65rem 0.85rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card);

    strong {
      font-size: 1.0625rem;
    }
  }

  &__link {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0;
    color: inherit;
    text-decoration: none;

    @media (hover: hover) {
      &:hover strong {
        text-decoration: underline;
      }
    }
  }

  &__text {
    flex: 1;
    min-width: 0;

    strong {
      display: block;
      color: var(--neo-accent);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &__meta {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
  }
}
</style>
