/** Shared notification icon / label helpers */

import type { NeoIconName } from '~/utils/neoIcons'

export function notifIconName(type: string): NeoIconName {
  switch (type) {
    case 'mention': return 'mention'
    case 'favourite': return 'heart'
    case 'reblog': return 'reblog'
    case 'follow': return 'user'
    case 'follow_request': return 'lock'
    case 'poll': return 'poll'
    case 'status': return 'pen'
    case 'update': return 'edit'
    default: return 'bell'
  }
}

/** @deprecated Use notifIconName + NeoIcon — kept for any leftover string uses */
export function notifIcon(type: string): string {
  return notifIconName(type)
}

export function notifLabel(type: string): string {
  switch (type) {
    case 'mention': return 'mentioned you'
    case 'favourite': return 'liked your post'
    case 'reblog': return 'boosted your post'
    case 'follow': return 'followed you'
    case 'follow_request': return 'requested to follow you'
    case 'poll': return 'poll ended'
    case 'status': return 'posted'
    case 'update': return 'edited a post'
    default: return 'notification'
  }
}
