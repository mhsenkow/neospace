<script setup lang="ts">
/**
 * Shared find-a-server surface: featured list, search, live peek.
 * Used on login; Explore uses the fuller browse UI.
 */

import { useCuratedInstances } from '~/composables/useCuratedInstances'
import { useInstancesStore } from '~/stores/instances'
import { createRaceGuard } from '~/composables/useRace'
import { normalizeServer, friendlyServerError, isAuthGatedPublicHost } from '~/utils/instances'

const props = withDefaults(
  defineProps<{
    /** Disable interactions while parent is connecting */
    disabled?: boolean
    /** Prefill the custom field */
    initialQuery?: string
    submitLabel?: string
  }>(),
  {
    disabled: false,
    submitLabel: 'Continue',
  },
)

const emit = defineEmits<{
  select: [url: string]
}>()

const { featured, search } = useCuratedInstances()
const instancesStore = useInstancesStore()

const query = ref(props.initialQuery || '')
/** Custom server field is primary — featured list is secondary. */
const showCustom = ref(true)
const inputRef = ref<HTMLInputElement | null>(null)
const localError = ref<string | null>(null)

const peekLoading = ref(false)
const peekTitle = ref<string | null>(null)
const peekOpen = ref<boolean | null>(null)
const peekUsers = ref<number | null>(null)
const peekHost = ref<string | null>(null)
const peekGated = ref(false)
const peekFailed = ref(false)
let peekTimer: ReturnType<typeof setTimeout> | null = null
const peekRace = createRaceGuard()

const inputErrorId = 'server-picker-input-error'

const catalogHits = computed(() => {
  const q = query.value.trim()
  if (q.length < 2) return []
  return search(q).slice(0, 6)
})

const openCustom = async () => {
  showCustom.value = true
  localError.value = null
  await nextTick()
  inputRef.value?.focus()
}

const clearPeek = () => {
  peekTitle.value = null
  peekOpen.value = null
  peekUsers.value = null
  peekHost.value = null
  peekGated.value = false
  peekFailed.value = false
}

const schedulePeek = () => {
  if (peekTimer) clearTimeout(peekTimer)
  peekTimer = setTimeout(runPeek, 420)
}

const runPeek = async () => {
  const url = normalizeServer(query.value)
  if (!url) {
    clearPeek()
    return
  }
  const host = url.replace(/^https?:\/\//, '')
  peekHost.value = host
  peekGated.value = isAuthGatedPublicHost(host)
  peekLoading.value = true
  const ticket = peekRace.next()
  try {
    const info = await instancesStore.fetchInstanceInfo(host)
    if (!ticket.isCurrent() || peekHost.value !== host) return
    if (info) {
      peekTitle.value = info.title || host
      peekOpen.value = info.registrations ?? null
      peekUsers.value = info.stats?.userCount ?? null
      peekFailed.value = false
      localError.value = null
    } else {
      peekTitle.value = null
      peekOpen.value = null
      peekUsers.value = null
      peekFailed.value = true
    }
  } finally {
    if (ticket.isCurrent()) peekLoading.value = false
  }
}

watch(query, () => {
  localError.value = null
  if (showCustom.value) schedulePeek()
})

const pick = (domainOrUrl: string) => {
  if (props.disabled) return
  const url = normalizeServer(domainOrUrl)
  if (!url) {
    localError.value = 'Enter a server name like mastodon.social'
    showCustom.value = true
    return
  }
  emit('select', url)
}

const submitCustom = () => {
  if (props.disabled) return
  const url = normalizeServer(query.value)
  if (!url) {
    localError.value = 'Enter a server name like mastodon.social'
    return
  }
  emit('select', url)
}

const onCatalogHit = (domain: string) => {
  query.value = domain
  localError.value = null
  schedulePeek()
}

defineExpose({
  setError: (msg: string | null) => {
    localError.value = msg
    if (msg) showCustom.value = true
  },
  friendlyError: friendlyServerError,
  openCustom,
})

onMounted(() => {
  // Desktop only — autofocus on phones pops the keyboard over the server list
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    nextTick(() => inputRef.value?.focus({ preventScroll: true }))
  }
  if (query.value.trim()) schedulePeek()
})

