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
        <div class="shell__content-inner">
          <slot />
        </div>
        <footer class="shell__foot">
          <span>© {{ new Date().getFullYear() }} {{ SITE_NAME }}</span>
          <span class="shell__foot-sep">·</span>
          <a :href="ICP_URL" target="_blank" rel="noopener noreferrer">{{ ICP_LICENSE }}</a>
          <span class="shell__foot-sep">·</span>
          <a :href="REPO_URL" target="_blank" rel="noopener noreferrer">开源仓库</a>
          <span class="shell__foot-sep">·</span>
          <NuxtLink to="/privacy">隐私说明</NuxtLink>
        </footer>
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
    <PwaStatus />
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
  display: flex;
  flex-direction: column;
  padding: 24px 32px 0;
}
.shell__content-inner {
  flex: 1;
  min-width: 0;
}
.shell__foot {
  position: sticky;
  bottom: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 32px;
  padding: 16px 0 24px;
  border-top: 1px solid var(--border);
  background: var(--bg);
  box-shadow: 0 -10px 18px -16px rgba(15, 17, 21, 0.55);
  font-size: 12px;
  color: var(--text-tertiary);
}
.shell__foot a {
  color: var(--text-tertiary);
  text-decoration: none;
  transition: color 0.12s;
}
.shell__foot a:hover {
  color: var(--accent);
}
.shell__foot-sep {
  color: var(--border-strong);
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
    padding: 16px 14px 0;
  }
  .shell__foot {
    gap: 4px;
    padding: 12px 0 16px;
    font-size: 11.5px;
  }
  .shell__foot a {
    padding: 4px 0;
  }
}
</style>
