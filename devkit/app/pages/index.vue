<script setup lang="ts">
import { categories, toolsOfCategory, getToolById, toolCount, searchTools } from '~/data/tools'
import { scenarios, scenarioPath } from '~/data/scenarios'
import { stepDef } from '~/utils/workflow'
import { SITE_DESC, SITE_URL } from '~/utils/site'

useSeo({
  title: '本地离线开发者工具箱 - JSON、编码、加密、时间戳 | DevKit',
  description: `${toolCount} 个在线开发者工具：JSON、YAML、Base64、URL 编码、摘要加密、国密、时间戳、UUID、Java 与前端处理。免注册免登录，全部在浏览器本地运行，输入不上传服务器，可离线使用。`
})

// 结构化数据：把「Web 应用 / 免费 / 本地运行」这些真实特征写成机器可读的形式
useHead({
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'DevKit 开发者工具箱',
        url: `${SITE_URL}/`,
        description: SITE_DESC,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Web',
        browserRequirements: '需要支持 Service Worker 的现代浏览器（Chrome / Edge / Safari / Firefox）',
        inLanguage: 'zh-CN',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
        image: `${SITE_URL}/og-cover.png`,
        featureList: [
          `${toolCount} 个开发者工具，覆盖 ${categories.length} 个分类`,
          '全部计算在浏览器本地完成，输入不上传服务器',
          '多工具串联的处理流程，数据只在页面内存中传递',
          '可安装为 PWA，断网后仍可使用已缓存的工具页'
        ]
      })
    }
  ]
})

const router = useRouter()
const toast = useToast()
const palette = usePalette()
const fav = useFavorites()
const recent = useRecent()
const store = useWorkflows()

const query = ref('')
const sel = ref(0)

/** 首次访问（无收藏且无历史）时只给说明，不编造记录 */
const firstVisit = computed(
  () => fav.ids.value.length === 0 && recent.entries.value.length === 0
)

/** 常用工具：按工具自身介绍展示，不编造使用频次 */
const commonIds = ['t01', 't05', 't12', 't18', 't22', 't20']
const commonTools = computed(() =>
  commonIds.flatMap((id) => {
    const tool = getToolById(id)
    return tool ? [tool] : []
  })
)

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

/** 处理流程：入口展示会话里真实存在的流程步骤链 */
const flowPresets = computed(() =>
  store.workflows.value.slice(0, 3).map((wf) => ({
    id: wf.id,
    name: wf.name,
    chain: wf.steps.map((s) => stepDef(s.type).name).join(' → ')
  }))
)

const MAX_RESULTS = 12
const results = computed(() => searchTools(query.value))
const visibleResults = computed(() => results.value.slice(0, MAX_RESULTS))
const searching = computed(() => query.value.trim().length > 0)
const moreCount = computed(() => Math.max(0, results.value.length - MAX_RESULTS))

watch(results, () => {
  sel.value = 0
})

function scrollSelected() {
  nextTick(() => {
    document.querySelector('.home__grid .tool-card--on')?.scrollIntoView({ block: 'nearest' })
  })
}

function move(delta: number) {
  const max = visibleResults.value.length - 1
  if (max < 0) return
  sel.value = Math.min(Math.max(sel.value + delta, 0), max)
  scrollSelected()
}

function openSelected() {
  const tool = visibleResults.value[sel.value] ?? visibleResults.value[0]
  if (tool) router.push(`/tools/${tool.slug}`)
}

