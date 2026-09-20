<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; label?: string; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
</script>

<template>
  <label class="dk-check" :class="{ 'dk-check--disabled': disabled }">
    <input
      type="checkbox"
      class="dk-check__box"
      :checked="modelValue"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
    <span v-if="label" class="dk-check__label">{{ label }}</span>
    <slot />
  </label>
</template>

<style scoped>
.dk-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  font-size: 13px;
  color: var(--text-primary);
}
.dk-check--disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.dk-check__box {
  appearance: none;
  width: 15px;
  height: 15px;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  background: var(--surface);
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition:
    background 0.12s,
    border-color 0.12s;
  margin: 0;
}
.dk-check__box:hover:not(:disabled) {
  border-color: var(--accent);
}
.dk-check__box:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.dk-check__box:checked::after {
  content: '';
  position: absolute;
  left: 4.5px;
  top: 1.5px;
  width: 4px;
  height: 8px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
.dk-check__box:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
