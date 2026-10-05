<script setup lang="ts">
/**
 * Explore — find servers by interest, then Sign in / Watch / Create.
 */

import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'
import { normalizeServer, friendlyServerError } from '~/utils/instances'

const { instances, categories, getByCategory, search } = useCuratedInstances()
const instancesStore = useInstancesStore()
const router = useRouter()

const selectedCategory = ref('all')
const query = ref('')
const customError = ref<string | null>(null)
const customBusy = ref(false)
const watchToast = ref<string | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

const filteredInstances = computed(() => {
  const q = query.value.trim()
  if (q.length >= 2) return search(q)
  return getByCategory(selectedCategory.value)
})

const handleVisit = (domain: string) => {
  instancesStore.openPreview(domain)
}

const showToast = (msg: string) => {
  watchToast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { watchToast.value = null }, 3200)
}

const onWatched = (domain: string) => {
  showToast(`Watching ${domain} — browse public posts anytime`)
}

const lookUpCustom = async () => {
  customError.value = null
  const url = normalizeServer(query.value)
  if (!url) {
    customError.value = 'Enter a server name like mastodon.social'
    return
  }
  const host = url.replace(/^https?:\/\//, '')
  customBusy.value = true
  try {
    const info = await instancesStore.fetchInstanceInfo(host)
    if (!info) {
      customError.value = "We couldn't reach that server. Check the spelling and try again."
      return
    }
    instancesStore.openPreview(host)
  } catch (e) {
    customError.value = friendlyServerError(e)
  } finally {
    customBusy.value = false
  }
}

const goSignIn = () => {
  router.push('/login')
}

useHead({
  title: 'Find servers | NeoSpace',
  meta: [
    { name: 'description', content: 'Discover Mastodon communities by interest. Sign in, watch public posts, or create an account.' },
  ],
})

onUnmounted(() => {
  if (toastTimer) clearTimeout(toastTimer)
})
</script>

<template>
  <div class="explore-page">
    <header class="explore-hero">
      <p class="explore-kicker">Servers</p>
      <h1>Find a community</h1>
      <p class="explore-lede">
        Each Mastodon server is its own neighborhood. Browse by interest, peek at public posts,
        then <strong>Sign in</strong> if you already have an account — or <strong>Watch</strong> to browse without one.
      </p>
      <div class="explore-hero-actions">
        <NuxtLink to="/login" class="explore-btn explore-btn--primary">I already have an account</NuxtLink>
        <a
          href="https://joinmastodon.org/servers"
          target="_blank"
          rel="noopener"
          class="explore-btn explore-btn--ghost"
        >
          Create a free account →
        </a>
      </div>
    </header>

    <div class="explore-toolbar">
      <label class="explore-search">
        <span class="sr-only">Search servers</span>
        <input
          v-model="query"
          type="search"
          placeholder="Search art, tech, Canada… or type a server name"
          autocomplete="off"
          @keydown.enter.prevent="lookUpCustom"
        />
        <button
          type="button"
          class="explore-search__go"
          :disabled="customBusy || !query.trim()"
          @click="lookUpCustom"
        >
          {{ customBusy ? '…' : 'Look up' }}
        </button>
      </label>
      <p v-if="customError" class="explore-error" role="alert">{{ customError }}</p>
    </div>

    <nav class="explore-cats" aria-label="Categories">
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        :class="['explore-cat', { active: selectedCategory === cat.id && query.trim().length < 2 }]"
        @click="selectedCategory = cat.id; query = ''"
      >
        {{ cat.label }}
      </button>
    </nav>

    <section class="explore-grid">
      <TransitionGroup name="card">
        <InstanceCard
          v-for="instance in filteredInstances"
          :key="instance.domain"
          :instance="instance"
          @visit="handleVisit"
          @watched="onWatched"
        />
      </TransitionGroup>
    </section>

    <div v-if="filteredInstances.length === 0" class="explore-empty">
      <p>No servers match that search.</p>
      <button type="button" class="explore-btn explore-btn--ghost" @click="lookUpCustom">
        Look up “{{ query }}” as a server name
      </button>
    </div>

    <section class="explore-help">
      <div class="explore-help__card">
        <h3>Sign in</h3>
        <p>You already have an account on a server. Approve NeoSpace there, then post and follow from here.</p>
        <button type="button" class="explore-text-link" @click="goSignIn">Go to sign in →</button>
      </div>
      <div class="explore-help__card">
        <h3>Watch</h3>
        <p>
          Browse that server’s public posts in NeoSpace without an account.
          Some large servers hide public feeds until you sign in.
        </p>
      </div>
      <div class="explore-help__card">
        <h3>Create account</h3>
        <p>Opens the server’s own sign-up page. Come back to NeoSpace afterward and sign in with that server.</p>
      </div>
    </section>

    <InstancePreview @watched="onWatched" />

    <Teleport to="body">
      <Transition name="toast-fade">
        <div v-if="watchToast" class="explore-toast">{{ watchToast }}</div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.explore-page {
  max-width: 56rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 4rem;
}

.explore-hero {
  margin-bottom: 1.75rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--neo-border-color);
}

