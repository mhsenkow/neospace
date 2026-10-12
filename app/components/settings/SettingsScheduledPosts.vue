<script setup lang="ts">
/**
 * Scheduled posts queue (Settings → Posting).
 * Account-scoped: every request is bound to the account that was active when
 * it started, and results are dropped if the account changed meanwhile.
 * Hidden on servers without scheduled_statuses support.
 */
import type { mastodon } from 'masto'
import { useInstancesStore } from '~/stores/instances'
import { useStatusStore } from '~/stores/status'
import { useOverlayStore } from '~/stores/overlay'
import { useToastStore } from '~/stores/toast'
import { createRaceGuard } from '~/composables/useRace'
import {
  isScheduledUnsupported,
  scheduledPreview,
  SCHEDULE_MIN_LEAD_MS,
  toLocalInputValue,
  validRescheduleIso,
} from '~/utils/scheduledPosts'

const instancesStore = useInstancesStore()
const statusStore = useStatusStore()
const overlayStore = useOverlayStore()
const toastStore = useToastStore()

const items = ref<mastodon.v1.ScheduledStatus[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
/** Server answered 404/405/501 — treat the feature as absent and hide the section */
const unsupported = ref(false)
const busyId = ref<string | null>(null)
const editingId = ref<string | null>(null)
const editValue = ref('')
const editError = ref<string | null>(null)
const minLocal = ref('')
const race = createRaceGuard()

const visible = computed(
  () => instancesStore.isAuthenticated && instancesStore.canSchedulePosts && !unsupported.value,
)

const formatWhen = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    )
  } catch {
    return iso
  }
}

const load = async () => {
  const accountId = instancesStore.activeAccountId
  if (!accountId || !instancesStore.canSchedulePosts) return
  const ticket = race.next()
  loading.value = true
  loadError.value = null
  try {
    const list = await statusStore.listScheduledStatuses(accountId)
    if (!ticket.isCurrent() || accountId !== instancesStore.activeAccountId) return
    items.value = list
  } catch (e) {
    if (!ticket.isCurrent() || accountId !== instancesStore.activeAccountId) return
    if (isScheduledUnsupported(e)) {
      unsupported.value = true
      items.value = []
    } else {
      loadError.value = 'Couldn’t load scheduled posts'
    }
  } finally {
    if (ticket.isCurrent()) loading.value = false
  }
}

const reset = () => {
  race.abort()
  items.value = []
  loadError.value = null
  unsupported.value = false
  busyId.value = null
  editingId.value = null
  editError.value = null
  loading.value = false
}

// Switching accounts must never show (or act on) the previous account's queue
watch(
  () => instancesStore.activeAccountId,
  () => {
    reset()
    void load()
  },
  { immediate: true },
)

const startEdit = (item: mastodon.v1.ScheduledStatus) => {
  editingId.value = item.id
  editValue.value = toLocalInputValue(item.scheduledAt)
  editError.value = null
  minLocal.value = toLocalInputValue(new Date(Date.now() + SCHEDULE_MIN_LEAD_MS).toISOString())
}

const cancelEdit = () => {
  editingId.value = null
  editError.value = null
}

const saveEdit = async (item: mastodon.v1.ScheduledStatus) => {
  const iso = validRescheduleIso(editValue.value)
  if (!iso) {
    editError.value = 'Pick a time at least 5 minutes from now'
    return
  }
  const accountId = instancesStore.activeAccountId
  if (!accountId) return
  busyId.value = item.id
  editError.value = null
  try {
    const updated = await statusStore.updateScheduledStatus(item.id, iso, accountId)
    if (accountId !== instancesStore.activeAccountId) return
    items.value = items
      .value.map((x) => (x.id === item.id ? updated : x))
      .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    editingId.value = null
    toastStore.show({ message: `Rescheduled for ${formatWhen(updated.scheduledAt)}`, duration: 3000 })
  } catch (e) {
    if (accountId !== instancesStore.activeAccountId) return
    editError.value = e instanceof Error ? e.message : 'Couldn’t reschedule'
  } finally {
    if (busyId.value === item.id) busyId.value = null
  }
}

