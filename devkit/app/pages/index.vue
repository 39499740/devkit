<script setup lang="ts">
import { categories, toolsOfCategory, getToolById, toolCount, searchTools } from '~/data/tools'

useSeoMeta({ title: 'DevKit · 开发者本地工具箱' })

const router = useRouter()
const toast = useToast()
const palette = usePalette()
const fav = useFavorites()
const recent = useRecent()

const query = ref('')

/** 首次访问（无收藏且无历史）时展示推荐工具，不编造用户记录 */
const firstVisit = computed(
  () => fav.ids.value.length === 0 && recent.entries.value.length === 0
)

const recommended = [
  { id: 't01', reason: '最常用' },
  { id: 't22', reason: 'Java 工程' },
  { id: 't05', reason: '编码入门' },
  { id: 't18', reason: '零参数' }
].flatMap((r) => {
  const tool = getToolById(r.id)
  return tool ? [{ tool, reason: r.reason }] : []
})

const favTools = computed(() =>
  fav.ids.value.slice(0, 4).flatMap((id) => {
    const tool = getToolById(id)
    return tool ? [tool] : []
  })
)

const recentTools = computed(() =>
  recent.entries.value.slice(0, 4).flatMap((e) => {
    const tool = getToolById(e.id)
    return tool ? [{ tool, at: e.at }] : []
  })
)

const results = computed(() => searchTools(query.value))
const searching = computed(() => query.value.trim().length > 0)

function onEnter() {
  const first = results.value[0]
  if (first) router.push(`/tools/${first.slug}`)
}

function clearRecent() {
  recent.clear()
  toast.success('已清空最近使用记录')
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** 最近使用时间：只读取已存储的访问时间，不编造 */
function fmtTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60_000) return '刚刚'
  if (sameDay(d, now)) {
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}
</script>

