<script setup lang="ts">
import { getToolById, getCategory, categories } from '~/data/tools'
import type { ToolMeta } from '~/data/tools'

useSeo({
  title: '最近使用 · DevKit',
  description: 'DevKit 最近打开过的工具记录，只含工具名称与访问时间，保存在当前浏览器本地。',
  noindex: true
})

const recent = useRecent()
const groupMode = ref<'time' | 'category'>('time')
const clearOpen = ref(false)

type Entry = { id: string; at: string }

interface RecentRow {
  id: string
  at: string
  tool?: ToolMeta
}

interface Group {
  key: string
  label: string
  icon: string
  rows: RecentRow[]
}

function toRows(list: Entry[]): RecentRow[] {
  return list.map((e) => ({ id: e.id, at: e.at, tool: getToolById(e.id) }))
}

const groups = computed<Group[]>(() => {
  const list = recent.entries.value
  if (groupMode.value === 'time') {
    const out: Group[] = []
    const g = recent.grouped.value
    if (g.today.length) out.push({ key: 'today', label: '今天', icon: 'clock', rows: toRows(g.today) })
    if (g.earlier.length) out.push({ key: 'earlier', label: '更早', icon: 'history', rows: toRows(g.earlier) })
    return out
  }
  const out: Group[] = []
  for (const c of categories) {
    const inCat = list.filter((e) => getToolById(e.id)?.cat === c.key)
    if (inCat.length) out.push({ key: c.key, label: getCategory(c.key).name, icon: 'grid', rows: toRows(inCat) })
  }
  const unknown = list.filter((e) => !getToolById(e.id))
  if (unknown.length) out.push({ key: 'unknown', label: '已不可用', icon: 'info', rows: toRows(unknown) })
  return out
})

const isEmpty = computed(() => recent.entries.value.length === 0)

const earliest = computed(() => {
  let min = Number.POSITIVE_INFINITY
  for (const e of recent.entries.value) {
    const t = Date.parse(e.at)
    if (!Number.isNaN(t) && t < min) min = t
  }
  return Number.isFinite(min) ? new Date(min).toISOString() : null
})

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未知时间'
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDay = Math.round((dayStart(now) - dayStart(d)) / 86400000)
  if (diffDay <= 0) return hm
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

const steps = computed(() =>
  isEmpty.value
    ? [
        { n: 1, title: '打开一个工具', body: '从首页、搜索或收藏进入任意工具，就会产生一条记录。' },
        { n: 2, title: '想关掉记录？', body: '在“偏好设置 → 记录最近使用”关闭后，本页会一直保持为空。' }
      ]
    : [
        { n: 1, title: '打开过的工具会自动记录', body: '只记录工具名称与访问时间，不区分是否执行过计算。' },
        { n: 2, title: '单条移除或全部清空', body: '点击右侧“移除”删除单条，或使用工具条的“清空全部记录”。' }
      ]
)

const faqs = computed(() =>
  isEmpty.value
    ? [
        { q: '这里为空是加载失败吗？', a: '不是。这是还没有访问记录的正常状态，页面不显示错误提示。' },
        { q: '关闭记录后已存在的记录会怎样？', a: '关闭只停止新增；已有记录仍然保留，需要手动清空。' }
      ]
    : [
        { q: '会记录我处理的正文或文件名吗？', a: '不会。记录里只有工具名称与访问时间，正文、密钥、Token、文件名都不写入。' },
        { q: '清空记录会影响收藏吗？', a: '不会。收藏是独立列表，需要在“我的收藏”里单独取消。' }
      ]
)

function doClear() {
  recent.clear()
  clearOpen.value = false
}
</script>

