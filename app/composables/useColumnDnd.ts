/** Shared drag-and-drop handlers for multi-column chrome. */
export function useColumnDnd(
  columnId: () => string,
  emit: {
    (e: 'column-drag-start', id: string): void
    (e: 'column-drag-end'): void
    (e: 'column-drag-over', id: string): void
    (e: 'column-drop', fromId: string): void
  },
  canReorder: () => boolean,
) {
  const onColumnDragStart = (e: DragEvent) => {
    if (!canReorder()) return
    e.dataTransfer?.setData('text/plain', columnId())
    e.dataTransfer?.setData('application/x-neospace-column', columnId())
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    emit('column-drag-start', columnId())
  }

  const onColumnDragEnd = () => {
    emit('column-drag-end')
  }

  const onColumnDragOver = (e: DragEvent) => {
    if (!canReorder()) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    emit('column-drag-over', columnId())
  }

  const onColumnDrop = (e: DragEvent) => {
    if (!canReorder()) return
    e.preventDefault()
    const fromId =
      e.dataTransfer?.getData('application/x-neospace-column') ||
      e.dataTransfer?.getData('text/plain')
    if (fromId && fromId !== columnId()) {
      emit('column-drop', fromId)
    }
    emit('column-drag-end')
  }

  return { onColumnDragStart, onColumnDragEnd, onColumnDragOver, onColumnDrop }
}
