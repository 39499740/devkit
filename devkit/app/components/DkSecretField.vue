<script setup lang="ts">
/**
 * 密钥输入框：默认掩码，「按住查看」松开立即恢复。
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
  rows?: number
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const revealed = ref(false)
const hasStored = computed(() => !!props.modelValue && !!props.updatedAt)

function onInput(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement | HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="sf">
    <div class="sf__head">
      <span class="sf__label">{{ label }}</span>
      <span v-if="hasStored" class="sf__badge">
        <DkIcon name="shield-check" :size="11" />含本地持久化密钥
      </span>
      <span class="grow"></span>
      <button
        type="button"
        class="sf__peek"
        @mousedown="revealed = true"
        @mouseup="revealed = false"
        @mouseleave="revealed = false"
        @touchstart.prevent="revealed = true"
        @touchend="revealed = false"
        @blur="revealed = false"
      >
        {{ revealed ? '松开即隐藏' : '按住查看' }}
      </button>
    </div>
    <input
      class="sf__input mono"
      :type="revealed ? 'text' : 'password'"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="label"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
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
