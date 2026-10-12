<script setup lang="ts">
/**
 * Appearance settings panel — theme, chrome, type, density, backup/restore.
 * Extracted from SettingsModal; local form state stays in sync with the store.
 */

import { useSettingsStore } from '~/stores/settings'
import { useInstancesStore } from '~/stores/instances'
import { useToastStore } from '~/stores/toast'
import {
  applyAppearance,
  DENSITY_OPTIONS,
  FONT_OPTIONS,
  FONT_SIZE_OPTIONS,
  LINE_OPTIONS,
  RADIUS_OPTIONS,
  THEME_OPTIONS,
  UI_OPTIONS,
  TYPE_FACES,
  type NeoDensityId,
  type NeoFontId,
  type NeoFontSizeId,
  type NeoLineId,
  type NeoRadiusId,
  type NeoThemeId,
  type NeoUiId,
} from '~/utils/appearance'

const props = defineProps<{
  /** Settings modal is open */
  open: boolean
  /** Phone drill-down: panel (true) vs category list (false) */
  mobilePanelOpen: boolean
}>()

const settingsStore = useSettingsStore()
const instancesStore = useInstancesStore()
const toastStore = useToastStore()

// Appearance form
const appearanceForm = reactive({
  theme: 'auto' as NeoThemeId,
  ui: 'braun' as NeoUiId,
  font: 'sans' as NeoFontId,
  fontSize: 'medium' as NeoFontSizeId,
  radius: 'match' as NeoRadiusId,
  density: 'cozy' as NeoDensityId,
  line: 'clean' as NeoLineId,
  reduceMotion: false,
  customProfileCss: false,
  flipTextAlign: 'center' as 'left' | 'center' | 'right',
  flipTextSize: 'large' as 'reading' | 'large' | 'display',
})

const flipAlignOptions = [
  { value: 'left' as const, label: 'Left' },
  { value: 'center' as const, label: 'Center' },
  { value: 'right' as const, label: 'Right' },
]

const flipSizeOptions = [
  { value: 'reading' as const, label: 'Reading' },
  { value: 'large' as const, label: 'Large' },
  { value: 'display' as const, label: 'Display' },
]

watch(() => settingsStore.localPreferences, (prefs) => {
  if (prefs) {
    appearanceForm.theme = prefs.theme
    appearanceForm.ui = prefs.ui
    appearanceForm.font = prefs.font
    appearanceForm.fontSize = prefs.fontSize
    appearanceForm.radius = prefs.radius
    appearanceForm.density = prefs.density
    appearanceForm.line = prefs.line
    appearanceForm.reduceMotion = prefs.reduceMotion
    appearanceForm.customProfileCss = prefs.customProfileCss
    appearanceForm.flipTextAlign = prefs.flipTextAlign
    appearanceForm.flipTextSize = prefs.flipTextSize
  }
}, { immediate: true })

const saveAppearance = () => {
  settingsStore.updateAppearance({
    theme: appearanceForm.theme,
    ui: appearanceForm.ui,
    font: appearanceForm.font,
    fontSize: appearanceForm.fontSize,
    radius: appearanceForm.radius,
    density: appearanceForm.density,
    line: appearanceForm.line,
    reduceMotion: appearanceForm.reduceMotion,
    customProfileCss: appearanceForm.customProfileCss,
    flipTextAlign: appearanceForm.flipTextAlign,
    flipTextSize: appearanceForm.flipTextSize,
  })
  settingsStore.clearSuccess()
}

const onThemeApply = () => {
  const previous = settingsStore.localPreferences.theme
  saveAppearance()
  toastStore.show({
    message: 'Theme updated',
    actionLabel: 'Revert',
    duration: 5000,
    onAction: () => {
      appearanceForm.theme = previous
      saveAppearance()
    },
  })
}

const hoveredTheme = ref<NeoThemeId | null>(null)

const previewTheme = (themeId: NeoThemeId) => {
  hoveredTheme.value = themeId
  applyAppearance({
    theme: themeId,
    ui: appearanceForm.ui,
    font: appearanceForm.font,
    fontSize: appearanceForm.fontSize,
    radius: appearanceForm.radius,
    density: appearanceForm.density,
    line: appearanceForm.line,
  })
}

