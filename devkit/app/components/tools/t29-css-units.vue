<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

const props = defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()
const toast = useToast()

type Unit = 'px' | 'rem' | 'em'

const SAMPLE = `padding: 16px;
font-size: 32px;
margin: 1.5rem;
gap: 0.5em;`

const BATCH_SAMPLE = Array.from({ length: 12 }, (_, i) => {
  const px = [8, 12, 16, 20, 24, 32, 40]
  if (i < 7) return `padding: ${px[i]}px;`
  return `padding: ${['1rem', '1.25rem', '1.5rem', '2rem', '0.75em'][i - 7]};`
}).join('\n')

const rootStr = ref('16')
const parentStr = ref('20')
const decimals = ref(2)
const decimalMode = ref<'trim' | 'fixed'>('trim')
const zeroUnit = ref<'unitless' | 'unit'>('unitless')
const target = ref<Unit>('rem')

const input = ref(SAMPLE)
const checked = ref<boolean[]>([])
const fileInput = ref<HTMLInputElement>()

const unitOptions = [
  { value: 'px', label: 'px' },
  { value: 'rem', label: 'rem' },
  { value: 'em', label: 'em' }
]

// ---------- 校验 ----------
function parsePositive(s: string, label: string): { v: number; err: string } {
  const t = s.trim()
  if (t === '') return { v: 0, err: `${label}为空` }
  const v = Number(t)
  if (Number.isNaN(v)) return { v: 0, err: `${label}“${t}”不是数字` }
  if (v <= 0) return { v: 0, err: `${label}必须大于 0（当前 ${t}）` }
  return { v, err: '' }
}

const rootParsed = computed(() => parsePositive(rootStr.value, '根字号'))
const parentParsed = computed(() => parsePositive(parentStr.value, '父字号'))
const baseError = computed(() => rootParsed.value.err || parentParsed.value.err)

// ---------- 换算（真实计算） ----------
const TOKEN_RE = /(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)\b/g

interface Token {
  start: number
  raw: string
  num: number
  unit: Unit
}

function toPx(v: number, unit: Unit, root: number, parent: number): number {
  return unit === 'px' ? v : unit === 'rem' ? v * root : v * parent
}
function fromPx(px: number, unit: Unit, root: number, parent: number): number {
  return unit === 'px' ? px : unit === 'rem' ? px / root : px / parent
}
function convert(v: number, f: Unit, t: Unit, root: number, parent: number): number {
  return fromPx(toPx(v, f, root, parent), t, root, parent)
}

function fmtNum(n: number, unit: Unit): string {
  if (Math.abs(n) < 1e-9 && zeroUnit.value === 'unitless') return '0'
  if (decimalMode.value === 'fixed') return n.toFixed(decimals.value) + unit
  return String(parseFloat(n.toFixed(decimals.value))) + unit
}

function scanLine(text: string): Token[] {
  const out: Token[] = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out.push({ start: m.index, raw: m[0], num: parseFloat(m[1]!), unit: m[2] as Unit })
  }
  return out
}

const lineInfos = computed(() =>
  input.value.split('\n').map((text, index) => ({ index, text, tokens: scanLine(text) }))
)

watch(
  () => lineInfos.value.length,
  (n) => {
    const next = new Array<boolean>(n).fill(true)
    for (let i = 0; i < Math.min(n, checked.value.length); i++) next[i] = checked.value[i]!
    checked.value = next
  },
  { immediate: true }
)

const totalValues = computed(() => lineInfos.value.reduce((s, l) => s + l.tokens.length, 0))
const checkedLineCount = computed(
  () => lineInfos.value.filter((l) => l.tokens.length && checked.value[l.index] !== false).length
)
const uncheckedLineCount = computed(
  () => lineInfos.value.filter((l) => l.tokens.length && checked.value[l.index] === false).length
)
const allChecked = computed(() => uncheckedLineCount.value === 0)

interface Row {
  key: string
  lineIndex: number
  checked: boolean
  raw: string
  px: string
  rem: string
  em: string
}

const resultRows = computed<Row[]>(() => {
  if (baseError.value) return []
  const root = rootParsed.value.v
  const parent = parentParsed.value.v
  const rows: Row[] = []
  for (const li of lineInfos.value) {
    const isChecked = checked.value[li.index] !== false
    for (const tk of li.tokens) {
      const px = toPx(tk.num, tk.unit, root, parent)
      rows.push({
        key: `${li.index}:${tk.start}`,
        lineIndex: li.index,
        checked: isChecked,
        raw: tk.raw,
        px: isChecked ? fmtNum(px, 'px') : '—',
        rem: isChecked ? fmtNum(px / root, 'rem') : '—',
        em: isChecked ? fmtNum(px / parent, 'em') : '—'
      })
    }
  }
  return rows
})

