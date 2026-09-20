<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

const SAMPLE_URL = 'https://api.example.com/search?q=中文&page=2&tag=vue&tag=frontend&empty=#results'

const urlInput = ref('')

interface ParamRow {
  id: number
  on: boolean
  key: string
  value: string
  /** 原参数是否带 =（裸参数如 &flag 合成时保持无 =） */
  hasEq: boolean
}

interface UrlBase {
  protocol: string
  host: string
  pathname: string
  hash: string
}

let uid = 0
const nextId = () => ++uid

const base = ref<UrlBase | null>(null)
const rows = ref<ParamRow[]>([])

const dupMode = ref<'keep' | 'merge'>('keep')
const encodeMode = ref<'auto' | 'none'>('auto')
const sortMode = ref<'original' | 'key'>('original')

const run = useToolRun(() => JSON.stringify([urlInput.value]))

const clipboard = useClipboard()

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** 解析 query（保留重复键与空值；不做 + → 空格转换，按原样百分号解码） */
function parseQuery(search: string): ParamRow[] {
  const q = search.startsWith('?') ? search.slice(1) : search
  if (!q) return []
  return q.split('&').map((part) => {
    const eq = part.indexOf('=')
    const rawK = eq >= 0 ? part.slice(0, eq) : part
    const rawV = eq >= 0 ? part.slice(eq + 1) : ''
    return { id: nextId(), on: true, key: safeDecode(rawK), value: safeDecode(rawV), hasEq: eq >= 0 }
  })
}

/** 解析 URL（仅客户端 watch 回调中执行） */
function parse() {
  if (!urlInput.value.trim()) {
    base.value = null
    rows.value = []
    run.markIdle()
    return
  }
  try {
    const u = new URL(urlInput.value.trim())
    base.value = { protocol: u.protocol, host: u.host, pathname: u.pathname, hash: u.hash }
    rows.value = parseQuery(u.search)
    const dup = duplicateKeys()
    run.markOk(dup.length ? `解析成功：${rows.value.length} 个参数，其中重复键 ${dup.map((d) => `${d}×${countOf(d)}`).join('、')}（重复键保留为独立行）` : `解析成功：${rows.value.length} 个参数`)
  } catch (e) {
    base.value = null
    rows.value = []
    run.markFail(
      `无效 URL：${errMessage(e)}。请输入完整地址（含协议，如 https://api.example.com/path?q=1），本工具只编辑 URL，不发起请求。`
    )
  }
}

function duplicateKeys(): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const r of rows.value) {
    if (seen.has(r.key)) dup.add(r.key)
    seen.add(r.key)
  }
  return [...dup]
}
function countOf(key: string): number {
  return rows.value.filter((r) => r.key === key).length
}

watch(urlInput, parse)

/* ---------------- 行编辑 ---------------- */

function addRow() {
  rows.value.push({ id: nextId(), on: true, key: '', value: '', hasEq: true })
}
function removeRow(i: number) {
  rows.value.splice(i, 1)
}
function moveRow(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= rows.value.length) return
  const arr = rows.value
  const tmp = arr[i]!
  arr[i] = arr[j]!
  arr[j] = tmp
  rows.value = [...arr]
}
function touchRow(r: ParamRow) {
  r.hasEq = true
}

/* ---------------- 合成预览（实时） ---------------- */

const enabledRows = computed(() => rows.value.filter((r) => r.on))

const outputRows = computed(() => {
  let list = enabledRows.value.slice()
  if (sortMode.value === 'key') list = [...list].sort((a, b) => a.key.localeCompare(b.key))
  if (dupMode.value !== 'merge') return list
  const seen = new Map<string, ParamRow>()
  const merged: ParamRow[] = []
  for (const r of list) {
    if (!r.key) {
      merged.push(r)
      continue
    }
    const hit = seen.get(r.key)
    if (hit) {
      hit.value = `${hit.value},${r.value}`
      hit.hasEq = true
    } else {
      const copy = { ...r }
      seen.set(r.key, copy)
      merged.push(copy)
    }
  }
  return merged
})