const clearThemePreview = () => {
  hoveredTheme.value = null
  settingsStore.applyLocalAppearance()
}

// Closing (Escape) or leaving Appearance unmounts the swatch under the pointer
// without a mouseleave — don't leave the whole app stuck on the previewed theme
watch(
  () => [props.open, props.mobilePanelOpen] as const,
  () => {
    if (hoveredTheme.value) clearThemePreview()
  },
)
onBeforeUnmount(() => {
  if (hoveredTheme.value) clearThemePreview()
})

const resetAppearance = () => {
  settingsStore.resetAppearance()
  Object.assign(appearanceForm, settingsStore.localPreferences)
}

const exportAppearance = () => {
  const json = settingsStore.exportAppearanceJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'neospace-appearance.json'
  a.click()
  // Revoking synchronously can cancel the download in Safari / Firefox
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Appearance JSON is a dozen short keys — anything bigger is the wrong file */
const APPEARANCE_IMPORT_MAX_BYTES = 64 * 1024

const importAppearanceInput = ref<HTMLInputElement | null>(null)

const importAppearance = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > APPEARANCE_IMPORT_MAX_BYTES) {
      throw new Error('That file is too large to be a NeoSpace appearance export')
    }
    const text = await file.text()
    try {
      settingsStore.importAppearanceJson(text)
    } catch (e) {
      // JSON.parse messages ("Unexpected token…") mean nothing to people
      throw e instanceof SyntaxError ? new Error('That file isn’t valid appearance JSON') : e
    }
    Object.assign(appearanceForm, settingsStore.localPreferences)
    toastStore.show({ message: 'Appearance imported', duration: 2500 })
  } catch (e) {
    toastStore.show({
      message: e instanceof Error ? e.message : 'Could not import appearance',
      duration: 3500,
    })
  } finally {
    input.value = ''
  }
}

const onFontSizeChange = (value: string) => {
  appearanceForm.fontSize = value as typeof appearanceForm.fontSize
  saveAppearance()
}

const onRadiusChange = (value: string) => {
  appearanceForm.radius = value as typeof appearanceForm.radius
  saveAppearance()
}

const onFlipAlignChange = (value: string) => {
  appearanceForm.flipTextAlign = value as typeof appearanceForm.flipTextAlign
  saveAppearance()
}

const onFlipSizeChange = (value: string) => {
  appearanceForm.flipTextSize = value as typeof appearanceForm.flipTextSize
  saveAppearance()
}

const onDensityChange = (value: string) => {
  appearanceForm.density = value as typeof appearanceForm.density
  saveAppearance()
}

const onLineChange = (value: string) => {
  appearanceForm.line = value as typeof appearanceForm.line
  saveAppearance()
}

const hasProfileCss = computed(() => !!instancesStore.userCustomCSS)

const themeOptions = [
  { value: 'auto' as const, label: 'Auto', desc: 'Match system light/dark', swatch: 'linear-gradient(135deg,#f2f2f0 50%,#161616 50%)', ink: '#c45c26' },
  ...THEME_OPTIONS.map((t) => ({
    value: t.id,
    label: t.label,
    desc: t.desc,
    swatch: t.swatch,
    ink: t.ink,
  })),
]

const uiOptions = UI_OPTIONS
const fontOptions = FONT_OPTIONS
const fontSizeOptions = FONT_SIZE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
const radiusOptions = RADIUS_OPTIONS
const radiusRadioOptions = RADIUS_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
const densityOptions = DENSITY_OPTIONS
const densityRadioOptions = DENSITY_OPTIONS.map((o) => ({ value: o.id, label: o.label }))
const lineOptions = LINE_OPTIONS
const lineRadioOptions = LINE_OPTIONS.map((o) => ({ value: o.id, label: o.label }))

const fontPreviewStack = (fontId: NeoFontId) => {
  const ui = appearanceForm.ui || 'braun'
  return TYPE_FACES[ui]?.[fontId] || TYPE_FACES.braun[fontId]
}
</script>

