<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'
import { stripHtml } from '~/utils/stripHtml'

const emit = defineEmits<{ 'update:dirty': [boolean] }>()
const settingsStore = useSettingsStore()

const DISPLAY_NAME_MAX = 30
const NOTE_MAX = 500

const profileForm = reactive({
  displayName: '',
  note: '',
  bot: false,
  discoverable: true,
})

const baseline = reactive({
  displayName: '',
  note: '',
  bot: false,
  discoverable: true,
})

const syncBaseline = () => {
  baseline.displayName = profileForm.displayName
  baseline.note = profileForm.note
  baseline.bot = profileForm.bot
  baseline.discoverable = profileForm.discoverable
}

const profileDirty = computed(
  () =>
    profileForm.displayName !== baseline.displayName ||
    profileForm.note !== baseline.note ||
    profileForm.bot !== baseline.bot ||
    profileForm.discoverable !== baseline.discoverable,
)

const displayNameInvalid = computed(() => profileForm.displayName.length > DISPLAY_NAME_MAX)
const noteInvalid = computed(() => profileForm.note.length > NOTE_MAX)
const profileFormInvalid = computed(() => displayNameInvalid.value || noteInvalid.value)

watch(
  () => settingsStore.account,
  (account) => {
    profileForm.displayName = account?.displayName || ''
    const sourceNote = (account as { source?: { note?: string } } | null)?.source?.note
    profileForm.note =
      typeof sourceNote === 'string' ? sourceNote : stripHtml(account?.note || '')
    profileForm.bot = account?.bot || false
    profileForm.discoverable = account ? account.discoverable !== false : true
    syncBaseline()
  },
  { immediate: true },
)

watch(profileDirty, (dirty) => emit('update:dirty', dirty), { immediate: true })

const saveProfile = async () => {
  if (profileFormInvalid.value || !settingsStore.account) return
  try {
    await settingsStore.updateProfile({
      displayName: profileForm.displayName,
      note: profileForm.note,
      bot: profileForm.bot,
      discoverable: profileForm.discoverable,
    })
  } catch {
    return
  }
  syncBaseline()
  settingsStore.clearSuccess()
}
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <div class="settings-group">
      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Profile details</legend>
        <label class="settings-label">
          <span class="settings-label__text">Display Name</span>
          <input
            v-model="profileForm.displayName"
            type="text"
            class="settings-input"
            placeholder="Your display name"
            :maxlength="DISPLAY_NAME_MAX"
            :aria-invalid="displayNameInvalid || undefined"
            aria-describedby="settings-display-name-hint settings-display-name-error"
          />
          <span id="settings-display-name-hint" class="settings-field-hint">
            {{ profileForm.displayName.length }}/{{ DISPLAY_NAME_MAX }}
          </span>
          <span
            v-if="displayNameInvalid"
            id="settings-display-name-error"
            class="settings-field-error"
            role="alert"
          >Display name must be {{ DISPLAY_NAME_MAX }} characters or fewer.</span>
        </label>

        <label class="settings-label">
          <span class="settings-label__text">Bio</span>
          <textarea
            v-model="profileForm.note"
            class="settings-textarea"
            placeholder="Tell the world about yourself..."
            rows="4"
            :maxlength="NOTE_MAX"
            :aria-invalid="noteInvalid || undefined"
            aria-describedby="settings-note-hint settings-note-error"
          />
          <span id="settings-note-hint" class="settings-field-hint">
            {{ profileForm.note.length }}/{{ NOTE_MAX }}
          </span>
          <span
            v-if="noteInvalid"
            id="settings-note-error"
            class="settings-field-error"
            role="alert"
          >Bio must be {{ NOTE_MAX }} characters or fewer.</span>
        </label>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Account flags</legend>
        <label class="settings-toggle">
          <div class="settings-toggle__info">
            <span class="settings-toggle__label">Discoverable</span>
            <span class="settings-toggle__desc">Allow your account to be found in search results and profile directories</span>
          </div>
          <input v-model="profileForm.discoverable" type="checkbox" class="settings-checkbox" />
        </label>

        <label class="settings-toggle">
          <div class="settings-toggle__info">
            <span class="settings-toggle__label">🤖 This is a bot account</span>
            <span class="settings-toggle__desc">Mark this account as automated</span>
          </div>
          <input v-model="profileForm.bot" type="checkbox" class="settings-checkbox" />
        </label>
      </fieldset>
    </div>

    <div class="settings-actions">
      <button
        class="settings-btn settings-btn--primary"
        :disabled="settingsStore.isSaving || profileFormInvalid || !profileDirty || !settingsStore.account"
        @click="saveProfile"
      >
        {{ settingsStore.isSaving ? 'Saving...' : 'Save Changes' }}
      </button>
    </div>
  </section>
</template>
