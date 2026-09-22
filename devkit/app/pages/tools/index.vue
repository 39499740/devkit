<script setup lang="ts">
import { categories, toolsOfCategory, toolCount } from '~/data/tools'

useSeo({
  title: computed(() => `全部工具 - ${toolCount} 个本地开发者工具目录 | DevKit`),
  description: `DevKit 全部 ${toolCount} 个在线开发者工具目录，按 ${categories.length} 个分类列出：JSON、编码、摘要加密、国密、时间、Java、前端、文件处理。免注册免登录，全部在浏览器本地运行，输入不上传，可离线使用。`
})

const palette = usePalette()

/** 跳转锚点：标题设了 scroll-margin-top，不会被吸顶导航盖住 */
function jumpTo(key: string) {
  document.getElementById(`cat-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<template>
  <div class="all">
    <header class="all__head">
      <span class="all__head-icon">
        <DkIcon name="grid" :size="17" />
      </span>
      <div class="all__head-text">
        <h1 class="all__title">全部工具</h1>
        <p class="all__sub">
          {{ toolCount }} 个工具 · {{ categories.length }} 个分类 ·
          解析、转换与加解密全部在你的浏览器里完成
        </p>
      </div>
      <span class="grow"></span>
      <span class="all__badge">
        <DkIcon name="shield-check" :size="13" />
        本地处理 · 输入不上传
      </span>
      <button class="all__search" type="button" aria-label="搜索工具" @click="palette.show()">
        <DkIcon name="search" :size="14" />
        搜索工具
        <kbd class="all__kbd">⌘K</kbd>
      </button>
    </header>

    <nav class="all__jump" aria-label="分类跳转">
      <button
        v-for="cat in categories"
        :key="cat.key"
        class="all__jumpitem"
        type="button"
        @click="jumpTo(cat.key)"
      >
        <span class="all__jumpdot" :style="{ background: `var(--cat-${cat.key})` }"></span>
        {{ cat.name }}
        <span class="all__jumpcount">{{ toolsOfCategory(cat.key).length }}</span>
      </button>
    </nav>

    <section v-for="cat in categories" :id="`cat-${cat.key}`" :key="cat.key" class="all__cat">
      <div class="all__cat-head">
        <span class="all__cat-dot" :style="{ background: `var(--cat-${cat.key})` }"></span>
        <h2 class="all__cat-name">{{ cat.name }}</h2>
        <span class="all__cat-meta">
          {{ toolsOfCategory(cat.key).length }} 个工具 · {{ cat.desc }}
        </span>
        <NuxtLink :to="`/category/${cat.key}`" class="all__cat-more">查看分类页 →</NuxtLink>
      </div>
      <div class="all__grid">
        <ToolCard v-for="t in toolsOfCategory(cat.key)" :key="t.id" :tool="t" variant="row" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.all {
  max-width: 1680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.all__head {
  display: flex;
  align-items: center;
  gap: 11px;
  flex-wrap: wrap;
  min-height: 48px;
}
.all__head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.all__head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.all__title {
  font-size: 22px;
  font-weight: 700;
}
.all__sub {
  font-size: 13px;
  color: var(--text-secondary);
}
.all__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.all__badge :deep(svg) {
  color: var(--ok);
}
.all__search {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12.5px;
  white-space: nowrap;
}
.all__search:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.all__kbd {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-subtle);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.all__jump {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.all__jumpitem {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12.5px;
  transition: border-color 0.12s, color 0.12s;
}
.all__jumpitem:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.all__jumpdot {
  width: 7px;
  height: 7px;
  border-radius: 2px;
  flex-shrink: 0;
}
.all__jumpcount {
  font-size: 11px;
  color: var(--text-tertiary);
}
.all__cat {
  display: flex;
  flex-direction: column;
  gap: 8px;
  scroll-margin-top: calc(var(--topnav-h) + 12px);
}
.all__cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.all__cat-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.all__cat-name {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
}
.all__cat-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.all__cat-more {
  font-size: 12px;
  white-space: nowrap;
}
.all__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}
@media (max-width: 720px) {
  .all__title {
    font-size: 20px;
  }
  .all__cat-meta {
    white-space: normal;
  }
}
</style>
