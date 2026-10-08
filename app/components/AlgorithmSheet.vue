<script setup lang="ts">
/**
 * Create / edit / share a client-side algorithm recipe.
 * Tabs: Describe (NL sentence) · Rules (manual).
 */

import { useAlgorithmsStore } from '~/stores/algorithms'
import { useColumnsStore } from '~/stores/columns'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import {
  ALGORITHM_SENTENCE_EXAMPLES,
  ALGORITHM_SOURCES,
  buildShareUrl,
  parseAlgorithmSentence,
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
  initialFocus: '.algo-sheet__sentence',
})

const editorTab = ref<'describe' | 'rules'>('describe')
const editorTabs = [
  { id: 'describe', label: 'Describe' },
  { id: 'rules', label: 'Rules' },
]

const sentence = ref('')
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
/** When true, typing in Describe overwrites Rules fields */
const sentenceDrivesForm = ref(true)

const editing = computed(() =>
  algorithms.editingId ? algorithms.getRecipe(algorithms.editingId) : null,
)

const title = computed(() => (editing.value ? 'Edit algorithm' : 'New algorithm'))

const sourceOptions = computed(() =>
  ALGORITHM_SOURCES.filter((s) => !s.needsAuth || instancesStore.hasAuthenticatedInstance),
)

const parsed = computed(() => {
  if (!sentence.value.trim()) return null
  return parseAlgorithmSentence(sentence.value)
})

