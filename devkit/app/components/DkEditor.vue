<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    readonly?: boolean
    /** 错误信息：显示红色边框与提示条 */
    error?: string
    /** 高度，如 420px / 100% */
    height?: string
    /** 自动换行；false 时长行横向滚动 */
    wrap?: boolean
    /** 下载文件名 */
    filename?: string
    /** 隐藏工具栏 */
    hideToolbar?: boolean
    /** 是否显示统计（字符/字节/行） */
    showStats?: boolean
    /** 结果待更新时禁用复制下载 */
    stale?: boolean
    /** 语言标注（用于无障碍） */
    lang?: string
  }>(),
  { wrap: true, showStats: true, height: '100%' }
)
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const clipboard = useClipboard()
const areaRef = ref<HTMLTextAreaElement>()
const gutterRef = ref<HTMLElement>()

const lines = computed(() => (props.modelValue === '' ? 1 : props.modelValue.split('\n').length))

const stats = computed(() => {
  const v = props.modelValue
  return {
    chars: v.length,
    bytes: new TextEncoder().encode(v).length,
    lines: v === '' ? 0 : v.split('\n').length
  }
})

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

function onScroll() {
  if (gutterRef.value && areaRef.value) {
    gutterRef.value.scrollTop = areaRef.value.scrollTop
  }
}

function copyContent() {
  clipboard.copy(props.modelValue, '内容')
}

function download() {
  if (!props.modelValue) return
  downloadText(props.filename ?? 'devkit.txt', props.modelValue)
}

function clear() {
  emit('update:modelValue', '')
}

function focus() {
  areaRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    class="editor"
    :class="{ 'editor--error': !!error, 'editor--readonly': readonly }"
    :style="height && height !== '100%' ? { height, minHeight: height } : undefined"
  >
    <div v-if="!hideToolbar" class="editor__bar">
      <span class="editor__lang mono" v-if="lang">{{ lang }}</span>
      <span class="grow"></span>
      <button
        class="editor__act"
        title="复制"
        :disabled="!modelValue || stale"
        @click="copyContent"
      >
        <DkIcon name="copy" :size="13" />复制
      </button>
      <button
        class="editor__act"
        title="下载"
        :disabled="!modelValue || stale"
        @click="download"
      >
        <DkIcon name="download" :size="13" />下载
      </button>
      <button
        v-if="!readonly"
        class="editor__act"
        title="清空"
        :disabled="!modelValue"
        @click="clear"
      >
        <DkIcon name="trash" :size="13" />清空
      </button>
    </div>
    <div class="editor__body">
      <div ref="gutterRef" class="editor__gutter mono" aria-hidden="true">
        <div
          v-for="n in Math.min(lines, 100000)"
          :key="n"
          class="editor__ln"
        >
          {{ n }}
        </div>
      </div>
      <textarea
        ref="areaRef"
        class="editor__area mono"
        :value="modelValue"
        :placeholder="placeholder"
        :readonly="readonly"
        :wrap="wrap ? 'soft' : 'off'"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        :aria-label="lang ? `${lang} 编辑器` : '代码编辑器'"
        @input="onInput"
        @scroll="onScroll"
      />
    </div>
    <div v-if="error" class="editor__error">
      <DkIcon name="alert-circle" :size="13" />
      <span class="editor__errmsg">{{ error }}</span>
    </div>
    <div v-if="showStats && !error" class="editor__stats">
      <span>字符 {{ stats.chars.toLocaleString() }}</span>
      <span>字节 {{ stats.bytes.toLocaleString() }}</span>
      <span>行 {{ stats.lines.toLocaleString() }}</span>
      <span v-if="!wrap" class="editor__hint">长行横向滚动</span>
    </div>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  flex: 1 1 auto;
  min-height: 180px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--editor-bg);
  overflow: hidden;
}
.editor--error {
  border-color: var(--error);
}
.editor__bar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 34px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
}
.editor__lang {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 0 4px;
}
.editor__act {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--text-secondary);
  transition: all 0.12s;
}
.editor__act:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--accent);
}
.editor__act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.editor__body {
  display: flex;
  min-height: 0;
  flex: 1;
  position: relative;
}
.editor__gutter {
  width: 44px;
  flex-shrink: 0;
  overflow: hidden;
  padding: 10px 0;
  text-align: right;
  color: var(--gutter-text);
  font-size: var(--code-font-size);
  line-height: 1.6;
  border-right: 1px solid var(--border);
  background: var(--surface-subtle);
  user-select: none;
}
.editor__ln {
  padding-right: 10px;
  height: calc(var(--code-font-size) * 1.6);
}
.editor__area {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border: none;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--code-font-size);
  line-height: 1.6;
  tab-size: 4;
  white-space: pre-wrap;
  overflow: auto;
}
.editor__area[wrap='off'] {
  white-space: pre;
}
.editor__area::placeholder {
  color: var(--text-tertiary);
}
.editor--readonly .editor__area {
  background: var(--surface-subtle);
}
.editor__error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 12px;
  background: var(--error-soft);
  color: var(--error);
  font-size: 12px;
  line-height: 1.5;
  flex-shrink: 0;
}
.editor__stats {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 4px 12px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.editor__hint {
  margin-left: auto;
}
</style>
