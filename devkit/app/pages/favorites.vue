<script setup lang="ts">
import { getToolById, getCategory, categories } from '~/data/tools'
import type { ToolMeta } from '~/data/tools'

useSeo({
  title: '我的收藏 · DevKit',
  description: 'DevKit 里收藏的常用工具入口，收藏数据只保存在当前浏览器本地。',
  noindex: true
})

const fav = useFavorites()
const sortMode = ref<'recent' | 'name' | 'category'>('recent')
const showAvailable = ref(true)
const clearOpen = ref(false)

interface FavRow {
  id: string
  at: string | null
  tool?: ToolMeta
}

const rows = computed<FavRow[]>(() =>
  fav.entries.value.map((e) => ({ id: e.id, at: e.at, tool: getToolById(e.id) }))
)

const unavailableCount = computed(() => rows.value.filter((r) => !r.tool).length)

const displayRows = computed(() => {
  const base = showAvailable.value ? rows.value.filter((r) => r.tool) : rows.value
  const list = [...base]
  if (sortMode.value === 'name') {
    list.sort((a, b) => (a.tool?.name ?? a.id).localeCompare(b.tool?.name ?? b.id, 'zh'))
  } else if (sortMode.value === 'category') {
    const order = categories.map((c) => c.key)
    list.sort((a, b) => {
      const ai = a.tool ? order.indexOf(a.tool.cat) : order.length
      const bi = b.tool ? order.indexOf(b.tool.cat) : order.length
      if (ai !== bi) return ai - bi
      return (a.tool?.name ?? a.id).localeCompare(b.tool?.name ?? b.id, 'zh')
    })
  } else {
    list.sort((a, b) => {
      const av = a.at ? Date.parse(a.at) : NaN
      const bv = b.at ? Date.parse(b.at) : NaN
      return (Number.isNaN(bv) ? -Infinity : bv) - (Number.isNaN(av) ? -Infinity : av)
    })
  }
  return list
})

const sortLabel = computed(
  () => ({ recent: '最近收藏', name: '工具名称', category: '分类' })[sortMode.value]
)

