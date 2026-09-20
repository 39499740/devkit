<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    disabled?: boolean
    loading?: boolean
    block?: boolean
    title?: string
    type?: 'button' | 'submit'
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' }
)
</script>

<template>
  <button
    class="dk-btn"
    :class="[`dk-btn--${variant}`, `dk-btn--${size}`, { 'dk-btn--block': block }]"
    :disabled="disabled || loading"
    :title="title"
    :type="type"
  >
    <span v-if="loading" class="dk-btn__spin" aria-hidden="true" />
    <slot />
  </button>
</template>

<style scoped>
.dk-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  font-weight: 500;
  white-space: nowrap;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
  user-select: none;
}
.dk-btn--md {
  height: 32px;
  padding: 0 14px;
  font-size: 13px;
}
.dk-btn--sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}
.dk-btn--primary {
  background: var(--accent);
  color: #fff;
}
.dk-btn--primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.dk-btn--secondary {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--text-primary);
}
.dk-btn--secondary:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--accent);
  color: var(--accent);
}
.dk-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}
.dk-btn--ghost:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--accent);
}
.dk-btn--danger {
  background: var(--error);
  color: #fff;
}
.dk-btn--danger:hover:not(:disabled) {
  opacity: 0.9;
}
.dk-btn:disabled {
  opacity: 0.5;
}
.dk-btn--block {
  width: 100%;
}
.dk-btn__spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: dk-spin 0.7s linear infinite;
}
@keyframes dk-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