const cssOut = computed(() => {
  if (baseError.value || !input.value.trim()) return ''
  const root = rootParsed.value.v
  const parent = parentParsed.value.v
  return input.value
    .split('\n')
    .map((line, i) => {
      if (checked.value[i] === false) return line
      return line.replace(TOKEN_RE, (_m, numS: string, unit: string) =>
        fmtNum(convert(parseFloat(numS), unit as Unit, target.value, root, parent), target.value)
      )
    })
    .join('\n')
})

function toggleAll() {
  const next = !allChecked.value
  checked.value = lineInfos.value.map(() => next)
}
function toggleLine(i: number) {
  const next = [...checked.value]
  next[i] = next[i] === false
  checked.value = next
}

// ---------- 复制 ----------
function tableText(onlyChecked: boolean): string {
  return resultRows.value
    .filter((r) => (onlyChecked ? r.checked : true))
    .map((r) => [r.raw, r.px, r.rem, r.em].join('\t'))
    .join('\n')
}
function copyRow(r: Row) {
  clipboard.copy([r.px, r.rem, r.em].join('\t'), `${r.raw} 的换算结果`)
}
function downloadCss() {
  if (!cssOut.value) return
  downloadText('units.css', cssOut.value, 'text/css;charset=utf-8')
}

// ---------- 状态（显式换算，改参数标待更新） ----------
const sig = () =>
  JSON.stringify([
    input.value,
    rootStr.value,
    parentStr.value,
    decimals.value,
    decimalMode.value,
    zeroUnit.value,
    target.value,
    checked.value
  ])
const run = useToolRun(sig)

function execute() {
  checked.value = lineInfos.value.map((l) => checked.value[l.index] !== false)
  if (!input.value.trim()) {
    run.markIdle()
    return
  }
  if (baseError.value) {
    run.markFail(baseError.value)
    return
  }
  const n = resultRows.value.length
  run.markOk(
    n
      ? `已换算 ${checkedLineCount.value} 行 / ${n} 个数值，跳过 ${uncheckedLineCount.value} 行；基准：根字号 ${fmtNum(rootParsed.value.v, 'px')} · 父字号 ${fmtNum(parentParsed.value.v, 'px')}`
      : '未识别到 px / rem / em 数值，输出与输入一致'
  )
}

function restoreRoot() {
  rootStr.value = '16'
  execute()
}

function loadSample() {
  input.value = SAMPLE
  rootStr.value = '16'
  parentStr.value = '20'
  execute()
}
function loadBatchSample() {
  input.value = BATCH_SAMPLE
  checked.value = BATCH_SAMPLE.split('\n').map((_, i) => i < 9)
  rootStr.value = '16'
  parentStr.value = '20'
  execute()
}
function clearInput() {
  input.value = ''
  checked.value = []
  execute()
}

async function onImportFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    input.value = await f.text()
    execute()
    toast.success(`已导入 ${f.name}`)
  } catch (err) {
    toast.warning(`读取文件失败：${errMessage(err)}`)
  }
  if (fileInput.value) fileInput.value.value = ''
}

