<script setup lang="ts">
/**
 * In-app thread / conversation view — mobile-safe sticky chrome + reply
 */

import type { mastodon } from 'masto'
import { useStatusStore } from '~/stores/status'
import { useInstancesStore } from '~/stores/instances'

const route = useRoute()
const router = useRouter()
const statusStore = useStatusStore()
const instancesStore = useInstancesStore()

const isLoading = ref(true)
const error = ref<string | null>(null)
const focusStatus = ref<mastodon.v1.Status | null>(null)
const ancestors = ref<mastodon.v1.Status[]>([])
const descendants = ref<mastodon.v1.Status[]>([])
const focusEl = ref<HTMLElement | null>(null)

const paramId = computed(() => String(route.params.id || ''))
const queryUrl = computed(() => {
  const u = route.query.url
  return typeof u === 'string' ? u : null
})

const replyPrefill = computed(() => {
  const acct = focusStatus.value?.account?.acct
  return acct ? `@${acct} ` : ''
})

const canReply = computed(() => instancesStore.isAuthenticated)

const loadThread = async (opts: { quiet?: boolean } = {}) => {
  if (!opts.quiet) {
    isLoading.value = true
    focusStatus.value = null
    ancestors.value = []
    descendants.value = []
  }
  error.value = null

  try {
    await instancesStore.initialize()

    const resolvedId = await statusStore.resolveThreadId({
      id: paramId.value,
      url: queryUrl.value,
    })

    if (!resolvedId) {
      error.value = 'Couldn’t find that post on your server.'
      return
    }

    if (resolvedId !== paramId.value) {
      await router.replace({
        path: `/status/${resolvedId}`,
        query: queryUrl.value ? { url: queryUrl.value } : undefined,
      })
    }

    const thread = await statusStore.fetchThread(resolvedId)
    focusStatus.value = thread.status
    ancestors.value = thread.ancestors
    descendants.value = thread.descendants

    if (!opts.quiet) {
      await nextTick()
      focusEl.value?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  } catch (e: any) {
    error.value = e?.message || 'Failed to load thread'
  } finally {
    isLoading.value = false
  }
}

const onReplyPosted = async (status: mastodon.v1.Status) => {
  if (!descendants.value.some((s) => s.id === status.id)) {
    descendants.value = [...descendants.value, status]
  }
  if (focusStatus.value) {
    focusStatus.value = {
      ...focusStatus.value,
      repliesCount: (focusStatus.value.repliesCount || 0) + 1,
    }
  }
  await loadThread({ quiet: true })
}

onMounted(() => loadThread())
watch(() => [route.params.id, route.query.url], () => loadThread())

useHead({
  title: computed(() =>
    focusStatus.value
      ? `Thread · @${focusStatus.value.account.acct} | NeoSpace`
      : 'Thread | NeoSpace',
  ),
})
</script>

<template>
  <div class="thread-page" :class="{ 'thread-page--can-reply': canReply && focusStatus }">
    <header class="thread-header">
      <button type="button" class="thread-back" @click="router.back()">← Back</button>
      <h1 class="thread-title">Thread</h1>
      <a
        v-if="focusStatus?.url || queryUrl"
        class="thread-external"
        :href="focusStatus?.url || queryUrl || '#'"
        target="_blank"
        rel="noopener noreferrer"
      >
        <span class="thread-external__full">Open original</span>
        <span class="thread-external__short">Original</span>
      </a>
      <span v-else class="thread-external thread-external--spacer" />
    </header>

    <div v-if="isLoading" class="thread-state">
      <span class="thread-spinner" aria-hidden="true" />
      <p>Loading conversation…</p>
    </div>

    <div v-else-if="error" class="thread-state thread-state--error">
      <p>{{ error }}</p>
      <div class="thread-state__actions">
        <button type="button" class="neo-btn neo-btn--secondary" @click="loadThread()">Retry</button>
        <NuxtLink v-if="!instancesStore.isAuthenticated" to="/login" class="neo-btn neo-btn--primary">
          Sign in
        </NuxtLink>
        <a
          v-else-if="queryUrl"
          :href="queryUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="neo-btn neo-btn--ghost"
        >
          Open on original server
        </a>
      </div>
    </div>

    <template v-else>
      <div class="thread-stream">
        <RealPostCard
          v-for="status in ancestors"
          :key="status.id"
          :status="status"
          hide-inline-reply
          class="thread-post thread-post--ancestor"
          @replied="onReplyPosted"
        />

        <div ref="focusEl" class="thread-focus">
          <RealPostCard
            v-if="focusStatus"
            :status="focusStatus"
            hide-inline-reply
            class="thread-post thread-post--focus"
            @replied="onReplyPosted"
          />
        </div>

        <RealPostCard
          v-for="status in descendants"
          :key="status.id"
          :status="status"
          hide-inline-reply
          class="thread-post thread-post--reply"
          @replied="onReplyPosted"
        />

        <p v-if="!descendants.length && !ancestors.length" class="thread-lonely">
          No replies yet — be the first.
        </p>
      </div>

      <div
        v-if="focusStatus && canReply"
        class="thread-reply-bar"
      >
        <RealComposeBox
          :key="`reply-${focusStatus.id}`"
          compact
          title="Reply"
          placeholder="Write a reply…"
          :in-reply-to-id="focusStatus.id"
          :initial-text="replyPrefill"
          @posted="onReplyPosted"
        />
      </div>

      <div v-else-if="focusStatus && !canReply" class="thread-signin-hint">
        <NuxtLink to="/login" class="neo-btn neo-btn--primary neo-btn--sm">Sign in to reply</NuxtLink>
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.thread-page {
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: 0.5rem 0.5rem 1.5rem;
  box-sizing: border-box;

  &--can-reply {
    // Room for fixed reply bar (no bottom nav on this route)
    padding-bottom: calc(7.5rem + env(safe-area-inset-bottom, 0));

    @media (min-width: 640px) {
      padding-bottom: calc(8.5rem + env(safe-area-inset-bottom, 0));
    }
  }
}

.thread-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.25rem;
  border-bottom: 1px solid var(--neo-border-color);
  position: sticky;
  /* Sit below mobile app header (52px) */
  top: 52px;
  z-index: 20;
  background: color-mix(in srgb, var(--neo-bg-primary) 94%, transparent);
  backdrop-filter: blur(10px);

  @media (min-width: 1024px) {
    top: 0;
    margin-bottom: 1rem;
    padding: 0.65rem 0;
  }
}

