<script setup lang="ts">
const props = defineProps<{
  open: boolean
  title: string
  /** 危险操作弹层的确认样式 */
  danger?: boolean
  width?: string
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

const panelRef = ref<HTMLElement>()
let lastFocus: HTMLElement | null = null

function focusables(): HTMLElement[] {
  if (!panelRef.value) return []
  return Array.from(
    panelRef.value.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  )
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables()
  if (!items.length) {
    e.preventDefault()
    panelRef.value?.focus()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement as HTMLElement | null
  if (e.shiftKey) {
    if (active === first || active === panelRef.value) {
      e.preventDefault()
      last.focus()
    }
  } else if (active === last) {
    e.preventDefault()
    first.focus()
  }
}

watch(
  () => props.open,
  (v) => {
    if (import.meta.server) return
    if (v) {
      lastFocus = document.activeElement as HTMLElement
      nextTick(() => panelRef.value?.focus())
      document.body.style.overflow = 'hidden'
      document.addEventListener('keydown', onKeydown)
    } else {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeydown)
      // 模态框关闭后焦点回到触发入口
      lastFocus?.focus?.()
    }
  }
)

onUnmounted(() => {
  if (import.meta.client) {
    document.body.style.overflow = ''
    document.removeEventListener('keydown', onKeydown)
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="dk-modal">
      <div v-if="open" class="dk-modal__mask" @click.self="emit('close')">
        <div
          ref="panelRef"
          class="dk-modal__panel"
          :class="{ 'dk-modal__panel--danger': danger }"
          :style="width ? { width } : undefined"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <div class="dk-modal__head">
            <h3 class="dk-modal__title">
              <DkIcon v-if="danger" name="alert-triangle" :size="16" style="color: var(--warn)" />
              {{ title }}
            </h3>
            <DkIconButton title="关闭" @click="emit('close')">
              <DkIcon name="x" :size="15" />
            </DkIconButton>
          </div>
          <div class="dk-modal__body">
            <slot />
          </div>
          <div v-if="$slots.footer" class="dk-modal__foot">
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dk-modal__mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 17, 21, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 12vh 16px 16px;
  overflow-y: auto;
}
.dk-modal__panel {
  width: 480px;
  max-width: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  outline: none;
}
.dk-modal__panel--danger {
  border-color: var(--error);
}
.dk-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 0;
}
.dk-modal__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
}
.dk-modal__body {
  padding: 14px 18px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.dk-modal__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 18px 16px;
}
.dk-modal-enter-active,
.dk-modal-leave-active {
  transition: opacity 0.15s;
}
.dk-modal-enter-active .dk-modal__panel,
.dk-modal-leave-active .dk-modal__panel {
  transition: transform 0.15s;
}
.dk-modal-enter-from,
.dk-modal-leave-to {
  opacity: 0;
}
.dk-modal-enter-from .dk-modal__panel {
  transform: translateY(-8px) scale(0.98);
}
</style>