onMounted(execute)
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="t29">
    <div class="t29__toolbar">
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="refresh" :size="12" />
        换算
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok' || !cssOut" @click="clipboard.copy(cssOut, '换算结果')">
        <DkIcon name="copy" :size="12" />
        复制结果
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok' || !cssOut" @click="downloadCss">
        <DkIcon name="download" :size="12" />
        下载 .css
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok' || !resultRows.length" @click="clipboard.copy(tableText(false), '换算表格')">
        <DkIcon name="table" :size="12" />
        复制表格
      </DkButton>
      <span class="t29__sep"></span>
      <span class="grow"></span>
      <span class="t29__kbd tertiary">⌘⏎ 换算</span>
    </div>

    <div class="t29__params">
      <div class="t29__field">
        <span class="t29__label">根字号</span>
        <div class="t29__num">
          <DkInput v-model="rootStr" mono :error="!!rootParsed.err" class="t29__num-in" />
          <span class="t29__unit">px</span>
        </div>
      </div>
      <div class="t29__field">
        <span class="t29__label">父字号</span>
        <div class="t29__num">
          <DkInput v-model="parentStr" mono :error="!!parentParsed.err" class="t29__num-in" />
          <span class="t29__unit">px</span>
        </div>
      </div>
      <div class="t29__field">
        <span class="t29__label">小数位</span>
        <DkSegmented
          size="sm"
          :model-value="String(decimals)"
          :options="[
            { value: '2', label: '2 位' },
            { value: '3', label: '3 位' },
            { value: '4', label: '4 位' }
          ]"
          @update:model-value="decimals = Number($event)"
        />
      </div>
      <div class="t29__field">
        <span class="t29__label">小数处理</span>
        <DkSegmented
          size="sm"
          :model-value="decimalMode"
          :options="[
            { value: 'trim', label: '去掉多余零' },
            { value: 'fixed', label: '固定位数' }
          ]"
          @update:model-value="decimalMode = $event as any"
        />
      </div>
      <div class="t29__field">
        <span class="t29__label">零值单位</span>
        <DkSegmented
          size="sm"
          :model-value="zeroUnit"
          :options="[
            { value: 'unitless', label: '0 不带单位' },
            { value: 'unit', label: '0px' }
          ]"
          @update:model-value="zeroUnit = $event as any"
        />
      </div>
      <div class="t29__field">
        <span class="t29__label">目标单位</span>
        <DkSegmented
          size="sm"
          :model-value="target"
          :options="unitOptions"
          @update:model-value="target = $event as any"
        />
      </div>
      <span class="grow"></span>
    </div>

    <div v-if="baseError" class="t29__tip t29__tip--err">
      <DkIcon name="alert-circle" :size="13" />
      <span>{{ baseError }}</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="restoreRoot">恢复默认 16px</DkButton>
    </div>
    <div v-else-if="uncheckedLineCount" class="t29__tip">
      <DkIcon name="alert-triangle" :size="13" />
      <span>{{ lineInfos.filter((l) => l.tokens.length).length }} 行中有 {{ uncheckedLineCount }} 行未勾选，将保持原值不参与换算；勾选状态由你控制，工具不会自动改变它。</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="toggleAll">
        <DkIcon name="list-checks" :size="12" />
        全选 {{ lineInfos.filter((l) => l.tokens.length).length }} 行
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[`根 ${fmtNum(rootParsed.v, 'px')} · 父 ${fmtNum(parentParsed.v, 'px')}`, `小数位 ${decimals}`, decimalMode === 'trim' ? '去掉多余零' : '固定位数']"
      :retry="execute"
    />

    <div class="t29__grid">
      <div class="t29__panel">
        <div class="t29__panel-head">
          <span class="t29__panel-title">输入 · CSS 值</span>
          <span class="t29__tag">逐行</span>
          <span class="grow"></span>
          <DkButton size="sm" variant="ghost" @click="loadSample">载入示例</DkButton>
          <DkButton size="sm" variant="ghost" @click="loadBatchSample">批量示例</DkButton>
          <DkButton size="sm" variant="ghost" @click="fileInput?.click()">
            <DkIcon name="upload" :size="12" />
            导入文件
          </DkButton>
          <DkButton size="sm" variant="ghost" :disabled="!input" @click="clearInput">
            <DkIcon name="trash" :size="12" />
            清空
          </DkButton>
          <input ref="fileInput" type="file" accept=".css,.txt,text/css,text/plain" class="t29__file" @change="onImportFile" />
        </div>
        <DkEditor
          v-model="input"
          lang="CSS 值文本"
          placeholder="每行一个 CSS 值，如 padding: 16px; 支持 px / rem / em"
          :height="'calc(56vh - 40px)'"
          filename="input.css"
        />
      </div>

      <div class="t29__panel">
        <div class="t29__panel-head">
          <span class="t29__panel-title">批量结果 · {{ lineInfos.filter((l) => l.tokens.length).length }} 行</span>
          <span class="t29__tag mono">根 {{ fmtNum(rootParsed.v, 'px') }} · 父 {{ fmtNum(parentParsed.v, 'px') }}</span>
          <span class="grow"></span>
          <span class="t29__hint tertiary">复制不含表头与单位说明</span>
          <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok' || !resultRows.length" @click="clipboard.copy(tableText(true), '已勾选行的数值')">
            <DkIcon name="list-checks" :size="12" />
            复制已勾选
          </DkButton>
        </div>

        <div class="t29__table">
          <div class="t29__thead">
            <span class="t29__th t29__c-raw">原值</span>
            <span class="t29__th">px（根字号 {{ fmtNum(rootParsed.v, 'px') }}）</span>
            <span class="t29__th">rem</span>
            <span class="t29__th">em（父字号 {{ fmtNum(parentParsed.v, 'px') }}）</span>
            <span class="t29__th t29__c-act"></span>
          </div>
          <div v-if="baseError" class="t29__empty">
            <DkIcon name="alert-circle" :size="18" />
            <p class="t29__empty-title">缺少有效的换算基准</p>
            <p class="tertiary">修正根字号（例如 16px）后重新换算，输入内容已保留。</p>
          </div>
          <div v-else-if="!lineInfos.some((l) => l.tokens.length)" class="t29__empty">
            <p class="tertiary">未识别到 px / rem / em 数值；请每行填写一个带单位的值，如 padding: 16px;</p>
          </div>
          <template v-else>
            <div v-for="r in resultRows" :key="r.key" class="t29__trow" :class="{ 't29__trow--off': !r.checked }">
              <span class="t29__c-raw t29__raw">
                <DkCheckbox :model-value="r.checked" @update:model-value="toggleLine(r.lineIndex)" />
                <span class="mono">{{ r.raw }}</span>
              </span>
              <span class="mono">{{ r.px }}</span>
              <span class="mono">{{ r.rem }}</span>
              <span class="mono">{{ r.em }}</span>
              <span class="t29__c-act">
                <DkIconButton title="复制该行数值" :disabled="!r.checked || run.status.value !== 'ok'" @click="copyRow(r)">
                  <DkIcon name="copy" :size="13" />
                </DkIconButton>
              </span>
            </div>
          </template>
        </div>

        <div class="t29__status">
          <span class="tertiary">基准：根字号 {{ fmtNum(rootParsed.v, 'px') }} · 父字号 {{ fmtNum(parentParsed.v, 'px') }}</span>
          <span class="grow"></span>
          <span class="tertiary">已换算 <b>{{ checkedLineCount }}</b></span>
          <span class="t29__div"></span>
          <span class="tertiary">跳过 <b>{{ uncheckedLineCount }}</b></span>
          <span class="t29__div"></span>
          <span :class="run.status.value === 'error' ? 't29__bad' : run.status.value === 'stale' ? 't29__stale' : 't29__ok'">
            {{ run.status.value === 'error' ? '换算失败' : run.status.value === 'stale' ? '待更新' : run.status.value === 'idle' ? '待输入' : '换算完成' }}
          </span>
        </div>
      </div>
    </div>

    <DkCollapse title="批量换算与勾选">
      <h4>rem 与 em 的参照不同</h4>
      <ul>
        <li><code>rem</code> 依据根字号（html font-size，这里 {{ fmtNum(rootParsed.v, 'px') }}），<code>em</code> 依据父元素字号（这里 {{ fmtNum(parentParsed.v, 'px') }}），两者不能互相替换。</li>
        <li>仅转换勾选的行，未勾选的行保持原值并在结果中显示 <code>—</code>；勾选状态由你控制，修改输入不会自动改变已勾选的行。</li>
        <li>小数位（2 / 3 / 4）与小数处理（去掉多余零 / 固定位数）直接决定结果；零值单位可选 <code>0</code> 或 <code>0px</code>。</li>
        <li>「复制结果 / 下载 .css」按当前「目标单位」重写勾选行；「复制表格 / 复制已勾选」只复制数值，不含表头与单位说明。</li>
      </ul>
      <h4>失败处理</h4>
      <p>根字号与父字号都必须是大于 0 的数字（允许小数，例如 15.5）。缺少有效基准时不执行换算，也不会输出部分结果；输入内容与参数会保留，修正后可直接重新换算。</p>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t29 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t29__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t29__sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t29__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t29__file {
  display: none;
}
.t29__params {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  padding: 8px 12px;
}
.t29__field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t29__label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t29__num {
  display: flex;
  align-items: center;
  gap: 4px;
}
.t29__num-in {
  width: 72px;
}
.t29__unit {
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.t29__tip {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--warn);
  background: var(--warn-soft);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 12px;
  color: var(--warn);
}
.t29__tip--err {
  border-color: var(--error);
  background: var(--error-soft);
  color: var(--error);
}
.t29__grid {
  display: grid;
  grid-template-columns: minmax(300px, 400px) minmax(0, 1fr);
  gap: 12px;
  min-height: 320px;
}
@media (max-width: 900px) {
  .t29__grid {
    grid-template-columns: 1fr;
  }
}
.t29__panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t29__panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-wrap: nowrap;
  overflow-x: auto;
}
.t29__panel-title {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}
.t29__tag {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--surface-subtle);
  border-radius: 6px;
  padding: 2px 8px;
  white-space: nowrap;
}
.t29__hint {
  font-size: 11.5px;
  white-space: nowrap;
}
.t29__table {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.t29__thead,
.t29__trow {
  display: grid;
  grid-template-columns: 160px 130px 120px 150px 44px;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
}
.t29__thead {
  height: 32px;
  background: var(--surface-subtle);
  position: sticky;
  top: 0;
  z-index: 1;
}
.t29__th {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t29__trow {
  height: 38px;
  border-top: 1px solid var(--border);
  font-size: 12.5px;
  color: var(--text-primary);
}
.t29__trow--off {
  color: var(--text-tertiary);
}
.t29__raw {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t29__c-act {
  display: flex;
  justify-content: flex-end;
}
.t29__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 180px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 12px;
}
.t29__empty-title {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}
.t29__status {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 28px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  font-size: 11.5px;
}
.t29__div {
  width: 1px;
  height: 12px;
  background: var(--border);
}
.t29__ok {
  color: var(--ok);
}
.t29__stale {
  color: var(--warn);
}
.t29__bad {
  color: var(--error);
}
</style>
