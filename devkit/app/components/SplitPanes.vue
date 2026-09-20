<script setup lang="ts">
/**
 * 左右分栏（G07）：桌面支持拖动分隔线调整比例，小屏自动改纵向排列。
 */
const props = withDefaults(defineProps<{ initial?: number; min?: number; max?: number }>(), {
  initial: 50,
  min: 20,
  max: 80
})

const leftPct = ref(props.initial)
const containerRef = ref<HTMLElement>()
const dragging = ref(false)

function onDown(e: PointerEvent) {
  dragging.value = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!dragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const horizontal = window.innerWidth > 960
  let pct = horizontal
    ? ((e.clientX - rect.left) / rect.width) * 100
    : ((e.clientY - rect.top) / rect.height) * 100
  pct = Math.max(props.min, Math.min(props.max, pct))
  leftPct.value = pct
}

function onUp() {
  dragging.value = false
}
</script>

<template>
  <div ref="containerRef" class="split" :class="{ 'split--drag': dragging }">
    <div class="split__pane split__left" :style="{ flexBasis: leftPct + '%' }">
      <slot name="left" />
    </div>
    <div
      class="split__handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整分栏比例"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <span class="split__grip"></span>
    </div>
    <div class="split__pane split__right">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.split {
  display: flex;
  align-items: stretch;
  min-height: 0;
  height: 100%;
}
.split__pane {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.split__left {
  flex: 0 0 auto;
}
.split__handle {
  width: 9px;
  flex-shrink: 0;
  cursor: col-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
}
.split__grip {
  width: 3px;
  height: 28px;
  border-radius: 2px;
  background: var(--border-strong);
  transition: background 0.12s;
}
.split__handle:hover .split__grip,
.split--drag .split__grip {
  background: var(--accent);
}

@media (max-width: 960px) {
  .split {
    flex-direction: column;
  }
  .split__pane {
    flex: 1 1 auto;
    flex-basis: auto !important;
    min-height: 220px;
  }
  .split__handle {
    width: 100%;
    height: 9px;
    cursor: row-resize;
  }
  .split__grip {
    width: 28px;
    height: 3px;
  }
}
</style>