.thread-back,
.thread-external {
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-accent);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
  padding: 0.35rem 0;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}

.thread-back {
  justify-self: start;
}

.thread-external {
  justify-self: end;

  &--spacer {
    visibility: hidden;
  }

  &__short {
    display: inline;
  }

  &__full {
    display: none;
  }

  @media (min-width: 420px) {
    &__short {
      display: none;
    }

    &__full {
      display: inline;
    }
  }
}

.thread-title {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: var(--neo-chrome-heading-weight, 700);
  letter-spacing: var(--neo-chrome-heading-tracking, -0.02em);
  text-align: center;
  color: var(--neo-text-primary);
}

.thread-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--neo-text-muted);

  &--error {
    color: var(--neo-danger);
  }

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
  }
}

.thread-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--neo-border-color);
  border-top-color: var(--neo-accent);
  border-radius: 50%;
  animation: thread-spin 0.7s linear infinite;
}

@keyframes thread-spin {
  to {
    transform: rotate(360deg);
  }
}

.thread-stream {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.thread-focus {
  margin: 0.15rem 0;
  padding: 0.25rem;
  border-radius: 4px;
  background: var(--neo-accent-soft);
  border: 1px solid color-mix(in srgb, var(--neo-accent) 35%, transparent);
}

.thread-post--ancestor,
.thread-post--reply {
  opacity: 0.96;
}

.thread-lonely {
  margin: 1.5rem 0 0;
  text-align: center;
  font-size: 0.875rem;
  color: var(--neo-text-muted);
}

.thread-signin-hint {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: flex;
  justify-content: center;
  padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0));
  background: color-mix(in srgb, var(--neo-bg-primary) 94%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(10px);

  @media (min-width: 1024px) {
    left: 64px;
  }
}

.thread-reply-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  padding: 0.5rem 0.5rem calc(0.5rem + env(safe-area-inset-bottom, 0));
  background: color-mix(in srgb, var(--neo-bg-primary) 96%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(12px);

  @media (min-width: 1024px) {
    left: 64px;
    padding: 0.65rem 0.75rem 0.75rem;
  }

  :deep(.compose) {
    max-width: 40rem;
    margin: 0 auto;
  }

  /* Ultra-slim reply chrome on phones */
  :deep(.compose--compact) {
    gap: 0.35rem;
    padding: 0.5rem 0.6rem;
    border-radius: 4px;

    .compose-header {
      display: none;
    }

    .compose-input {
      min-height: 2.25rem;
      padding: 0.5rem 0.65rem;
      font-size: 0.9375rem;
      border-radius: 4px;
    }

    .compose-footer {
      gap: 0.35rem;
      flex-wrap: wrap;
    }

    .compose-visibility {
      display: none;
    }

    .compose-submit {
      min-height: 2.25rem;
      padding: 0.4rem 0.85rem;
      font-size: 0.875rem;
    }
  }
}

@media (min-width: 1024px) {
  .thread-page {
    padding-top: 0.5rem;
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
}
</style>
