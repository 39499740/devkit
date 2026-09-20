<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: string | number
    type?: string
    placeholder?: string
    disabled?: boolean
    readonly?: boolean
    mono?: boolean
    error?: boolean
  }>(),
  { type: 'text', mono: false }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>

<template>
  <input
    class="dk-input"
    :class="{ 'dk-input--mono': mono, 'dk-input--error': error }"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    @input="onInput"
  />
</template>

<style scoped>
.dk-input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  transition:
    border-color 0.12s,
    box-shadow 0.12s;
}
.dk-input::placeholder {
  color: var(--text-tertiary);
}
.dk-input:hover:not(:disabled):not(:focus) {
  border-color: var(--accent);
}
.dk-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.dk-input:disabled {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.dk-input--mono {
  font-family: var(--font-mono);
}
.dk-input--error {
  border-color: var(--error);
}
.dk-input--error:focus {
  box-shadow: 0 0 0 3px var(--error-soft);
}
</style>
