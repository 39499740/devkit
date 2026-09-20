<script setup lang="ts">
const toast = useToast()
const icons: Record<string, string> = {
  success: 'check',
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info'
}
const colors: Record<string, string> = {
  success: 'var(--ok)',
  error: 'var(--error)',
  warning: 'var(--warn)',
  info: 'var(--accent)'
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-host" aria-live="polite">
      <TransitionGroup name="toast">
        <div v-for="t in toast.items.value" :key="t.id" class="toast" role="status">
          <DkIcon :name="icons[t.kind] ?? 'info'" :size="15" :style="{ color: colors[t.kind] }" />
          <span class="toast__msg">{{ t.message }}</span>
          <button v-if="t.action" class="toast__action" @click="t.action.onClick(); toast.dismiss(t.id)">
            {{ t.action.label }}
          </button>
          <button class="toast__close" title="关闭" aria-label="关闭提示" @click="toast.dismiss(t.id)">
            <DkIcon name="x" :size="13" />
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: min(90vw, 480px);
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-2);
  font-size: 13px;
  color: var(--text-primary);
}
.toast__msg {
  flex: 1;
  min-width: 0;
}
.toast__action {
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
  flex-shrink: 0;
}
.toast__action:hover {
  text-decoration: underline;
}
.toast__close {
  color: var(--text-tertiary);
  display: inline-flex;
  flex-shrink: 0;
}
.toast__close:hover {
  color: var(--text-primary);
}
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.18s,
    transform 0.18s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
