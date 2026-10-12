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

/**
 * Server-generated notices carry the recipient's *own* account — there is no actor to
 * name or link to ("YourName severed a relationship" with your own avatar).
 */
const ACTORLESS_TYPES = new Set(['severed_relationships', 'moderation_warning', 'annual_report'])

export const notifHasActor = (type: string): boolean => !ACTORLESS_TYPES.has(type)

/** Label read after the actor's name — or, for actorless notices, the whole sentence */
export function notifLabel(type: string): string {
  switch (type) {
    case 'mention': return 'mentioned you'
    case 'favourite': return 'liked your post'
    case 'reblog': return 'boosted your post'
    case 'follow': return 'followed you'
    case 'follow_request': return 'requested to follow you'
    case 'poll': return 'ended a poll'
    case 'status': return 'posted'
    case 'update': return 'edited a post'
    case 'admin.sign_up': return 'signed up (admin notice)'
    case 'admin.report': return 'submitted a report (admin notice)'
    case 'severed_relationships': return 'A relationship with another server was severed'
    case 'moderation_warning': return 'You received a moderation warning'
    case 'annual_report': return 'Your annual report is ready'
    case 'quote': return 'quoted your post'
    default: return 'notification'
  }
}
