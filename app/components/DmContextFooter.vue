<script setup lang="ts">
/**
 * Tiny tertiary Chat | Profile icon toggle — sits by the send button.
 */

type DmContextPane = 'chat' | 'profile'

defineProps<{
  pane: DmContextPane
}>()

const emit = defineEmits<{
  'update:pane': [pane: DmContextPane]
}>()

const tabs = [
  { id: 'chat' as const, label: 'Chat', icon: 'message' as const },
  { id: 'profile' as const, label: 'Profile', icon: 'user' as const },
]

const listRef = ref<HTMLElement | null>(null)

const select = (id: DmContextPane) => emit('update:pane', id)

const onKeydown = (e: KeyboardEvent, index: number) => {
  const n = tabs.length
  let next = index
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault()
    next = (index + 1) % n
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault()
    next = (index - 1 + n) % n
  } else if (e.key === 'Home') {
    e.preventDefault()
    next = 0
  } else if (e.key === 'End') {
    e.preventDefault()
    next = n - 1
  } else {
    return
  }
  const tab = tabs[next]
  if (!tab) return
  select(tab.id)
  nextTick(() => {
    listRef.value
      ?.querySelector<HTMLElement>(`#dm-context-tab-${tab.id}`)
      ?.focus()
  })
}
</script>

<template>
  <div
    ref="listRef"
    class="dm-context-footer"
    role="tablist"
    aria-label="Conversation view"
  >
    <button
      v-for="(tab, i) in tabs"
      :id="`dm-context-tab-${tab.id}`"
      :key="tab.id"
      type="button"
      class="dm-context-footer__tab"
      role="tab"
      :aria-selected="tab.id === pane"
      aria-controls="dm-context-panel"
      :tabindex="tab.id === pane ? 0 : -1"
      :title="tab.label"
      :aria-label="tab.label"
      @click="select(tab.id)"
      @keydown="onKeydown($event, i)"
    >
      <NeoIcon
        :name="tab.icon"
        :size="12"
        :stroke="1.75"
        :filled="tab.id === pane"
      />
      <span class="dm-context-footer__label">{{ tab.label }}</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.dm-context-footer {
  display: inline-flex;
  align-items: center;
  // Hit areas are 32×44 (see ::before) — the gap keeps neighbours from overlapping
  gap: 10px;
}

.dm-context-footer__tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.28rem;
  min-width: 22px;
  height: 22px;
  padding: 0 0.35rem;
  border: none;
  border-radius: 5px;
  background: transparent;
  // Full opacity: tertiary text at 0.55 dropped below 3:1 against the bar
  color: var(--neo-text-secondary);
  cursor: pointer;

  // Touch target: 44px tall without growing the visual chip
  &::before {
    content: '';
    position: absolute;
    inset: -11px -5px;
  }

  &[aria-selected='true'] {
    color: var(--neo-text-primary);
    background: color-mix(in srgb, var(--neo-text-primary) 10%, transparent);
  }

  @include hover {
    color: var(--neo-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--neo-focus, var(--neo-accent));
    outline-offset: 2px;
  }
}

.dm-context-footer__label {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
}
</style>
