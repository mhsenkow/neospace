/** Shared Activity vs Mentions route state for shell chrome. */

export function useActivityNav() {
  const route = useRoute()
  const path = computed(() => route.path.replace(/\/+$/, '') || '/')

  const isMentions = computed(
    () => path.value === '/notifications' && route.query.filter === 'mention',
  )
  const isActivity = computed(
    () => path.value === '/notifications' && !isMentions.value,
  )

  return { path, isActivity, isMentions }
}
