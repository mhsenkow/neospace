<script setup lang="ts">
/**
 * Create / edit / share a client-side algorithm recipe.
 */

import { useAlgorithmsStore } from '~/stores/algorithms'
import { useColumnsStore } from '~/stores/columns'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import {
  ALGORITHM_SOURCES,
  buildShareUrl,
  recipeSummary,
  type AlgorithmSource,
} from '~/utils/algorithms'
import { useKeyboardViewport } from '~/composables/useKeyboardViewport'

const algorithms = useAlgorithmsStore()
const columnsStore = useColumnsStore()
const instancesStore = useInstancesStore()
const toast = useToastStore()

const open = computed({
  get: () => algorithms.editorOpen,
  set: (v: boolean) => {
    if (!v) algorithms.closeEditor()
  },
})

const sheetRef = ref<HTMLElement | null>(null)
const { viewportStyle, onFocusField } = useKeyboardViewport(open, { lockScroll: true })

useFocusTrap(sheetRef, open, {
  onEscape: () => algorithms.closeEditor(),
  initialFocus: '.algo-sheet__name',
})

const name = ref('')
const description = ref('')
const source = ref<AlgorithmSource>('home')
const mediaOnly = ref(false)
const noReblogs = ref(false)
const noReplies = ref(false)
const includeTags = ref('')
const excludeTags = ref('')
const includeKeywords = ref('')
const excludeKeywords = ref('')
const shareUrl = ref('')
const saving = ref(false)

const editing = computed(() =>
  algorithms.editingId ? algorithms.getRecipe(algorithms.editingId) : null,
)

const title = computed(() => (editing.value ? 'Edit algorithm' : 'New algorithm'))

const sourceOptions = computed(() =>
  ALGORITHM_SOURCES.filter((s) => !s.needsAuth || instancesStore.hasAuthenticatedInstance),
)

function resetFromRecipe() {
  const r = editing.value
  if (!r) {
    name.value = ''
    description.value = ''
    source.value = instancesStore.hasAuthenticatedInstance ? 'home' : 'local'
    mediaOnly.value = false
    noReblogs.value = false
    noReplies.value = false
    includeTags.value = ''
    excludeTags.value = ''
    includeKeywords.value = ''
    excludeKeywords.value = ''
    shareUrl.value = ''
    return
  }
  name.value = r.name
  description.value = r.description || ''
  source.value = r.source
  mediaOnly.value = !!r.mediaOnly
  noReblogs.value = !!r.noReblogs
  noReplies.value = !!r.noReplies
  includeTags.value = (r.includeTags || []).map((t) => `#${t}`).join(' ')
  excludeTags.value = (r.excludeTags || []).map((t) => `#${t}`).join(' ')
  includeKeywords.value = (r.includeKeywords || []).join(', ')
  excludeKeywords.value = (r.excludeKeywords || []).join(', ')
  shareUrl.value = ''
}

watch(open, (isOpen) => {
  if (isOpen) {
    algorithms.hydrate()
    resetFromRecipe()
  }
})

watch(
  () => algorithms.editingId,
  () => {
    if (open.value) resetFromRecipe()
  },
)

async function save(andOpen: boolean) {
  const n = name.value.trim()
  if (!n) {
    toast.show({ message: 'Give this algorithm a name' })
    return
  }
  saving.value = true
  try {
    const recipe = algorithms.upsert({
      id: editing.value?.builtin ? undefined : editing.value?.id,
      name: n,
      description: description.value,
      source: source.value,
      mediaOnly: mediaOnly.value,
      noReblogs: noReblogs.value,
      noReplies: noReplies.value,
      includeTags: includeTags.value,
      excludeTags: excludeTags.value,
      includeKeywords: includeKeywords.value,
      excludeKeywords: excludeKeywords.value,
    })
    if (!recipe) {
      toast.show({ message: 'Couldn’t save — too many custom algorithms?' })
      return
    }
    if (andOpen) {
      columnsStore.ensureFocusedView('algorithm', recipe.id)
      const router = useRouter()
      if (router.currentRoute.value.path !== '/') {
        await router.push('/')
      }
    }
    toast.show({ message: andOpen ? `Opened ${recipe.name}` : `Saved ${recipe.name}` })
    algorithms.closeEditor()
  } finally {
    saving.value = false
  }
}

async function copyShareLink() {
  const base = editing.value
  if (!base && !name.value.trim()) {
    toast.show({ message: 'Save the algorithm before sharing' })
    return
  }
  // Persist latest edits first so the link matches the form
  const recipe = algorithms.upsert({
    id: editing.value?.builtin ? undefined : editing.value?.id,
    name: name.value.trim() || editing.value?.name || 'Untitled',
    description: description.value,
    source: source.value,
    mediaOnly: mediaOnly.value,
    noReblogs: noReblogs.value,
    noReplies: noReplies.value,
    includeTags: includeTags.value,
    excludeTags: excludeTags.value,
    includeKeywords: includeKeywords.value,
    excludeKeywords: excludeKeywords.value,
  })
  if (!recipe) {
    toast.show({ message: 'Couldn’t prepare share link' })
    return
  }
  const stamped = algorithms.stampAuthor(recipe)
  const url = buildShareUrl(window.location.origin, stamped)
  shareUrl.value = url
  try {
    if (navigator.share) {
      await navigator.share({
        title: stamped.name,
        text: `Try my NeoSpace algorithm: ${stamped.name}${stamped.authorAcct ? ` — curated by @${stamped.authorAcct}` : ''}`,
        url,
      })
      return
    }
    await navigator.clipboard.writeText(url)
    toast.show({ message: 'Share link copied' })
  } catch {
    try {
      await navigator.clipboard.writeText(url)
      toast.show({ message: 'Share link copied' })
    } catch {
      toast.show({ message: 'Couldn’t copy link' })
    }
  }
}

