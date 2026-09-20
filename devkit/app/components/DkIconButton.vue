<script setup lang="ts">
const props = withDefaults(
  defineProps<{ title?: string; ariaLabel?: string; disabled?: boolean; size?: number }>(),
  { size: 30 }
)

const accessibleName = computed(() => props.ariaLabel || props.title || '按钮')

if (import.meta.env.DEV && !props.ariaLabel && !props.title) {
  console.warn('[DkIconButton] 缺少可访问名称，请传入 title 或 aria-label')
}
</script>

<template>
  <button
    class="icon-btn"
    :style="{ '--icon-size': `${size}px` }"
    :title="title || ariaLabel"
    :aria-label="accessibleName"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped>
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--icon-size, 30px);
  height: var(--icon-size, 30px);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition:
    background 0.12s,
    color 0.12s;
  flex-shrink: 0;
}
.icon-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.icon-btn:disabled {
  opacity: 0.4;
}
@media (max-width: 768px), (pointer: coarse) {
  .icon-btn {
    min-width: 40px;
    min-height: 40px;
  }
}
</style>
