<script setup lang="ts">
/**
 * G02 文件拖入区：支持点击选择与拖拽，
 * 拖入高亮、多文件、大小限制提示。
 */
const props = withDefaults(
  defineProps<{
    multiple?: boolean
    accept?: string
    /** 单文件大小上限（字节），0 为不限制 */
    maxSize?: number
    hint?: string
  }>(),
  { multiple: false, maxSize: 0 }
)
const emit = defineEmits<{ (e: 'files', files: File[]): void; (e: 'reject', reason: string): void }>()

const inputRef = ref<HTMLInputElement>()
const dragging = ref(false)

function matchesAccept(file: File): boolean {
  if (!props.accept) return true
  const type = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  return props.accept
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule)
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1))
      return type === rule
    })
}

function emitFiles(list: FileList | null) {
  if (!list || list.length === 0) return
  const accepted: File[] = []
  for (const file of Array.from(list)) {
    if (!matchesAccept(file)) {
      emit('reject', `文件「${file.name}」类型不受支持（当前只接受 ${props.accept}）`)
      continue
    }
    if (props.maxSize > 0 && file.size > props.maxSize) {
      emit('reject', `文件「${file.name}」超出当前限制（${formatBytes(props.maxSize)}）`)
      continue
    }
    accepted.push(file)
  }
  if (!accepted.length) return
  emit('files', props.multiple ? accepted : accepted.slice(0, 1))
}

function onDrop(e: DragEvent) {
  dragging.value = false
  emitFiles(e.dataTransfer?.files ?? null)
}

function onPick(e: Event) {
  emitFiles((e.target as HTMLInputElement).files)
  ;(e.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div
    class="filedrop"
    :class="{ 'filedrop--over': dragging }"
    role="button"
    tabindex="0"
    aria-label="拖入或点击选择文件"
    @click="inputRef?.click()"
    @keydown.enter.prevent="inputRef?.click()"
    @keydown.space.prevent="inputRef?.click()"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <DkIcon name="upload" :size="20" class="filedrop__icon" />
    <p class="filedrop__title">拖入文件，或点击选择</p>
    <p class="filedrop__hint">{{ hint ?? '文件保留在本地，不会上传' }}</p>
    <p v-if="maxSize > 0" class="filedrop__hint">当前单文件限制 {{ formatBytes(maxSize) }}</p>
    <input
      ref="inputRef"
      type="file"
      :multiple="multiple"
      :accept="accept"
      class="filedrop__input"
      @change="onPick"
    />
  </div>
</template>

<style scoped>
.filedrop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 28px 16px;
  border: 1.5px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
  text-align: center;
}
.filedrop:hover,
.filedrop--over {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.filedrop--over {
  border-style: solid;
}
.filedrop__icon {
  color: var(--text-tertiary);
  margin-bottom: 4px;
}
.filedrop--over .filedrop__icon,
.filedrop:hover .filedrop__icon {
  color: var(--accent);
}
.filedrop__title {
  font-size: 13px;
  color: var(--text-primary);
}
.filedrop__hint {
  font-size: 12px;
  color: var(--text-tertiary);
}
.filedrop__input {
  display: none;
}
</style>
