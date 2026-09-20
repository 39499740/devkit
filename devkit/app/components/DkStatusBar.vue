<script setup lang="ts">
export type BarStatus = 'idle' | 'ok' | 'error' | 'stale' | 'running'

const props = withDefaults(
  defineProps<{
    status: BarStatus
    message?: string
    /** 附加信息片段（如耗时、算法） */
    meta?: string[]
    /** 待更新时点击重新执行 */
    retry?: () => void
    retryLabel?: string
  }>(),
  { retryLabel: '重新执行' }
)

const conf = computed(() => {
  switch (props.status) {
    case 'ok':
      return { icon: 'check', color: 'var(--ok)', bg: 'var(--ok-soft)', label: '成功' }
    case 'error':
      return { icon: 'alert-circle', color: 'var(--error)', bg: 'var(--error-soft)', label: '失败' }
    case 'stale':
      return { icon: 'alert-triangle', color: 'var(--warn)', bg: 'var(--warn-soft)', label: '结果待更新' }
    case 'running':
      return { icon: 'loader', color: 'var(--accent)', bg: 'var(--accent-soft)', label: '处理中' }
    default:
      return { icon: 'info', color: 'var(--text-tertiary)', bg: 'var(--surface-subtle)', label: '未执行' }
  }
})
</script>

<template>
  <div class="statusbar" :style="{ background: conf.bg }">
    <DkIcon
      :name="conf.icon"
      :size="14"
      :style="{ color: conf.color }"
      :class="{ 'statusbar__spin': status === 'running' }"
    />
    <span class="statusbar__label" :style="{ color: conf.color }">{{ conf.label }}</span>
    <span v-if="message" class="statusbar__msg">{{ message }}</span>
    <span class="grow"></span>
    <span v-for="m in meta" :key="m" class="statusbar__meta">{{ m }}</span>
    <button v-if="status === 'stale' && retry" class="statusbar__retry" @click="retry">
      <DkIcon name="refresh" :size="12" />{{ retryLabel }}
    </button>
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  flex-wrap: wrap;
}
.statusbar__label {
  font-weight: 600;
  flex-shrink: 0;
}
.statusbar__msg {
  color: var(--text-secondary);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 60%;
}
.statusbar__meta {
  color: var(--text-tertiary);
  font-size: 11px;
  white-space: nowrap;
}
.statusbar__retry {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  color: var(--warn);
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
}
.statusbar__retry:hover {
  border-color: var(--warn);
}
.statusbar__spin {
  animation: dk-spin 0.8s linear infinite;
}
@keyframes dk-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
