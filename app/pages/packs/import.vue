<script setup lang="ts">
/**
 * Import a shared Feed Pack from ?p= base64url payload.
 */

import { useAlgorithmsStore } from '~/stores/algorithms'
import { useColumnsStore, FEED_LABELS, type ColumnFeedType } from '~/stores/columns'
import { useToastStore } from '~/stores/toast'
import { recipeToSharePayload } from '~/utils/algorithms'
import {
  packShareToFeedPack,
  tryDecodePackShare,
  type PackShareColumn,
} from '~/utils/packs'

definePageMeta({
  layout: 'default',
})

useHead({ title: 'Import pack | LoomSpace' })

const route = useRoute()
const router = useRouter()
const algorithms = useAlgorithmsStore()
const columnsStore = useColumnsStore()
const toast = useToastStore()

const raw = computed(() => {
  const q = route.query.p
  return typeof q === 'string' ? q : Array.isArray(q) ? q[0] || '' : ''
})

const decoded = computed(() => (raw.value ? tryDecodePackShare(raw.value) : null))
const payload = computed(() => (decoded.value?.ok ? decoded.value.payload : null))

const cleanCurator = (v?: string) =>
  (v || '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
const curatorAcct = computed(() => cleanCurator(payload.value?.a).replace(/^@/, ''))
const curatorName = computed(() => cleanCurator(payload.value?.an))
const curatorHref = computed(() => {
  const m = /^([\w.-]{1,64})@([a-z0-9.-]{1,253})$/i.exec(curatorAcct.value)
  return m ? { path: '/profile', query: { user: curatorAcct.value } } : null
})

const error = computed(() => {
  if (!raw.value) return 'This link is missing a pack payload.'
  const d = decoded.value
  if (!d) return 'This share link is invalid or corrupted.'
  if (!d.ok && d.reason === 'version') {
    return 'This link was made with a newer LoomSpace — refresh to update.'
  }
  if (!d.ok) return 'This share link is invalid or corrupted.'
  return null
})

const feedBadge = (token: PackShareColumn) => {
  const t = token.t || ''
  if (t.startsWith('rss:')) return { kind: 'RSS', label: token.n || t.slice(4) }
  if (t.startsWith('group:')) return { kind: 'Group', label: `#${t.slice(6)}` }
  if (t.startsWith('algo:')) return { kind: 'Algorithm', label: token.n || 'Custom algorithm' }
  if (t.startsWith('list:')) return { kind: 'List', label: token.n || 'List' }
  const pinned = t.match(/^(local|federated|home)@(host:)?(.+)$/i)
  if (pinned) {
    const type = pinned[1]!.toLowerCase() as ColumnFeedType
    const host = pinned[2] ? pinned[3] : ''
    return {
      kind: FEED_LABELS[type] || type,
      label: host ? `${FEED_LABELS[type]} · ${host}` : FEED_LABELS[type] || type,
    }
  }
  const type = t as ColumnFeedType
  return { kind: FEED_LABELS[type] || 'Feed', label: FEED_LABELS[type] || t }
}

const previewFeeds = computed(() => (payload.value?.c || []).map(feedBadge))

const importing = ref(false)

onMounted(() => {
  columnsStore.initialize()
  algorithms.hydrate()
})

async function installAsPack() {
  if (!payload.value) return
  importing.value = true
  try {
    const { pack, algorithms: recipes } = packShareToFeedPack(payload.value)
    const idMap = new Map<string, string>()
    for (const recipe of recipes) {
      const result = algorithms.importPayload(recipeToSharePayload(recipe))
      if (result) idMap.set(recipe.id, result.recipe.id)
    }
    for (const col of pack.columns) {
      if (col.feedType === 'algorithm' && col.algorithmId && idMap.has(col.algorithmId)) {
        col.algorithmId = idMap.get(col.algorithmId)!
      }
    }
    const id = columnsStore.installPack(pack, true)
    if (!id) {
      toast.show({
        message: `You already have ${columnsStore.maxPacks} packs — delete one to install`,
      })
      return
    }
    toast.show({ message: `Installed “${pack.name}”` })
    await router.replace('/')
  } finally {
    importing.value = false
  }
}

async function addFeedsToCurrent() {
  if (!payload.value) return
  importing.value = true
  try {
    const { pack, algorithms: recipes } = packShareToFeedPack(payload.value)
    const idMap = new Map<string, string>()
    for (const recipe of recipes) {
      const result = algorithms.importPayload(recipeToSharePayload(recipe))
      if (result) idMap.set(recipe.id, result.recipe.id)
    }
    let added = 0
    for (const col of pack.columns) {
      if (!columnsStore.canAddColumn) break
      if (col.feedType === 'algorithm' && col.algorithmId && idMap.has(col.algorithmId)) {
        col.algorithmId = idMap.get(col.algorithmId)!
      }
      if (col.feedType === 'rss' && col.rssUrl) {
        if (columnsStore.openRssColumn(col.rssUrl, col.rssTitle)) added += 1
      } else if (col.feedType === 'list' && col.listId) {
        if (columnsStore.openListColumn(col.listId, col.listTitle)) added += 1
      } else {
        const param =
          col.feedType === 'group'
            ? col.groupTag
            : col.feedType === 'algorithm'
              ? col.algorithmId
              : undefined
        const id = columnsStore.ensureFocusedView(col.feedType, param)
        if (id) added += 1
      }
    }
    toast.show({
      message: added
        ? `Added ${added} feed${added === 1 ? '' : 's'} to your board`
        : 'Nothing new to add',
    })
    await router.replace('/')
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <div class="pack-import">
    <div class="pack-import__card">
      <p class="pack-import__eyebrow">Shared pack</p>
      <template v-if="payload && !error">
        <h1 class="pack-import__title">{{ payload.n }}</h1>
        <p v-if="payload.d" class="pack-import__desc">{{ payload.d }}</p>
        <p v-if="curatorAcct" class="pack-import__curator">
          Says it’s from
          <NuxtLink v-if="curatorHref" :to="curatorHref"><strong>@{{ curatorAcct }}</strong></NuxtLink>
          <strong v-else>@{{ curatorAcct }}</strong>
          <template v-if="curatorName"> · {{ curatorName }}</template>
          <span class="pack-import__unverified"> (unverified)</span>
        </p>
        <ul class="pack-import__feeds">
          <li v-for="(feed, i) in previewFeeds" :key="i">
            <span class="pack-import__kind">{{ feed.kind }}</span>
            <span class="pack-import__label">{{ feed.label }}</span>
          </li>
        </ul>
        <p class="pack-import__note">
          Installs as a switchable board (max {{ columnsStore.maxPacks }} packs ×
          {{ columnsStore.maxColumns }} feeds). LoomSpace never posts on the curator’s behalf.
        </p>
        <div class="pack-import__actions">
          <button
            type="button"
            class="neo-btn neo-btn--primary"
            :disabled="importing || !columnsStore.canAddPack"
            @click="installAsPack"
          >
            {{
              importing
                ? 'Installing…'
                : columnsStore.canAddPack
                  ? 'Install as new pack'
                  : 'Packs full'
            }}
          </button>
          <button
            type="button"
            class="neo-btn neo-btn--secondary"
            :disabled="importing"
            @click="addFeedsToCurrent"
          >
            Add feeds to current pack
          </button>
          <NuxtLink to="/" class="neo-btn neo-btn--tertiary">Cancel</NuxtLink>
        </div>
      </template>
      <template v-else>
        <h1 class="pack-import__title">Can’t open this pack</h1>
        <p class="pack-import__desc">{{ error }}</p>
        <NuxtLink to="/" class="neo-btn neo-btn--primary">Back home</NuxtLink>
      </template>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.pack-import {
  min-height: 60dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 1rem 3rem;
}

.pack-import__card {
  width: min(32rem, 100%);
  padding: 1.5rem 1.25rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.pack-import__eyebrow {
  margin: 0;
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
}

.pack-import__title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--neo-text-primary);
}

.pack-import__desc,
.pack-import__note {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
}

.pack-import__curator {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--neo-text-primary);
}

.pack-import__unverified {
  color: var(--neo-text-muted);
}

.pack-import__note {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.pack-import__feeds {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.pack-import__feeds li {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
  font-size: 0.8125rem;
}

.pack-import__kind {
  flex-shrink: 0;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--neo-text-tertiary);
  min-width: 4.5rem;
}

.pack-import__label {
  color: var(--neo-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pack-import__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
</style>
