<script setup lang="ts">
/**
 * Threads-style “View activity” — who liked / reposted a status.
 */
import type { mastodon } from 'masto'
import { activeClient } from '~/composables/useMasto'
import { useRelationshipCache } from '~/composables/useRelationshipCache'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { logWarn } from '~/utils/log'

const props = defineProps<{
  open: boolean
  statusId: string | null
  likesCount?: number
  repostsCount?: number
}>()

const emit = defineEmits<{
  close: []
}>()

const instances = useInstancesStore()
const toast = useToastStore()
const { ensure, follow, cache } = useRelationshipCache()
/** Read through the reactive Map so Follow/Following labels update after taps */
const relFor = (id: string) => (cache.has(id) ? cache.get(id)! : null)

type Tab = 'likes' | 'reposts'
const tab = ref<Tab>('likes')
const loading = ref(false)
const error = ref<string | null>(null)
const likers = ref<mastodon.v1.Account[]>([])
const reposters = ref<mastodon.v1.Account[]>([])
const sheetRef = ref<HTMLElement | null>(null)
const isOpen = computed(() => props.open)
const followBusy = reactive(new Set<string>())

useFocusTrap(sheetRef, isOpen, {
  onEscape: () => emit('close'),
  initialFocus: '.post-activity__tab, .action-sheet__cancel',
})

const accounts = computed(() => (tab.value === 'likes' ? likers.value : reposters.value))

const load = async () => {
  if (!props.statusId || !instances.hasAuthenticatedInstance) {
    error.value = 'Sign in to see activity'
    return
  }
  loading.value = true
  error.value = null
  try {
    const client = activeClient()
    const [favs, boosts] = await Promise.all([
      client.v1.statuses.$select(props.statusId).favouritedBy.list(),
      client.v1.statuses.$select(props.statusId).rebloggedBy.list(),
    ])
    likers.value = favs
    reposters.value = boosts
    for (const a of [...favs, ...boosts]) ensure(a.id)
    if (!favs.length && boosts.length) tab.value = 'reposts'
    else tab.value = 'likes'
  } catch (e) {
    logWarn('activity sheet failed', e)
    error.value = 'Couldn’t load activity for this post'
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.statusId] as const,
  ([open]) => {
    if (open) void load()
  },
)