function removeRecipe() {
  if (!editing.value || editing.value.builtin) return
  const id = editing.value.id
  algorithms.remove(id)
  // Drop board columns using this recipe
  for (const col of [...columnsStore.columns]) {
    if (col.feedType === 'algorithm' && col.algorithmId === id) {
      columnsStore.removeColumn(col.id)
    }
  }
  toast.show({ message: 'Algorithm deleted' })
  algorithms.closeEditor()
}
</script>

<template>
  <NeoSheet
    :open="open"
    desktop-width="compact"
    :viewport-style="viewportStyle"
    @close="algorithms.closeEditor()"
  >
    <div ref="sheetRef" class="algo-sheet" role="dialog" aria-modal="true" :aria-label="title">
      <NeoSheetHeader :title="title" @cancel="algorithms.closeEditor()" />

      <div class="algo-sheet__body">
        <p class="algo-sheet__lede">
          Filter a timeline with simple rules. Share the link so others can add your curation to their board.
        </p>

        <label class="algo-sheet__field">
          <span>Name</span>
          <input
            v-model="name"
            class="algo-sheet__name"
            type="text"
            maxlength="48"
            placeholder="Cat photos, No politics…"
            @focus="onFocusField"
          >
        </label>

        <label class="algo-sheet__field">
          <span>Description <em>(optional)</em></span>
          <input
            v-model="description"
            type="text"
            maxlength="160"
            placeholder="What should people expect?"
            @focus="onFocusField"
          >
        </label>

        <label class="algo-sheet__field">
          <span>Source</span>
          <select v-model="source">
            <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>

        <fieldset class="algo-sheet__toggles">
          <legend>Filters</legend>
          <label class="algo-sheet__check">
            <input v-model="mediaOnly" type="checkbox">
            Media only
          </label>
          <label class="algo-sheet__check">
            <input v-model="noReblogs" type="checkbox">
            Hide boosts
          </label>
          <label class="algo-sheet__check">
            <input v-model="noReplies" type="checkbox">
            Hide replies
          </label>
        </fieldset>

        <label class="algo-sheet__field">
          <span>Must include tags</span>
          <input
            v-model="includeTags"
            type="text"
            placeholder="#cats #photography"
            @focus="onFocusField"
          >
        </label>
        <label class="algo-sheet__field">
          <span>Exclude tags</span>
          <input
            v-model="excludeTags"
            type="text"
            placeholder="#nsfw #politics"
            @focus="onFocusField"
          >
        </label>
        <label class="algo-sheet__field">
          <span>Must include keywords</span>
          <input
            v-model="includeKeywords"
            type="text"
            placeholder="climate, open source"
            @focus="onFocusField"
          >
        </label>
        <label class="algo-sheet__field">
          <span>Exclude keywords</span>
          <input
            v-model="excludeKeywords"
            type="text"
            placeholder=" spoilers, giveaway"
            @focus="onFocusField"
          >
        </label>

        <p v-if="editing" class="algo-sheet__summary">
          {{ recipeSummary(editing) }}
          <template v-if="editing.authorAcct">
            · curated by @{{ editing.authorAcct }}
          </template>
        </p>

        <p v-if="shareUrl" class="algo-sheet__share-url">{{ shareUrl }}</p>
      </div>

      <footer class="algo-sheet__footer">
        <button
          v-if="editing && !editing.builtin"
          type="button"
          class="neo-btn neo-btn--tertiary algo-sheet__danger"
          @click="removeRecipe"
        >
          Delete
        </button>
        <button type="button" class="neo-btn neo-btn--tertiary" :disabled="saving" @click="copyShareLink">
          Share
        </button>
        <button type="button" class="neo-btn neo-btn--secondary" :disabled="saving" @click="save(false)">
          Save
        </button>
        <button type="button" class="neo-btn neo-btn--primary" :disabled="saving" @click="save(true)">
          {{ editing ? 'Save & open' : 'Create & open' }}
        </button>
      </footer>
    </div>
  </NeoSheet>
</template>

<style lang="scss" scoped>
.algo-sheet {
  display: flex;
  flex-direction: column;
  max-height: inherit;
  background: var(--neo-bg-primary);
  border-radius: inherit;
}

.algo-sheet__body {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.algo-sheet__lede {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-secondary);
}

.algo-sheet__field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-muted);

  em {
    font-weight: 400;
    font-style: normal;
  }

  input,
  select {
    width: 100%;
    padding: 0.55rem 0.7rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--neo-text-primary);
    background: var(--neo-bg-secondary);
    border: 1px solid var(--neo-border-color);
    border-radius: 8px;

    &:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
    }
  }
}

.algo-sheet__toggles {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;

  legend {
    padding: 0 0.35rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
  }
}

.algo-sheet__check {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--neo-text-primary);
  cursor: pointer;

  input {
    width: 1.05rem;
    height: 1.05rem;
    accent-color: var(--neo-accent);
  }
}

.algo-sheet__summary {
  margin: 0;
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.algo-sheet__share-url {
  margin: 0;
  padding: 0.5rem 0.65rem;
  font-size: 0.6875rem;
  word-break: break-all;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary);
  border-radius: 8px;
}

.algo-sheet__footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
  padding: 0.65rem 0.75rem calc(0.65rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--neo-border-color);
}

.algo-sheet__danger {
  margin-right: auto;
  color: var(--neo-danger, #e11d48);
}
</style>
