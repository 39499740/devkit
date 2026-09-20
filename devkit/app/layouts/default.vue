<script setup lang="ts">
const drawerOpen = ref(false)
const route = useRoute()
const palette = usePalette()

// 路由变化时关闭抽屉
watch(() => route.path, () => {
  drawerOpen.value = false
})

// 全局快捷键 ⌘K / Ctrl+K 打开搜索
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    palette.open.value = !palette.open.value
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="shell">
    <TopNav @menu="drawerOpen = true" />
    <div class="shell__main">
      <aside class="shell__sidenav">
        <SideNav />
      </aside>
      <main class="shell__content">
        <slot />
      </main>
    </div>

    <!-- 移动端抽屉导航 -->
    <Teleport to="body">
      <Transition name="drawer">
        <div v-if="drawerOpen" class="drawer__mask" @click.self="drawerOpen = false">
          <div class="drawer">
            <div class="drawer__head">
              <span class="drawer__title">导航</span>
              <DkIconButton title="关闭导航" @click="drawerOpen = false">
                <DkIcon name="x" :size="16" />
              </DkIconButton>
            </div>
            <div class="drawer__body" @click="drawerOpen = false">
              <SideNav />
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <CommandPalette />
    <DkToastHost />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}
.shell__main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.shell__sidenav {
  position: sticky;
  top: var(--topnav-h);
  height: calc(100vh - var(--topnav-h));
  height: calc(100dvh - var(--topnav-h));
}
.shell__content {
  flex: 1;
  min-width: 0;
  padding: 24px 32px 48px;
}
.drawer__mask {
  position: fixed;
  inset: 0;
  z-index: 180;
  background: rgba(15, 17, 21, 0.45);
}
.drawer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: min(300px, 85vw);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.drawer__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}
.drawer__title {
  font-size: 14px;
  font-weight: 600;
}
.drawer__body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.drawer__body > :deep(*) {
  width: 100%;
}
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.2s;
}
.drawer-enter-active .drawer,
.drawer-leave-active .drawer {
  transition: transform 0.2s;
}
.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .drawer,
.drawer-leave-to .drawer {
  transform: translateX(-100%);
}

@media (max-width: 960px) {
  .shell__sidenav {
    display: none;
  }
  .shell__content {
    padding: 16px 14px 40px;
  }
}
</style>
