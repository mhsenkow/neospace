<script setup lang="ts">
import { useSettingsStore } from '~/stores/settings'

const emit = defineEmits<{ 'update:dirty': [boolean] }>()
const settingsStore = useSettingsStore()

const postingForm = reactive({
  visibility: 'public' as 'public' | 'unlisted' | 'private' | 'direct',
  sensitive: false,
})

const postingBaseline = reactive({
  visibility: postingForm.visibility,
  sensitive: postingForm.sensitive,
})

const syncPostingBaseline = () => {
  postingBaseline.visibility = postingForm.visibility
  postingBaseline.sensitive = postingForm.sensitive
}

const postingDirty = computed(
  () =>
    postingForm.visibility !== postingBaseline.visibility ||
    postingForm.sensitive !== postingBaseline.sensitive,
)

watch(
  () => [settingsStore.preferences, settingsStore.defaultVisibility, settingsStore.defaultSensitive],
  () => {
    postingForm.visibility = settingsStore.defaultVisibility
    postingForm.sensitive = settingsStore.defaultSensitive
    syncPostingBaseline()
  },
  { immediate: true },
)

watch(postingDirty, (dirty) => emit('update:dirty', dirty), { immediate: true })

const savePostingDefaults = async () => {
  await settingsStore.updatePostingDefaults({
    visibility: postingForm.visibility,
    sensitive: postingForm.sensitive,
  })
  syncPostingBaseline()
  settingsStore.clearSuccess()
}

const visibilityOptions = [
  { value: 'public', label: 'Public', icon: 'globe' as const, desc: 'Visible to everyone' },
  { value: 'unlisted', label: 'Unlisted', icon: 'unlisted' as const, desc: 'Visible but not on public timelines' },
  { value: 'private', label: 'Followers Only', icon: 'lock' as const, desc: 'Only your followers can see' },
  { value: 'direct', label: 'Direct', icon: 'message' as const, desc: 'Only mentioned users can see' },
]

const mediaQualityOptions = [
  {
    value: 'efficient' as const,
    label: 'Efficient',
    desc: 'Smaller files (~1600px) — kinder to small instances and slow links',
  },
  {
    value: 'balanced' as const,
    label: 'Balanced',
    desc: 'Everyday posts (~2048px) — sharp enough, much faster than full camera files',
  },
  {
    value: 'original' as const,
    label: 'Original',
    desc: 'Near-full camera files (only clamps above 4096px) — heavier on your server',
  },
]
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />

    <div class="settings-group">
      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Default Visibility</legend>
        <p class="settings-hint">Choose who can see your posts by default.</p>

        <div class="settings-option-list">
          <label
            v-for="option in visibilityOptions"
            :key="option.value"
            :class="['settings-option-row', { active: postingForm.visibility === option.value }]"
          >
            <input
              v-model="postingForm.visibility"
              type="radio"
              name="settings-visibility"
              :value="option.value"
              class="settings-radio-hidden"
            />
            <span class="settings-option-row__icon">
              <NeoIcon :name="option.icon" :size="20" :stroke="1.75" />
            </span>
            <div class="settings-option-row__text">
              <span class="settings-option-row__label">{{ option.label }}</span>
              <span class="settings-option-row__desc">{{ option.desc }}</span>
            </div>
            <span v-if="postingForm.visibility === option.value" class="settings-option-row__check">
              <NeoIcon name="check" :size="16" :stroke="2.5" />
            </span>
          </label>
        </div>

        <div class="settings-divider" />

        <label class="settings-toggle">
          <div class="settings-toggle__info">
            <span class="settings-toggle__label">Collapse duplicate reposts</span>
            <span class="settings-toggle__desc">In Home, show “Alice and 2 others reposted” instead of separate cards</span>
          </div>
          <input
            :checked="settingsStore.localPreferences.collapseReblogs"
            type="checkbox"
            class="settings-checkbox"
            @change="settingsStore.updateAppearance({ collapseReblogs: ($event.target as HTMLInputElement).checked })"
          />
        </label>

        <div class="settings-divider" />

        <label class="settings-toggle">
          <div class="settings-toggle__info">
            <span class="settings-toggle__label">Mark media as sensitive by default</span>
            <span class="settings-toggle__desc">Media will be hidden behind a warning</span>
          </div>
          <input v-model="postingForm.sensitive" type="checkbox" class="settings-checkbox" />
        </label>

        <div class="settings-divider" />

        <div
          class="settings-media-quality"
          role="group"
          aria-labelledby="settings-media-quality-label"
        >
          <p id="settings-media-quality-label" class="settings-subheading">
            Photo upload size
          </p>
          <p class="settings-hint">
            Photos are resized on your device before upload so they don’t overwhelm your
            server. Media is stored on the instance you post from — not on NeoSpace.
          </p>
          <div class="settings-option-list">
            <label
              v-for="option in mediaQualityOptions"
              :key="option.value"
              :class="[
                'settings-option-row',
                {
                  active:
                    settingsStore.localPreferences.mediaUploadQuality === option.value,
                },
              ]"
            >
              <input
                type="radio"
                name="settings-media-quality"
                class="settings-radio-hidden"
                :value="option.value"
                :checked="
                  settingsStore.localPreferences.mediaUploadQuality === option.value
                "
                @change="
                  settingsStore.updateAppearance({ mediaUploadQuality: option.value })
                "
              />
              <div class="settings-option-row__text">
                <span class="settings-option-row__label">{{ option.label }}</span>
                <span class="settings-option-row__desc">{{ option.desc }}</span>
              </div>
              <span
                v-if="
                  settingsStore.localPreferences.mediaUploadQuality === option.value
                "
                class="settings-option-row__check"
              >
                <NeoIcon name="check" :size="16" :stroke="2.5" />
              </span>
            </label>
          </div>
        </div>
      </fieldset>
    </div>

    <SettingsDrafts />
    <SettingsScheduledPosts />

    <div class="settings-actions">
      <button
        class="settings-btn settings-btn--primary"
        :disabled="!postingDirty"
        @click="savePostingDefaults"
      >
        Save Posting Defaults
      </button>
    </div>
  </section>
</template>
