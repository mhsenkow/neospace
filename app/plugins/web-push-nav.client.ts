/**
 * When a push notification is clicked and the SW can't navigate the client,
 * it posts { type: 'neo-push-navigate', url }.
 */
export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator)) return
  const router = useRouter()
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string; url?: string } | null
    if (!data || data.type !== 'neo-push-navigate' || typeof data.url !== 'string') return
    const url = data.url.startsWith('/') ? data.url : '/notifications'
    void router.push(url)
  })
})