function fmtFavTime(at: string | null) {
  if (!at) return '未知时间'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '未知时间'
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDay = Math.round((dayStart(now) - dayStart(d)) / 86400000)
  if (diffDay <= 0) return hm
  if (diffDay === 1) return `昨天 ${hm}`
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

const isEmpty = computed(() => fav.entries.value.length === 0)

const steps = computed(() =>
  isEmpty.value
    ? [
        { n: 1, title: '先浏览工具', body: '点击下方或顶部的搜索进入任意工具，首页也会列出全部分类。' },
        { n: 2, title: '收藏后回到这里', body: '收藏只在点击星标时发生，本页不会自动产生记录。' }
      ]
    : [
        { n: 1, title: '在工具页收藏', body: '点击任意工具页右上角的星标按钮即可加入收藏，再次点击取消。' },
        { n: 2, title: '在这里快速打开', body: '列表默认按最近收藏排序，也可切换为按名称或分类排序。' }
      ]
)

const faqs = computed(() =>
  isEmpty.value
    ? [
        { q: '为什么这里是空的？', a: '因为你还没有收藏任何工具；这是正常的首次访问状态，不是加载失败。' },
        { q: '收藏需要登录吗？', a: '不需要。收藏只保存在当前浏览器本地。' }
      ]
    : [
        { q: '收藏会保存我处理过的内容吗？', a: '不会。收藏只保存工具标识与收藏时间，输入、密钥、Token 都不会写入。' },
        { q: '取消收藏会删除历史记录吗？', a: '不会。收藏与“最近使用”是两套独立记录，互不影响。' }
      ]
)

function doClear() {
  fav.clear()
  clearOpen.value = false
}
</script>

<template>
  <div class="fav">
    <header class="fav__head">
      <div class="fav__title">
        <span class="fav__icon"><DkIcon name="star" :size="17" /></span>
        <div class="fav__titletext">
          <h1 class="fav__name">我的收藏</h1>
          <p class="fav__sub">收藏的工具入口与快捷打开方式；收藏只保存工具标识与收藏时间，不保存任何输入内容。</p>
        </div>
      </div>
      <div class="fav__actions">
        <NuxtLink to="/privacy" class="fav__local" title="了解本地处理与隐私">
          <DkIcon name="shield-check" :size="13" />本地处理
        </NuxtLink>
        <span class="fav__chip">
          <DkIcon name="star-filled" :size="14" />已收藏 {{ fav.entries.value.length }}
        </span>
      </div>
    </header>

    <section class="fav__workspace">
      <div class="fav__toolbar">
        <div class="fav__seg-group">
          <span class="fav__label">排序</span>
          <DkSegmented
            :model-value="sortMode"
            size="sm"
            :options="[
              { value: 'recent', label: '最近收藏' },
              { value: 'name', label: '工具名称' },
              { value: 'category', label: '分类' }
            ]"
            @update:model-value="sortMode = $event as any"
          />
        </div>
        <span class="fav__divider"></span>
        <DkCheckbox v-model="showAvailable" label="仅显示当前可用工具" />
        <span class="grow"></span>
        <span class="fav__count">共 {{ fav.entries.value.length }} 个收藏</span>
        <DkButton size="sm" :disabled="isEmpty" @click="clearOpen = true">
          <DkIcon name="trash" :size="13" />全部取消收藏
        </DkButton>
      </div>

      <div class="fav__panel">
        <div v-if="isEmpty" class="fav__empty">
          <span class="fav__empty-icon"><DkIcon name="star" :size="19" /></span>
          <p class="fav__empty-title">还没有收藏任何工具</p>
          <p class="fav__empty-hint">在工具页点击右上角星标按钮即可收藏，收藏只保存工具标识与收藏时间。</p>
          <NuxtLink to="/tools"><DkButton variant="primary" size="sm"><DkIcon name="grid" :size="13" />浏览全部工具</DkButton></NuxtLink>
          <p class="fav__empty-note">也可以用顶部搜索直接进入工具，例如“国密”“时间戳”。</p>
        </div>

        <div v-else class="fav__table" role="table" aria-label="收藏的工具">
          <div class="fav__thead" role="row">
            <span class="fav__col fav__col--tool" role="columnheader">工具</span>
            <span class="fav__col fav__col--cat" role="columnheader">分类</span>
            <span class="fav__col fav__col--time" role="columnheader">收藏时间</span>
            <span class="fav__col fav__col--ops" role="columnheader">操作</span>
          </div>
          <div class="fav__tbody" role="rowgroup">
            <p v-if="displayRows.length === 0" class="fav__noresult">
              已收藏的 {{ fav.entries.value.length }} 个工具在当前目录中无法识别，可关闭「仅显示当前可用工具」查看原始标识。
            </p>
            <div v-for="row in displayRows" :key="row.id" class="fav__row" role="row">
              <div class="fav__cell fav__cell--tool" role="cell">
                <span
                  v-if="row.tool"
                  class="fav__row-icon"
                  :style="{ background: `var(--cat-${row.tool.cat}-soft)`, color: `var(--cat-${row.tool.cat})` }"
                >
                  <DkIcon :name="row.tool.icon" :size="15" />
                </span>
                <span v-else class="fav__row-icon fav__row-icon--unknown"><DkIcon name="info" :size="15" /></span>
                <div class="fav__row-text">
                  <NuxtLink v-if="row.tool" :to="`/tools/${row.tool.slug}`" class="fav__row-name">{{ row.tool.name }}</NuxtLink>
                  <span v-else class="fav__row-name fav__row-name--unknown">无法识别的工具</span>
                  <span class="fav__row-desc">{{ row.tool ? row.tool.desc : `收藏标识：${row.id}` }}</span>
                </div>
              </div>
              <div class="fav__cell fav__cell--cat" role="cell">
                <span
                  v-if="row.tool"
                  class="fav__cat"
                  :style="{ background: `var(--cat-${row.tool.cat}-soft)`, color: `var(--cat-${row.tool.cat})` }"
                >{{ getCategory(row.tool.cat).name }}</span>
                <span v-else class="fav__cat fav__cat--unknown">已不可用</span>
              </div>
              <div class="fav__cell fav__cell--time" role="cell">
                <span class="fav__time" :title="row.at ? row.at : '旧版收藏未记录时间'">{{ fmtFavTime(row.at) }}</span>
              </div>
              <div class="fav__cell fav__cell--ops" role="cell">
                <DkIconButton title="取消收藏" @click="fav.remove(row.id)">
                  <DkIcon name="star-filled" :size="14" class="fav__star" />
                </DkIconButton>
                <NuxtLink v-if="row.tool" :to="`/tools/${row.tool.slug}`">
                  <DkButton size="sm"><DkIcon name="arrow-right" :size="13" />打开</DkButton>
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <div class="fav__status">
          <span class="fav__status-mono">收藏记录 · 本地存储</span>
          <span class="grow"></span>
          <span v-if="showAvailable && unavailableCount" class="fav__status-mono fav__status-hint">
            {{ unavailableCount }} 个收藏已不可用 · 已隐藏
          </span>
          <span class="fav__status-mono fav__status-mono--strong">
            共 {{ fav.entries.value.length }} 个收藏<span v-if="!isEmpty"> · 排序：{{ sortLabel }}</span>
          </span>
        </div>
      </div>
    </section>

    <footer class="fav__docs">
      <div class="fav__docs-cols">
        <section class="fav__docs-block">
          <h2 class="fav__docs-title"><DkIcon name="help" :size="14" />使用说明</h2>
          <div class="fav__steps">
            <div v-for="s in steps" :key="s.n" class="fav__step">
              <span class="fav__step-n">{{ s.n }}</span>
              <div class="fav__step-text">
                <p class="fav__step-title">{{ s.title }}</p>
                <p class="fav__step-body">{{ s.body }}</p>
              </div>
            </div>
          </div>
        </section>
        <section class="fav__docs-block">
          <h2 class="fav__docs-title"><DkIcon name="info" :size="14" />常见问题</h2>
          <div class="fav__faqs">
            <div v-for="f in faqs" :key="f.q" class="fav__faq">
              <p class="fav__faq-q">{{ f.q }}</p>
              <p class="fav__faq-a">{{ f.a }}</p>
            </div>
          </div>
        </section>
      </div>
    </footer>

    <DkModal :open="clearOpen" title="全部取消收藏" :danger="true" width="420px" @close="clearOpen = false">
      <p>将删除全部 {{ fav.entries.value.length }} 个工具收藏标识与收藏时间。这不影响“最近使用”记录，也不会触碰任何输入数据。</p>
      <template #footer>
        <DkButton size="sm" @click="clearOpen = false">取消</DkButton>
        <DkButton size="sm" variant="danger" @click="doClear">确认取消收藏</DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.fav {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1680px;
  margin: 0 auto;
}
.fav__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.fav__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.fav__icon {
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
.fav__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.fav__sub {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.fav__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.fav__local {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 11px;
  border-radius: 14px;
  background: var(--ok-soft);
  color: var(--ok);
  font-size: 12px;
  white-space: nowrap;
}
.fav__local:hover {
  text-decoration: none;
  filter: brightness(0.97);
}
.fav__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  font-size: 12px;
  white-space: nowrap;
}
.fav__chip :deep(svg) {
  color: var(--star);
}

.fav__workspace {
  display: flex;
  flex-direction: column;
  min-height: 420px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}
.fav__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.fav__seg-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.fav__label {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.fav__divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.fav__count {
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.fav__panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.fav__table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.fav__thead {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.fav__col {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.fav__col--tool {
  flex: 1;
  min-width: 0;
}
.fav__col--cat,
.fav__col--time {
  width: 150px;
  flex-shrink: 0;
}
.fav__col--ops {
  width: 132px;
  flex-shrink: 0;
}
.fav__tbody {
  flex: 1;
  min-height: 0;
}
.fav__noresult {
  padding: 24px 16px;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.fav__row {
  display: flex;
  align-items: center;
  min-height: 58px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.fav__row:last-child {
  border-bottom: none;
}
.fav__row:hover {
  background: var(--surface-hover);
}
.fav__cell {
  display: flex;
  align-items: center;
  min-width: 0;
}
.fav__cell--tool {
  flex: 1;
  gap: 10px;
}
.fav__cell--cat,
.fav__cell--time {
  width: 150px;
  flex-shrink: 0;
}
.fav__cell--ops {
  width: 132px;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
}
.fav__row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
}
.fav__row-icon--unknown {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.fav__row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.fav__row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.fav__row-name:hover {
  color: var(--accent);
  text-decoration: none;
}
.fav__row-name--unknown {
  color: var(--text-secondary);
}
.fav__row-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fav__cat {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.fav__cat--unknown {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.fav__time {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.fav__star {
  color: var(--star);
}
.fav__status {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 26px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.fav__status-mono {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.fav__status-mono--strong {
  color: var(--text-secondary);
}
.fav__status-hint {
  color: var(--warn);
}

.fav__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 9px;
  padding: 64px 16px;
  text-align: center;
}
.fav__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.fav__empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.fav__empty-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.fav__empty-note {
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.fav__docs {
  padding-top: 20px;
}
.fav__docs-cols {
  display: flex;
  gap: 44px;
}
.fav__docs-block {
  display: flex;
  flex-direction: column;
  gap: 13px;
  flex: 1;
  min-width: 0;
}
.fav__docs-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.fav__docs-title :deep(svg) {
  color: var(--accent);
}
.fav__steps {
  display: flex;
  gap: 22px;
}
.fav__step {
  display: flex;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.fav__step-n {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.fav__step-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.fav__step-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.fav__step-body {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.fav__faqs {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.fav__faq {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.fav__faq-q {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.fav__faq-a {
  font-size: 11.5px;
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .fav__col--cat,
  .fav__cell--cat {
    display: none;
  }
  .fav__docs-cols {
    flex-direction: column;
    gap: 24px;
  }
}
@media (max-width: 680px) {
  .fav__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .fav__col--time,
  .fav__cell--time {
    display: none;
  }
  .fav__col--ops,
  .fav__cell--ops {
    width: auto;
  }
  .fav__steps {
    flex-direction: column;
    gap: 14px;
  }
}
</style>
