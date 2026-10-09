<script setup lang="ts">
import { useColumnDnd } from '~/composables/useColumnDnd'

const props = withDefaults(
  defineProps<{
    columnId: string
    canReorder?: boolean
    isFirst?: boolean
    isLast?: boolean
  }>(),
  {
    canReorder: false,
    isFirst: false,
    isLast: true,
  },
)

const emit = defineEmits<{
  remove: []
  'column-drag-start': [columnId: string]
  'column-drag-end': []
  'column-drag-over': [columnId: string]
  'column-drop': [fromColumnId: string]
  'move-left': []
  'move-right': []
}>()

const { onColumnDragStart, onColumnDragEnd, onColumnDragOver, onColumnDrop } = useColumnDnd(
  () => props.columnId,
  emit,
  () => props.canReorder,
)
</script>

<template>
  <div class="column-header">
    <button
      v-if="canReorder"
      type="button"
      class="neo-chrome-btn column-drag-handle"
      draggable="true"
      title="Drag to reorder"
      aria-label="Reorder column — drag, or press Left / Right arrow"
      aria-keyshortcuts="ArrowLeft ArrowRight"
      @click.stop
      @keydown.left.prevent="!isFirst && emit('move-left')"
      @keydown.right.prevent="!isLast && emit('move-right')"
      @dragstart="onColumnDragStart"
      @dragend="onColumnDragEnd"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </button>

    <slot name="lead" />

    <div class="column-header__title">
      <slot name="title" />
    </div>

    <div v-if="canReorder" class="column-reorder">
      <button
        type="button"
        class="neo-chrome-btn"
        title="Move left"
        aria-label="Move column left"
        :disabled="isFirst"
        @pointerdown.stop
        @click.stop="emit('move-left')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        type="button"
        class="neo-chrome-btn"
        title="Move right"
        aria-label="Move column right"
        :disabled="isLast"
        @pointerdown.stop
        @click.stop="emit('move-right')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </div>

    <slot name="actions" />

    <slot name="close" />
  </div>
</template>

<style lang="scss" scoped>
.column-header__title {
  flex: 1;
  min-width: 0;
}
</style>