const onFollow = async (account: mastodon.v1.Account) => {
  if (followBusy.has(account.id)) return
  followBusy.add(account.id)
  try {
    await follow(account.id)
  } catch {
    toast.show({ message: 'Couldn’t update follow', duration: 3500 })
  } finally {
    followBusy.delete(account.id)
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition appear name="action-sheet">
      <div
        v-if="open"
        ref="sheetRef"
        class="action-sheet post-activity"
        role="dialog"
        aria-modal="true"
        aria-labelledby="post-activity-title"
      >
        <button
          type="button"
          class="action-sheet__backdrop"
          tabindex="-1"
          aria-hidden="true"
          @click="emit('close')"
        />
        <div class="action-sheet__panel">
          <p id="post-activity-title" class="action-sheet__title">View activity</p>

          <div class="post-activity__tabs" role="tablist" aria-label="Activity type">
            <button
              type="button"
              class="post-activity__tab"
              role="tab"
              :aria-selected="tab === 'likes'"
              :class="{ 'post-activity__tab--on': tab === 'likes' }"
              @click="tab = 'likes'"
            >
              Likes{{ likesCount != null ? ` · ${likesCount}` : likers.length ? ` · ${likers.length}` : '' }}
            </button>
            <button
              type="button"
              class="post-activity__tab"
              role="tab"
              :aria-selected="tab === 'reposts'"
              :class="{ 'post-activity__tab--on': tab === 'reposts' }"
              @click="tab = 'reposts'"
            >
              Reposts{{ repostsCount != null ? ` · ${repostsCount}` : reposters.length ? ` · ${reposters.length}` : '' }}
            </button>
          </div>

          <p v-if="loading" class="post-activity__empty">Loading…</p>
          <p v-else-if="error" class="post-activity__empty" role="alert">{{ error }}</p>
          <p v-else-if="!accounts.length" class="post-activity__empty">
            {{ tab === 'likes' ? 'No likes yet' : 'No reposts yet' }}
          </p>
          <ul v-else class="post-activity__list">
            <li v-for="account in accounts" :key="account.id" class="post-activity__row">
              <NuxtLink
                :to="{ path: '/profile', query: { user: account.acct } }"
                class="post-activity__person"
                @click="emit('close')"
              >
                <img :src="account.avatar" alt="" class="post-activity__avatar" loading="lazy" decoding="async" />
                <span class="post-activity__meta">
                  <strong>{{ account.displayName || account.username }}</strong>
                  <em>@{{ account.acct }}</em>
                </span>
              </NuxtLink>
              <button
                v-if="account.id !== instances.currentUser?.id"
                type="button"
                class="neo-btn neo-btn--sm"
                :class="relFor(account.id)?.following || relFor(account.id)?.requested ? 'neo-btn--secondary' : 'neo-btn--primary'"
                :disabled="followBusy.has(account.id)"
                @click="onFollow(account)"
              >
                {{
                  relFor(account.id)?.following
                    ? 'Following'
                    : relFor(account.id)?.requested
                      ? 'Requested'
                      : 'Follow'
                }}
              </button>
            </li>
          </ul>

          <button type="button" class="action-sheet__cancel" @click="emit('close')">Close</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.post-activity {
  z-index: 220;
}

.action-sheet {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.action-sheet__backdrop {
  position: absolute;
  inset: 0;
  border: none;
  background: var(--neo-bg-overlay);
  cursor: pointer;
}

.action-sheet__panel {
  position: relative;
  z-index: 1;
  margin: 0 0.5rem calc(0.5rem + env(safe-area-inset-bottom, 0px));
  padding: 0.4rem 0.4rem 0.5rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px;
  max-height: calc(100dvh - 1rem - env(safe-area-inset-bottom, 0px));
  overflow-y: auto;

  @media (min-width: 640px) {
    align-self: center;
    width: 100%;
    max-width: 24rem;
    margin-bottom: 1.5rem;
  }
}

.action-sheet__title {
  margin: 0.35rem 0.75rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.action-sheet__cancel {
  display: block;
  width: 100%;
  margin-top: 0.45rem;
  min-height: 44px;
  border: none;
  border-radius: 12px;
  background: var(--neo-bg-tertiary);
  color: var(--neo-text-primary);
  font-weight: 600;
  cursor: pointer;
}

.post-activity__tabs {
  display: flex;
  gap: 0.35rem;
  margin: 0 0.35rem 0.55rem;
}

.post-activity__tab {
  flex: 1;
  min-height: 36px;
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-secondary);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;

  &--on {
    background: var(--neo-bg-tertiary);
    color: var(--neo-text-primary);
    border-color: color-mix(in srgb, var(--neo-accent) 35%, var(--neo-border-color));
  }
}

.post-activity__empty {
  margin: 0.75rem;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
  text-align: center;
}

.post-activity__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.post-activity__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.45rem;
}

.post-activity__person {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  flex: 1;
  color: inherit;
  text-decoration: none;
}

.post-activity__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
}

.post-activity__meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;

  strong {
    font-size: 0.875rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    font-style: normal;
    font-size: 0.75rem;
    color: var(--neo-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.action-sheet-enter-active,
.action-sheet-leave-active {
  transition: opacity 0.18s ease;

  .action-sheet__panel {
    transition: transform 0.22s ease;
  }
}

.action-sheet-enter-from,
.action-sheet-leave-to {
  opacity: 0;

  .action-sheet__panel {
    transform: translateY(12px);
  }
}
</style>