<template>
  <section class="settings-section">
    <SettingsSectionHeader :category="settingsStore.currentCategory" />
    <div class="settings-group">
      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Theme</legend>
      <p class="settings-hint">Color system — tap a swatch or use the sidebar cycle button.</p>
      <div class="settings-theme-grid">
        <label
          v-for="option in themeOptions"
          :key="option.value"
          :class="['settings-theme-swatch', { active: appearanceForm.theme === option.value, 'is-previewing': hoveredTheme === option.value }]"
          @mouseenter="previewTheme(option.value)"
          @mouseleave="clearThemePreview"
          @focusin="previewTheme(option.value)"
          @focusout="clearThemePreview"
        >
          <input
            v-model="appearanceForm.theme"
            type="radio"
            name="settings-theme"
            :value="option.value"
            class="settings-radio-hidden"
            @change="onThemeApply"
          />
          <span
            class="settings-theme-swatch__chip"
            :style="{ background: option.swatch, color: option.ink }"
          >
            <span class="settings-theme-swatch__dot"></span>
            <span class="settings-theme-swatch__ring" aria-hidden="true"></span>
            <span v-if="hoveredTheme === option.value" class="settings-theme-swatch__preview" aria-hidden="true">
              <span class="settings-theme-swatch__preview-bar"></span>
              <span class="settings-theme-swatch__preview-line"></span>
              <span class="settings-theme-swatch__preview-line settings-theme-swatch__preview-line--short"></span>
            </span>
          </span>
          <span class="settings-theme-swatch__label">{{ option.label }}</span>
          <span class="settings-theme-swatch__desc">{{ option.desc }}</span>
        </label>
      </div>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Chrome</legend>
      <p class="settings-hint">Full interface system — type, borders, labels. Corners follow Radius unless set to Match.</p>
      <div class="settings-chrome-grid">
        <label
          v-for="option in uiOptions"
          :key="option.id"
          :class="['settings-chrome-card', { active: appearanceForm.ui === option.id }]"
          :data-preview-ui="option.id"
          :title="option.desc"
        >
          <input
            v-model="appearanceForm.ui"
            type="radio"
            name="settings-chrome"
            :value="option.id"
            class="settings-radio-hidden"
            @change="saveAppearance"
          />
          <span class="settings-chrome-card__sample">{{ option.sample }}</span>
          <span class="settings-chrome-card__label">{{ option.label }}</span>
          <span class="settings-chrome-card__desc">{{ option.desc }}</span>
        </label>
      </div>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Typography</legend>
      <p class="settings-hint">Reading face for posts &amp; pages — remapped through the active chrome.</p>
      <div class="settings-font-grid">
        <label
          v-for="option in fontOptions"
          :key="option.id"
          :class="['settings-font-card', { active: appearanceForm.font === option.id }]"
        >
          <input
            v-model="appearanceForm.font"
            type="radio"
            name="settings-font"
            :value="option.id"
            class="settings-radio-hidden"
            @change="saveAppearance"
          />
          <span
            class="settings-font-card__sample"
            :style="{ fontFamily: fontPreviewStack(option.id) }"
          >{{ option.sample }}</span>
          <span class="settings-font-card__label">{{ option.label }}</span>
          <span class="settings-font-card__desc">{{ option.desc }}</span>
        </label>
      </div>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Font Size</legend>
      <NeoRadioGroup
        :options="fontSizeOptions"
        :model-value="appearanceForm.fontSize"
        ariaLabel="Font size"
        @update:model-value="onFontSizeChange"
      />
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Corners</legend>
      <p class="settings-hint">
        Border-radius set across cards, inputs, and chrome. Match keeps the active chrome’s corners
        (Brutal / NES stay sharp when Match).
      </p>
      <NeoRadioGroup
        :options="radiusRadioOptions"
        :model-value="appearanceForm.radius"
        ariaLabel="Corners"
        @update:model-value="onRadiusChange"
      />
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Flip text</legend>
      <p class="settings-hint">
        How posts look in Flip mode (full-bleed swipe). Applies especially to text-only slides.
      </p>

      <p class="settings-hint settings-subheading--tight">Alignment</p>
      <NeoRadioGroup
        :options="flipAlignOptions"
        :model-value="appearanceForm.flipTextAlign"
        ariaLabel="Flip text alignment"
        @update:model-value="onFlipAlignChange"
      />

      <p class="settings-hint settings-subheading--tight">Size</p>
      <NeoRadioGroup
        :options="flipSizeOptions"
        :model-value="appearanceForm.flipTextSize"
        ariaLabel="Flip text size"
        @update:model-value="onFlipSizeChange"
      />
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Density</legend>
      <p class="settings-hint">How tightly cards and chrome pack the screen.</p>
      <NeoRadioGroup
        :options="densityRadioOptions"
        :model-value="appearanceForm.density"
        ariaLabel="Density"
        @update:model-value="onDensityChange"
      />
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Lines</legend>
      <p class="settings-hint">Outline character — clean hairlines through crayon wiggles.</p>
      <NeoRadioGroup
        :options="lineRadioOptions"
        :model-value="appearanceForm.line"
        ariaLabel="Lines"
        @update:model-value="onLineChange"
      />
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Motion &amp; accessibility</legend>
      <label class="settings-toggle">
        <div class="settings-toggle__info">
          <span class="settings-toggle__label">Reduce motion</span>
          <span class="settings-toggle__desc">Disable animations and auto-playing content</span>
        </div>
        <input
          v-model="appearanceForm.reduceMotion"
          type="checkbox"
          class="settings-checkbox"
          @change="saveAppearance"
        />
      </label>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Custom profile CSS</legend>
      <p class="settings-hint">
        Optional Myspace-style skins. If your Mastodon profile has a field named
        <code>css</code>, <code>custom_css</code>, <code>theme</code>, <code>style</code>, or
        <code>chaos_css</code>, NeoSpace can apply that CSS here. (Formerly called Chaos Mode.)
      </p>

      <label class="settings-toggle">
        <div class="settings-toggle__info">
          <span class="settings-toggle__label">Apply my profile CSS</span>
          <span class="settings-toggle__desc">
            {{
              hasProfileCss
                ? 'Uses the CSS from your profile metadata fields'
                : 'No custom CSS found on your profile yet — add a field named css or custom_css'
            }}
          </span>
        </div>
        <input
          v-model="appearanceForm.customProfileCss"
          type="checkbox"
          class="settings-checkbox"
          :disabled="!hasProfileCss"
          @change="saveAppearance"
        />
      </label>
      </fieldset>

      <div class="settings-divider" />

      <fieldset class="settings-fieldset">
        <legend class="settings-subheading">Backup &amp; reset</legend>
        <p class="settings-hint">Reset appearance to defaults or move settings between devices.</p>
        <div class="settings-actions settings-actions--inline">
          <button type="button" class="settings-btn settings-btn--ghost" @click="resetAppearance">
            Reset appearance
          </button>
          <button type="button" class="settings-btn settings-btn--ghost" @click="exportAppearance">
            Export JSON
          </button>
          <button type="button" class="settings-btn settings-btn--ghost" @click="importAppearanceInput?.click()">
            Import JSON
          </button>
          <input
            ref="importAppearanceInput"
            type="file"
            accept="application/json,.json"
            class="settings-file-input"
            tabindex="-1"
            aria-hidden="true"
            @change="importAppearance"
          />
        </div>
      </fieldset>
    </div>
  
  </section>
