/**
 * Pure helpers tying an open DM thread to its entry in the conversations inbox, so the
 * thread page can follow the inbox poll instead of re-downloading the whole context on its own timer.
 */

type ConversationLike = {
  id: string
  lastStatus?: { id: string } | null
  accounts?: { id: string }[] | null
}

/**
 * The inbox entry for a thread: the conversation whose last message is one of the thread's
 * messages, else the one whose other-participant set equals `accountIds` exactly.
 */
export function findThreadConversation<T extends ConversationLike>(
  conversations: T[],
  opts: { statusIds: string[]; accountIds: string[] },
): T | null {
  const statusSet = new Set(opts.statusIds.filter(Boolean))
  const byStatus = conversations.find((c) => c.lastStatus?.id && statusSet.has(c.lastStatus.id))
  if (byStatus) return byStatus
  const acctSet = new Set(opts.accountIds.filter(Boolean))
  if (!acctSet.size) return null
  return (
    conversations.find((c) => {
      const ids = (c.accounts || []).map((a) => a.id)
      return ids.length === acctSet.size && ids.length > 0 && ids.every((id) => acctSet.has(id))
    }) || null
  )
}

/**
 * Refetch the thread's context only when the conversation's newest message is one we haven't
 * loaded — an unchanged inbox row costs nothing.
 */
export function threadNeedsRefetch(
  conversation: ConversationLike | null,
  loadedStatusIds: ReadonlySet<string>,
): boolean {
  const last = conversation?.lastStatus?.id
  return !!last && !loadedStatusIds.has(last)
}
