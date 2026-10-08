<script setup lang="ts">
/**
 * Subtle bottom-right suite waffle — same pattern as ibm.io/wordcount,
 * tucked above mobile chrome so it stays out of the way.
 */

type SuiteTool = {
  id: string
  label: string
  blurb: string
  href: string
  current?: boolean
}

type SuiteGroup = {
  id: string
  label: string
  tools: SuiteTool[]
}

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const groups: SuiteGroup[] = [
  {
    id: 'think',
    label: 'think',
    tools: [
      {
        id: 'loom',
        label: 'loom',
        blurb: 'data · stories',
        href: 'https://loom.ibm.io/',
      },
      {
        id: 'wordcount',
        label: 'words',
        blurb: 'count · draft',
        href: 'https://ibm.io/wordcount/',
      },
    ],
  },
  {
    id: 'connect',
    label: 'connect',
    tools: [
      {
        id: 'neospace',
        label: 'neospace',
        blurb: 'people · feed',
        href: 'https://neospace.ibm.io/',
        current: true,
      },
      {
        id: 'ibm',
        label: 'ibm.io',
        blurb: 'home · work',
        href: 'https://ibm.io/',
      },
    ],
  },
]

const triggerEl = ref<HTMLButtonElement | null>(null)

const close = (opts?: { restoreFocus?: boolean }) => {
  open.value = false
  if (opts?.restoreFocus !== false) {
    nextTick(() => triggerEl.value?.focus())
  }
}

const toggle = () => {
  open.value = !open.value
}

const onDocPointer = (e: PointerEvent) => {
  if (!open.value || !rootEl.value) return
  if (e.target instanceof Node && rootEl.value.contains(e.target)) return
  close({ restoreFocus: false })
}

const onKey = (e: KeyboardEvent) => {
  if (e.defaultPrevented) return
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
}

watch(open, (isOpen) => {
  if (typeof document === 'undefined') return
  if (isOpen) {
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('pointerdown', onDocPointer)
    document.removeEventListener('keydown', onKey)
  }
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointer)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <nav
    ref="rootEl"
    class="suite-menu"
    :class="{ 'is-open': open }"
    aria-label="ibm.io tools"
  >
    <button
      ref="triggerEl"
      type="button"
      class="suite-menu__btn"
      :aria-expanded="open"
      aria-controls="neoSuitePanel"
      aria-label="Tools"
      title="Tools"
      @click="toggle"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" fill="currentColor" width="12" height="12">
        <rect x="1" y="1" width="3" height="3" rx=".4" />
        <rect x="8" y="1" width="3" height="3" rx=".4" />
        <rect x="1" y="8" width="3" height="3" rx=".4" />
        <rect x="8" y="8" width="3" height="3" rx=".4" />
      </svg>
    </button>

    <div
      v-show="open"
      id="neoSuitePanel"
      class="suite-menu__panel"
      role="region"
      aria-label="Tools"
    >
      <p class="suite-menu__lede">Instruments that help you think clearer.</p>

      <section
        v-for="group in groups"
        :key="group.id"
        class="suite-menu__group"
        :aria-label="group.label"
      >
        <span class="suite-menu__group-label">{{ group.label }}</span>
        <ul class="suite-menu__grid">
          <li v-for="tool in group.tools" :key="tool.id">
            <a
              class="suite-menu__tile"
              :class="{ 'is-current': tool.current }"
              :href="tool.href"
              :aria-current="tool.current ? 'page' : undefined"
              :target="tool.current ? undefined : '_blank'"
              :rel="tool.current ? undefined : 'noopener noreferrer'"
              :aria-label="tool.current ? tool.label : `${tool.label} (opens in new tab)`"
              @click="close({ restoreFocus: false })"
            >
              <span class="suite-menu__tile-label">{{ tool.label }}</span>
              <span class="suite-menu__tile-blurb">{{ tool.blurb }}</span>
            </a>
          </li>
        </ul>
      </section>

      <a
        class="suite-menu__map"
        href="https://ibm.io/tools/"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="All tools (opens in new tab)"
        @click="close({ restoreFocus: false })"
      >
        all tools
      </a>
    </div>
  </nav>
</template>

<style lang="scss" scoped>
/* Positioning comes from .neo-bottom-dock in the layout */
.suite-menu {
  position: relative;
  align-self: flex-end;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-end;
  font-family: var(--neo-font-family-ui, var(--neo-font-family));
  color: var(--neo-text-muted);
  pointer-events: none;
}

.suite-menu__btn {
  pointer-events: auto;
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 2px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.72;
  transition: opacity 0.2s ease, color 0.2s ease, background 0.2s ease;
  touch-action: manipulation;

  &::before {
    content: '';
    position: absolute;
    inset: 8px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--neo-bg-primary) 88%, transparent);
    z-index: -1;
  }

  &:hover,
  &:focus-visible,
  .suite-menu.is-open & {
    opacity: 0.95;
    color: var(--neo-text-primary);
  }

  &:focus-visible {
    outline: 1px solid var(--neo-accent);
    outline-offset: 2px;
  }
}

.suite-menu__panel {
  pointer-events: auto;
  margin-bottom: 4px;
  width: min(292px, calc(100vw - 24px));
  max-height: min(60vh, calc(100dvh - 8rem));
  overflow: auto;
  overscroll-behavior: contain;
  padding: 12px 12px 14px;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--neo-bg-card) 96%, var(--neo-text-primary) 4%);
  border: 1px solid var(--neo-border-color);
  border-radius: 2px;
  box-shadow: 0 8px 28px color-mix(in srgb, var(--neo-text-primary) 12%, transparent);
  scrollbar-width: thin;
}

.suite-menu__lede {
  margin: 0 0 12px;
  padding: 0 4px;
  font-size: 0.6875rem;
  line-height: 1.35;
  color: var(--neo-text-muted);
}

.suite-menu__group {
  margin: 0 0 12px;

  &:last-of-type {
    margin-bottom: 8px;
  }
}

.suite-menu__group-label {
  display: block;
  font-size: 0.6875rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--neo-text-muted);
  padding: 2px 4px 6px;
}

.suite-menu__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.suite-menu__tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  min-height: 52px;
  padding: 8px 8px 7px;
  text-decoration: none;
  color: var(--neo-text-muted);
  border: 1px solid transparent;
  border-radius: 2px;
  transition: color 0.15s ease, background 0.15s ease, border-color 0.15s ease;

  &:hover {
    color: var(--neo-text-primary);
    background: var(--neo-bg-hover);
    border-color: color-mix(in srgb, var(--neo-accent) 45%, transparent);
  }

  &:focus-visible {
    color: var(--neo-text-primary);
    background: var(--neo-bg-hover);
    border-color: color-mix(in srgb, var(--neo-accent) 45%, transparent);
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }

  &.is-current {
    color: var(--neo-text-primary);
    border-color: color-mix(in srgb, var(--neo-accent) 55%, transparent);
    background: var(--neo-accent-soft);
  }
}

.suite-menu__tile-label {
  font-size: 0.8125rem;
  letter-spacing: 0.03em;
  text-transform: lowercase;
}

.suite-menu__tile-blurb {
  font-size: 0.625rem;
  opacity: 0.75;
  line-height: 1.3;
}

.suite-menu__map {
  display: block;
  margin-top: 4px;
  padding: 8px 4px 2px;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: lowercase;
  text-decoration: none;
  color: var(--neo-text-muted);
  border-top: 1px solid var(--neo-border-color);

  &:hover {
    color: var(--neo-accent);
  }

  &:focus-visible {
    color: var(--neo-accent);
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }
}
</style>