<template>
  <div class="recent">
    <header class="recent__head">
      <div class="recent__title">
        <span class="recent__icon"><DkIcon name="history" :size="17" /></span>
        <div class="recent__titletext">
          <h1 class="recent__name">最近使用</h1>
          <p class="recent__sub">只记录工具名称与访问时间；不保存输入正文、密钥、Token 或文件名。</p>
        </div>
      </div>
      <div class="recent__actions">
        <NuxtLink to="/privacy" class="recent__local" title="了解本地处理与隐私">
          <DkIcon name="shield-check" :size="13" />本地处理
        </NuxtLink>
        <NuxtLink to="/favorites" class="recent__fav">
          <DkIcon name="star" :size="14" />收藏
        </NuxtLink>
      </div>
    </header>

    <section class="recent__workspace">
      <div class="recent__toolbar">
        <span class="recent__option">
          <DkIcon name="lock" :size="12" />只记录工具名与访问时间
        </span>
        <span class="recent__divider"></span>
        <div class="recent__seg-group">
          <span class="recent__label">分组</span>
          <DkSegmented
            :model-value="groupMode"
            size="sm"
            :options="[
              { value: 'time', label: '按时间' },
              { value: 'category', label: '按分类' }
            ]"
            @update:model-value="groupMode = $event as any"
          />
        </div>
        <span class="grow"></span>
        <span class="recent__count">共 {{ recent.entries.value.length }} 条记录</span>
        <DkButton size="sm" :disabled="isEmpty" @click="clearOpen = true">
          <DkIcon name="trash" :size="13" />清空全部记录
        </DkButton>
      </div>

      <div class="recent__panel">
        <div v-if="isEmpty" class="recent__empty">
          <span class="recent__empty-icon"><DkIcon name="history" :size="19" /></span>
          <p class="recent__empty-title">暂无访问记录</p>
          <p class="recent__empty-hint">打开任意工具后，这里会记录工具名称与访问时间。</p>
          <NuxtLink to="/tools"><DkButton variant="primary" size="sm"><DkIcon name="grid" :size="13" />浏览全部工具</DkButton></NuxtLink>
          <p class="recent__empty-note">也可以在“偏好设置”里关闭“记录最近使用”。</p>
        </div>

        <div v-else class="recent__table" role="table" aria-label="最近使用的工具">
          <div class="recent__thead" role="row">
            <span class="recent__col recent__col--tool" role="columnheader">工具</span>
            <span class="recent__col recent__col--cat" role="columnheader">分类</span>
            <span class="recent__col recent__col--time" role="columnheader">访问时间</span>
            <span class="recent__col recent__col--ops" role="columnheader">操作</span>
          </div>
          <div class="recent__tbody" role="rowgroup">
            <template v-for="g in groups" :key="g.key">
              <div class="recent__group">
                <DkIcon :name="g.icon" :size="13" />
                <span class="recent__group-label">{{ g.label }}</span>
                <span class="recent__group-count">{{ g.rows.length }}</span>
              </div>
              <div v-for="row in g.rows" :key="row.id + row.at" class="recent__row" role="row">
                <div class="recent__cell recent__cell--tool" role="cell">
                  <span
                    v-if="row.tool"
                    class="recent__row-icon"
                    :style="{ background: `var(--cat-${row.tool.cat}-soft)`, color: `var(--cat-${row.tool.cat})` }"
                  >
                    <DkIcon :name="row.tool.icon" :size="15" />
                  </span>
                  <span v-else class="recent__row-icon recent__row-icon--unknown"><DkIcon name="info" :size="15" /></span>
                  <div class="recent__row-text">
                    <NuxtLink v-if="row.tool" :to="`/tools/${row.tool.slug}`" class="recent__row-name">{{ row.tool.name }}</NuxtLink>
                    <span v-else class="recent__row-name recent__row-name--unknown">无法识别的工具</span>
                    <span class="recent__row-desc">{{ row.tool ? row.tool.desc : `记录标识：${row.id}` }}</span>
                  </div>
                </div>
                <div class="recent__cell recent__cell--cat" role="cell">
                  <span
                    v-if="row.tool"
                    class="recent__cat"
                    :style="{ background: `var(--cat-${row.tool.cat}-soft)`, color: `var(--cat-${row.tool.cat})` }"
                  >{{ getCategory(row.tool.cat).name }}</span>
                  <span v-else class="recent__cat recent__cat--unknown">已不可用</span>
                </div>
                <div class="recent__cell recent__cell--time" role="cell">
                  <span class="recent__time" :title="row.at">{{ fmtTime(row.at) }}</span>
                </div>
                <div class="recent__cell recent__cell--ops" role="cell">
                  <DkIconButton title="移除记录" @click="recent.remove(row.id)">
                    <DkIcon name="x" :size="14" />
                  </DkIconButton>
                </div>
              </div>
            </template>
          </div>
        </div>

        <div class="recent__status">
          <span class="recent__status-mono">最近使用 · 本地存储</span>
          <span class="grow"></span>
          <span class="recent__status-mono recent__status-mono--strong">
            {{ isEmpty ? '0 条记录' : `共 ${recent.entries.value.length} 条记录 · 最早 ${fmtTime(earliest!)}` }}
          </span>
        </div>
      </div>
    </section>

    <footer class="recent__docs">
      <div class="recent__docs-cols">
        <section class="recent__docs-block">
          <h2 class="recent__docs-title"><DkIcon name="help" :size="14" />使用说明</h2>
          <div class="recent__steps">
            <div v-for="s in steps" :key="s.n" class="recent__step">
              <span class="recent__step-n">{{ s.n }}</span>
              <div class="recent__step-text">
                <p class="recent__step-title">{{ s.title }}</p>
                <p class="recent__step-body">{{ s.body }}</p>
              </div>
            </div>
          </div>
        </section>
        <section class="recent__docs-block">
          <h2 class="recent__docs-title"><DkIcon name="info" :size="14" />常见问题</h2>
          <div class="recent__faqs">
            <div v-for="f in faqs" :key="f.q" class="recent__faq">
              <p class="recent__faq-q">{{ f.q }}</p>
              <p class="recent__faq-a">{{ f.a }}</p>
            </div>
          </div>
        </section>
      </div>
    </footer>

    <DkModal :open="clearOpen" title="清空全部记录" :danger="true" width="420px" @close="clearOpen = false">
      <p>将删除最近使用列表（仅含工具名称与访问时间）。不影响收藏和偏好设置，也不会触碰任何输入数据。</p>
      <template #footer>
        <DkButton size="sm" @click="clearOpen = false">取消</DkButton>
        <DkButton size="sm" variant="danger" @click="doClear">确认清空</DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.recent {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1680px;
  margin: 0 auto;
}
.recent__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.recent__title {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.recent__icon {
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
.recent__name {
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
}
.recent__sub {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.recent__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.recent__local {
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
.recent__local:hover {
  text-decoration: none;
  filter: brightness(0.97);
}
.recent__fav {
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
.recent__fav:hover {
  border-color: var(--accent);
  color: var(--accent);
  text-decoration: none;
}

.recent__workspace {
  display: flex;
  flex-direction: column;
  min-height: 420px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface);
  overflow: hidden;
}
.recent__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.recent__option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 9px;
  border-radius: 6px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11.5px;
  white-space: nowrap;
}
.recent__divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.recent__seg-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.recent__label {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.recent__count {
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.recent__panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.recent__table {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.recent__thead {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.recent__col {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}
.recent__col--tool {
  flex: 1;
  min-width: 0;
}
.recent__col--cat,
.recent__col--time {
  width: 150px;
  flex-shrink: 0;
}
.recent__col--ops {
  width: 132px;
  flex-shrink: 0;
}
.recent__tbody {
  flex: 1;
  min-height: 0;
}
.recent__group {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.recent__group-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
}
.recent__group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 7px;
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-tertiary);
  font-size: 10.5px;
}
.recent__row {
  display: flex;
  align-items: center;
  min-height: 58px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
}
.recent__row:last-child {
  border-bottom: none;
}
.recent__row:hover {
  background: var(--surface-hover);
}
.recent__cell {
  display: flex;
  align-items: center;
  min-width: 0;
}
.recent__cell--tool {
  flex: 1;
  gap: 10px;
}
.recent__cell--cat,
.recent__cell--time {
  width: 150px;
  flex-shrink: 0;
}
.recent__cell--ops {
  width: 132px;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 8px;
}
.recent__row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
}
.recent__row-icon--unknown {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.recent__row-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.recent__row-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.recent__row-name:hover {
  color: var(--accent);
  text-decoration: none;
}
.recent__row-name--unknown {
  color: var(--text-secondary);
}
.recent__row-desc {
  font-size: 11.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent__cat {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.recent__cat--unknown {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.recent__time {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.recent__status {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 26px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.recent__status-mono {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}
.recent__status-mono--strong {
  color: var(--text-secondary);
}

.recent__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 9px;
  padding: 64px 16px;
  text-align: center;
}
.recent__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.recent__empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.recent__empty-hint {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.recent__empty-note {
  font-size: 11.5px;
  color: var(--text-tertiary);
}

.recent__docs {
  padding-top: 20px;
}
.recent__docs-cols {
  display: flex;
  gap: 44px;
}
.recent__docs-block {
  display: flex;
  flex-direction: column;
  gap: 13px;
  flex: 1;
  min-width: 0;
}
.recent__docs-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.recent__docs-title :deep(svg) {
  color: var(--accent);
}
.recent__steps {
  display: flex;
  gap: 22px;
}
.recent__step {
  display: flex;
  gap: 10px;
  flex: 1;
  min-width: 0;
}
.recent__step-n {
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
.recent__step-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.recent__step-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.recent__step-body {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.recent__faqs {
  display: flex;
  flex-direction: column;
  gap: 13px;
}
.recent__faq {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.recent__faq-q {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
}
.recent__faq-a {
  font-size: 11.5px;
  color: var(--text-secondary);
}

@media (max-width: 900px) {
  .recent__col--cat,
  .recent__cell--cat {
    display: none;
  }
  .recent__docs-cols {
    flex-direction: column;
    gap: 24px;
  }
}
@media (max-width: 680px) {
  .recent__head {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .recent__col--time,
  .recent__cell--time {
    display: none;
  }
  .recent__col--ops,
  .recent__cell--ops {
    width: auto;
  }
  .recent__steps {
    flex-direction: column;
    gap: 14px;
  }
}
</style>
