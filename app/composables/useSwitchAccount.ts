/**
 * One place that changes the posting account and tells the user (global toast).
 * Account switcher sheet, Accounts manager and the composer cycle all route through here.
 */

import { useInstancesStore, type ConnectedInstance } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'

/** `@user@host` for a connected account (host omitted when the acct already carries it). */
export function instanceHandle(instance: Pick<ConnectedInstance, 'user' | 'url'>): string {
  const acct = instance.user?.acct || instance.user?.username || ''
  const host = instance.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return acct.includes('@') ? `@${acct}` : `@${acct}@${host}`
}

export function switchActiveAccount(id: string): ConnectedInstance | null {
  const instances = useInstancesStore()
  const next = instances.authenticatedInstances.find((i) => i.id === id) ?? null
  if (!next || instances.activeAccount?.id === id) return next
  instances.setActiveAccount(id)
  useToastStore().show({ message: `Posting as ${instanceHandle(next)}`, duration: 2500 })
  return next
}

/** Threads-style quick swap through signed-in accounts, with the same toast. */
export function cycleActiveAccountWithToast(): ConnectedInstance | null {
  const instances = useInstancesStore()
  const authed = instances.authenticatedInstances
  if (authed.length < 2) return instances.activeAccount
  const idx = authed.findIndex((i) => i.id === instances.activeAccount?.id)
  return switchActiveAccount(authed[(idx + 1) % authed.length]!.id)
}
