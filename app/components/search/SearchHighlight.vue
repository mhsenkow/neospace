<script setup lang="ts">
/** Text with the query's words marked (escaped — no v-html). */
import { splitHighlight } from '~/utils/searchQuery'

const props = defineProps<{ text: string; terms: string[] }>()
const parts = computed(() => splitHighlight(props.text || '', props.terms))
</script>

<template>
  <template v-for="(p, i) in parts" :key="i"><mark v-if="p.hit" class="search-hl">{{ p.text }}</mark><template v-else>{{ p.text }}</template></template>
</template>

<style scoped>
.search-hl {
  padding: 0;
  border-radius: 2px;
  background: color-mix(in srgb, var(--neo-accent) 22%, transparent);
  color: inherit;
}
</style>
