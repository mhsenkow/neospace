<script setup lang="ts">
/**
 * In-app thread / conversation view — sticky reply, local stream
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
    if (!instancesStore.isAuthenticated) {
      error.value = 'Sign in to view threads in NeoSpace.'
      return
    }

    const resolvedId = await statusStore.resolveThreadId({
      id: paramId.value,
      url: queryUrl.value,
    })

    if (!resolvedId) {
      error.value = 'Couldn’t find that post on your server.'
      return
    }

    // Keep URL tidy if we resolved a different local id
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
  // Optimistic: show reply immediately, then refresh context
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
  <div class="thread-page">
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
        Open original
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
          class="thread-post thread-post--ancestor"
          @replied="onReplyPosted"
        />

        <div ref="focusEl" class="thread-focus">
          <RealPostCard
            v-if="focusStatus"
            :status="focusStatus"
            class="thread-post thread-post--focus"
            @replied="onReplyPosted"
          />
        </div>

        <RealPostCard
          v-for="status in descendants"
          :key="status.id"
          :status="status"
          class="thread-post thread-post--reply"
          @replied="onReplyPosted"
        />

        <p v-if="!descendants.length && !ancestors.length" class="thread-lonely">
          No replies yet — be the first.
        </p>
      </div>

      <!-- Sticky reply — always ready, like Threads, without Meta chrome -->
      <div
        v-if="focusStatus && instancesStore.isAuthenticated"
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
    </template>
  </div>
</template>

<style lang="scss" scoped>
.thread-page {
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: 0.75rem 0.75rem 7.5rem;
}

.thread-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--neo-border-color);
  position: sticky;
  top: 0;
  z-index: 5;
  background: color-mix(in srgb, var(--neo-bg-primary) 92%, transparent);
  backdrop-filter: blur(8px);
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
}

.thread-back {
  justify-self: start;
}

.thread-external {
  justify-self: end;

  &--spacer {
    visibility: hidden;
  }

  &:hover {
    text-decoration: underline;
  }
}

.thread-title {
  margin: 0;
  font-size: 1rem;
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
  gap: 0.5rem;
}

.thread-focus {
  margin: 0.25rem 0;
  padding: 0.35rem;
  border-radius: var(--neo-radius-md);
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

.thread-reply-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  padding: 0.65rem 0.75rem calc(0.65rem + env(safe-area-inset-bottom, 0));
  background: color-mix(in srgb, var(--neo-bg-primary) 94%, transparent);
  border-top: 1px solid var(--neo-border-color);
  backdrop-filter: blur(10px);

  @media (min-width: 1024px) {
    left: 64px;
    padding-bottom: 0.75rem;
  }

  @media (max-width: 1023px) {
    bottom: calc(3.5rem + env(safe-area-inset-bottom, 0));
  }

  :deep(.compose) {
    max-width: 40rem;
    margin: 0 auto;
  }
}

@media (min-width: 1024px) {
  .thread-page {
    padding-top: 1.25rem;
  }
}
</style>
