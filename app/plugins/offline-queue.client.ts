/** Hydrate + flush the offline like queue as soon as the app boots. */
export default defineNuxtPlugin(() => {
  const { hydrate, flush } = useOfflineQueue()
  hydrate()
  if (navigator.onLine) void flush()
})
