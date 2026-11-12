/**
 * Opens the New thread sheet from a PWA share target or a home-screen shortcut.
 * Shared text is stashed when the reader isn't signed in, then applied after login.
 */

import type { LocationQueryRaw } from 'vue-router'
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
    await router.replace({ path: route.path, query: next as LocationQueryRaw })
  }

  const openCompose = (text: string) => {
    composeSheet.show(text ? { initialText: text, title: 'New thread' } : { title: 'New thread' })
  }

  const run = async () => {
    // Thread pages use ?compose=1 for peek → full-thread draft handoff.
    const compose = String(route.query.compose || '')
    if (route.path.startsWith('/status/') && compose === '1') return

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
      if (route.path.startsWith('/status/') && compose === '1') return
      if (compose === '1' || compose === 'share') void consumeShareTarget()
    },
  )

  // A share skipped during a thread's own ?compose=1 handoff opens once that page is left.
  watch(
    () => route.path,
    (path, prev) => {
      if (typeof prev === 'string' && prev.startsWith('/status/') && !path.startsWith('/status/')) {
        void consumeShareTarget()
      }
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
