/**
 * Mobile edge portals on the home board (Settings / Profile left of the feeds,
 * Search / Inbox / Activity / Groups right of them): preview rows, the
 * slide → chrome sync, and the CTA actions that leave the board for a route.
 */

import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import { useColumnsStore } from '~/stores/columns'
import { useConversationsStore } from '~/stores/conversations'
import { useGroupsStore } from '~/stores/groups'
import { useInstancesStore } from '~/stores/instances'
import { useNotificationsStore, type ExtendedNotification } from '~/stores/notifications'
import { useSettingsStore } from '~/stores/settings'
import { THEME_OPTIONS, UI_OPTIONS, resolveTheme } from '~/utils/appearance'
import { participantLabel } from '~/utils/dmHelpers'
import { notifLabel, notificationRoute } from '~/utils/notifHelpers'
import { BOARD_RIGHT_PORTALS, useBoardPortal, type BoardPortal } from '~/composables/useBoardPortal'

/** Full-width edge pages left of the first feed (Settings, Profile) */
export const BOARD_EDGE_LEFT = 2
/** Edge pages right of the last feed (Search, Inbox, Activity, Groups) */
export const BOARD_EDGE_RIGHT = BOARD_RIGHT_PORTALS.length

export function useBoardPortals({ isMobileUi }: { isMobileUi: Ref<boolean> }) {
  const instancesStore = useInstancesStore()
  const columnsStore = useColumnsStore()
  const groupsStore = useGroupsStore()
  const settingsStore = useSettingsStore()
  const conversationsStore = useConversationsStore()
  const notificationsStore = useNotificationsStore()
  const { setBoardPortal } = useBoardPortal()
  const router = useRouter()
  const EDGE_LEFT = BOARD_EDGE_LEFT

  const portalSearch = ref('')
  let portalActionLock = false

  const portalThemeLabel = computed(() => {
    const id = resolveTheme(settingsStore.localPreferences.theme)
    return THEME_OPTIONS.find((t) => t.id === id)?.label || id
  })

  const portalUiLabel = computed(() => {
    const id = settingsStore.localPreferences.ui
    return UI_OPTIONS.find((u) => u.id === id)?.label || id
  })

  const portalUser = computed(() => instancesStore.currentUser)

  const portalGroupChips = computed(() => {
    const joined = groupsStore.joinedGroups.slice(0, 6)
    if (joined.length) return joined
    return groupsStore.recommendedGroups.slice(0, 6)
  })

  const portalInboxRows = computed(() => {
    const myId = instancesStore.currentUser?.id || ''
    const myAcct = instancesStore.currentUser?.acct || ''
    return conversationsStore.conversations.slice(0, 4).map((c) => ({
      id: c.id,
      label: participantLabel(c),
      preview: conversationsStore.previewFor(c, myId, myAcct),
      unread: !!c.unread,
      statusId: c.lastStatus?.id || null,
      avatar: c.accounts?.[0]?.avatar || '',
    }))
  })

  const portalActivityRows = computed(() =>
    notificationsStore.notifications.slice(0, 4).map((n) => {
      const who = n.account?.displayName || n.account?.username || 'Someone'
      const verb = notifLabel(n.type)
      return {
        id: n.id,
        label: `${who} ${verb}`,
        avatar: n.account?.avatar || '',
        notif: n,
        unread: notificationsStore.isUnread(n),
      }
    }),
  )

  const openPortalActivityRow = (notif: ExtendedNotification) => {
    const route = notificationRoute(notif)
    if (route) void router.push(route)
    else void openPortal('activity')
  }

  const syncBoardPortalFromSlide = (index: number) => {
    if (!isMobileUi.value) {
      setBoardPortal(null)
      return
    }
    const feeds = columnsStore.columns.length
    if (index === 0) setBoardPortal('settings')
    else if (index === 1) setBoardPortal('profile')
    else if (index >= EDGE_LEFT + feeds) {
      const ri = index - (EDGE_LEFT + feeds)
      setBoardPortal((BOARD_RIGHT_PORTALS[ri] as BoardPortal) ?? null)
    } else setBoardPortal(null)
  }

  const openPortal = async (
    kind: Exclude<BoardPortal, null>,
    opts?: { q?: string; filter?: string },
  ) => {
    if (portalActionLock) return
    portalActionLock = true
    try {
      if (kind === 'settings') {
        settingsStore.open()
        return
      }
      if (kind === 'profile') {
        await router.push(instancesStore.isAuthenticated ? '/profile' : '/login')
        return
      }
      if (kind === 'search') {
        const q = (opts?.q ?? portalSearch.value).trim()
        await router.push(q ? { path: '/explore', query: { q } } : '/explore')
        return
      }
      if (kind === 'inbox') {
        await router.push(
          instancesStore.hasAuthenticatedInstance ? '/messages' : '/login',
        )
        return
      }
      if (kind === 'activity') {
        if (!instancesStore.hasAuthenticatedInstance) {
          await router.push('/login')
          return
        }
        await router.push(
          opts?.filter
            ? { path: '/notifications', query: { filter: opts.filter } }
            : '/notifications',
        )
        return
      }
      await router.push('/groups')
    } finally {
      window.setTimeout(() => {
        portalActionLock = false
      }, 400)
    }
  }

  const openInboxRow = async (statusId: string | null, conversation?: { id: string; unread: boolean }) => {
    // Opening a DM from here is reading it — match the Inbox column and clear the badge/dot
    if (conversation?.unread) void conversationsStore.markRead(conversation.id)
    if (!statusId) {
      await openPortal('inbox')
      return
    }
    await router.push(`/status/${statusId}`)
  }

  /** Portal CTAs ignore re-taps while a navigation is in flight (and for a beat after) */
  const isPortalActionLocked = () => portalActionLock

  return {
    portalSearch,
    portalThemeLabel,
    portalUiLabel,
    portalUser,
    portalGroupChips,
    portalInboxRows,
    portalActivityRows,
    openPortalActivityRow,
    syncBoardPortalFromSlide,
    openPortal,
    openInboxRow,
    isPortalActionLocked,
  }
}
