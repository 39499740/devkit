<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { localizeJsonMessage } from '~/utils/json'

defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()
const transfer = useTransfer()

/* ---------------- 输入与参数 ---------------- */
const left = ref('')
const right = ref('')
const errLeft = ref('')
const errRight = ref('')
// JSON 对象语义上无序：默认忽略键顺序；数组顺序默认有意义，必须显式开启才忽略
const ignoreKeyOrder = ref(true)
const ignoreArrayOrder = ref(false)

interface DiffEntry {
  kind: 'add' | 'del' | 'mod'
  path: string
  oldVal: string
  newVal: string
  note: string
  pair?: string // 忽略数组顺序时按内容配对的下标说明
}
const KIND_LABEL = { add: '新增', del: '删除', mod: '修改' } as const

const diffs = ref<DiffEntry[]>([])
const activeIdx = ref(-1)
const listRef = ref<HTMLElement>()
const replaceAsk = ref<{ text: string; from: string } | null>(null)

const SAMPLE_LEFT = `{
  "version": "2.1.0",
  "roles": ["admin", "editor", "viewer"],
  "config": {
    "theme": "dark",
    "timeout": 30,
    "features": { "beta": false, "export": true }
  }
}`
const SAMPLE_RIGHT = `{
  "config": {
    "theme": "dark",
    "timeout": 45,
    "features": { "beta": true, "export": true, "import": true }
  },
  "version": "2.2.0",
  "roles": ["viewer", "admin", "editor"],
  "owner": "ops-team"
}`

const sig = () => JSON.stringify([left.value, right.value, ignoreKeyOrder.value, ignoreArrayOrder.value])
const run = useToolRun(sig)

/* ---------------- 值的展示与类型 ---------------- */
function typeOf(v: unknown): string {
  if (v instanceof RawNumber) return 'number'
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v === 'object' ? 'object' : typeof v
}

function displayVal(v: unknown): string {
  if (v instanceof RawNumber) return v.raw
  if (v === null) return 'null'
  const t = typeof v
  if (t === 'string') return JSON.stringify(v)
  if (t === 'boolean' || t === 'number') return String(v)
  if (t === 'object') {
    const s = minifyJson(v)
    return s.length > 60 ? s.slice(0, 57) + '…' : s
  }
  return String(v)
}

/** 数字原文的有效位数（去掉符号 / 小数点 / 指数部分） */
function sigDigits(raw: string): number {
  const m = /^[-+]?([0-9]*)\.?([0-9]*)/.exec(raw)
  const s = ((m?.[1] ?? '') + (m?.[2] ?? '')).replace(/^0+/, '')
  return s.length
}

/** 大整数安全的数字等值判断：原文相同，或双方有效数字 ≤15 且数值相等 */
function numEqual(aRaw: string, bRaw: string): boolean {
  if (aRaw === bRaw) return true
  const a = Number(aRaw)
  const b = Number(bRaw)
  return Number.isFinite(a) && Number.isFinite(b) && a === b && sigDigits(aRaw) <= 15 && sigDigits(bRaw) <= 15
}

/* ---------------- 深度相等（受忽略选项影响） ---------------- */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a instanceof RawNumber && b instanceof RawNumber) return numEqual(a.raw, b.raw)
  if (a instanceof RawNumber || b instanceof RawNumber) return false
  if (a === null || b === null) return a === b
  const ta = typeof a
  const tb = typeof b
  if (ta !== 'object' || tb !== 'object') return ta === tb && a === b
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false
  if (aArr && bArr) {
    const arrA = a as unknown[]
    const arrB = b as unknown[]
    if (arrA.length !== arrB.length) return false
    if (!ignoreArrayOrder.value) return arrA.every((x, i) => deepEqual(x, arrB[i]))
    // 多重集合匹配：每个 A 元素都能在 B 中找到未配对的相等元素
    const used = new Array<boolean>(arrB.length).fill(false)
    for (const x of arrA) {
      let hit = false
      for (let j = 0; j < arrB.length; j++) {
        if (!used[j] && deepEqual(x, arrB[j])) {
          used[j] = true
          hit = true
          break
        }
      }
      if (!hit) return false
    }
    return true
  }
  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const ka = Object.keys(objA)
  const kb = Object.keys(objB)
  if (ka.length !== kb.length) return false
  for (const k of ka) {
    if (!(k in objB) || !deepEqual(objA[k], objB[k])) return false
  }
  if (!ignoreKeyOrder.value && ka.some((k, i) => k !== kb[i])) return false
  return true
}

