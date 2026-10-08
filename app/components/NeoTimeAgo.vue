<script setup lang="ts">
/**
 * Relative timestamp text: "5 minutes ago", or "5m" when the row it sits in is
 * narrow (phones, ~250px board columns) so names keep the room. Screen readers
 * always get the long form. Render it inside a <time :datetime :title> owned by
 * the caller, within a `container-type: inline-size` row (no container → long).
 */

defineProps<{
  date: string
}>()

const { formatRelativeTime, formatCompactRelativeTime } = useRelativeTime()
</script>

<template>
  <span class="neo-time-ago">
    <span class="neo-time-ago__long">{{ formatRelativeTime(date) }}</span>
    <span class="neo-time-ago__short" aria-hidden="true">{{ formatCompactRelativeTime(date) }}</span>
  </span>
</template>

<style scoped lang="scss">
.neo-time-ago {
  position: relative;
}

.neo-time-ago__short {
  display: none;
}

@container (max-width: 420px) {
  .neo-time-ago__long {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .neo-time-ago__short {
    display: inline;
  }
}
</style>
