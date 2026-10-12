<script setup lang="ts">
/**
 * Theme picker for the shell: Auto + every theme, with the current one checked.
 * Sits beside the one-way "cycle" row, which can't return to Auto or step back.
 */

import { useSettingsStore } from '~/stores/settings'
import { THEME_OPTIONS, type NeoThemeId } from '~/utils/appearance'
import { useShellAppearance } from '~/composables/useShellAppearance'

withDefaults(defineProps<{ placement?: 'bottom' | 'end' }>(), { placement: 'bottom' })

const settingsStore = useSettingsStore()
const { setTheme } = useShellAppearance()
const open = ref(false)

const choices = computed<{ id: NeoThemeId; label: string; desc: string }[]>(() => [
  { id: 'auto', label: 'Auto', desc: 'Follows your device — light, dark or high contrast' },
  ...THEME_OPTIONS.map((t) => ({ id: t.id as NeoThemeId, label: t.label, desc: t.desc })),
])
const current = computed(() => settingsStore.localPreferences.theme)

const pick = (id: NeoThemeId) => {
  setTheme(id)
}
</script>

<template>
  <NeoMenu
    v-model:open="open"
    class="theme-menu"
    label="Choose theme"
    teleport
    :placement="placement"
    panel-class="theme-menu__panel"
  >
    <NeoIcon name="chevron-down" :size="16" :stroke="2" />
    <template #items>
      <button
        v-for="opt in choices"
        :key="opt.id"
        type="button"
        role="menuitemradio"
        :aria-checked="current === opt.id"
        class="theme-menu__item"
        :class="{ active: current === opt.id }"
        :title="opt.desc"
        @click="pick(opt.id)"
      >
        <span class="theme-menu__check" aria-hidden="true">
          <NeoIcon v-if="current === opt.id" name="check" :size="14" :stroke="2.25" />
        </span>
        {{ opt.label }}
      </button>
    </template>
  </NeoMenu>
</template>

<style lang="scss" scoped>
.theme-menu {
  flex-shrink: 0;

  :deep(.neo-menu__trigger) {
    width: 36px;
    height: 36px;
    color: var(--neo-text-muted);

    @media (hover: hover) {
      &:hover {
        background: var(--neo-bg-hover);
        color: var(--neo-text-primary);
      }
    }
  }
}

.theme-menu__item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem 0.5rem 0.5rem;
  border: none;
  background: transparent;
  border-radius: calc(var(--neo-radius-sm, 4px) - 1px);
  font: inherit;
  font-size: 0.875rem;
  color: var(--neo-text-primary);
  cursor: pointer;

  &:hover,
  &:focus-visible {
    background: var(--neo-bg-hover);
  }

  &.active {
    color: var(--neo-accent);
    font-weight: 600;
  }
}

.theme-menu__check {
  display: inline-flex;
  width: 14px;
  justify-content: center;
}
</style>