.explore-kicker {
  margin: 0 0 0.35rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--neo-accent);
}

.explore-hero h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.5rem, 3vw, 1.875rem);
  font-weight: var(--neo-chrome-heading-weight, 700);
  letter-spacing: -0.03em;
  color: var(--neo-text-primary);
}

.explore-lede {
  margin: 0 0 1.25rem;
  max-width: 40rem;
  font-size: 0.9375rem;
  line-height: 1.55;
  color: var(--neo-text-muted);

  strong {
    color: var(--neo-text-secondary);
    font-weight: 600;
  }
}

.explore-hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.explore-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  padding: 0.5rem 0.9rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.875rem;
  font-weight: 600;
  text-decoration: none;
  border-radius: 4px;
  cursor: pointer;
  border: 1px solid transparent;

  &--primary {
    color: var(--neo-text-inverse, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);

    &:hover {
      background: var(--neo-accent-hover);
    }
  }

  &--ghost {
    color: var(--neo-text-secondary);
    background: transparent;
    border-color: var(--neo-border-color-dark);

    &:hover {
      border-color: var(--neo-accent);
      color: var(--neo-accent);
    }
  }
}

.explore-toolbar {
  margin-bottom: 1rem;
}

.explore-search {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;

  input {
    flex: 1;
    min-width: 0;
    padding: 0.75rem 0.875rem;
    font-size: 0.9375rem;
    color: var(--neo-text-primary);
    background: var(--neo-bg-card);
    border: 1px solid var(--neo-border-color-dark);
    border-radius: 4px;
    outline: none;

    &:focus {
      border-color: var(--neo-accent);
    }

    &::placeholder {
      color: var(--neo-text-disabled);
    }
  }
}

.explore-search__go {
  padding: 0 1rem;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--neo-text-inverse, #fafaf8);
  background: var(--neo-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.explore-error {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--neo-danger);
}

.explore-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-bottom: 1.5rem;
}

.explore-cat {
  padding: 0.4rem 0.7rem;
  font-family: var(--neo-font-family-ui);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: transparent;
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    border-color: var(--neo-accent);
    color: var(--neo-accent);
  }

  &.active {
    color: var(--neo-text-inverse, #fafaf8);
    background: var(--neo-accent);
    border-color: var(--neo-accent);
  }
}

.explore-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.875rem;
  margin-bottom: 2rem;
}

.card-enter-active,
.card-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.card-enter-from,
.card-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.explore-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--neo-text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.explore-help {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
  margin-top: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--neo-border-color);
}

.explore-help__card {
  padding: 1rem;
  background: var(--neo-bg-card);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;

  h3 {
    margin: 0 0 0.35rem;
    font-size: 0.9375rem;
    color: var(--neo-text-primary);
  }

  p {
    margin: 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--neo-text-muted);
  }
}

.explore-text-link {
  margin-top: 0.65rem;
  padding: 0;
  border: none;
  background: none;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-accent);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.explore-toast {
  position: fixed;
  bottom: 5.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 0.65rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--neo-text-primary);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 2px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);

  @media (min-width: 1024px) {
    bottom: 2rem;
  }
}

.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

@media (min-width: 1024px) {
  .explore-page {
    padding: 2rem 1.5rem 3rem;
  }
}
</style>
