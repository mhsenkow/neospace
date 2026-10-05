<script setup lang="ts">
import type { CuratedInstance } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'
import { friendlyServerError, isAuthGatedPublicHost } from '~/utils/instances'

const props = defineProps<{
  instance: CuratedInstance
}>()

const emit = defineEmits<{
  visit: [domain: string]
  watched: [domain: string]
}>()

const instancesStore = useInstancesStore()

const liveData = ref<Awaited<ReturnType<typeof instancesStore.fetchInstanceInfo>>>(null)
const loading = ref(true)
const isAdding = ref(false)
const actionError = ref<string | null>(null)

const isWatching = computed(() =>
  instancesStore.instances.some((i) =>
    i.url.toLowerCase().includes(props.instance.domain.toLowerCase()),
  ),
)

const isSignedIn = computed(() => {
  const inst = instancesStore.instances.find((i) =>
    i.url.toLowerCase().includes(props.instance.domain.toLowerCase()),
  )
  return !!(inst?.accessToken && inst?.user)
})

const isGated = computed(() => isAuthGatedPublicHost(props.instance.domain))

onMounted(async () => {
  try {
    liveData.value = await instancesStore.fetchInstanceInfo(props.instance.domain)
  } finally {
    loading.value = false
  }
})

const handleVisit = () => emit('visit', props.instance.domain)

const handleWatch = async () => {
  if (isWatching.value) return
  isAdding.value = true
  actionError.value = null
  try {
    await instancesStore.addInstance(`https://${props.instance.domain}`)
    emit('watched', props.instance.domain)
  } catch (e) {
    actionError.value = friendlyServerError(e)
  } finally {
    isAdding.value = false
  }
}

const handleSignIn = async () => {
  actionError.value = null
  try {
    const authUrl = await instancesStore.loginWithInstance(`https://${props.instance.domain}`)
    window.location.href = authUrl
  } catch (e) {
    actionError.value = friendlyServerError(e)
  }
}
</script>

<template>
  <article class="instance-card">
    <header class="instance-card__head">
      <span class="instance-card__emoji" aria-hidden="true">{{ instance.emoji }}</span>
      <div class="instance-card__titles">
        <h3>{{ instance.name }}</h3>
        <span class="instance-card__domain">{{ instance.domain }}</span>
      </div>
    </header>

    <p class="instance-card__vibe">{{ instance.vibe }}</p>
    <p class="instance-card__desc">{{ instance.description }}</p>

    <div v-if="liveData?.stats || liveData?.registrations !== undefined" class="instance-card__stats">
      <span v-if="liveData.stats?.userCount != null">
        {{ liveData.stats.userCount.toLocaleString() }} monthly active
      </span>
      <span v-if="liveData.registrations === true" class="instance-card__open">Open to join</span>
      <span v-else-if="liveData.registrations === false" class="instance-card__closed">Invite only</span>
      <span v-if="isGated" class="instance-card__gated">Public feed often needs sign-in</span>
    </div>
    <div v-else-if="loading" class="instance-card__stats instance-card__stats--muted">
      Checking server…
    </div>

    <p v-if="actionError" class="instance-card__error">{{ actionError }}</p>

    <footer class="instance-card__actions">
      <button
        v-if="!isSignedIn"
        type="button"
        class="instance-card__btn instance-card__btn--primary"
        @click="handleSignIn"
      >
        Sign in
      </button>
      <span v-else class="instance-card__badge">Signed in</span>

      <button
        v-if="!isWatching"
        type="button"
        class="instance-card__btn"
        :disabled="isAdding"
        :title="isGated ? 'You can still watch — public posts may need sign-in' : 'Browse public posts without an account'"
        @click="handleWatch"
      >
        {{ isAdding ? '…' : 'Watch' }}
      </button>
      <span v-else class="instance-card__badge instance-card__badge--soft">Watching</span>

      <button type="button" class="instance-card__btn instance-card__btn--ghost" @click="handleVisit">
        Preview
      </button>
    </footer>
  </article>
</template>

<style scoped lang="scss">
.instance-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  transition: border-color var(--neo-transition-fast);

  &:hover {
    border-color: var(--neo-border-color-dark);
  }
}

.instance-card__head {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.instance-card__emoji {
  font-size: 1.5rem;
  line-height: 1;
}

.instance-card__titles {
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 700;
    color: var(--neo-text-primary);
  }
}

.instance-card__domain {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
  font-family: var(--neo-font-family-ui);
}

.instance-card__vibe {
  margin: 0;
  display: inline-block;
  align-self: flex-start;
  padding: 0.15rem 0.45rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--neo-accent);
  background: var(--neo-accent-soft);
  border-radius: 2px;
}

.instance-card__desc {
  margin: 0;
  flex: 1;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-muted);
}

.instance-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--neo-border-color);
  font-size: 0.75rem;
  color: var(--neo-text-muted);

  &--muted {
    border-top: none;
    padding-top: 0;
  }
}

.instance-card__open {
  color: var(--neo-success);
  font-weight: 600;
}

.instance-card__closed {
  font-weight: 500;
}

.instance-card__gated {
  color: var(--neo-accent);
  font-weight: 500;
}

.instance-card__error {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-danger);
}

.instance-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
  margin-top: 0.25rem;
}

.instance-card__btn {
  min-height: 2rem;
  padding: 0.35rem 0.7rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  background: transparent;
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 4px;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: var(--neo-accent);
    color: var(--neo-accent);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &--primary {
    color: var(--neo-text-inverse, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);

    &:hover:not(:disabled) {
      background: var(--neo-accent-hover);
      color: var(--neo-text-inverse, #fafaf8);
    }
  }

  &--ghost {
    border-style: dashed;
  }
}

.instance-card__badge {
  display: inline-flex;
  align-items: center;
  min-height: 2rem;
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-success);
  background: var(--neo-success-soft);
  border-radius: 4px;

  &--soft {
    color: var(--neo-text-secondary);
    background: var(--neo-bg-tertiary);
  }
}
</style>
