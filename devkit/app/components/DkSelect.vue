<script setup lang="ts">
export interface SelectOption {
  value: string
  label: string
}

withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    disabled?: boolean
    label?: string
    ariaLabel?: string
    id?: string
  }>(),
  {}
)

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()
function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLSelectElement).value)
}
</script>

<template>
  <div class="dk-select">
    <select
      :id="id"
      class="dk-select__el"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel || label"
      @change="onChange"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
    <svg class="dk-select__caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
  </div>
</template>

<style scoped>
.dk-select {
  position: relative;
  display: inline-flex;
  min-width: 0;
}
.dk-select__el {
  appearance: none;
  width: 100%;
  height: 32px;
  padding: 0 26px 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.12s;
}
.dk-select__el:hover:not(:disabled) {
  border-color: var(--accent);
}
.dk-select__el:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.dk-select__el:disabled {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  cursor: not-allowed;
}
.dk-select__caret {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  color: var(--text-tertiary);
}
</style>