</template>

<style lang="scss" scoped>
@use '~/assets/css/settingsPanel' as panel;

@include panel.shared;

.settings-theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 0.625rem;
}


.settings-theme-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  cursor: pointer;
  min-width: 0;

  &.active .settings-theme-swatch__chip,
  &.is-previewing .settings-theme-swatch__chip {
    outline: 2px solid var(--neo-accent);
    outline-offset: 2px;
  }

  &__chip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    aspect-ratio: 1.35;
    border-radius: var(--neo-radius-sm, 4px);
    border: 1px solid var(--neo-border-color-dark);
    overflow: hidden;
  }

  &__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: currentColor;
    z-index: 1;
  }

  &__ring {
    position: absolute;
    inset: 4px;
    border-radius: calc(var(--neo-radius-sm, 4px) - 2px);
    border: 1px solid color-mix(in srgb, currentColor 55%, transparent);
    pointer-events: none;
  }

  &__preview {
    position: absolute;
    inset: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px;
    background: color-mix(in srgb, var(--neo-bg-secondary, #fff) 82%, transparent);
    border-radius: 3px;
    z-index: 2;
  }

  &__preview-bar {
    height: 4px;
    border-radius: 2px;
    background: currentColor;
    opacity: 0.85;
  }

  &__preview-line {
    height: 2px;
    border-radius: 1px;
    background: color-mix(in srgb, currentColor 35%, transparent);

    &--short {
      width: 65%;
    }
  }

  &__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--neo-text-secondary);
    letter-spacing: 0.02em;
    text-align: center;
    line-height: 1.2;
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    text-align: center;
    line-height: 1.25;
    max-width: 9rem;
  }

  &.active &__label {
    color: var(--neo-text-primary);
  }
}

