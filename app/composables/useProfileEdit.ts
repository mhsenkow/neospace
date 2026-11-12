/**
 * Profile edit form — presence draft, image picks, save/cancel helpers.
 */

import { onBeforeRouteLeave } from 'vue-router'
import { useProfileStore } from '~/stores/profile'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import { usePrefersReducedMotion } from '~/composables/usePrefersReducedMotion'
import {
  isPresenceField,
  mergePresenceIntoFields,
  profileFieldLimit,
  readPresenceDraft,
} from '~/utils/profileSources'
import { mapErrorToMessage } from '~/utils/friendlyError'

const PROFILE_IMAGE_MAX_BYTES = 8 * 1024 * 1024

export function useProfileEdit() {
  const profileStore = useProfileStore()
  const instancesStore = useInstancesStore()
  const toastStore = useToastStore()

  const presenceDraft = ref({ bluesky: '', seenu: '', website: '' })

  const syncPresenceDraft = () => {
    presenceDraft.value = readPresenceDraft(profileStore.editForm.fields)
  }

  let editBaseline = ''
  const editSnapshot = () => {
    const f = profileStore.editForm
    return JSON.stringify([f.displayName, f.note, f.fields, f.locked, f.bot, f.discoverable, presenceDraft.value])
  }

  const hasUnsavedEdits = () =>
    profileStore.isEditing &&
    (editSnapshot() !== editBaseline ||
      !!profileStore.editForm.avatar ||
      !!profileStore.editForm.header)

  onBeforeRouteLeave(async () => {
    if (!hasUnsavedEdits()) return true
    return await useOverlayStore().openConfirm({
      title: 'Discard unsaved changes?',
      body: 'Your profile edits haven’t been saved.',
      confirmLabel: 'Discard',
      danger: true,
    })
  })

  const startEdit = () => {
    profileStore.toggleEditMode()
    if (profileStore.isEditing) {
      syncPresenceDraft()
      profileStore.editForm.fields = profileStore.editForm.fields.filter((f) => !isPresenceField(f))
      editBaseline = editSnapshot()
    }
  }

  const headerPreviewUrl = ref<string | null>(null)
  const avatarPreviewUrl = ref<string | null>(null)

  const clearImagePreviews = () => {
    if (headerPreviewUrl.value) URL.revokeObjectURL(headerPreviewUrl.value)
    if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value)
    headerPreviewUrl.value = null
    avatarPreviewUrl.value = null
  }

  const cancelEdit = () => {
    profileStore.cancelEdit()
    presenceDraft.value = { bluesky: '', seenu: '', website: '' }
    clearImagePreviews()
  }

  const presenceSlotsUsed = computed(
    () =>
      [presenceDraft.value.bluesky, presenceDraft.value.seenu, presenceDraft.value.website].filter(
        (v) => v.trim(),
      ).length,
  )

  const maxProfileFields = computed(() =>
    profileFieldLimit(instancesStore.activeAccount?.instanceInfo?.maxProfileFields),
  )

  const canAddCustomField = computed(
    () => profileStore.editForm.fields.length + presenceSlotsUsed.value < maxProfileFields.value,
  )

  const fieldLimitMessage = computed(() => {
    const cap = maxProfileFields.value
    const used = profileStore.editForm.fields.length + presenceSlotsUsed.value
    if (used <= cap) return ''
    return `Your server allows ${cap} profile fields — remove ${used - cap} to save.`
  })

  const reduceMotion = usePrefersReducedMotion()

  const profileHeaderUrl = computed(() => {
    if (headerPreviewUrl.value) return headerPreviewUrl.value
    const p = profileStore.viewedProfile
    if (reduceMotion.value) return p?.headerStatic || p?.header || null
    return p?.header || p?.headerStatic || null
  })

  const profileHeaderStyle = computed(() =>
    profileHeaderUrl.value
      ? { backgroundImage: `url(${JSON.stringify(profileHeaderUrl.value)})` }
      : undefined,
  )

  const profileAvatarUrl = computed(() => {
    if (avatarPreviewUrl.value) return avatarPreviewUrl.value
    const p = profileStore.viewedProfile
    return (reduceMotion.value ? p?.avatarStatic || p?.avatar : p?.avatar) || ''
  })

  const avatarInput = ref<HTMLInputElement | null>(null)
  const headerInput = ref<HTMLInputElement | null>(null)

  const takeProfileImage = (event: Event, what: 'Avatar' | 'Header'): File | null => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0] || null
    input.value = ''
    if (!file) return null
    if (!file.type.startsWith('image/')) {
      toastStore.show({ message: `${what} must be an image file` })
      return null
    }
    if (file.size > PROFILE_IMAGE_MAX_BYTES) {
      toastStore.show({ message: `${what} image must be under 8 MB` })
      return null
    }
    return file
  }

  const handleAvatarChange = (event: Event) => {
    const file = takeProfileImage(event, 'Avatar')
    if (!file) return
    if (avatarPreviewUrl.value) URL.revokeObjectURL(avatarPreviewUrl.value)
    avatarPreviewUrl.value = URL.createObjectURL(file)
    profileStore.editForm.avatar = file
  }

  const handleHeaderChange = (event: Event) => {
    const file = takeProfileImage(event, 'Header')
    if (!file) return
    if (headerPreviewUrl.value) URL.revokeObjectURL(headerPreviewUrl.value)
    headerPreviewUrl.value = URL.createObjectURL(file)
    profileStore.editForm.header = file
  }

  const handleSaveProfile = async () => {
    const prevFields = profileStore.editForm.fields.map((f) => ({ ...f }))
    try {
      profileStore.editForm.fields = mergePresenceIntoFields(
        prevFields,
        presenceDraft.value,
        maxProfileFields.value,
      )
      await profileStore.updateProfile()
      clearImagePreviews()
      editBaseline = ''
      toastStore.show({ message: 'Profile saved' })
    } catch {
      profileStore.editForm.fields = prevFields
    }
  }

  const profileErrorFriendly = computed(() => {
    if (!profileStore.error) return null
    if (profileStore.errorStatus === 404) {
      return {
        title: 'Account not found',
        detail: 'This account doesn’t exist, or it was moved or deleted.',
        retryable: false,
      }
    }
    return mapErrorToMessage(new Error(profileStore.error))
  })

  const triggerAvatarUpload = () => {
    avatarInput.value?.click()
  }

  const triggerHeaderUpload = () => {
    headerInput.value?.click()
  }

  const onProfileUnmountCleanup = () => {
    clearImagePreviews()
  }

  return {
    presenceDraft,
    syncPresenceDraft,
    startEdit,
    cancelEdit,
    presenceSlotsUsed,
    maxProfileFields,
    canAddCustomField,
    fieldLimitMessage,
    headerPreviewUrl,
    avatarPreviewUrl,
    clearImagePreviews,
    profileHeaderUrl,
    profileHeaderStyle,
    profileAvatarUrl,
    avatarInput,
    headerInput,
    handleAvatarChange,
    handleHeaderChange,
    handleSaveProfile,
    profileErrorFriendly,
    triggerAvatarUpload,
    triggerHeaderUpload,
    onProfileUnmountCleanup,
  }
}