function activeEncode(s: string): string {
  return encodeMode.value === 'auto' ? encodeURIComponent(s) : s
}

const queryOutput = computed(() =>
  outputRows.value.map((r) => (r.hasEq ? `${activeEncode(r.key)}=${activeEncode(r.value)}` : activeEncode(r.key))).join('&')
)

const composedUrl = computed(() => {
  if (!base.value) return ''
  const b = base.value
  const path = encodeMode.value === 'auto' ? b.pathname : safeDecode(b.pathname)
  const hash = encodeMode.value === 'auto' ? b.hash : b.hash ? safeDecode(b.hash) : ''
  return `${b.protocol}${b.host ? `//${b.host}` : ''}${path}${queryOutput.value ? `?${queryOutput.value}` : ''}${hash}`
})

const mergedCount = computed(() => (dupMode.value === 'merge' ? enabledRows.value.length - outputRows.value.length : 0))

const dupCount = computed(() => duplicateKeys().length)
const emptyCount = computed(() => enabledRows.value.filter((r) => !r.value).length)

const emptyKeyHint = computed(() => (enabledRows.value.some((r) => !r.key) ? '存在 key 为空的启用行，合成结果将包含形如 =value 的参数（如需删除请取消勾选或删除该行）' : ''))

async function copyResult() {
  if (!composedUrl.value) return
  await clipboard.copy(composedUrl.value, '合成 URL')
}

function apply() {
  if (!composedUrl.value) return
  urlInput.value = composedUrl.value
}