.settings-chrome-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 0.625rem;
}

.settings-chrome-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.75rem 0.625rem;
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  min-width: 0;

  &:hover {
    border-color: var(--neo-border-color-dark);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  /* Shape language preview per chrome */
  &[data-preview-ui='braun'] { border-radius: 4px; }
  &[data-preview-ui='monocle'] { border-radius: 8px; }
  &[data-preview-ui='noyes'] { border-radius: 2px; }
  &[data-preview-ui='bauhaus'],
  &[data-preview-ui='ikea'],
  &[data-preview-ui='military'],
  &[data-preview-ui='terminal'],
  &[data-preview-ui='nyt'] { border-radius: 0; }
  &[data-preview-ui='bauhaus'],
  &[data-preview-ui='ikea'],
  &[data-preview-ui='military'] { border-width: 2px; }
  &[data-preview-ui='terminal'] { border-style: dashed; }
  &[data-preview-ui='nyt'] {
    border-top-width: 2px;
    border-top-color: var(--neo-text-primary);
  }

  &__sample {
    font-size: 1.25rem;
    line-height: 1.2;
    color: var(--neo-text-primary);
    margin-bottom: 0.125rem;
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    text-transform: none;
    letter-spacing: normal;
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    line-height: 1.3;
  }

  &[data-preview-ui='braun'] .settings-chrome-card__sample {
    font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;
  }
  &[data-preview-ui='monocle'] .settings-chrome-card__sample {
    font-family: 'Source Sans 3', 'Avenir Next', 'Gill Sans', sans-serif;
  }
  &[data-preview-ui='bauhaus'] .settings-chrome-card__sample {
    font-family: 'Josefin Sans', Futura, 'Century Gothic', sans-serif;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 1.05rem;
  }
  &[data-preview-ui='noyes'] .settings-chrome-card__sample {
    font-family: 'IBM Plex Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  }
  &[data-preview-ui='ikea'] .settings-chrome-card__sample {
    font-family: Verdana, Geneva, Tahoma, sans-serif;
    font-weight: 700;
  }
  &[data-preview-ui='military'] .settings-chrome-card__sample {
    font-family: Oswald, 'Arial Narrow', sans-serif;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-size: 1rem;
  }
  &[data-preview-ui='terminal'] .settings-chrome-card__sample {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  &[data-preview-ui='nyt'] .settings-chrome-card__sample {
    font-family: Georgia, 'Times New Roman', Times, serif;
    font-weight: 400;
  }
}

.settings-font-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.625rem;
}

.settings-font-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.875rem 0.75rem;
  background: var(--neo-bg-primary);
  border: var(--neo-border-width, 1px) solid var(--neo-border-color);
  border-radius: var(--neo-radius-sm, 4px);
  cursor: pointer;
  transition: border-color 0.15s ease;

  &:hover {
    border-color: var(--neo-border-color-dark);
  }

  &.active {
    border-color: var(--neo-accent);
    background: var(--neo-accent-soft);
  }

  &__sample {
    font-size: 1.5rem;
    line-height: 1;
    color: var(--neo-text-primary);
  }

  &__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--neo-text-primary);
    text-transform: none;
    letter-spacing: normal;
  }

  &__desc {
    font-size: 0.6875rem;
    color: var(--neo-text-muted);
    line-height: 1.3;
  }
}

@media (max-width: 768px) {
  .settings-theme-grid,
  .settings-chrome-grid,
  .settings-font-grid {
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  }
}

@media (max-width: 480px) {
  .settings-theme-grid,
  .settings-chrome-grid,
  .settings-font-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