const liveSummary = computed(() =>
  recipeSummary({
    id: 'preview',
    name: name.value || 'Untitled',
    source: source.value,
    mediaOnly: mediaOnly.value,
    noReblogs: noReblogs.value,
    noReplies: noReplies.value,
    includeTags: includeTags.value.split(/[\s,]+/).filter(Boolean).map((t) => t.replace(/^#/, '')),
    excludeTags: excludeTags.value.split(/[\s,]+/).filter(Boolean).map((t) => t.replace(/^#/, '')),
    includeKeywords: includeKeywords.value.split(/,/).map((k) => k.trim()).filter(Boolean),
    excludeKeywords: excludeKeywords.value.split(/,/).map((k) => k.trim()).filter(Boolean),
    createdAt: 0,
    updatedAt: 0,
  }),
)

function applyParsed(p: NonNullable<typeof parsed.value>, opts?: { keepName?: boolean }) {
  if (!opts?.keepName || !name.value.trim()) name.value = p.name
  description.value = p.description
  source.value = p.source
  // Fall back if guest picked home
  if (p.source === 'home' && !instancesStore.hasAuthenticatedInstance) {
    source.value = 'local'
  }
  mediaOnly.value = p.mediaOnly
  noReblogs.value = p.noReblogs
  noReplies.value = p.noReplies
  includeTags.value = p.includeTags.map((t) => `#${t}`).join(' ')
  excludeTags.value = p.excludeTags.map((t) => `#${t}`).join(' ')
  includeKeywords.value = p.includeKeywords.join(', ')
  excludeKeywords.value = p.excludeKeywords.join(', ')
}

watch(sentence, (s) => {
  if (!sentenceDrivesForm.value) return
  const p = s.trim() ? parseAlgorithmSentence(s) : null
  if (!p) return
  applyParsed(p)
})

function useExample(ex: string) {
  sentenceDrivesForm.value = true
  sentence.value = ex
  editorTab.value = 'describe'
}

function onRulesManualEdit() {
  sentenceDrivesForm.value = false
}

function resetFromRecipe() {
  const r = editing.value
  sentenceDrivesForm.value = !r
  editorTab.value = r ? 'rules' : 'describe'
  sentence.value = ''
  shareUrl.value = ''
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
  sentence.value = r.description || r.name
}

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      algorithms.hydrate()
      resetFromRecipe()
    }
  },
  // Layout mounts this sheet on first open — open is already true then
  { immediate: true },
)

watch(
  () => algorithms.editingId,
  () => {
    if (open.value) resetFromRecipe()
  },
)

async function save(andOpen: boolean) {
  // Apply latest sentence parse if Describe is driving
  if (sentenceDrivesForm.value && parsed.value) applyParsed(parsed.value, { keepName: true })

  const n = name.value.trim()
  if (!n) {
    toast.show({ message: 'Give this algorithm a name' })
    editorTab.value = 'rules'
    return
  }
  saving.value = true
  try {
    const recipe = algorithms.upsert({
      id: editing.value?.builtin ? undefined : editing.value?.id,
      name: n,
      description: description.value || sentence.value.trim() || undefined,
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
  if (sentenceDrivesForm.value && parsed.value) applyParsed(parsed.value, { keepName: true })
  if (!name.value.trim() && !editing.value) {
    toast.show({ message: 'Describe or name the algorithm before sharing' })
    return
  }
  const recipe = algorithms.upsert({
    id: editing.value?.builtin ? undefined : editing.value?.id,
    name: name.value.trim() || editing.value?.name || 'Untitled',
    description: description.value || sentence.value.trim() || undefined,
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
      <div class="algo-sheet__hero" aria-hidden="true">
        <span class="algo-sheet__hero-glow" />
      </div>

      <NeoSheetHeader :title="title" @cancel="algorithms.closeEditor()" />

      <div class="algo-sheet__body">
        <p class="algo-sheet__lede">
          Describe what you want — or fine-tune the rules. Share a link so others can run your curation on their board.
        </p>

        <NeoTabs
          v-model="editorTab"
          class="algo-sheet__tabs"
          :tabs="editorTabs"
          :panels="false"
          controls-id="algo-editor-panel"
          aria-label="Algorithm editor mode"
          id-prefix="algo-edit"
        />

        <div
          id="algo-editor-panel"
          class="algo-sheet__panel"
          role="tabpanel"
          :aria-labelledby="`algo-edit-tab-${editorTab}`"
        >
          <!-- Describe -->
          <div v-show="editorTab === 'describe'" class="algo-sheet__describe">
            <label class="algo-sheet__field algo-sheet__field--sentence">
              <span>In a sentence</span>
              <textarea
                v-model="sentence"
                class="algo-sheet__sentence"
                rows="3"
                maxlength="240"
                placeholder="e.g. Cat photos on local, no boosts…"
                @focus="onFocusField($event); sentenceDrivesForm = true"
              />
            </label>

            <div class="algo-sheet__examples" aria-label="Try an example">
              <button
                v-for="ex in ALGORITHM_SENTENCE_EXAMPLES"
                :key="ex"
                type="button"
                class="algo-sheet__example"
                @click="useExample(ex)"
              >
                {{ ex }}
              </button>
            </div>

            <Transition name="algo-chips" mode="out-in">
              <div v-if="parsed?.chips.length" :key="parsed.chips.join('|')" class="algo-sheet__chips">
                <span
                  v-for="(chip, i) in parsed.chips"
                  :key="`${chip}-${i}`"
                  class="algo-sheet__chip"
                  :class="{ 'algo-sheet__chip--minus': chip.startsWith('−') }"
                  :style="{ animationDelay: `${i * 40}ms` }"
                >
                  {{ chip }}
                </span>
              </div>
              <p v-else class="algo-sheet__hint">
                Tip: mention Local / Federated, #tags, “no politics”, photos, or no boosts.
              </p>
            </Transition>
          </div>

          <!-- Rules -->
          <div v-show="editorTab === 'rules'" class="algo-sheet__rules" @change="onRulesManualEdit">
            <label class="algo-sheet__field">
              <span>Name</span>
              <input
                v-model="name"
                class="algo-sheet__name"
                type="text"
                maxlength="48"
                placeholder="Cat photos, No politics…"
                @focus="onFocusField"
                @input="onRulesManualEdit"
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
                @input="onRulesManualEdit"
              >
            </label>

            <fieldset class="algo-sheet__sources">
              <legend>Source</legend>
              <div class="algo-sheet__source-pills">
                <label
                  v-for="opt in sourceOptions"
                  :key="opt.value"
                  class="algo-sheet__pill"
                  :class="{ 'algo-sheet__pill--on': source === opt.value }"
                >
                  <input
                    v-model="source"
                    type="radio"
                    :value="opt.value"
                    class="sr-only"
                    @change="onRulesManualEdit"
                  >
                  <NeoIcon
                    v-if="source === opt.value"
                    name="check"
                    :size="14"
                    :stroke="2.25"
                    class="algo-sheet__check"
                  />
                  {{ opt.label.replace(' (home)', '') }}
                </label>
              </div>
            </fieldset>

            <div class="algo-sheet__toggles" role="group" aria-label="Filters">
              <label class="algo-sheet__toggle" :class="{ 'algo-sheet__toggle--on': mediaOnly }">
                <input v-model="mediaOnly" type="checkbox" @change="onRulesManualEdit">
                <NeoIcon name="image" :size="16" :stroke="1.75" />
                Media only
                <NeoIcon v-if="mediaOnly" name="check" :size="14" :stroke="2.25" class="algo-sheet__check" />
              </label>
              <label class="algo-sheet__toggle" :class="{ 'algo-sheet__toggle--on': noReblogs }">
                <input v-model="noReblogs" type="checkbox" @change="onRulesManualEdit">
                <NeoIcon name="reblog" :size="16" :stroke="1.75" />
                Hide boosts
                <NeoIcon v-if="noReblogs" name="check" :size="14" :stroke="2.25" class="algo-sheet__check" />
              </label>
              <label class="algo-sheet__toggle" :class="{ 'algo-sheet__toggle--on': noReplies }">
                <input v-model="noReplies" type="checkbox" @change="onRulesManualEdit">
                <NeoIcon name="message" :size="16" :stroke="1.75" />
                Hide replies
                <NeoIcon v-if="noReplies" name="check" :size="14" :stroke="2.25" class="algo-sheet__check" />
              </label>
            </div>

            <div class="algo-sheet__grid">
              <label class="algo-sheet__field">
                <span>Must include tags</span>
                <input
                  v-model="includeTags"
                  type="text"
                  placeholder="#cats #photography"
                  @focus="onFocusField"
                  @input="onRulesManualEdit"
                >
              </label>
              <label class="algo-sheet__field">
                <span>Exclude tags</span>
                <input
                  v-model="excludeTags"
                  type="text"
                  placeholder="#nsfw #politics"
                  @focus="onFocusField"
                  @input="onRulesManualEdit"
                >
              </label>
              <label class="algo-sheet__field">
                <span>Must include keywords</span>
                <input
                  v-model="includeKeywords"
                  type="text"
                  placeholder="climate, open source"
                  @focus="onFocusField"
                  @input="onRulesManualEdit"
                >
              </label>
              <label class="algo-sheet__field">
                <span>Exclude keywords</span>
                <input
                  v-model="excludeKeywords"
                  type="text"
                  placeholder="spoilers, giveaway"
                  @focus="onFocusField"
                  @input="onRulesManualEdit"
                >
              </label>
            </div>
          </div>
        </div>

        <div class="algo-sheet__preview">
          <NeoIcon name="filter" :size="14" :stroke="2" />
          <span>{{ liveSummary || 'Start describing to preview rules' }}</span>
          <template v-if="editing?.authorAcct">
            · @{{ editing.authorAcct }}
          </template>
        </div>

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
          <NeoIcon name="share" :size="15" :stroke="1.75" />
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
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: inherit;
  background: var(--neo-bg-primary);
  border-radius: inherit;
  overflow: hidden;
}

.algo-sheet__hero {
  position: absolute;
  inset: 0 0 auto 0;
  height: 7.5rem;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

.algo-sheet__hero-glow {
  display: block;
  position: absolute;
  inset: -40% -20% auto -20%;
  height: 140%;
  background:
    radial-gradient(
      60% 80% at 20% 0%,
      color-mix(in srgb, var(--neo-accent) 22%, transparent),
      transparent 70%
    ),
    radial-gradient(
      50% 70% at 85% 10%,
      color-mix(in srgb, var(--neo-accent) 12%, transparent),
      transparent 65%
    );
  opacity: 0.9;
}

.algo-sheet :deep(.neo-sheet-header) {
  position: relative;
  z-index: 1;
  background: transparent;
  border-bottom-color: color-mix(in srgb, var(--neo-border-color) 70%, transparent);
}

.algo-sheet__body {
  position: relative;
  z-index: 1;
  flex: 1;
  overflow-y: auto;
  padding: 0.65rem 1rem 1rem;
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

.algo-sheet__tabs {
  :deep(.neo-tabs__list) {
    gap: 0.25rem;
    padding: 0.2rem;
    border: 1px solid var(--neo-border-color);
    border-radius: 10px;
    background: var(--neo-bg-secondary);
    border-bottom: 1px solid var(--neo-border-color);
  }

  :deep(.neo-tabs__tab) {
    flex: 1;
    justify-content: center;
    border-radius: 8px;
    padding: 0.45rem 0.65rem;
    font-weight: 600;
    box-shadow: none;

    &[aria-selected='true'] {
      background: var(--neo-bg-primary);
      color: var(--neo-text-primary);
      box-shadow: 0 1px 2px color-mix(in srgb, var(--neo-text-primary) 8%, transparent);
    }
  }
}

.algo-sheet__panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 12rem;
}

.algo-sheet__describe,
.algo-sheet__rules {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
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
  select,
  textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    font-family: inherit;
    color: var(--neo-text-primary);
    background: var(--neo-bg-secondary);
    border: 1px solid var(--neo-border-color);
    border-radius: 10px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:focus {
      outline: 2px solid var(--neo-focus);
      outline-offset: 1px;
      border-color: color-mix(in srgb, var(--neo-accent) 55%, var(--neo-border-color));
    }
  }
}

.algo-sheet__sentence {
  resize: vertical;
  min-height: 5.5rem;
  line-height: 1.45;
  font-size: 1rem !important;
  font-weight: 500 !important;
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--neo-bg-primary) 40%, var(--neo-bg-secondary)),
      var(--neo-bg-secondary)
    ) !important;
}

.algo-sheet__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.algo-sheet__example {
  padding: 0.35rem 0.65rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary);
  border: 1px solid transparent;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;

  &:hover {
    color: var(--neo-text-primary);
    border-color: color-mix(in srgb, var(--neo-accent) 35%, var(--neo-border-color));
    background: color-mix(in srgb, var(--neo-accent) 10%, var(--neo-bg-tertiary));
  }
}

.algo-sheet__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  min-height: 1.75rem;
}

.algo-sheet__chip {
  display: inline-flex;
  align-items: center;
  padding: 0.28rem 0.6rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--neo-text-primary);
  background: color-mix(in srgb, var(--neo-accent) 14%, var(--neo-bg-secondary));
  border: 1px solid color-mix(in srgb, var(--neo-accent) 28%, var(--neo-border-color));
  border-radius: 999px;
  animation: algo-chip-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;

  &--minus {
    color: var(--neo-text-secondary);
    background: var(--neo-bg-tertiary);
    border-color: var(--neo-border-color);
  }
}

