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
    case 'admin.sign_up': return 'user'
    case 'admin.report': return 'alert'
    case 'severed_relationships': return 'ban'
    case 'moderation_warning': return 'alert'
    case 'annual_report': return 'sparkle'
    case 'quote': return 'reblog'
    default: return 'bell'
  }
}

export function notifLabel(type: string): string {
  switch (type) {
    case 'mention': return 'mentioned you'
    case 'favourite': return 'liked your post'
    case 'reblog': return 'boosted your post'
    case 'follow': return 'followed you'
    case 'follow_request': return 'requested to follow you'
    case 'poll': return "'s poll has ended"
    case 'status': return 'posted'
    case 'update': return 'edited a post'
    case 'admin.sign_up': return 'signed up (admin notice)'
    case 'admin.report': return 'submitted a report (admin notice)'
    case 'severed_relationships': return 'severed a relationship'
    case 'moderation_warning': return 'received a moderation warning'
    case 'annual_report': return 'shared an annual report'
    case 'quote': return 'quoted your post'
    default: return 'notification'
  }
}
