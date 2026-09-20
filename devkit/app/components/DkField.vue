<script setup lang="ts">
const props = defineProps<{
  label: string
  help?: string
  error?: string
  /** 密钥字段：提供显隐切换 */
  secret?: boolean
  /** 当前是否明文（v-model:revealed 可选） */
  modelValue?: string
  revealed?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void; (e: 'update:revealed', v: boolean): void }>()

const inner = ref(props.revealed ?? false)
watch(
  () => props.revealed,
  (v) => {
    if (v !== undefined) inner.value = v
  }
)
function toggle() {
  inner.value = !inner.value
  emit('update:revealed', inner.value)
}
</script>

<template>
  <div class="dk-field" :class="{ 'dk-field--error': !!error }">
    <div class="dk-field__head">
      <label class="dk-field__label">{{ label }}</label>
      <button
        v-if="secret"
        type="button"
        class="dk-field__eye"
        :title="inner ? '隐藏密钥' : '显示密钥'"
        :aria-label="inner ? '隐藏密钥' : '显示密钥'"
        @click="toggle"
      >
        <DkIcon :name="inner ? 'eye-off' : 'eye'" :size="14" />
      </button>
    </div>
    <div class="dk-field__control">
      <slot :revealed="inner" />
    </div>
    <p v-if="error" class="dk-field__error">{{ error }}</p>
    <p v-else-if="help" class="dk-field__help">{{ help }}</p>
  </div>
</template>

<style scoped>
.dk-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.dk-field__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.dk-field__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.dk-field__eye {
  display: inline-flex;
  color: var(--text-tertiary);
  padding: 2px;
  border-radius: 4px;
}
.dk-field__eye:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.dk-field__help {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.dk-field__error {
  font-size: 12px;
  color: var(--error);
  line-height: 1.5;
}
</style>
