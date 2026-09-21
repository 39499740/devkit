<script setup lang="ts">
const route = useRoute()
const { prefs, isDark, update } = usePrefs()
const palette = usePalette()

const isMac = ref(true)
onMounted(() => {
  isMac.value = /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent)
})

function openPalette() {
  palette.show()
}

function setTheme(mode: 'light' | 'dark') {
  update({ theme: mode })
}
</script>

<template>
  <header class="topnav">
    <div class="topnav__inner">
      <button class="topnav__menu" aria-label="打开导航" @click="$emit('menu')">
        <DkIcon name="menu" :size="18" />
      </button>
      <NuxtLink to="/" class="topnav__brand" aria-label="DevKit 首页">
        <span class="topnav__logo">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <!-- 品牌标识：工具箱（箱体 + 盖缝 + 分格 + 提手），与 public/pwa-*.png 同一图形 -->
            <path d="M8.2 7.6V6c0-1.1.9-2 2-2h3.6c1.1 0 2 .9 2 2v1.6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            <path
              d="M6 7.6h12a3.4 3.4 0 0 1 3.4 3.4v5.6a3.4 3.4 0 0 1-3.4 3.4H6a3.4 3.4 0 0 1-3.4-3.4V11A3.4 3.4 0 0 1 6 7.6Z M2.6 11.8h18.8v1.8H2.6Z M11.1 13.6h1.8v6.4h-1.8Z"
              fill="currentColor"
              fill-rule="evenodd"
            />
          </svg>
        </span>
        <span class="topnav__name">DevKit</span>
      </NuxtLink>

      <button class="topnav__search" @click="openPalette">
        <DkIcon name="search" :size="14" />
        <span class="topnav__search-text">搜索工具，例如 JSON、国密、时间戳</span>
        <span class="topnav__kbd">
          <kbd>{{ isMac ? '⌘' : 'Ctrl' }}</kbd><kbd>K</kbd>
        </span>
      </button>

      <span class="grow"></span>

      <a
        class="topnav__src"
        href="https://github.com/39499740/devkit"
        target="_blank"
        rel="noopener noreferrer"
        title="查看源码（GitHub: 39499740/devkit）"
      >
        <DkIcon name="github" :size="14" />
        <span class="topnav__src-text">源码</span>
      </a>

      <div class="topnav__theme" role="group" aria-label="主题切换">
        <button
          class="topnav__theme-btn"
          :class="{ 'topnav__theme-btn--on': !isDark }"
          title="浅色主题"
          aria-label="切换到浅色主题"
          @click="setTheme('light')"
        >
          <DkIcon name="sun" :size="14" />
        </button>
        <button
          class="topnav__theme-btn"
          :class="{ 'topnav__theme-btn--on': isDark }"
          title="深色主题"
          aria-label="切换到深色主题"
          @click="setTheme('dark')"
        >
          <DkIcon name="moon" :size="14" />
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topnav {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--topnav-h);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.topnav__inner {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 100%;
  padding: 0 20px;
}
.topnav__menu {
  display: none;
  color: var(--text-secondary);
  padding: 6px;
  border-radius: 6px;
}
.topnav__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-primary);
  flex-shrink: 0;
}
.topnav__brand:hover {
  text-decoration: none;
}
.topnav__logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
}
.topnav__name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.2px;
}
.topnav__search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 400px;
  max-width: 40vw;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  font-size: 13px;
  transition: border-color 0.12s;
}
.topnav__search:hover {
  border-color: var(--accent);
}
.topnav__search-text {
  flex: 1;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.topnav__kbd {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}
.topnav__src {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  transition: all 0.12s;
}
.topnav__src:hover {
  color: var(--accent);
  border-color: var(--accent);
  text-decoration: none;
}
.topnav__theme {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.topnav__theme-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 26px;
  border-radius: 4px;
  color: var(--text-tertiary);
}
.topnav__theme-btn--on {
  background: var(--accent-soft);
  color: var(--accent);
}

@media (max-width: 960px) {
  .topnav__menu {
    display: inline-flex;
  }
  .topnav__search {
    max-width: none;
    flex: 1;
  }
  .topnav__search-text,
  .topnav__kbd {
    display: none;
  }
  .topnav__src-text {
    display: none;
  }
  .topnav__src {
    padding: 0 8px;
  }
  .topnav__name {
    display: none;
  }
}
</style>