@keyframes algo-chip-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.algo-chips-enter-active,
.algo-chips-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.algo-chips-enter-from,
.algo-chips-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

.algo-sheet__hint {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--neo-text-muted);
}

.algo-sheet__sources {
  margin: 0;
  padding: 0;
  border: none;

  legend {
    margin-bottom: 0.4rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-muted);
  }
}

.algo-sheet__source-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.algo-sheet__pill {
  display: inline-flex;
  align-items: center;
  padding: 0.45rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;

  // Not color alone: on also gets a ✓ glyph and a heavier border
  &--on {
    gap: 0.3rem;
    padding-left: 0.6rem;
    color: var(--neo-text-primary);
    background: color-mix(in srgb, var(--neo-accent) 16%, var(--neo-bg-secondary));
    border-color: var(--neo-accent);
    box-shadow: inset 0 0 0 1px var(--neo-accent);
  }

  // Visually-hidden radio — show its keyboard focus on the pill
  &:has(input:focus-visible) {
    outline: 2px solid var(--neo-focus);
    outline-offset: 2px;
  }
}

.algo-sheet__check {
  flex-shrink: 0;
}

.algo-sheet__toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.algo-sheet__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.7rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;

  input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  // Not color alone: on also gets a ✓ glyph and a heavier border
  &--on {
    color: var(--neo-text-primary);
    background: color-mix(in srgb, var(--neo-accent) 16%, var(--neo-bg-secondary));
    border-color: var(--neo-accent);
    box-shadow: inset 0 0 0 1px var(--neo-accent);
  }

  // opacity:0 checkbox — show its keyboard focus on the label
  &:has(input:focus-visible) {
    outline: 2px solid var(--neo-focus);
    outline-offset: 2px;
  }
}

.algo-sheet__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.65rem;

  @media (min-width: 480px) {
    grid-template-columns: 1fr 1fr;
  }
}

.algo-sheet__preview {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  padding: 0.55rem 0.7rem;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: var(--neo-bg-tertiary);
  border-radius: 10px;

  span {
    flex: 1;
    min-width: 0;
  }
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
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 0.45rem;
  padding: 0.65rem 0.75rem calc(0.65rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--neo-border-color);
  background: color-mix(in srgb, var(--neo-bg-primary) 92%, transparent);
  backdrop-filter: blur(8px);
}

.algo-sheet__danger {
  margin-right: auto;
  color: var(--neo-danger, #e11d48);
}
</style>
