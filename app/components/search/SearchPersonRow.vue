<script setup lang="ts">
/**
 * One account in Explore — who they are, why they matched, and a follow button.
 */
import type { mastodon } from 'masto'
import SearchHighlight from '~/components/search/SearchHighlight.vue'
import { stripHtml } from '~/utils/stripHtml'
import { formatCompactRelativeTime } from '~/utils/relativeTime'
import { formatCount } from '~/utils/searchQuery'

const props = withDefaults(
  defineProps<{
    account: mastodon.v1.Account
    relationship?: mastodon.v1.Relationship | null
    terms?: string[]
    canFollow?: boolean
    /** Larger card treatment for the All tab's top hit */
    featured?: boolean
  }>(),
  { relationship: null, terms: () => [], canFollow: false, featured: false },
)

const emit = defineEmits<{ follow: [account: mastodon.v1.Account, e: Event]; open: [] }>()

const name = computed(() => props.account.displayName || props.account.username)
const bio = computed(() => (props.account.note ? stripHtml(props.account.note) : ''))
const mutual = computed(() => !!props.relationship?.following && !!props.relationship?.followedBy)

const meta = computed(() => {
  const parts: string[] = []
  const followers = props.account.followersCount
  if (followers != null) parts.push(`${formatCount(followers)} ${followers === 1 ? 'follower' : 'followers'}`)
  if (props.account.lastStatusAt) parts.push(`active ${formatCompactRelativeTime(props.account.lastStatusAt)}`)
  return parts.join(' · ')
})

const followLabel = computed(() =>
  props.relationship?.following ? 'Following' : props.relationship?.requested ? 'Requested' : props.account.locked ? 'Request' : 'Follow',
)
</script>

<template>
  <article class="search-person" :class="{ 'search-person--featured': featured }">
    <NuxtLink
      :to="{ path: '/profile', query: { user: account.acct } }"
      class="search-person__link"
      @click="emit('open')"
    >
      <img :src="account.avatar" alt="" class="search-person__avatar" loading="lazy" decoding="async" />
      <span class="search-person__meta">
        <span class="search-person__name">
          <strong><SearchHighlight :text="name" :terms="terms" /></strong>
          <NeoIcon v-if="account.locked" name="lock" :size="13" class="search-person__lock" aria-label="Approves followers" />
        </span>
        <em>@<SearchHighlight :text="account.acct" :terms="terms" /></em>
        <span v-if="mutual || relationship?.followedBy || account.bot || account.group" class="search-person__chips">
          <span v-if="mutual" class="search-chip search-chip--accent">Mutuals</span>
          <span v-else-if="relationship?.followedBy" class="search-chip">Follows you</span>
          <span v-if="account.bot" class="search-chip">Bot</span>
          <span v-if="account.group" class="search-chip">Group</span>
        </span>
        <span v-if="bio" class="search-person__bio"><SearchHighlight :text="bio" :terms="terms" /></span>
        <span v-if="meta" class="search-person__stats">{{ meta }}</span>
      </span>
    </NuxtLink>
    <button
      v-if="canFollow"
      type="button"
      class="neo-btn neo-btn--sm search-person__follow"
      :class="relationship?.following || relationship?.requested ? 'neo-btn--secondary' : 'neo-btn--primary'"
      :aria-label="`${followLabel} ${name}`"
      @click="emit('follow', account, $event)"
    >
      {{ followLabel }}
    </button>
  </article>
</template>

<style scoped lang="scss">
.search-person {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.35rem 0;
  border-bottom: 1px solid var(--neo-border-color);

  &--featured {
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 12px;
    background: var(--neo-bg-card);

    .search-person__avatar {
      width: 56px;
      height: 56px;
    }
  }

  &__link {
    display: flex;
    align-items: flex-start;
    gap: 0.7rem;
    flex: 1;
    min-width: 0;
    padding: 0.35rem 0;
    color: inherit;
    text-decoration: none;
    border-radius: 8px;

    @media (hover: hover) {
      &:hover strong {
        text-decoration: underline;
      }
    }
  }

  &__avatar {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    background: var(--neo-bg-tertiary);
  }

  &__meta {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;

    em {
      font-style: normal;
      font-size: 0.8125rem;
      color: var(--neo-text-tertiary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &__name {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;

    strong {
      font-size: 0.9375rem;
      color: var(--neo-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  &__lock {
    flex-shrink: 0;
    color: var(--neo-text-tertiary);
  }

  &__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.15rem;
  }

  &__bio {
    margin-top: 0.2rem;
    font-size: 0.8125rem;
    color: var(--neo-text-muted);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__stats {
    margin-top: 0.15rem;
    font-size: 0.75rem;
    color: var(--neo-text-tertiary);
  }

  &__follow {
    flex-shrink: 0;
  }
}

.search-chip {
  display: inline-block;
  padding: 0.05rem 0.4rem;
  font-size: 0.6875rem;
  font-weight: 600;
  font-style: normal;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary, var(--neo-bg-secondary));
  border-radius: 999px;

  &--accent {
    background: var(--neo-accent-soft);
  }
}
</style>
