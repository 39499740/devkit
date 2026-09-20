<script setup lang="ts">
import { categories, tools, toolsOfCategory, toolCount } from '~/data/tools'

const route = useRoute()
const fav = useFavorites()
const recent = useRecent()

const collapsed = ref<Record<string, boolean>>({})

const currentSlug = computed(() => {
  const m = route.path.match(/^\/tools\/([^/]+)/)
  return m?.[1] ?? ''
})
const currentTool = computed(() => tools.find((t) => t.slug === currentSlug.value))

function isActiveCat(key: string) {
  if (route.path === '/') return false
  if (currentTool.value) return currentTool.value.cat === key
  return route.path === `/category/${key}`
}
</script>

<template>
  <nav class="sidenav" aria-label="工具导航">
    <div class="sidenav__scroll">
      <NuxtLink to="/" class="sidenav__item" :class="{ 'sidenav__item--on': route.path === '/' }">
        <DkIcon name="grid" :size="15" />
        <span class="sidenav__label">全部工具</span>
        <span class="grow"></span>
        <span class="sidenav__count">{{ toolCount }}</span>
      </NuxtLink>
      <NuxtLink to="/favorites" class="sidenav__item" :class="{ 'sidenav__item--on': route.path === '/favorites' }">
        <DkIcon name="star" :size="15" />
        <span class="sidenav__label">我的收藏</span>
        <span class="grow"></span>
        <span class="sidenav__count">{{ fav.ids.value.length }}</span>
      </NuxtLink>
      <NuxtLink to="/recent" class="sidenav__item" :class="{ 'sidenav__item--on': route.path === '/recent' }">
        <DkIcon name="history" :size="15" />
        <span class="sidenav__label">最近使用</span>
        <span class="grow"></span>
        <span class="sidenav__count">{{ recent.entries.value.length }}</span>
      </NuxtLink>

      <div class="sidenav__sep" role="separator"></div>
      <p class="sidenav__group-title">工具分类</p>

      <div v-for="cat in categories" :key="cat.key" class="sidenav__cat">
        <button
          class="sidenav__cat-btn"
          :class="{ 'sidenav__cat-btn--on': isActiveCat(cat.key) }"
          :aria-expanded="!collapsed[cat.key]"
          @click="collapsed[cat.key] = !collapsed[cat.key]"
        >
          <span class="sidenav__dot" :style="{ background: `var(--cat-${cat.key})` }"></span>
          <span class="sidenav__label">{{ cat.name }}</span>
          <span class="grow"></span>
          <span class="sidenav__count">{{ toolsOfCategory(cat.key).length }}</span>
          <DkIcon
            class="sidenav__chev"
            :class="{ 'sidenav__chev--open': !collapsed[cat.key] }"
            name="chevron-down"
            :size="12"
          />
        </button>
        <div v-show="!collapsed[cat.key]" class="sidenav__sub">
          <NuxtLink
            v-for="t in toolsOfCategory(cat.key)"
            :key="t.id"
            :to="`/tools/${t.slug}`"
            class="sidenav__subitem"
            :class="{ 'sidenav__subitem--on': currentSlug === t.slug }"
          >
            <span class="sidenav__marker"></span>
            <span class="ellipsis">{{ t.name }}</span>
          </NuxtLink>
        </div>
      </div>
    </div>

    <NuxtLink to="/privacy" class="sidenav__privacy">
      <span class="sidenav__privacy-title">
        <DkIcon name="shield-check" :size="13" />
        纯本地运行
      </span>
      <span class="sidenav__privacy-text">所有计算在浏览器内完成，输入内容不会上传到服务器。</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.sidenav {
  display: flex;
  flex-direction: column;
  width: var(--sidenav-w);
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: var(--surface);
  height: 100%;
  min-height: 0;
}
.sidenav__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidenav__item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 36px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  transition: all 0.1s;
}
.sidenav__item:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
  text-decoration: none;
}
.sidenav__item--on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.sidenav__label {
  white-space: nowrap;
}
.sidenav__count {
  font-size: 11px;
  color: var(--text-tertiary);
}
.sidenav__item--on .sidenav__count {
  color: var(--accent);
}
.sidenav__sep {
  height: 1px;
  background: var(--border);
  margin: 10px 6px;
}
.sidenav__group-title {
  font-size: 11px;
  color: var(--text-tertiary);
  padding: 4px 10px 6px;
  letter-spacing: 0.4px;
}
.sidenav__cat-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 13px;
  transition: all 0.1s;
}
.sidenav__cat-btn:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.sidenav__cat-btn--on {
  color: var(--accent);
  font-weight: 500;
}
.sidenav__dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.sidenav__chev {
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.sidenav__chev--open {
  transform: rotate(0deg);
}
.sidenav__cat-btn .sidenav__chev {
  transform: rotate(-90deg);
}
.sidenav__cat-btn .sidenav__chev--open {
  transform: rotate(0deg);
}
.sidenav__sub {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0 6px 14px;
}
.sidenav__subitem {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 8px;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  transition: all 0.1s;
}
.sidenav__subitem:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
  text-decoration: none;
}
.sidenav__subitem--on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}
.sidenav__marker {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--border-strong);
  flex-shrink: 0;
}
.sidenav__subitem--on .sidenav__marker {
  background: var(--accent);
}
.sidenav__privacy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
}
.sidenav__privacy:hover {
  text-decoration: none;
}
.sidenav__privacy-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}
.sidenav__privacy-text {
  font-size: 11px;
  line-height: 1.5;
}
</style>
