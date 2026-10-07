<script setup lang="ts">
/**
 * Shared stroke icons — Braun / neo chrome.
 * House style: 24 viewBox, stroke currentColor, round caps/joins.
 * Idle chrome: stroke 1.5 · Active: stroke 2 · Size: 18–22
 */

import { h } from 'vue'
import { resolveIcon, type NeoIconName } from '~/utils/neoIcons'

export type { NeoIconName }

const props = withDefaults(
  defineProps<{
    name: NeoIconName
    size?: number | string
    stroke?: number | string
    /** Filled variant where supported (home, message, heart) */
    filled?: boolean
    /** Accessible name — sets role=img + <title>; decorative when omitted */
    label?: string
  }>(),
  {
    size: 20,
    stroke: 1.75,
    filled: false,
  },
)

/** Single svg VNode so path children stay in the SVG namespace (no component boundary). */
const svg = computed(() =>
  h(
    'svg',
    {
      class: 'neo-icon',
      width: props.size,
      height: props.size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': props.stroke,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      focusable: 'false',
      role: props.label ? 'img' : undefined,
      'aria-hidden': props.label ? undefined : 'true',
      'aria-label': props.label || undefined,
      style: {
        display: 'inline-block',
        flexShrink: 0,
        verticalAlign: 'middle',
      },
    },
    [
      props.label ? h('title', props.label) : null,
      ...resolveIcon(props.name)({ filled: props.filled }),
    ],
  ),
)
</script>

<template>
  <component :is="svg" />
</template>

<style scoped>
.neo-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
