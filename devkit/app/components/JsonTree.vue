<script setup lang="ts">
import { RawNumber } from '~/utils/json'

const props = withDefaults(defineProps<{ data: unknown; name?: string; depth?: number }>(), {
  depth: 0
})

const open = ref(props.depth < 2)

const isArray = computed(() => Array.isArray(props.data))
const isObject = computed(
  () => props.data !== null && typeof props.data === 'object' && !(props.data instanceof RawNumber)
)
const entries = computed<[string, unknown][]>(() => {
  if (isArray.value) return (props.data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
  if (isObject.value) return Object.entries(props.data as Record<string, unknown>)
  return []
})
const isRaw = computed(() => props.data instanceof RawNumber)
const rawText = computed(() => (props.data as RawNumber).raw)
</script>

<template>
  <div class="jtree">
    <template v-if="isObject">
      <button class="jtree__toggle" @click="open = !open">
        <span class="jtree__arrow">{{ open ? '▾' : '▸' }}</span>
        <template v-if="name">
          <span class="jtree__key">{{ JSON.stringify(name) }}</span>
          <span class="jtree__punct">: </span>
        </template>
        <span class="jtree__punct">{{ isArray ? '[' : '{' }}</span>
        <span v-if="!open" class="jtree__punct">{{ isArray ? ']' : '}' }}</span>
      </button>
      <div v-show="open" class="jtree__children">
        <JsonTree
          v-for="[k, v] in entries"
          :key="k"
          :data="v"
          :name="isArray ? undefined : k"
          :depth="depth + 1"
        />
        <div class="jtree__close jtree__punct">{{ isArray ? ']' : '}' }}</div>
      </div>
    </template>
    <div v-else class="jtree__leaf">
      <template v-if="name">
        <span class="jtree__key">{{ JSON.stringify(name) }}</span>
        <span class="jtree__punct">: </span>
      </template>
      <span v-if="isRaw" class="jtree__number">{{ rawText }}</span>
      <span v-else-if="data === null" class="jtree__bool">null</span>
      <span v-else-if="typeof data === 'string'" class="jtree__string">{{ JSON.stringify(data) }}</span>
      <span v-else-if="typeof data === 'number'" class="jtree__number">{{ data }}</span>
      <span v-else-if="typeof data === 'boolean'" class="jtree__bool">{{ data }}</span>
    </div>
  </div>
</template>

<style scoped>
.jtree__toggle {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: var(--text-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.jtree__arrow {
  color: var(--text-tertiary);
  width: 12px;
  display: inline-block;
}
.jtree__children {
  padding-left: 16px;
  border-left: 1px dashed var(--border);
  margin-left: 6px;
}
.jtree__key {
  color: var(--code-key);
}
.jtree__punct {
  color: var(--code-punct);
}
.jtree__string {
  color: var(--code-string);
}
.jtree__number {
  color: var(--code-number);
}
.jtree__bool {
  color: var(--code-bool);
}
.jtree__close {
  padding-left: 12px;
}
</style>
