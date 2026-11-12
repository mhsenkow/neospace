<script setup lang="ts">
/**
 * Instant command typeahead under Explore / board search.
 * Local matches only (<16ms): curated/connected servers (incl. swapped-domain),
 * followed accounts, recent searches, and post filter operators.
 */
import type { mastodon } from 'masto'
import type { CuratedInstance } from '~/composables/useCuratedInstances'
import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useAccountSearch } from '~/composables/useAccountSearch'
import { useBoardNav } from '~/composables/useBoardNav'
import { useCrossAccountAction } from '~/composables/useCrossAccountAction'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import {
  detectIntent,
  postOperatorTips,
  rankServers,
  suggestTwinHost,
} from '~/utils/searchQuery'
import { hostOf } from '~/utils/federation'

export type TypeaheadAction =
  | { kind: 'query'; q: string; tab?: 'all' | 'people' | 'posts' | 'tags' | 'servers' }
  | { kind: 'profile'; acct: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'server'; host: string }
  | { kind: 'operator'; insert: string }

type Row =
  | {
      id: string
      kind: 'server'
      label: string
      detail: string
      host: string
      name?: string
    }
  | {
      id: string
      kind: 'handle'
      label: string
      detail: string
      acct: string
      account?: mastodon.v1.Account
    }
  | {
      id: string
      kind: 'tag'
      label: string
      detail: string
      tag: string
    }
  | {
      id: string
      kind: 'operator'
      label: string
      detail: string
      insert: string
    }
  | {
      id: string
      kind: 'recent'
      label: string
      detail: string
      q: string
    }

const props = withDefaults(
  defineProps<{
    query: string
    open?: boolean
    recent?: { q: string; tab?: string }[]
    listId?: string
  }>(),
  {
    open: true,
    recent: () => [],
    listId: 'explore-typeahead',
  },
)

const emit = defineEmits<{
  select: [action: TypeaheadAction]
  follow: [account: mastodon.v1.Account]
  close: []
}>()

const { instances: curated } = useCuratedInstances()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()
const { openServerOnBoard } = useBoardNav()
const { toggleFollow, canPickAccount, accountHandle } = useCrossAccountAction()
const { following, loadFollowing } = useAccountSearch()

const activeIndex = ref(0)
const followBusy = ref(false)

onMounted(() => {
  if (instancesStore.hasAuthenticatedInstance) void loadFollowing()
})

const connectedHosts = computed(() => {
  const rows: CuratedInstance[] = []
  for (const inst of instancesStore.instances) {
    const domain = hostOf(inst.url)
    if (!domain) continue
    if (curated.some((c) => c.domain.toLowerCase() === domain)) continue
    rows.push({
      domain,
      name: inst.name || domain,
      vibe: '',
      category: 'general',
      description: '',
      blurb: '',
      color: '#888',
      emoji: '🌐',
    })
  }
  return rows
})

const catalog = computed(() => [...curated, ...connectedHosts.value])

