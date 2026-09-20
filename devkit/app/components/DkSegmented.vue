<script setup lang="ts">
export interface SegmentOption {
  value: string
  label: string
  title?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SegmentOption[]
    size?: 'sm' | 'md'
    label?: string
    ariaLabel?: string
  }>(),
  { size: 'md' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const root = ref<HTMLElement | null>(null)
const activeIndex = computed(() => {
  const i = props.options.findIndex((o) => o.value === props.modelValue)
  return i >= 0 ? i : 0
})

function focusAt(index: number) {
  root.value?.querySelectorAll<HTMLButtonElement>('.dk-seg__item')[index]?.focus()
}

function moveTo(index: number) {
  const n = props.options.length
  if (n === 0) return
  const next = ((index % n) + n) % n
  const option = props.options[next]
  if (!option) return
  emit('update:modelValue', option.value)
  focusAt(next)
}

function onKeydown(e: KeyboardEvent) {
  if (props.options.length === 0) return
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      e.preventDefault()
      moveTo(activeIndex.value + 1)
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      e.preventDefault()
      moveTo(activeIndex.value - 1)
      break
    case 'Home':
      e.preventDefault()
      moveTo(0)
      break
    case 'End':
      e.preventDefault()
      moveTo(props.options.length - 1)
      break
  }
}
</script>

<template>
  <div
    ref="root"
    class="dk-seg"
    :class="`dk-seg--${size}`"
    role="radiogroup"
    :aria-label="ariaLabel || label"
    @keydown="onKeydown"
  >
    <button
      v-for="(o, i) in options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === o.value"
      :tabindex="i === activeIndex ? 0 : -1"
      class="dk-seg__item"
      :class="{ 'dk-seg__item--active': modelValue === o.value }"
      :title="o.title"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.dk-seg {
  display: inline-flex;
  padding: 2px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  gap: 2px;
}
.dk-seg__item {
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  transition:
    background 0.12s,
    color 0.12s;
}
.dk-seg--md .dk-seg__item {
  height: 26px;
  padding: 0 12px;
}
.dk-seg--sm .dk-seg__item {
  height: 22px;
  padding: 0 8px;
  font-size: 11px;
}
.dk-seg__item:hover:not(.dk-seg__item--active) {
  color: var(--text-primary);
}
.dk-seg__item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.dk-seg__item--active {
  background: var(--surface);
  color: var(--accent);
  font-weight: 500;
  box-shadow: var(--shadow-1);
}
</style>