onUnmounted(() => {
  if (peekTimer) clearTimeout(peekTimer)
})
</script>

<template>
  <div class="server-picker" :class="{ 'server-picker--disabled': disabled }">
    <div v-if="localError" :id="inputErrorId" class="server-picker__error" role="alert">{{ localError }}</div>

    <div class="server-picker__custom">
      <form class="server-picker__form" @submit.prevent="submitCustom">
        <label class="server-picker__label" for="server-picker-input">Your handle or server</label>
        <input
          id="server-picker-input"
          ref="inputRef"
          v-model="query"
          type="text"
          class="server-picker__input"
          placeholder="@you@example.social or example.social"
          inputmode="url"
          enterkeyhint="go"
          autocomplete="username"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          :disabled="disabled"
          :aria-invalid="!!localError"
          :aria-describedby="localError ? inputErrorId : undefined"
        />
        <p class="server-picker__hint">
          Pick the server where your account lives — like a phone company for the fediverse.
          Enter <strong>@you@server</strong> or just the server name (e.g.
          <strong>mastodon.social</strong>).
        </p>
        <p v-if="peekUsers != null || peekOpen != null" class="server-picker__peek-summary">
          <template v-if="peekUsers != null">{{ peekUsers.toLocaleString() }} monthly active</template>
          <template v-if="peekOpen === true"> · open registration</template>
          <template v-else-if="peekOpen === false"> · invite-only</template>
        </p>

        <!-- Live peek -->
        <div v-if="peekHost && (peekLoading || peekTitle || peekFailed)" class="server-picker__peek" aria-live="polite">
          <div v-if="peekLoading" class="server-picker__peek-loading">Checking {{ peekHost }}…</div>
          <div v-else-if="peekFailed" class="server-picker__peek-error" role="alert">
            Couldn’t reach {{ peekHost }}
          </div>
          <template v-else-if="peekTitle">
            <div class="server-picker__peek-title">{{ peekTitle }}</div>
            <div class="server-picker__peek-meta">
              <span v-if="peekUsers != null">{{ peekUsers.toLocaleString() }} monthly active</span>
              <span v-if="peekOpen === true">Registrations open</span>
              <span v-else-if="peekOpen === false">Registrations closed</span>
              <span v-if="peekGated" class="server-picker__peek-note">
                Public feed often needs sign-in on this server
              </span>
            </div>
          </template>
        </div>

        <!-- Catalog matches while typing -->
        <ul v-if="catalogHits.length && query.trim().length >= 2" class="server-picker__hits">
          <li v-for="hit in catalogHits" :key="hit.domain">
            <button type="button" class="server-picker__hit" :disabled="disabled" @click="onCatalogHit(hit.domain)">
              <span>{{ hit.emoji }} {{ hit.domain }}</span>
              <span class="server-picker__hit-blurb">{{ hit.blurb }}</span>
            </button>
          </li>
        </ul>

        <button type="submit" class="server-picker__submit" :disabled="disabled || !query.trim()">
          {{ submitLabel }}
        </button>
      </form>
    </div>

    <p class="server-picker__featured-label">Or pick a featured server</p>
    <div class="server-picker__list">
      <button
        v-for="server in featured"
        :key="server.domain"
        type="button"
        class="server-picker__row"
        :disabled="disabled"
        @click="pick(server.domain)"
      >
        <span class="server-picker__emoji" aria-hidden="true">{{ server.emoji }}</span>
        <span class="server-picker__meta">
          <span class="server-picker__name">{{ server.domain }}</span>
          <span class="server-picker__blurb">{{ server.blurb }}</span>
        </span>
        <span class="server-picker__arrow" aria-hidden="true">→</span>
      </button>
    </div>

    <p class="server-picker__more">
      Prefer browsing by interest?
      <NuxtLink to="/explore">Explore servers</NuxtLink>
    </p>
  </div>
