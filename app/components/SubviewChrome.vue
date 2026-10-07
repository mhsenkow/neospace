<script setup lang="ts">
/**
 * Sticky back chrome for focused linear views (profile, thread).
 * Visible on all breakpoints — Threads-style escape hatch to the prior view.
 */

const props = withDefaults(
  defineProps<{
    title?: string
    /** Override default history back → home fallback */
    backAction?: () => void
  }>(),
  {
    title: '',
  },
)

const router = useRouter()

const goBack = () => {
  if (props.backAction) {
    props.backAction()
    return
  }
  if (typeof window !== 'undefined' && window.history.length > 1) {
    router.back()
    return
  }
  router.push('/')
}
</script>

<template>
  <header class="subview-chrome">
    <button
      type="button"
      class="subview-chrome__btn subview-chrome__back neo-tip"
      title="Back"
      aria-label="Back"
      @click="goBack"
    >
      <NeoIcon name="chevron-left" :size="22" :stroke="2" />
    </button>

    <div class="subview-chrome__title">
      <slot name="title">
        <span v-if="title" class="subview-chrome__name">{{ title }}</span>
      </slot>
    </div>

    <div class="subview-chrome__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style lang="scss" scoped>
.subview-chrome {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 52px;
  padding: 0.35rem 0.5rem;
  padding-top: max(0.35rem, env(safe-area-inset-top, 0px));
  padding-bottom: 0.35rem;
  overflow: visible;
  background: color-mix(in srgb, var(--neo-bg-primary) 94%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--neo-border-color);

  @media (min-width: 1024px) {
    margin: 0 -0.5rem;
    padding-left: 0.25rem;
    padding-right: 0.25rem;
    padding-top: 0.35rem;
  }
}

.subview-chrome__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--neo-text-primary);
  cursor: pointer;
  flex-shrink: 0;
  text-decoration: none;

  &:hover {
    background: var(--neo-bg-hover, var(--neo-bg-tertiary));
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.subview-chrome__back {
  margin-left: -0.15rem;
}

.subview-chrome__title {
  flex: 1;
  min-width: 0;
}

.subview-chrome__name {
  display: block;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--neo-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subview-chrome__actions {
  display: flex;
  align-items: center;
  gap: 0.1rem;
  flex-shrink: 0;
  overflow: visible;

  :deep(.subview-chrome__btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: var(--neo-text-primary);
    cursor: pointer;
    text-decoration: none;

    &:hover {
      background: var(--neo-bg-hover, var(--neo-bg-tertiary));
    }
  }
}
</style>
