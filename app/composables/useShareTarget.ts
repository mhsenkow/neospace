/**
 * Opens the New thread sheet from a PWA share target or a home-screen shortcut.
 * Shared text is stashed when the reader isn't signed in, then applied after login.
 */

import { useComposeSheetStore } from '~/stores/composeSheet'
import { useInstancesStore } from '~/stores/instances'
import { shareTargetIntent, takeShareStash, writeShareStash } from '~/utils/shareTarget'

const SHARE_QUERY_KEYS = ['compose', 'title', 'text', 'url'] as const

export function useShareTarget() {
  const route = useRoute()
  const router = useRouter()
  const instancesStore = useInstancesStore()
  const composeSheet = useComposeSheetStore()

  let task: Promise<void> | null = null

  const clearShareQuery = async () => {
    const next: Record<string, unknown> = { ...route.query }
    let changed = false
    for (const key of SHARE_QUERY_KEYS) {
      if (key in next) {
        delete next[key]
        changed = true
      }
    }
    if (!changed) return
    await router.replace({ path: route.path, query: next })
  }

  const openCompose = (text: string) => {
    composeSheet.show(text ? { initialText: text, title: 'New thread' } : { title: 'New thread' })
  }

  const run = async () => {
    const intent = shareTargetIntent(route.path, route.query as Record<string, unknown>)
    // A fresh share or shortcut wins over anything waiting from a previous visit.
    if (intent) takeShareStash()
    const stashed = intent ? null : takeShareStash()
    if (!intent && stashed == null) return

    const text = intent ? intent.text : stashed || ''

    if (!instancesStore.isAuthenticated) {
      if (text) writeShareStash(text)
      if (intent) await clearShareQuery()
      if (!route.path.startsWith('/login')) await router.push('/login')
      return
    }

    if (intent) await clearShareQuery()
    openCompose(text)
  }

  const consumeShareTarget = () => {
    if (task) return task
    task = run().finally(() => {
      task = null
    })
    return task
  }

  watch(
    () => String(route.query.compose || ''),
    (compose) => {
      if (compose === '1' || compose === 'share') void consumeShareTarget()
    },
  )

  watch(
    () => instancesStore.isAuthenticated,
    (ok, prev) => {
      if (ok && prev === false) void consumeShareTarget()
    },
  )

  return { consumeShareTarget }
}