function restore() {
  parse()
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    apply()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="t34">
    <div class="t34__toolbar">
      <span class="t34__tl">URL</span>
      <DkInput v-model="urlInput" mono placeholder="https://api.example.com/search?q=中文&page=2&tag=vue&tag=frontend&empty=#results" class="t34__url-input" />
      <DkButton size="sm" variant="ghost" @click="urlInput = SAMPLE_URL">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" @click="urlInput = ''">清空</DkButton>
    </div>

    <div class="t34__toolbar">
      <DkButton size="sm" variant="primary" :disabled="!base || run.status.value === 'error'" title="把合成结果写回 URL 输入框" @click="apply">
        <DkIcon name="check" :size="12" />
        应用修改
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!composedUrl || run.status.value === 'error'" @click="copyResult">
        <DkIcon name="copy" :size="12" />
        复制 URL
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!base" title="放弃行内编辑，按当前 URL 重新解析" @click="restore">
        <DkIcon name="refresh" :size="12" />
        还原
      </DkButton>
      <span class="t34__divider"></span>
      <span class="grow"></span>
      <span class="t34__kbd tertiary">⌘/Ctrl + Enter 应用</span>
    </div>

    <div class="t34__params">
      <div class="t34__opt">
        <span class="t34__opt-label">重复键</span>
        <DkSegmented
          size="sm"
          :model-value="dupMode"
          :options="[
            { value: 'keep', label: '保留' },
            { value: 'merge', label: '合并' }
          ]"
          @update:model-value="dupMode = $event as 'keep' | 'merge'"
        />
      </div>
      <div class="t34__opt">
        <span class="t34__opt-label">编码</span>
        <DkSegmented
          size="sm"
          :model-value="encodeMode"
          :options="[
            { value: 'auto', label: '自动' },
            { value: 'none', label: '不编码' }
          ]"
          @update:model-value="encodeMode = $event as 'auto' | 'none'"
        />
      </div>
      <div class="t34__opt">
        <span class="t34__opt-label">排序</span>
        <DkSegmented
          size="sm"
          :model-value="sortMode"
          :options="[
            { value: 'original', label: '保持原序' },
            { value: 'key', label: '按键排序' }
          ]"
          @update:model-value="sortMode = $event as 'original' | 'key'"
        />
      </div>
      <span class="grow"></span>
      <span v-if="base" class="tertiary t34__stat">重复键 {{ dupCount }} · 空值 {{ emptyCount }} · 已解析 {{ rows.length }} 个参数</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[base ? `协议 ${base.protocol.replace(':', '')}` : '', base ? `启用 ${enabledRows.length}/${rows.length} 参数` : '']"
      :retry="parse"
    />

    <p class="t34__scope tertiary">本工具只编辑 URL，不发起任何请求。</p>

    <template v-if="base">
      <div class="t34__card">
        <div class="t34__card-head">结构信息</div>
        <div class="t34__base">
          <div class="t34__base-item">
            <span class="t34__base-label">协议</span>
            <span class="mono t34__base-val">{{ base.protocol }}</span>
          </div>
          <div class="t34__base-item">
            <span class="t34__base-label">主机</span>
            <span class="mono t34__base-val">{{ base.host || '（无）' }}</span>
          </div>
          <div class="t34__base-item t34__base-item--wide">
            <span class="t34__base-label">路径</span>
            <span class="mono t34__base-val">{{ base.pathname }}</span>
          </div>
          <div class="t34__base-item">
            <span class="t34__base-label">Fragment</span>
            <span class="mono t34__base-val">{{ base.hash || '（无）' }}</span>
          </div>
        </div>
      </div>

      <div class="t34__card">
        <div class="t34__card-head">
          参数表（{{ rows.length }} 行，启用 {{ enabledRows.length }}）
          <span class="t34__card-note tertiary">默认重复键保留为独立行，选择「合并」后用逗号合并；空值参数保留；取消勾选即从合成结果中剔除</span>
        </div>
        <div class="t34__rows">
          <div v-for="(r, i) in rows" :key="r.id" class="t34__row" :class="{ 't34__row--off': !r.on }">
            <DkCheckbox v-model="r.on" :title="r.on ? '取消勾选则该参数不参与合成' : '勾选以参与合成'" />
            <DkInput v-model="r.key" mono placeholder="key" class="t34__row-key" @update:model-value="touchRow(r)" />
            <span v-if="r.hasEq" class="t34__row-eq mono">=</span>
            <span v-else class="t34__row-eq mono t34__row-eq--bare" title="原参数没有 = （裸参数），合成时保持原样">≠</span>
            <DkInput v-model="r.value" mono placeholder="value（可为空）" class="t34__row-val" @update:model-value="touchRow(r)" />
            <span class="t34__row-ops">
              <DkIconButton title="上移" :disabled="i === 0" @click="moveRow(i, -1)">
                <DkIcon name="chevron-up" :size="14" />
              </DkIconButton>
              <DkIconButton title="下移" :disabled="i === rows.length - 1" @click="moveRow(i, 1)">
                <DkIcon name="chevron-down" :size="14" />
              </DkIconButton>
              <DkIconButton title="删除该参数" @click="removeRow(i)">
                <DkIcon name="trash" :size="14" />
              </DkIconButton>
            </span>
          </div>
          <p v-if="!rows.length" class="t34__empty tertiary">当前 URL 没有 query 参数，点击下方新增。</p>
        </div>
        <div class="t34__rows-foot">
          <DkButton size="sm" variant="secondary" @click="addRow">
            <DkIcon name="plus" :size="12" />
            新增参数
          </DkButton>
          <span v-if="emptyKeyHint" class="t34__hint">{{ emptyKeyHint }}</span>
        </div>
      </div>

      <div class="t34__card">
        <div class="t34__card-head">
          合成预览（实时）
          <span class="tertiary t34__card-note">{{ encodeMode === 'auto' ? '编码：自动（UTF-8 百分号编码）' : '编码：不编码（原样拼接）' }}</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="secondary" :disabled="!composedUrl || run.status.value === 'error'" @click="copyResult">
            <DkIcon name="copy" :size="12" />
            复制编码结果
          </DkButton>
        </div>
        <div class="t34__preview">
          <div class="t34__preview-item">
            <span class="t34__preview-label">合成 URL（当前选项）</span>
            <code class="t34__preview-val">{{ composedUrl }}</code>
          </div>
          <div class="t34__preview-item">
            <span class="t34__preview-label">
              当前规则
            </span>
            <p class="t34__preview-note tertiary">
              重复键：{{ dupMode === 'merge' ? `合并（逗号连接，已合并 ${mergedCount} 条）` : '保留为独立行' }}；排序：{{ sortMode === 'key' ? '按键排序' : '保持原序' }}；编码：{{ encodeMode === 'auto' ? '仅对参数 key / value 做 encodeURIComponent，协议、主机、路径与 Fragment 维持解析所得的编码形态' : '原样输出 key / value 与路径 / Fragment，请自行确认是否需要编码' }}。「≠」标记表示原参数无 =（裸参数），编辑该行后自动转为 key=value 形式。
            </p>
          </div>
        </div>
      </div>
    </template>

    <div v-else-if="run.status.value !== 'error'" class="t34__idle tertiary">输入完整 URL 后实时解析；示例包含重复键（tag 出现两次）、空值参数（empty=）与 Fragment（#results）。</div>

    <div v-else class="t34__idle tertiary">URL 解析失败：输入内容已保留，请按上方提示修正后自动重新解析。</div>

    <DkCollapse title="重复键与编码规则">
      <ul>
        <li>同名参数（如 <code>tag</code>）默认保留为多条并按原顺序输出；选择「合并」后才会用逗号连接值，空值参数保留为 <code>key=</code>。</li>
        <li>「编码：自动」只对参数 key / value 做 <code>encodeURIComponent</code>（UTF-8 百分号编码）；「不编码」原样输出，是否编码由你确认。</li>
        <li>「按键排序」使用稳定的按键排序；同键多条保持原有相对顺序。</li>
        <li>Fragment（<code>#...</code>）不属于 query 参数，不会被打散改写。</li>
        <li>URL 只在浏览器内存中解析，不发起任何请求，也不写入本地存储。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t34 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t34__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t34__tl {
  font-size: 12px;
  color: var(--text-secondary);
}
.t34__url-input {
  flex: 1;
  min-width: 260px;
}
.t34__divider {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t34__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t34__params {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
}
.t34__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t34__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t34__stat {
  font-size: 11.5px;
}
.t34__scope {
  font-size: 12px;
  margin: -4px 0 0;
}
.t34__card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t34__card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
  flex-wrap: wrap;
}
.t34__card-note {
  font-weight: 400;
  font-size: 11.5px;
}
.t34__base {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px 16px;
  padding: 12px;
}
.t34__base-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.t34__base-item--wide {
  grid-column: span 2;
}
@media (max-width: 720px) {
  .t34__base-item--wide {
    grid-column: span 1;
  }
}
.t34__base-label {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.t34__base-val {
  font-size: 12.5px;
  color: var(--text-primary);
  word-break: break-all;
}
.t34__rows {
  padding: 6px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.t34__row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.t34__row--off {
  opacity: 0.55;
}
.t34__row-key {
  width: 30%;
  min-width: 100px;
  flex-shrink: 1;
}
.t34__row-eq {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.t34__row-eq--bare {
  color: var(--warn);
}
.t34__row-val {
  flex: 1;
  min-width: 100px;
}
.t34__row-ops {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.t34__empty {
  padding: 8px 0;
  font-size: 13px;
}
.t34__rows-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  flex-wrap: wrap;
}
.t34__hint {
  font-size: 11.5px;
  color: var(--warn);
}
.t34__preview {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.t34__preview-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.t34__preview-label {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.t34__preview-val {
  font-family: var(--font-mono);
  font-size: var(--code-font-size);
  color: var(--text-primary);
  background: var(--editor-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  word-break: break-all;
  white-space: pre-wrap;
}
.t34__preview-note {
  font-size: 11.5px;
  line-height: 1.6;
}
.t34__idle {
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  padding: 18px 16px;
  font-size: 13px;
  text-align: center;
}
</style>
