<script setup lang="ts">
/**
 * 密钥输入框：默认掩码，「按住查看」松开立即恢复；键盘回车/空格也能切换显示。
 * 不提供复制按钮，避免密钥进入剪贴板；也不显示密钥摘要，避免误解为「摘要可证明未泄露」。
 */
const props = defineProps<{
  label: string
  modelValue: string
  placeholder?: string
  help?: string
  error?: string
  /** 上次写入密钥存储的时间（毫秒）；有值才显示「含本地持久化密钥」 */
  updatedAt?: number | null
  /** 禁用时输入框不可编辑、不再向外抛事件（例如风险确认已失效） */
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'blur'): void
}>()

const revealed = ref(false)
const hasStored = computed(() => !!props.modelValue && !!props.updatedAt)

/**
 * 「按住查看」：鼠标/触摸按住时显示、松开恢复；短按视为切换。
 * 键盘用原生 button 的 click 切换，并暴露 aria-pressed，保证纯键盘可用。
 */
const HOLD_MS = 250
let pressing = false
let pressAt = 0
let revealedBeforePress = false
let suppressClick = false

function pressStart() {
  suppressClick = false
  pressing = true
  pressAt = Date.now()
  revealedBeforePress = revealed.value
  revealed.value = true
}

function pressEnd() {
  if (!pressing) return
  pressing = false
  // 长按=按住查看（松开即隐藏）；短按=点击切换
  revealed.value = Date.now() - pressAt < HOLD_MS ? !revealedBeforePress : false
  // 指针操作结束后浏览器还会补一个 click，这里吞掉它，避免再切换一次
  suppressClick = true
  setTimeout(() => {
    suppressClick = false
  }, 0)
}

function pressCancel() {
  if (!pressing) return
  pressing = false
  revealed.value = revealedBeforePress
}

function onPeekClick() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  revealed.value = !revealed.value
}

/** 失焦即隐藏，避免密钥长时间停留在屏幕上 */
function onPeekBlur() {
  pressCancel()
  revealed.value = false
}

function onInput(e: Event) {
  if (props.disabled) return
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function onBlur() {
  emit('blur')
}
</script>

<template>
  <div class="sf" :class="{ 'sf--disabled': disabled }">
    <div class="sf__head">
      <span class="sf__label">{{ label }}</span>
      <span v-if="hasStored" class="sf__badge">
        <DkIcon name="shield-check" :size="11" />含本地持久化密钥
      </span>
      <span class="grow"></span>
      <button
        type="button"
        class="sf__peek"
        :aria-pressed="revealed"
        :title="revealed ? '松开即隐藏；键盘回车可切换' : '按住查看；键盘回车可切换'"
        @mousedown="pressStart"
        @mouseup="pressEnd"
        @mouseleave="pressCancel"
        @touchstart.prevent="pressStart"
        @touchend="pressEnd"
        @touchcancel="pressCancel"
        @blur="onPeekBlur"
        @click="onPeekClick"
      >
        {{ revealed ? '隐藏' : '按住查看' }}
      </button>
    </div>
    <input
      class="sf__input mono"
      :type="revealed ? 'text' : 'password'"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label"
      :disabled="disabled"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @blur="onBlur"
    />
    <p v-if="error" class="sf__error">{{ error }}</p>
    <p v-else-if="help" class="sf__help">{{ help }}</p>
    <p v-if="updatedAt" class="sf__time">上次修改：{{ fmtAgo(updatedAt) }}</p>
  </div>
</template>

<style scoped>
.sf {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.sf__head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
}
.sf__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.sf__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 7px;
  border-radius: 9px;
  background: var(--warn-soft, var(--surface-subtle));
  color: var(--warn, var(--text-secondary));
  font-size: 10.5px;
  white-space: nowrap;
}
.sf__peek {
  font-size: 11.5px;
  color: var(--text-tertiary);
  padding: 2px 4px;
  border-radius: 4px;
}
.sf__peek:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.sf__input {
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
}
.sf__input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.sf__input:disabled {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  cursor: not-allowed;
}
.sf--disabled .sf__label {
  color: var(--text-tertiary);
}
.sf__help {
  font-size: 11.5px;
  color: var(--text-tertiary);
  line-height: 1.6;
}
.sf__error {
  font-size: 11.5px;
  color: var(--error);
  line-height: 1.6;
}
.sf__time {
  font-size: 11px;
  color: var(--text-tertiary);
}
</style>