const rows = computed((): Row[] => {
  const q = props.query.trim()
  if (!q || q.length < 1) return []
  const out: Row[] = []
  const intent = detectIntent(q)
  const lower = q.toLowerCase()

  // Direct handle action
  if (intent.kind === 'handle') {
    out.push({
      id: `go-handle:${intent.acct}`,
      kind: 'handle',
      label: `Go to @${intent.acct}`,
      detail: intent.remote ? 'Open profile' : 'Look up on your server',
      acct: intent.acct,
    })
  }

  // Direct tag action
  if (intent.kind === 'tag') {
    out.push({
      id: `go-tag:${intent.tag}`,
      kind: 'tag',
      label: `Open #${intent.tag}`,
      detail: 'Group / tag timeline',
      tag: intent.tag,
    })
  }

  // Server / twin
  if (intent.kind === 'host') {
    const twin = suggestTwinHost(catalog.value, intent.host)
    const exact = catalog.value.find((c) => c.domain.toLowerCase() === intent.host)
    const host = exact?.domain || twin?.domain || intent.host
    const name = exact?.name || twin?.name
    out.push({
      id: `go-host:${host}`,
      kind: 'server',
      label: name ? `Explore ${host} (${name})` : `Explore ${host}`,
      detail: twin && !exact ? `Did you mean ${host}?` : 'Preview · board · people',
      host,
      name,
    })
  }

  // Ranked servers (swapped-domain aware)
  for (const s of rankServers(catalog.value, q).slice(0, 4)) {
    if (out.some((r) => r.kind === 'server' && r.host === s.domain)) continue
    out.push({
      id: `srv:${s.domain}`,
      kind: 'server',
      label: s.name,
      detail: s.domain,
      host: s.domain,
      name: s.name,
    })
  }

  // Followed accounts
  const needle = lower.replace(/^@/, '')
  if (needle.length >= 1) {
    for (const a of following.value) {
      const acct = a.acct.toLowerCase()
      const name = (a.displayName || a.username || '').toLowerCase()
      if (!acct.includes(needle) && !name.includes(needle) && !a.username.toLowerCase().startsWith(needle)) {
        continue
      }
      if (out.some((r) => r.kind === 'handle' && r.acct.toLowerCase() === acct)) continue
      out.push({
        id: `fol:${a.id}`,
        kind: 'handle',
        label: a.displayName || a.username,
        detail: `@${a.acct}`,
        acct: a.acct,
        account: a,
      })
      if (out.filter((r) => r.kind === 'handle').length >= 5) break
    }
  }

  // Operators when query looks like a post filter prefix
  if (/^(from:|has:|-is:|language:|after:|before:)/i.test(q) || lower.includes('has:') || lower === 'from') {
    for (const tip of postOperatorTips()) {
      if (!tip.insert.toLowerCase().includes(needle) && !tip.label.toLowerCase().includes(needle)) continue
      out.push({
        id: `op:${tip.insert}`,
        kind: 'operator',
        label: tip.insert,
        detail: tip.label,
        insert: tip.insert,
      })
    }
  } else if (q.length <= 4) {
    // Surface a couple of tips for very short queries
    for (const tip of postOperatorTips().slice(0, 2)) {
      out.push({
        id: `op:${tip.insert}`,
        kind: 'operator',
        label: tip.insert,
        detail: tip.label,
        insert: tip.insert,
      })
    }
  }

  // Recents
  for (const r of props.recent.slice(0, 4)) {
    if (!r.q.toLowerCase().includes(lower) && lower.length > 1) continue
    out.push({
      id: `recent:${r.q}`,
      kind: 'recent',
      label: r.q,
      detail: 'Recent search',
      q: r.q,
    })
  }

  return out.slice(0, 10)
})

const visible = computed(() => props.open && rows.value.length > 0)

watch(
  () => props.query,
  () => {
    activeIndex.value = 0
  },
)

watch(rows, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = Math.max(0, list.length - 1)
})

const selectRow = (row: Row) => {
  if (row.kind === 'server') emit('select', { kind: 'server', host: row.host })
  else if (row.kind === 'handle') emit('select', { kind: 'profile', acct: row.acct })
  else if (row.kind === 'tag') emit('select', { kind: 'tag', tag: row.tag })
  else if (row.kind === 'operator') emit('select', { kind: 'operator', insert: row.insert })
  else emit('select', { kind: 'query', q: row.q })
}

const addServerColumn = async (host: string, e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  try {
    await openServerOnBoard(host, 'local')
    toastStore.show({ message: `Opened Local · ${host} on your board`, duration: 2400 })
  } catch {
    toastStore.show({ message: 'Couldn’t open that server on the board' })
  }
}

