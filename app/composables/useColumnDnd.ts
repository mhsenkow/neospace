/** Shared drag-and-drop handlers for multi-column chrome. */
const COLUMN_MIME = 'application/x-neospace-column'

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
    e.dataTransfer?.setData(COLUMN_MIME, columnId())
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    emit('column-drag-start', columnId())
  }

  const onColumnDragEnd = () => {
    emit('column-drag-end')
  }

  const onColumnDragOver = (e: DragEvent) => {
    if (!canReorder()) return
    // Only advertise a drop target for column drags — not selected text, links or files
    if (!e.dataTransfer?.types?.includes(COLUMN_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    emit('column-drag-over', columnId())
  }

  const onColumnDrop = (e: DragEvent) => {
    if (!canReorder()) return
    e.preventDefault()
    const fromId = e.dataTransfer?.getData(COLUMN_MIME)
    if (fromId && fromId !== columnId()) {
      emit('column-drop', fromId)
    }
    emit('column-drag-end')
  }

  return { onColumnDragStart, onColumnDragEnd, onColumnDragOver, onColumnDrop }
}
