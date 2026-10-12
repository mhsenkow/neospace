<script setup lang="ts">
/**
 * Import a shared algorithm recipe from ?r= base64url payload.
 * Curators share links; recipients land here and add the feed to their board.
 */

import { useAlgorithmsStore } from '~/stores/algorithms'
import { useColumnsStore } from '~/stores/columns'
import { useToastStore } from '~/stores/toast'
import { useInstancesStore } from '~/stores/instances'
import { MAX_CUSTOM } from '~/stores/algorithms'
import {
  recipeSummary,
  sharePayloadToRecipe,
  tryDecodeAlgorithmShare,
} from '~/utils/algorithms'
import { RANKERS } from '~/utils/rankers'

definePageMeta({
  layout: 'default',
})

useHead({ title: 'Import algorithm | NeoSpace' })

const route = useRoute()
const router = useRouter()
const algorithms = useAlgorithmsStore()
const columnsStore = useColumnsStore()
const toast = useToastStore()
const instancesStore = useInstancesStore()

const raw = computed(() => {
  const q = route.query.r
  return typeof q === 'string' ? q : Array.isArray(q) ? q[0] || '' : ''
})

const decoded = computed(() => (raw.value ? tryDecodeAlgorithmShare(raw.value) : null))
const payload = computed(() => (decoded.value?.ok ? decoded.value.payload : null))
const preview = computed(() => (payload.value ? sharePayloadToRecipe(payload.value, 'preview') : null))

/** Share links are unauthenticated: strip bidi / control characters so a name can't visually spoof another */
const cleanCurator = (v?: string) => (v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
const curatorAcct = computed(() => cleanCurator(preview.value?.authorAcct).replace(/^@/, ''))
const curatorName = computed(() => cleanCurator(preview.value?.authorName))
/** Link to the claimed profile, only for a well-formed user@host */
const curatorHref = computed(() => {
  const m = /^([\w.-]{1,64})@([a-z0-9.-]{1,253})$/i.exec(curatorAcct.value)
  return m ? { path: '/profile', query: { user: curatorAcct.value } } : null
})

/** Guests can't use a recipe that reads the home timeline or an auth-only ranker */
const needsSignIn = computed(() => {
  const p = payload.value
  if (!p || instancesStore.hasAuthenticatedInstance) return false
  return p.s === 'home' || (!!p.r && !!RANKERS[p.r]?.needsAuth)
})
const loginHref = computed(() => `/login?returnTo=${encodeURIComponent(route.fullPath)}`)

const importing = ref(false)
const error = computed(() => {
  if (!raw.value) return 'This link is missing an algorithm payload.'
  const d = decoded.value
  if (!d) return 'This share link is invalid or corrupted.'
  if (!d.ok && d.reason === 'version') {
    return 'This link was made with a newer NeoSpace — refresh to update.'
  }
  if (!d.ok) return 'This share link is invalid or corrupted.'
  return null
})

async function addToBoard() {
  if (!raw.value || !payload.value) return
  importing.value = true
  try {
    algorithms.hydrate()
    const result = algorithms.importShare(raw.value)
    if (!result) {
      toast.show({
        message: algorithms.isFull
          ? `You have ${MAX_CUSTOM} algorithms — delete one to import`
          : 'Couldn’t import this algorithm',
      })
      return
    }
    const { recipe, alreadyHad } = result
    // null = the board is full and nothing was added; don't claim otherwise
    const columnId = columnsStore.ensureFocusedView('algorithm', recipe.id)
    if (alreadyHad) {
      toast.show({ message: 'Already in your feeds — opened it' })
    } else {
      toast.show({
        message: columnId
          ? `Added “${recipe.name}”`
          : `Saved “${recipe.name}” — your board is full (${columnsStore.maxColumns}/${columnsStore.maxColumns}). Remove a column to add it.`,
      })
    }
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
        <p v-if="curatorAcct" class="algo-import__curator">
          Says it’s from
          <NuxtLink v-if="curatorHref" :to="curatorHref"><strong>@{{ curatorAcct }}</strong></NuxtLink>
          <strong v-else>@{{ curatorAcct }}</strong>
          <template v-if="curatorName"> · {{ curatorName }}</template>
          <span class="algo-import__unverified"> (unverified — anyone can write this)</span>
        </p>
        <p v-if="needsSignIn" class="algo-import__note" role="status">
          This algorithm needs you to sign in to work.
          <NuxtLink :to="loginHref">Sign in to use this algorithm</NuxtLink>
        </p>
        <p class="algo-import__note">
          <template v-if="preview.ranker">
            This ranks posts from trending, federated, and tag sources — not just your home timeline. NeoSpace never posts or follows on the curator’s behalf.
          </template>
          <template v-else>
            This adds a filtered view on <em>your</em> timelines — NeoSpace never posts or follows on the curator’s behalf.
          </template>
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

.algo-import__unverified {
  color: var(--neo-text-muted);
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