const followHandle = async (row: Row, e: Event) => {
  e.preventDefault()
  e.stopPropagation()
  if (row.kind !== 'handle' || !row.account || followBusy.value) return
  if (!instancesStore.hasAuthenticatedInstance) {
    toastStore.show({ message: 'Sign in to follow people' })
    return
  }
  followBusy.value = true
  try {
    const active = instancesStore.activeAccount
    const who = active ? accountHandle(active) : 'you'
    if (canPickAccount.value && active) {
      const { useOverlayStore } = await import('~/stores/overlay')
      const ok = await useOverlayStore().openConfirm({
        title: `Follow as ${who}?`,
        body: `@${row.acct} — switch accounts first if you meant a different login.`,
        confirmLabel: 'Follow',
      })
      if (!ok) return
    }
    const rel = await toggleFollow(row.account)
    toastStore.show({
      message:
        rel?.following || rel?.requested
          ? `Following @${row.acct} as ${who}`
          : `Unfollowed @${row.acct}`,
      duration: 2400,
    })
    emit('follow', row.account)
  } catch (err: unknown) {
    toastStore.show({
      message: err instanceof Error && err.message ? err.message : 'Couldn’t update follow',
    })
  } finally {
    followBusy.value = false
  }
}

/** Called from the parent input's keydown */
const onKeydown = (e: KeyboardEvent): boolean => {
  if (!visible.value) return false
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % rows.value.length
    return true
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + rows.value.length) % rows.value.length
    return true
  }
  if (e.key === 'Enter' && rows.value[activeIndex.value]) {
    e.preventDefault()
    selectRow(rows.value[activeIndex.value]!)
    return true
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return true
  }
  return false
}

defineExpose({ onKeydown, visible, rows })
</script>

<template>
  <div
    v-if="visible"
    :id="listId"
    class="explore-typeahead"
    role="listbox"
    :aria-label="'Search suggestions'"
  >
    <div
      v-for="(row, i) in rows"
      :key="row.id"
      role="option"
      class="explore-typeahead__row"
      :class="{ 'is-active': i === activeIndex }"
      :aria-selected="i === activeIndex"
      @mouseenter="activeIndex = i"
      @mousedown.prevent="selectRow(row)"
    >
      <div class="explore-typeahead__main">
        <strong>{{ row.label }}</strong>
        <span>{{ row.detail }}</span>
      </div>
      <div v-if="row.kind === 'server'" class="explore-typeahead__actions">
        <button type="button" class="explore-typeahead__btn" @mousedown.prevent="addServerColumn(row.host, $event)">
          Add column
        </button>
      </div>
      <div v-else-if="row.kind === 'handle' && row.account" class="explore-typeahead__actions">
        <button
          type="button"
          class="explore-typeahead__btn"
          :disabled="followBusy"
          @mousedown.prevent="followHandle(row, $event)"
        >
          Follow
        </button>
      </div>
      <div v-else-if="row.kind === 'tag'" class="explore-typeahead__actions">
        <span class="explore-typeahead__hint">#</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.explore-typeahead {
  margin-top: 0.35rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 12px;
  background: var(--neo-bg-elevated, var(--neo-bg-card));
  box-shadow: 0 8px 28px color-mix(in srgb, #000 12%, transparent);
  overflow: hidden;
  z-index: 5;
}

.explore-typeahead__row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  cursor: pointer;
  border-bottom: 1px solid var(--neo-border-color);

  &:last-child {
    border-bottom: 0;
  }

  &.is-active {
    background: color-mix(in srgb, var(--neo-accent) 10%, transparent);
  }
}

.explore-typeahead__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;

  strong {
    font-size: 0.875rem;
    color: var(--neo-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    font-size: 0.75rem;
    color: var(--neo-text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.explore-typeahead__actions {
  flex-shrink: 0;
}

.explore-typeahead__btn {
  appearance: none;
  border: 1px solid var(--neo-border-color);
  background: var(--neo-bg-card);
  color: var(--neo-text-secondary);
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.7rem;
  cursor: pointer;

  @media (hover: hover) {
    &:hover {
      border-color: var(--neo-accent);
      color: var(--neo-accent);
    }
  }
}

.explore-typeahead__hint {
  font-size: 0.75rem;
  color: var(--neo-text-tertiary);
}
</style>
