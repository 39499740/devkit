<script setup lang="ts">
/**
 * 风险确认弹窗（唯一入口的界面部分）。
 * 未勾选时「我已知晓并添加」不可点；关闭、Esc、点遮罩一律等价于「仍不添加」，
 * 由调用方负责不添加步骤、不创建密钥记录。
 */
import { CONSENT_ACCEPT_TEXT, CONSENT_NOTICE_TEXT, CONSENT_NOTICE_VERSION } from '~/workflow/secrets'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>()

const checked = ref(false)

// 每次重新打开都要重新勾选：不做「一次同意永久生效」
watch(
  () => props.open,
  (v) => {
    if (v) checked.value = false
  }
)
</script>

<template>
  <DkModal :open="open" :title="title ?? '密钥会以明文保存到本机浏览器'" width="580px" danger @close="emit('cancel')">
    <div class="rc">
      <p class="rc__text">{{ CONSENT_NOTICE_TEXT }}</p>
      <DkCheckbox v-model="checked" :label="CONSENT_ACCEPT_TEXT" />
      <p class="rc__note">
        确认记录只对这一个步骤有效（文案版本 v{{ CONSENT_NOTICE_VERSION }}），以后新增敏感步骤会重新询问；风险文案有实质变化时旧确认也会失效。
      </p>
    </div>
    <template #footer>
      <DkButton size="sm" @click="emit('cancel')">仍不添加</DkButton>
      <DkButton size="sm" variant="primary" :disabled="!checked" @click="emit('confirm')">我已知晓并添加</DkButton>
    </template>
  </DkModal>
</template>

<style scoped>
.rc {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rc__text {
  font-size: 13px;
  line-height: 1.75;
  color: var(--text-primary);
}
.rc__note {
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-tertiary);
}
</style>