/** 搜索结果支持 ↑ ↓ 选择、Enter 进入、Esc 清空 */
function onSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    openSelected()
  } else if (e.key === 'Escape') {
    query.value = ''
  }
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
    <header class="home__hero">
      <div class="home__hero-main">
        <span class="home__hero-badge">
          <DkIcon name="shield-check" :size="13" />
          本地处理 · 输入不上传
        </span>
        <h1 class="home__hero-title">本地离线开发者工具箱</h1>
        <p class="home__hero-sub">
          {{ toolCount }} 个工具 · {{ categories.length }} 个分类 ·
          解析、转换与加解密全部在你的浏览器里完成，免账号、可离线使用
        </p>
      </div>
      <div class="home__hero-actions">
        <NuxtLink to="/tools" class="home__cta">
          <DkIcon name="grid" :size="13" />
          浏览全部工具
        </NuxtLink>
        <PwaInstallButton />
        <NuxtLink to="/settings" class="home__ghost">
          <DkIcon name="settings" :size="13" />
          偏好设置
        </NuxtLink>
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
          @keydown="onSearchKeydown"
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
      <span class="home__search-note">↑ ↓ 选择、Enter 进入；只检索工具目录，不检索已处理的输入</span>
    </div>

    <section v-if="searching" class="home__results">
      <div class="home__sec-head">
        <h2 class="home__sec-title">搜索结果</h2>
        <span class="home__sec-meta">{{ results.length }} 个匹配</span>
        <span class="grow"></span>
        <button class="home__sec-action" type="button" @click="query = ''">清空搜索</button>
      </div>
      <div v-if="visibleResults.length" class="home__grid">
        <ToolCard
          v-for="(t, i) in visibleResults"
          :key="t.id"
          :tool="t"
          variant="row"
          :highlight="i === sel"
        />
      </div>
      <p v-else class="home__empty">
        没有找到匹配「{{ query }}」的工具，试试「国密」「JSON」「Base64」。
      </p>
      <p v-if="moreCount" class="home__more">
        还有 {{ moreCount }} 个匹配，按 ⌘K / Ctrl K 打开全局搜索查看全部。
      </p>
    </section>

    <template v-else>
      <!-- 按任务解决：新用户的主入口，排在工具目录之前；卡片数据来自 app/data/scenarios.ts -->
      <section class="home__scenarios">
        <div class="home__sec-head">
          <h2 class="home__sec-title">你现在要解决什么</h2>
          <!-- 「新」徽标随发版轮换：本次发版新增「场景入口」，随下次发版摘除 -->
          <span class="home__flow-new" title="本次新增">新</span>
          <span class="home__sec-meta">带着具体问题进入，比先找工具更快</span>
        </div>
        <div class="home__scngrid">
          <NuxtLink
            v-for="s in scenarios"
            :key="s.slug"
            :to="scenarioPath(s)"
            class="home__scncard"
          >
            <span class="home__scncard-head">
              <span class="home__scncard-icon"><DkIcon :name="s.icon" :size="14" /></span>
              <span class="home__scncard-name">{{ s.name }}</span>
              <span class="home__scncard-steps">{{ s.steps }}</span>
            </span>
            <p class="home__scncard-problem">{{ s.problem }}</p>
            <span class="home__scncard-fact">
              <span class="home__scncard-fact-k">输入</span>
              <span class="home__scncard-fact-v">{{ s.input }}</span>
            </span>
            <span class="home__scncard-fact">
              <span class="home__scncard-fact-k">结果</span>
              <span class="home__scncard-fact-v">{{ s.output }}</span>
            </span>
            <span class="home__scncard-cta">
              开始处理
              <DkIcon name="arrow-right" :size="13" />
            </span>
          </NuxtLink>
        </div>
      </section>

      <!-- 核心差异：多工具串联，数据仍然只留在浏览器 -->
      <section class="home__flow">
        <div class="home__flow-main">
          <span class="home__flow-icon"><DkIcon name="workflow" :size="18" /></span>
          <div class="home__flow-text">
            <h2 class="home__flow-title">
              处理流程
              <span class="home__flow-new">新</span>
            </h2>
            <p class="home__flow-desc">
              把多个工具串成一条流水线：Base64 解码 → JSON 格式化 → JSONPath 提取，一次完成，全程不上传。
            </p>
          </div>
        </div>
        <div class="home__flow-presets">
          <NuxtLink v-for="wf in flowPresets" :key="wf.id" :to="`/workflows/${wf.id}`" class="home__flow-preset">
            <span class="home__flow-preset-name">{{ wf.name }}</span>
            <span class="home__flow-preset-chain ellipsis">{{ wf.chain }}</span>
          </NuxtLink>
        </div>
        <NuxtLink to="/workflows" class="home__flow-more">
          打开处理流程
          <DkIcon name="chevron-down" :size="13" class="home__flow-more-icon" />
        </NuxtLink>
      </section>

      <section class="home__quick">
        <div class="home__panel">
          <div class="home__panel-head">
            <DkIcon class="home__panel-icon home__panel-icon--star" name="star" :size="14" />
            <h2 class="home__panel-title">收藏快捷</h2>
            <span class="grow"></span>
            <NuxtLink to="/favorites" class="home__panel-more">
              {{ fav.ids.value.length }} / {{ toolCount }} · 全部收藏 →
            </NuxtLink>
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
            <NuxtLink v-else to="/recent" class="home__panel-more">全部记录 →</NuxtLink>
          </div>
          <p v-if="!recentTools.length" class="home__panel-empty">
            {{ firstVisit ? '首次访问还没有使用记录。' : '还没有使用记录。' }}
            打开任意工具后，这里会显示最近访问的工具与时间。
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
        </div>
      </section>

      <section class="home__common">
        <div class="home__sec-head">
          <h2 class="home__sec-title">常用工具</h2>
          <span class="home__sec-meta">
            高频场景入口，完整目录在
            <NuxtLink to="/tools" class="home__sec-link">全部工具</NuxtLink>
          </span>
        </div>
        <div class="home__grid">
          <ToolCard v-for="t in commonTools" :key="t.id" :tool="t" variant="row" />
        </div>
      </section>

      <section class="home__cats">
        <div class="home__sec-head">
          <h2 class="home__sec-title">按分类浏览</h2>
          <span class="home__sec-meta">{{ categories.length }} 个分类</span>
          <span class="grow"></span>
          <NuxtLink to="/tools" class="home__sec-action">查看全部 {{ toolCount }} 个工具 →</NuxtLink>
        </div>
        <div class="home__catgrid">
          <NuxtLink v-for="cat in categories" :key="cat.key" :to="`/category/${cat.key}`" class="home__catcard">
            <span class="home__catcard-head">
              <span class="home__catcard-dot" :style="{ background: `var(--cat-${cat.key})` }"></span>
              <span class="home__catcard-name">{{ cat.name }}</span>
              <span class="grow"></span>
              <span class="home__catcard-count">{{ toolsOfCategory(cat.key).length }}</span>
            </span>
            <span class="home__catcard-desc">{{ cat.desc }}</span>
            <span class="home__catcard-tools">
              <span v-for="t in toolsOfCategory(cat.key).slice(0, 3)" :key="t.id" class="home__catcard-tool ellipsis">
                {{ t.short ?? t.name }}
              </span>
              <span v-if="toolsOfCategory(cat.key).length > 3" class="home__catcard-more">
                +{{ toolsOfCategory(cat.key).length - 3 }}
              </span>
            </span>
          </NuxtLink>
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
.home__hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 4px 0 2px;
}
.home__hero-main {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.home__hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 12px;
  white-space: nowrap;
}
.home__hero-title {
  font-size: 26px;
  font-weight: 700;
  line-height: 1.25;
}
.home__hero-sub {
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.home__hero-actions {
  display: flex;
  align-items: center;
  gap: 9px;
  flex-wrap: wrap;
}
.home__cta,
.home__ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: 8px;
  font-size: 12.5px;
  white-space: nowrap;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.home__cta {
  background: var(--accent);
  color: #fff;
}
.home__cta:hover {
  text-decoration: none;
  filter: brightness(1.06);
}
.home__ghost {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
}
.home__ghost:hover {
  color: var(--accent);
  border-color: var(--accent);
  text-decoration: none;
}
.home__search {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 56px;
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
  color: var(--text-secondary);
  white-space: nowrap;
}
.home__search-kbd:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.home__search-note {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.home__results,
.home__common,
.home__cats {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.home__sec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.home__sec-title {
  font-size: 16px;
  font-weight: 600;
}
.home__sec-meta {
  font-size: 12px;
  color: var(--text-secondary);
}
.home__sec-link,
.home__sec-action {
  font-size: 12px;
  color: var(--accent);
}
.home__sec-link:hover,
.home__sec-action:hover {
  text-decoration: underline;
}
.home__empty,
.home__more {
  font-size: 13px;
  color: var(--text-secondary);
}
.home__empty {
  padding: 24px 0;
}
/* 你现在要解决什么：按任务进入的主入口，排在处理流程与工具目录之前 */
.home__scenarios {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.home__scngrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}
.home__scncard {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.home__scncard:hover {
  border-color: var(--accent-ring);
  box-shadow: var(--shadow-2);
  text-decoration: none;
}
.home__scncard-head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.home__scncard-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--accent-soft);
  color: var(--accent);
  flex-shrink: 0;
}
.home__scncard-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}
.home__scncard-steps {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.home__scncard-problem {
  font-size: 12.5px;
  color: var(--text-primary);
  line-height: 1.6;
}
.home__scncard-fact {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.55;
}
.home__scncard-fact-k {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.home__scncard-fact-v {
  min-width: 0;
  color: var(--text-secondary);
}
.home__scncard-cta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
  padding-top: 4px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--accent);
}
/* 处理流程：首页给出明确入口，与普通在线工具箱区分开 */
.home__flow {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border: 1px solid var(--accent-ring);
  border-radius: 12px;
  background: var(--accent-soft);
}
.home__flow-main {
  display: flex;
  align-items: center;
  gap: 11px;
  flex: 1;
  min-width: 260px;
}
.home__flow-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: var(--surface);
  color: var(--accent);
  flex-shrink: 0;
}
.home__flow-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.home__flow-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
}
.home__flow-new {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}
.home__flow-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.home__flow-presets {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.home__flow-preset {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 220px;
  padding: 7px 11px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--surface);
  transition: border-color 0.12s;
}
.home__flow-preset:hover {
  border-color: var(--accent);
  text-decoration: none;
}
.home__flow-preset-name {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-primary);
}
.home__flow-preset-chain {
  min-width: 0;
  font-size: 11.5px;
  color: var(--text-secondary);
}
.home__flow-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.home__flow-more-icon {
  transform: rotate(-90deg);
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
  color: var(--text-secondary);
  flex-shrink: 0;
}
.home__panel-icon--star {
  color: var(--star);
}
.home__panel-title {
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
}
.home__panel-more,
.home__panel-clear {
  min-width: 0;
  overflow: hidden;
  font-size: 11.5px;
  color: var(--accent);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.home__panel-more:hover,
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
  font-size: 11.5px;
  color: var(--text-secondary);
}
.home__catgrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}
.home__catcard {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 13px 14px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  transition: border-color 0.12s, box-shadow 0.12s;
}
.home__catcard:hover {
  border-color: var(--accent-ring);
  box-shadow: var(--shadow-2);
  text-decoration: none;
}
.home__catcard-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.home__catcard-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}
.home__catcard-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.home__catcard-count {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.home__catcard-desc {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  min-height: 38px;
}
.home__catcard-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}
.home__catcard-tool {
  min-width: 0;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
}
.home__catcard-more {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.home__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
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
  .home__hero {
    align-items: flex-start;
  }
  .home__hero-title {
    font-size: 21px;
  }
  .home__flow {
    align-items: flex-start;
  }
  .home__flow-presets {
    width: 100%;
  }
  .home__flow-preset {
    flex: 1;
    max-width: none;
    min-width: 150px;
  }
}
</style>