<template>
  <div class="home">
    <header class="home__head">
      <div class="home__head-main">
        <span class="home__head-icon">
          <DkIcon name="grid" :size="17" />
        </span>
        <div class="home__head-text">
          <h1 class="home__head-title">全部工具</h1>
          <p class="home__head-sub">
            {{ toolCount }} 个开发工具 · {{ categories.length }} 个分类 ·
            解析、转换与加解密都在你的浏览器里完成
          </p>
        </div>
      </div>
      <div class="home__head-actions">
        <span class="home__badge">
          <DkIcon class="home__badge-icon" name="shield-check" :size="13" />
          本地处理 · 输入不上传
        </span>
        <NuxtLink v-if="!firstVisit" to="/settings" class="home__head-link">
          <DkIcon name="settings" :size="13" />
          偏好设置
        </NuxtLink>
        <span v-else class="home__head-first">
          <DkIcon name="star" :size="13" />
          首次访问
        </span>
      </div>
    </header>

    <div class="home__search">
      <label class="home__search-box">
        <DkIcon name="search" :size="15" />
        <input
          v-model="query"
          class="home__search-input"
          type="search"
          aria-label="搜索工具"
          placeholder="搜索工具名称、缩写或别名，例如 国密 / sm4 / base64"
          @keydown.enter.prevent="onEnter"
        />
        <button
          v-if="searching"
          class="home__search-clear"
          type="button"
          aria-label="清空搜索"
          @click="query = ''"
        >
          <DkIcon name="x" :size="13" />
        </button>
      </label>
      <button class="home__search-kbd" type="button" title="打开全局搜索" @click="palette.show()">
        ⌘K / Ctrl K
      </button>
      <span class="home__search-note">只检索工具目录，不检索已处理的输入内容</span>
    </div>

    <section v-if="searching" class="home__results">
      <div class="home__sec-head">
        <h2 class="home__sec-title">搜索结果</h2>
        <span class="home__sec-meta">{{ results.length }} 个匹配</span>
        <span class="grow"></span>
        <button class="home__sec-action" type="button" @click="query = ''">清空搜索</button>
      </div>
      <div v-if="results.length" class="home__grid">
        <ToolCard v-for="t in results" :key="t.id" :tool="t" variant="row" />
      </div>
      <p v-else class="home__empty">
        没有找到匹配「{{ query }}」的工具，试试「国密」「JSON」「Base64」。
      </p>
    </section>

    <template v-else>
      <section class="home__quick">
        <div class="home__panel">
          <div class="home__panel-head">
            <DkIcon class="home__panel-icon home__panel-icon--star" name="star" :size="14" />
            <h2 class="home__panel-title">收藏快捷</h2>
            <span class="grow"></span>
            <span class="home__panel-meta">{{ fav.ids.value.length }} / {{ toolCount }}</span>
          </div>
          <p v-if="!favTools.length" class="home__panel-empty">
            还没有收藏的工具。点击任意工具卡片右上角的星标，即可加入收藏。
          </p>
          <div v-else class="home__panel-items">
            <NuxtLink v-for="t in favTools" :key="t.id" :to="`/tools/${t.slug}`" class="home__favitem">
              <DkIcon :name="t.icon" :size="12" />
              <span class="ellipsis">{{ t.name }}</span>
            </NuxtLink>
          </div>
        </div>

        <div class="home__panel">
          <template v-if="firstVisit">
            <div class="home__panel-head">
              <DkIcon class="home__panel-icon home__panel-icon--accent" name="zap" :size="14" />
              <h2 class="home__panel-title">推荐工具</h2>
              <span class="grow"></span>
              <span class="home__panel-meta">首次访问暂无使用记录</span>
            </div>
            <div class="home__panel-items">
              <NuxtLink
                v-for="r in recommended"
                :key="r.tool.id"
                :to="`/tools/${r.tool.slug}`"
                class="home__recentitem"
              >
                <span class="home__recentitem-row">
                  <DkIcon :name="r.tool.icon" :size="12" />
                  <span class="ellipsis">{{ r.tool.name }}</span>
                </span>
                <span class="home__recentitem-sub">{{ r.reason }}</span>
              </NuxtLink>
            </div>
          </template>
          <template v-else>
            <div class="home__panel-head">
              <DkIcon class="home__panel-icon" name="history" :size="14" />
              <h2 class="home__panel-title">最近使用</h2>
              <span class="grow"></span>
              <button
                v-if="recentTools.length"
                class="home__panel-clear"
                type="button"
                @click="clearRecent"
              >
                清空记录
              </button>
            </div>
            <p v-if="!recentTools.length" class="home__panel-empty">
              还没有使用记录。打开任意工具后，这里会显示最近访问的工具与时间。
            </p>
            <div v-else class="home__panel-items">
              <NuxtLink
                v-for="r in recentTools"
                :key="r.tool.id"
                :to="`/tools/${r.tool.slug}`"
                class="home__recentitem"
              >
                <span class="home__recentitem-row">
                  <DkIcon :name="r.tool.icon" :size="12" />
                  <span class="ellipsis">{{ r.tool.name }}</span>
                </span>
                <span class="home__recentitem-sub">{{ fmtTime(r.at) }}</span>
              </NuxtLink>
            </div>
          </template>
        </div>
      </section>

      <section class="home__dir">
        <div v-for="cat in categories" :key="cat.key" class="home__cat">
          <div class="home__cat-head">
            <span class="home__cat-dot" :style="{ background: `var(--cat-${cat.key})` }"></span>
            <h2 class="home__cat-name">{{ cat.name }}</h2>
            <span class="home__cat-meta">
              {{ toolsOfCategory(cat.key).length }} 个工具 · {{ cat.desc }}
            </span>
            <NuxtLink :to="`/category/${cat.key}`" class="home__cat-more">查看全部 →</NuxtLink>
          </div>
          <div class="home__grid">
            <ToolCard v-for="t in toolsOfCategory(cat.key)" :key="t.id" :tool="t" variant="row" />
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.home {
  max-width: 1680px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.home__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
}
.home__head-main {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.home__head-icon {
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
.home__head-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.home__head-title {
  font-size: 22px;
  font-weight: 700;
}
.home__head-sub {
  font-size: 13px;
  color: var(--text-secondary);
}
.home__head-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-shrink: 0;
}
.home__badge {
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
.home__badge-icon {
  color: var(--ok);
}
.home__head-link,
.home__head-first {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
}
.home__head-link:hover {
  color: var(--accent);
  border-color: var(--accent);
  text-decoration: none;
}
.home__head-first {
  background: var(--accent-soft);
  border-color: transparent;
  color: var(--accent);
  font-weight: 500;
}
.home__search {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 60px;
  padding: 0 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.home__search-box {
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  cursor: text;
}
.home__search-box:focus-within {
  box-shadow: 0 0 0 2px var(--accent-ring);
}
.home__search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13px;
  color: var(--text-primary);
}
.home__search-input::placeholder {
  color: var(--text-tertiary);
}
.home__search-clear {
  display: inline-flex;
  color: var(--text-tertiary);
  padding: 3px;
  border-radius: 4px;
}
.home__search-clear:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.home__search-kbd {
  flex-shrink: 0;
  padding: 4px 6px;
  border-radius: 5px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.home__search-kbd:hover {
  color: var(--text-secondary);
  background: var(--surface-hover);
}
.home__search-note {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.home__results {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.home__sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.home__sec-title {
  font-size: 16px;
  font-weight: 600;
}
.home__sec-meta {
  font-size: 12px;
  color: var(--text-tertiary);
}
.home__sec-action {
  font-size: 12px;
  color: var(--accent);
  white-space: nowrap;
}
.home__sec-action:hover {
  text-decoration: underline;
}
.home__empty {
  padding: 24px 0;
  font-size: 13px;
  color: var(--text-tertiary);
}
.home__quick {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.home__panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 104px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
}
.home__panel-head {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.home__panel-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.home__panel-icon--star {
  color: var(--star);
}
.home__panel-icon--accent {
  color: var(--accent);
}
.home__panel-title {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
}
.home__panel-meta {
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--text-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.home__panel-clear {
  font-size: 11.5px;
  color: var(--accent);
  white-space: nowrap;
}
.home__panel-clear:hover {
  text-decoration: underline;
}
.home__panel-empty {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.home__panel-items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
}
.home__favitem {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 40px;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
}
.home__favitem .ellipsis {
  min-width: 0;
}
.home__favitem:hover {
  background: var(--surface-hover);
  text-decoration: none;
}
.home__recentitem {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-subtle);
}
.home__recentitem:hover {
  background: var(--surface-hover);
  text-decoration: none;
}
.home__recentitem-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}
.home__recentitem-row .ellipsis {
  min-width: 0;
}
.home__recentitem-sub {
  font-size: 11px;
  color: var(--text-tertiary);
}
.home__dir {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.home__cat {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.home__cat-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.home__cat-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.home__cat-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.home__cat-meta {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.home__cat-more {
  font-size: 12px;
  white-space: nowrap;
}
.home__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
@media (max-width: 900px) {
  .home__quick {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 820px) {
  .home__search {
    flex-wrap: wrap;
    padding: 10px 14px;
  }
  .home__search-box {
    flex-basis: 100%;
  }
  .home__search-note {
    flex: 1;
    min-width: 0;
    white-space: normal;
  }
}
@media (max-width: 720px) {
  .home__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .home__head-actions {
    flex-wrap: wrap;
  }
  .home__head-title {
    font-size: 20px;
  }
}
</style>
