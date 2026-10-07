<script setup lang="ts">
/**
 * Import a shared algorithm recipe from ?r= base64url payload.
 * Curators share links; recipients land here and add the feed to their board.
 */

import { useAlgorithmsStore } from '~/stores/algorithms'
import { useColumnsStore } from '~/stores/columns'
import { useToastStore } from '~/stores/toast'
import {
  decodeAlgorithmShare,
  recipeSummary,
  sharePayloadToRecipe,
} from '~/utils/algorithms'

definePageMeta({
  layout: 'default',
})

const route = useRoute()
const router = useRouter()
const algorithms = useAlgorithmsStore()
const columnsStore = useColumnsStore()
const toast = useToastStore()

const raw = computed(() => {
  const q = route.query.r
  return typeof q === 'string' ? q : Array.isArray(q) ? q[0] || '' : ''
})

const payload = computed(() => (raw.value ? decodeAlgorithmShare(raw.value) : null))
const preview = computed(() => (payload.value ? sharePayloadToRecipe(payload.value, 'preview') : null))

const importing = ref(false)
const error = computed(() => {
  if (!raw.value) return 'This link is missing an algorithm payload.'
  if (!payload.value) return 'This share link is invalid or corrupted.'
  return null
})

async function addToBoard() {
  if (!raw.value || !payload.value) return
  importing.value = true
  try {
    algorithms.hydrate()
    const recipe = algorithms.importShare(raw.value)
    if (!recipe) {
      toast.show({ message: 'Couldn’t import this algorithm' })
      return
    }
    columnsStore.ensureFocusedView('algorithm', recipe.id)
    toast.show({ message: `Added “${recipe.name}”` })
    await router.replace('/')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="algo-import">
    <div class="algo-import__card">
      <p class="algo-import__eyebrow">Shared algorithm</p>
      <template v-if="preview && !error">
        <h1 class="algo-import__title">{{ preview.name }}</h1>
        <p v-if="preview.description" class="algo-import__desc">{{ preview.description }}</p>
        <p class="algo-import__meta">{{ recipeSummary(preview) }}</p>
        <p v-if="preview.authorAcct" class="algo-import__curator">
          Curated by <strong>@{{ preview.authorAcct }}</strong>
          <template v-if="preview.authorName"> · {{ preview.authorName }}</template>
        </p>
        <p class="algo-import__note">
          This adds a filtered view on <em>your</em> timelines — NeoSpace never posts or follows on the curator’s behalf.
        </p>
        <div class="algo-import__actions">
          <button
            type="button"
            class="neo-btn neo-btn--primary"
            :disabled="importing"
            @click="addToBoard"
          >
            {{ importing ? 'Adding…' : 'Add to my feeds' }}
          </button>
          <NuxtLink to="/" class="neo-btn neo-btn--tertiary">Cancel</NuxtLink>
        </div>
      </template>
      <template v-else>
        <h1 class="algo-import__title">Can’t open this algorithm</h1>
        <p class="algo-import__desc">{{ error }}</p>
        <NuxtLink to="/" class="neo-btn neo-btn--primary">Back home</NuxtLink>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.algo-import {
  min-height: 60dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem 3rem;
}

.algo-import__card {
  width: min(28rem, 100%);
  padding: 1.5rem 1.25rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.algo-import__eyebrow {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.algo-import__title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.algo-import__desc,
.algo-import__meta,
.algo-import__note {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
}

.algo-import__curator {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-primary);
}

.algo-import__note {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.algo-import__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