const cancelPost = async (item: mastodon.v1.ScheduledStatus) => {
  const accountId = instancesStore.activeAccountId
  if (!accountId) return
  const ok = await overlayStore.openConfirm({
    title: 'Cancel this scheduled post?',
    body: `It will not be published. ${scheduledPreview(item.params, 80)}`,
    confirmLabel: 'Cancel post',
    danger: true,
  })
  // The account may have switched while the dialog was open
  if (!ok || accountId !== instancesStore.activeAccountId) return
  busyId.value = item.id
  try {
    await statusStore.cancelScheduledStatus(item.id, accountId)
    if (accountId !== instancesStore.activeAccountId) return
    items.value = items.value.filter((x) => x.id !== item.id)
    if (editingId.value === item.id) cancelEdit()
    toastStore.show({ message: 'Scheduled post cancelled', duration: 2500 })
  } catch (e) {
    toastStore.show({
      message: e instanceof Error ? e.message : 'Couldn’t cancel that post',
      duration: 3500,
    })
  } finally {
    if (busyId.value === item.id) busyId.value = null
  }
}

onBeforeUnmount(() => race.abort())
</script>

<template>
  <div v-if="visible" class="settings-group settings-scheduled">
    <fieldset class="settings-fieldset">
      <legend class="settings-subheading">Scheduled posts</legend>
      <p class="settings-hint">
        These are <strong>not published yet</strong>. They will go out at the time shown, from
        {{ instancesStore.currentUser ? `@${instancesStore.currentUser.acct}` : 'this account' }}.
      </p>

      <p v-if="loading && !items.length" class="settings-hint" role="status">Loading…</p>
      <p v-else-if="loadError" class="settings-hint" role="alert">
        {{ loadError }}
        <button type="button" class="settings-btn settings-btn--small settings-btn--ghost" @click="load">
          Retry
        </button>
      </p>
      <p v-else-if="!items.length" class="settings-hint">
        Nothing scheduled. Use the clock field in the composer to schedule a post.
      </p>

      <ul v-else class="settings-scheduled__list">
        <li v-for="item in items" :key="item.id" class="settings-scheduled__item">
          <div class="settings-scheduled__meta">
            <span class="settings-scheduled__badge">Scheduled · not published</span>
            <time :datetime="item.scheduledAt" class="settings-scheduled__when">
              {{ formatWhen(item.scheduledAt) }}
            </time>
          </div>
          <p class="settings-scheduled__text">{{ scheduledPreview(item.params) }}</p>
          <p v-if="item.mediaAttachments?.length" class="settings-field-hint">
            {{ item.mediaAttachments.length }} attachment{{ item.mediaAttachments.length === 1 ? '' : 's' }}
          </p>

          <div v-if="editingId === item.id" class="settings-scheduled__edit">
            <label class="sr-only" :for="`sched-${item.id}`">New time</label>
            <input
              :id="`sched-${item.id}`"
              v-model="editValue"
              type="datetime-local"
              class="settings-input"
              :min="minLocal"
              :aria-invalid="!!editError"
            />
            <button
              type="button"
              class="settings-btn settings-btn--small settings-btn--primary"
              :disabled="busyId === item.id"
              @click="saveEdit(item)"
            >
              {{ busyId === item.id ? 'Saving…' : 'Save time' }}
            </button>
            <button type="button" class="settings-btn settings-btn--small settings-btn--ghost" @click="cancelEdit">
              Keep current
            </button>
            <p v-if="editError" class="settings-field-error" role="alert">{{ editError }}</p>
          </div>
          <div v-else class="settings-scheduled__actions">
            <button
              type="button"
              class="settings-btn settings-btn--small settings-btn--ghost"
              :disabled="busyId === item.id"
              @click="startEdit(item)"
            >
              Reschedule
            </button>
            <button
              type="button"
              class="settings-btn settings-btn--small settings-btn--danger"
              :disabled="busyId === item.id"
              @click="cancelPost(item)"
            >
              {{ busyId === item.id ? 'Cancelling…' : 'Cancel post' }}
            </button>
          </div>
        </li>
      </ul>

      <div v-if="items.length || loadError" class="settings-actions settings-actions--inline">
        <button
          type="button"
          class="settings-btn settings-btn--small settings-btn--ghost"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </div>
    </fieldset>
  </div>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;

.settings-scheduled {
  margin-top: 1rem;
}

.settings-input[aria-invalid='true'] {
  border-color: var(--neo-danger);
}

.settings-scheduled__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.settings-scheduled__item {
  padding: 0.75rem;
  border: 1px solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  background: var(--neo-bg-secondary);
}

.settings-scheduled__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}

.settings-scheduled__badge {
  font-size: 0.6875rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.1rem 0.4rem;
  border: 1px dashed var(--neo-accent);
  border-radius: var(--neo-radius-sm, 4px);
  color: var(--neo-accent);
}

.settings-scheduled__when {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--neo-text-primary);
}

.settings-scheduled__text {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--neo-text-secondary);
  overflow-wrap: anywhere;
}

.settings-scheduled__actions,
.settings-scheduled__edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
</style>
