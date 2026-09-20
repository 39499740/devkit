<script setup lang="ts">
/**
 * G01 发送到另一个工具菜单：只列出兼容目标；
 * 目标已有未保存输入时在目标侧弹替换确认（由接收工具处理）。
 */
const props = defineProps<{
  text: string
  from: string
  kind: 'json' | 'text'
}>()

const transfer = useTransfer()
const open = ref(false)
const menuRef = ref<HTMLElement>()

const targets = computed(() =>
  transfer.compatibleTargets(props.kind).filter((t) => t.slug !== props.from)
)

function toggle() {
  if (!props.text.trim()) return
  open.value = !open.value
}

function onClickOutside(e: MouseEvent) {
  if (open.value && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => document.addEventListener('click', onClickOutside))
onUnmounted(() => document.removeEventListener('click', onClickOutside))

function go(slug: string) {
  transfer.send(props.text, props.from, props.kind)
  open.value = false
  transfer.deliver(slug)
}
</script>

<template>
  <div ref="menuRef" class="sendto">
    <button class="sendto__btn" :disabled="!text.trim()" title="发送到另一个工具（仅内存）" @click="toggle">
      <DkIcon name="send" :size="12" />
      发送到…
    </button>
    <Transition name="sendto-pop">
      <div v-if="open" class="sendto__menu" role="menu">
        <p class="sendto__menu-title">兼容的目标工具</p>
        <button v-for="t in targets" :key="t.slug" class="sendto__item" role="menuitem" @click="go(t.slug)">
          <DkIcon name="arrow-right" :size="12" />
          {{ t.name }}
        </button>
        <p v-if="!targets.length" class="sendto__empty">当前没有兼容目标</p>
        <p class="sendto__note">传递仅发生在本页内存中，不会写入 URL 或本地存储。</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.sendto {
  position: relative;
  display: inline-flex;
}
.sendto__btn {
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
.sendto__btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--accent);
}
.sendto__btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sendto__menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 50;
  min-width: 220px;
  padding: 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-2);
}
.sendto__menu-title {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 4px 8px;
}
.sendto__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-primary);
  text-align: left;
}
.sendto__item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.sendto__empty {
  padding: 8px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.sendto__note {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 6px 8px 4px;
  border-top: 1px solid var(--border);
    margin-top: 4px;
}
.sendto-pop-enter-active,
.sendto-pop-leave-active {
  transition: all 0.12s;
}
.sendto-pop-enter-from,
.sendto-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