</template>

<style scoped lang="scss">
.server-picker {
  &--disabled {
    opacity: 0.72;
    pointer-events: none;
  }
}

.server-picker__featured-label {
  margin: 1.25rem 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--neo-text-tertiary);
}

.server-picker__list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.server-picker__row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
  min-height: 56px;
  padding: 0.75rem 1rem;
  text-align: left;
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color var(--neo-transition-fast), background-color var(--neo-transition-fast);

  &:hover,
  &:focus-visible {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
    outline: none;
  }

  &:active {
    transform: translateY(1px);
  }
}

.server-picker__emoji {
  font-size: 1.15rem;
  line-height: 1;
}

.server-picker__meta {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.server-picker__name {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.server-picker__blurb {
  font-size: 0.75rem;
  color: var(--neo-text-muted);
}

.server-picker__arrow {
  font-size: 1.125rem;
  color: var(--neo-accent);
}

.server-picker__error {
  margin-top: 1rem;
  padding: 0.75rem 0.875rem;
  background: var(--neo-danger-soft);
  border: 1px solid color-mix(in srgb, var(--neo-danger) 35%, transparent);
  border-radius: 4px;
  color: var(--neo-danger);
  font-size: 0.875rem;
  line-height: 1.45;
}

.server-picker__custom {
  margin-top: 1.25rem;
}

.server-picker__toggle {
  display: block;
  width: 100%;
  padding: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--neo-text-secondary);
  background: transparent;
  border: 1px dashed var(--neo-border-color-dark);
  border-radius: 4px;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--neo-accent);
    border-color: var(--neo-accent);
    outline: none;
  }
}

.server-picker__form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.server-picker__label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-secondary);
}

.server-picker__input {
  width: 100%;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  color: var(--neo-text-primary);
  background: var(--neo-bg-primary);
  border: 1px solid var(--neo-border-color-dark);
  border-radius: 4px;
  outline: none;

  &::placeholder {
    color: var(--neo-text-disabled);
  }

  &:focus-visible {
    border-color: var(--neo-accent);
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: 2px;
  }
}

.server-picker__hint {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.45;
  color: var(--neo-text-muted);

  strong {
    color: var(--neo-text-secondary);
    font-weight: 600;
  }
}

.server-picker__peek {
  padding: 0.65rem 0.75rem;
  background: var(--neo-bg-secondary);
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  font-size: 0.8125rem;
}

.server-picker__peek-loading {
  color: var(--neo-text-muted);
}

.server-picker__peek-error {
  color: var(--neo-danger);
  font-size: 0.875rem;
}

.server-picker__peek-title {
  font-weight: 600;
  color: var(--neo-text-primary);
  margin-bottom: 0.25rem;
}

.server-picker__peek-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.75rem;
  color: var(--neo-text-muted);
}

.server-picker__peek-note {
  color: var(--neo-accent);
  font-weight: 500;
}

.server-picker__hits {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--neo-border-color);
  border-radius: 4px;
  overflow: hidden;
}

.server-picker__hit {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.55rem 0.75rem;
  text-align: left;
  background: var(--neo-bg-primary);
  border: none;

  &:focus-visible {
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: -2px;
  }
  border-bottom: 1px solid var(--neo-border-color);
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--neo-text-primary);

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: var(--neo-accent-soft);
  }
}

.server-picker__hit-blurb {
  color: var(--neo-text-muted);
  font-size: 0.75rem;
}

.server-picker__submit {
  width: 100%;
  margin-top: 0.35rem;
  min-height: 48px;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--neo-text-inverse, #fafaf8);
  background: var(--neo-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--neo-accent-hover);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.server-picker__more {
  margin: 1.25rem 0 0;
  text-align: center;
  font-size: 0.8125rem;
  color: var(--neo-text-muted);

  a {
    font-weight: 600;
    color: var(--neo-accent);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }
}
</style>