/* ---------------- 递归结构化比较 ---------------- */
const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$\u4e00-\u9fa5]*$/
function joinKey(path: string, k: string): string {
  return SIMPLE_KEY.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`
}

function pushMod(path: string, a: unknown, b: unknown, pair: string | undefined, out: DiffEntry[], extraNote = '') {
  const ta = typeOf(a)
  const tb = typeOf(b)
  out.push({
    kind: 'mod',
    path,
    oldVal: displayVal(a),
    newVal: displayVal(b),
    note: ta === tb ? extraNote : `类型不同：${ta} → ${tb}${extraNote ? `；${extraNote}` : ''}`,
    pair
  })
}

function compare(a: unknown, b: unknown, path: string, out: DiffEntry[], pair?: string) {
  if (deepEqual(a, b)) return
  if (a instanceof RawNumber && b instanceof RawNumber) {
    pushMod(path, a, b, pair, out)
    return
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    pushMod(path, a, b, pair, out)
    return
  }
  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) {
    pushMod(path, a, b, pair, out)
    return
  }
  if (aArr && bArr) {
    compareArrays(a as unknown[], b as unknown[], path, out)
    return
  }
  compareObjects(a as Record<string, unknown>, b as Record<string, unknown>, path, out)
}

function compareObjects(a: Record<string, unknown>, b: Record<string, unknown>, path: string, out: DiffEntry[]) {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  // 忽略对象键顺序关闭时：两侧共有键的出现顺序不同 → 报告一处「键顺序」修改
  if (!ignoreKeyOrder.value) {
    const setB = new Set(kb)
    const commonA = ka.filter((k) => setB.has(k))
    const setA = new Set(ka)
    const commonB = kb.filter((k) => setA.has(k))
    if (commonA.join('\u0000') !== commonB.join('\u0000')) {
      out.push({
        kind: 'mod',
        path,
        oldVal: '',
        newVal: '',
        note: `键顺序不同：${commonA.join(', ')} → ${commonB.join(', ')}`
      })
    }
  }
  for (const k of ka) {
    if (!(k in b)) out.push({ kind: 'del', path: joinKey(path, k), oldVal: displayVal(a[k]), newVal: '', note: '' })
  }
  for (const k of kb) {
    if (!(k in a)) out.push({ kind: 'add', path: joinKey(path, k), oldVal: '', newVal: displayVal(b[k]), note: '' })
  }
  for (const k of ka) {
    if (k in b) compare(a[k], b[k], joinKey(path, k), out)
  }
}

function compareArrays(a: unknown[], b: unknown[], path: string, out: DiffEntry[]) {
  if (!ignoreArrayOrder.value) {
    // 数组顺序有意义：按下标逐一比较
    const n = Math.max(a.length, b.length)
    for (let i = 0; i < n; i++) {
      const p = `${path}[${i}]`
      if (i >= a.length) out.push({ kind: 'add', path: p, oldVal: '', newVal: displayVal(b[i]), note: '右侧多出的元素' })
      else if (i >= b.length) out.push({ kind: 'del', path: p, oldVal: displayVal(a[i]), newVal: '', note: '左侧多出的元素' })
      else compare(a[i], b[i], p, out)
    }
    return
  }
  // 忽略数组顺序：先按深度相等配对，剩余元素按出现顺序两两比较
  const usedB = new Array<boolean>(b.length).fill(false)
  const matchedA = new Array<boolean>(a.length).fill(false)
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (!usedB[j] && deepEqual(a[i], b[j])) {
        usedB[j] = true
        matchedA[i] = true
        break
      }
    }
  }
  const remA: number[] = []
  const remB: number[] = []
  for (let i = 0; i < a.length; i++) if (!matchedA[i]) remA.push(i)
  for (let j = 0; j < b.length; j++) if (!usedB[j]) remB.push(j)
  const pairs = Math.min(remA.length, remB.length)
  for (let n = 0; n < pairs; n++) {
    const i = remA[n]!
    const j = remB[n]!
    compare(a[i], b[j], `${path}[${i}]`, out, `按内容配对：左[${i}] ↔ 右[${j}]`)
  }
  for (let n = pairs; n < remA.length; n++) {
    const i = remA[n]!
    out.push({ kind: 'del', path: `${path}[${i}]`, oldVal: displayVal(a[i]), newVal: '', note: '仅左侧存在' })
  }
  for (let n = pairs; n < remB.length; n++) {
    const j = remB[n]!
    out.push({ kind: 'add', path: `${path}[${j}]`, oldVal: '', newVal: displayVal(b[j]), note: '仅右侧存在' })
  }
}

/* ---------------- 执行 ---------------- */
function execute() {
  errLeft.value = ''
  errRight.value = ''
  diffs.value = []
  activeIdx.value = -1
  if (!left.value.trim() && !right.value.trim()) {
    run.markIdle()
    return
  }
  let a: unknown
  let b: unknown
  if (!left.value.trim()) {
    errLeft.value = '输入为空，请提供要比较的 JSON'
  } else {
    try {
      a = parseJson(left.value).value
    } catch (e) {
      const pos = jsonErrorPosition(e, left.value)
      errLeft.value = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : localizeJsonMessage(errMessage(e))
    }
  }
  if (!right.value.trim()) {
    errRight.value = '输入为空，请提供要比较的 JSON'
  } else {
    try {
      b = parseJson(right.value).value
    } catch (e) {
      const pos = jsonErrorPosition(e, right.value)
      errRight.value = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : localizeJsonMessage(errMessage(e))
    }
  }
  if (errLeft.value || errRight.value) {
    run.markFail(
      [errLeft.value && `左侧 JSON 无效：${errLeft.value}`, errRight.value && `右侧 JSON 无效：${errRight.value}`]
        .filter(Boolean)
        .join('；')
    )
    return
  }
  const out: DiffEntry[] = []
  compare(a, b, '$', out)
  diffs.value = out
  const c = { add: 0, del: 0, mod: 0 }
  for (const d of out) c[d.kind]++
  run.markOk(
    out.length
      ? `共 ${out.length} 处差异：新增 ${c.add} · 删除 ${c.del} · 修改 ${c.mod}`
      : '结构一致：在当前比较选项下两侧 JSON 没有差异'
  )
}

watch([ignoreKeyOrder, ignoreArrayOrder], execute)

function nextDiff() {
  if (!diffs.value.length) return
  activeIdx.value = (activeIdx.value + 1) % diffs.value.length
  nextTick(() => {
    const el = listRef.value?.querySelector(`[data-idx="${activeIdx.value}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

function reportLine(d: DiffEntry): string {
  const head = `[${KIND_LABEL[d.kind]}] ${d.path}`
  let tail: string
  if (d.kind === 'add') tail = `+ ${d.newVal}`
  else if (d.kind === 'del') tail = `- ${d.oldVal}`
  else if (!d.newVal && !d.oldVal) tail = d.note
  else tail = `${d.oldVal} -> ${d.newVal}${d.note ? `（${d.note}）` : ''}`
  return `${head}  ${tail}${d.pair ? `（${d.pair}）` : ''}`
}

const statusMeta = computed(() => {
  if (!diffs.value.length) return []
  const base = [`差异 ${diffs.value.length} 处`]
  if (activeIdx.value >= 0) base.push(`${activeIdx.value + 1}/${diffs.value.length}`)
  return base
})

async function copyReport() {
  if (!diffs.value.length) return
  await clipboard.copy(diffs.value.map((d, i) => `${String(i + 1).padStart(2, ' ')}. ${reportLine(d)}`).join('\n'), '差异报告')
}

function loadSample() {
  left.value = SAMPLE_LEFT
  right.value = SAMPLE_RIGHT
  execute()
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/* G01：接收来自其他工具的内存传递；已有输入时先确认 */
onMounted(() => {
  const p = transfer.take('json-diff')
  if (p && p.from !== 'json-diff') {
    if (left.value.trim()) replaceAsk.value = { text: p.text, from: p.from }
    else applyIncoming(p.text)
  }
})

function applyIncoming(text: string) {
  left.value = text
  replaceAsk.value = null
  execute()
}
</script>

<template>
  <div class="t02">
    <div class="t02__toolbar">
      <span class="t02__opt" title="JSON 对象在语义上无序：开启后键顺序不同不算差异（默认开启）">
        <DkCheckbox v-model="ignoreKeyOrder" label="忽略对象键顺序" />
      </span>
      <span class="t02__opt" title="数组的顺序通常有意义：默认逐下标比较，开启后按内容配对（多重集合）比较">
        <DkCheckbox v-model="ignoreArrayOrder" label="忽略数组顺序" />
      </span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" title="以文本形式复制全部差异" :disabled="!diffs.length || run.status.value !== 'ok'" @click="copyReport">
        <DkIcon name="copy" :size="12" />复制报告
      </DkButton>
      <DkButton size="sm" :disabled="!diffs.length" title="循环定位到下一处差异" @click="nextDiff">
        <DkIcon name="arrow-right" :size="12" />下一处差异
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />比较差异
      </DkButton>
      <span class="t02__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="statusMeta"
      :retry="execute"
    />

    <div class="t02__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="left"
            lang="JSON A（左侧）"
            placeholder="粘贴左侧 JSON，或点击「载入示例」"
            :error="errLeft"
            :height="'calc(44vh - 60px)'"
            filename="left.json"
          />
        </template>
        <template #right>
          <DkEditor
            v-model="right"
            lang="JSON B（右侧）"
            placeholder="粘贴右侧 JSON"
            :error="errRight"
            :height="'calc(44vh - 60px)'"
            filename="right.json"
          />
        </template>
      </SplitPanes>
    </div>

    <div ref="listRef" class="t02__result">
      <div v-if="run.status.value === 'ok' && !diffs.length" class="t02__empty t02__empty--ok">
        <DkIcon name="check" :size="14" />结构一致：在当前比较选项下两侧 JSON 没有差异
      </div>
      <div v-else-if="!diffs.length" class="t02__empty tertiary">
        比较后将在此列出差异（路径、类型与值的变化），点击「下一处差异」可循环定位。
      </div>
      <div
        v-for="(d, i) in diffs"
        :key="i"
        :data-idx="i"
        class="t02__row"
        :class="[`t02__row--${d.kind}`, { 't02__row--active': i === activeIdx }]"
        @click="activeIdx = i"
      >
        <span class="t02__badge" :class="`t02__badge--${d.kind}`">
          <DkIcon :name="d.kind === 'add' ? 'plus' : d.kind === 'del' ? 'minus' : 'swap'" :size="11" />
          {{ KIND_LABEL[d.kind] }}
        </span>
        <span class="t02__path mono">{{ d.path }}</span>
        <span v-if="d.pair" class="t02__pair">{{ d.pair }}</span>
        <span class="t02__vals mono">
          <template v-if="d.kind === 'add'">+ {{ d.newVal }}</template>
          <template v-else-if="d.kind === 'del'">- {{ d.oldVal }}</template>
          <template v-else>
            <template v-if="d.oldVal || d.newVal">{{ d.oldVal }} <span class="t02__arrow">→</span> {{ d.newVal }}</template>
            <span v-if="d.note" class="t02__note">{{ d.note }}</span>
          </template>
        </span>
      </div>
    </div>

    <DkModal :open="!!replaceAsk" title="替换左侧输入？" width="420px" @close="replaceAsk = null">
      <p>
        来自其他工具的结果准备发送到本工具的左侧输入，但左侧已有内容。
        替换后原输入将丢失（不会自动保存）。
      </p>
      <template #footer>
        <DkButton size="sm" @click="replaceAsk = null">保留当前输入</DkButton>
        <DkButton size="sm" variant="primary" @click="replaceAsk && applyIncoming(replaceAsk.text)">替换并比较</DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.t02 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t02__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t02__opt {
  display: inline-flex;
}
.t02__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t02__panes {
  min-height: 300px;
}
.t02__result {
  max-height: 250px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.t02__empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 12px;
  font-size: 13px;
  color: var(--text-tertiary);
}
.t02__empty--ok {
  color: var(--ok);
}
.t02__row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.6;
  cursor: pointer;
  flex-wrap: wrap;
  border: 1px solid transparent;
}
.t02__row:hover {
  background: var(--surface-hover);
}
.t02__row--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.t02__badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
  align-self: center;
}
.t02__badge--add {
  color: var(--ok);
  background: var(--ok-soft);
}
.t02__badge--del {
  color: var(--error);
  background: var(--error-soft);
}
.t02__badge--mod {
  color: var(--warn);
  background: var(--warn-soft);
}
.t02__path {
  color: var(--text-primary);
  font-size: var(--code-font-size);
  word-break: break-all;
}
.t02__row--add .t02__path {
  color: var(--ok);
}
.t02__row--del .t02__path {
  color: var(--error);
}
.t02__row--mod .t02__path {
  color: var(--warn);
}
.t02__pair {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
}
.t02__vals {
  color: var(--text-secondary);
  font-size: var(--code-font-size);
  word-break: break-all;
  min-width: 0;
}
.t02__row--add .t02__vals {
  color: var(--ok);
}
.t02__row--del .t02__vals {
  color: var(--error);
}
.t02__row--mod .t02__vals {
  color: var(--warn);
}
.t02__arrow {
  color: var(--text-tertiary);
}
.t02__note {
  color: var(--text-secondary);
}
</style>
