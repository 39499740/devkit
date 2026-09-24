<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { parseJson, jsonErrorPosition, localizeJsonMessage, RawNumber } from '~/utils/json'

const props = defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()
const toast = useToast()

type Kind = 'interface' | 'type'
type OptionalStrategy = 'keep' | 'all' | 'required'
type DateStrategy = 'string' | 'date'
type ArrStrategy = 'unknown' | 'any' | 'manual'
type ObjStrategy = 'record' | 'braces'
type UnionStrategy = 'union' | 'first'

const input = ref('')
const output = ref('')
const kind = ref<Kind>('interface')
const rootName = ref('Root')
const optStrategy = ref<OptionalStrategy>('keep')
const ro = ref(false)
const dateStrategy = ref<DateStrategy>('string')
const arrStrategy = ref<ArrStrategy>('unknown')
const objStrategy = ref<ObjStrategy>('record')
const unionStrategy = ref<UnionStrategy>('union')

const overrides = ref<Record<string, string>>({})
const candidates = ref<{ path: string; reason: string; current: string }[]>([])
const warnings = ref<string[]>([])
const notes = ref<string[]>([])
const errDetail = ref('')

const adjustOpen = ref(false)
const draft = ref<Record<string, string>>({})
const fileInput = ref<HTMLInputElement>()

const SAMPLE = `{"id":1000000000000000001,"name":"陈立","createdAt":"2024-01-01T09:00:00Z","active":true,"email":null,"flags":[true,1,0],"tags":[],"meta":{},"scores":[1,"a"],"address":{"city":"杭州","zip":"310000","geo":{"lat":30.2741,"lng":120.1551}}}`

// ---------- 类型生成（真实推断，无猜测） ----------
const TS_RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'as implements interface let package private protected public static yield ' +
    'any bigint boolean never number object string symbol undefined unknown declare namespace module type readonly keyof infer override out satisfies asserts is unique from global get set'
  )
    .split(' ')
    .filter(Boolean)
)

function isValidIdent(s: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)
}

function pascal(hint: string): string {
  const parts = String(hint)
    .split(/[^A-Za-z0-9$]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
  let n = parts.join('')
  if (!n) n = 'Nested'
  if (/^[0-9]/.test(n)) n = 'I' + n
  return n
}

function propName(k: string): string {
  return isValidIdent(k) ? k : JSON.stringify(k)
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof RawNumber)
}

const DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** 顶层联合：仅在括号 / 泛型之外的 | 处切分 */
function splitUnion(t: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of t) {
    if (c === '<' || c === '(') depth++
    else if (c === '>' || c === ')') depth--
    if (c === '|' && depth === 0) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}

function mergeTypes(types: string[]): string {
  const order: string[] = []
  for (const t of types) {
    for (const p of splitUnion(t)) if (!order.includes(p)) order.push(p)
  }
  if (!order.length) return 'unknown'
  if (order.includes('unknown')) return 'unknown'
  if (order.length === 1) return order[0]!
  return order.join(' | ')
}

function wrapElem(t: string): string {
  return splitUnion(t).length > 1 ? `(${t})[]` : `${t}[]`
}

interface GenOptions {
  kind: Kind
  rootName: string
  optional: OptionalStrategy
  readonly: boolean
  date: DateStrategy
  arr: ArrStrategy
  obj: ObjStrategy
  union: UnionStrategy
  overrides: Record<string, string>
}
interface Candidate {
  path: string
  reason: string
  current: string
}
interface Field {
  key: string
  optional: boolean
  type: string
}
interface GenResult {
  code: string
  warnings: string[]
  notes: string[]
  candidates: Candidate[]
}

function generateTypes(value: unknown, opts: GenOptions): GenResult {
  const { kind, rootName, optional, readonly: roMode, date, arr, obj, union, overrides } = opts
  const interfaces: { name: string; lines: string[] }[] = []
  const usedNames = new Set<string>([rootName])
  const shapeMap = new Map<string, string>()
  const warnings: string[] = []
  const notes: string[] = []
  const candidates: Candidate[] = []
  let dateCount = 0
  let dateSample = ''
  const hasOverride = (p: string) => !!overrides[p]?.trim()
  const overrideOf = (p: string) => overrides[p]!.trim()

  function uniqueName(base: string): string {
    let n = base || 'Nested'
    while (usedNames.has(n) || TS_RESERVED.has(n)) n = n + '2'
    usedNames.add(n)
    return n
  }

  function addCandidate(path: string, reason: string, current: string) {
    if (!candidates.some((c) => c.path === path)) candidates.push({ path, reason, current })
  }

  function fieldLines(fields: Field[]): string[] {
    return fields.map(
      (f) => `${roMode ? 'readonly ' : ''}${propName(f.key)}${f.optional ? '?' : ''}: ${f.type}`
    )
  }

  function inferFromValues(values: unknown[], hint: string, path: string): string {
    if (
      values.length &&
      values.every(isPlainObject) &&
      values.some((o) => Object.keys(o as Record<string, unknown>).length > 0)
    ) {
      return registerObject(values as Record<string, unknown>[], hint, path)
    }
    const types = values.map((v) => infer(v, hint, path))
    return mergeTypes(types)
  }

  function objectFields(objs: Record<string, unknown>[], path: string): Field[] {
    const keys: string[] = []
    for (const o of objs) for (const k of Object.keys(o)) if (!keys.includes(k)) keys.push(k)
    return keys.map((k) => {
      const present = objs.filter((o) => k in o).map((o) => o[k])
      const missing = objs.length - present.length
      const isOptional = optional === 'all' ? true : optional === 'required' ? false : missing > 0
      return { key: k, optional: isOptional, type: inferFromValues(present, k, `${path}.${k}`) }
    })
  }

  function registerObject(objs: Record<string, unknown>[], hint: string, path: string): string {
    const fields = objectFields(objs, path)
    const sig = JSON.stringify(fields.map((f) => [f.key, f.optional, f.type]))
    const cached = shapeMap.get(sig)
    if (cached) return cached
    const base = pascal(hint)
    const name = uniqueName(base === rootName ? base + '2' : base)
    shapeMap.set(sig, name)
    interfaces.push({ name, lines: fieldLines(fields) })
    return name
  }

  function inferArray(v: unknown[], hint: string, path: string): string {
    if (v.length === 0) {
      let auto = 'unknown[]'
      if (arr === 'any') auto = 'any[]'
      const manual = arr === 'manual'
      addCandidate(path, manual ? '空数组：请填写元素类型' : '空数组：无元素可推断', manual ? 'unknown' : auto)
      warnings.push(
        manual
          ? `${path}：空数组策略为“手动指定”，但未填写类型，暂用 ${auto}`
          : `${path}：空数组无法推断元素类型，已生成 ${auto}`
      )
      return auto
    }
    const nonNull = v.filter((x) => x !== null)
    const hasNull = nonNull.length !== v.length
    if (!nonNull.length) {
      addCandidate(path, '数组元素全为 null，无类型证据', 'unknown[]')
      warnings.push(`${path}：数组元素全为 null，无法推断，按 unknown[] 处理`)
      return 'unknown[]'
    }
    const elemHint = /s$/i.test(hint) && hint.length > 1 ? hint.slice(0, -1) : hint + 'Item'
    let elem: string
    if (nonNull.every(isPlainObject)) {
      const objs = nonNull as Record<string, unknown>[]
      if (objs.every((o) => Object.keys(o).length === 0)) {
        elem = obj === 'braces' ? '{}' : 'Record<string, unknown>'
        addCandidate(path, '数组元素均为空对象', wrapElem(elem))
        warnings.push(`${path}：数组元素均为空对象，按 ${elem} 处理`)
      } else {
        elem = registerObject(objs, elemHint, `${path}[]`)
      }
    } else {
      const types = nonNull.map((el) => infer(el, elemHint, `${path}[]`))
      if (union === 'first') {
        elem = types[0] ?? 'unknown'
        if (splitUnion(mergeTypes(types)).length > 1) {
          addCandidate(path, '混合数组：已按“取首项类型”策略', wrapElem(elem))
          warnings.push(`${path}：数组元素类型不一致（${mergeTypes(types)}），按“取首项类型”仅保留 ${elem}`)
        }
      } else {
        elem = mergeTypes(types)
        const branches = splitUnion(elem)
        if (branches.length > 1) {
          addCandidate(path, `混合数组：${branches.join(' | ')}`, wrapElem(elem))
          warnings.push(`${path}：数组元素类型不一致，已生成联合类型 ${wrapElem(elem)}`)
        }
      }
    }
    if (hasNull && union === 'union') {
      const branches = splitUnion(elem)
      if (!branches.includes('unknown') && !branches.includes('null')) elem = mergeTypes([elem, 'null'])
    }
    return wrapElem(elem)
  }

  function infer(v: unknown, hint: string, path: string): string {
    if (hasOverride(path)) {
      const ov = overrideOf(path)
      if (Array.isArray(v) && v.length === 0 && arr === 'manual') return wrapElem(ov)
      return ov
    }
    if (v === null) {
      addCandidate(path, '值为 null，无其它类型证据', 'unknown')
      warnings.push(`${path}：值为 null，无其它类型证据，按 unknown 处理`)
      return 'unknown'
    }
    if (v instanceof RawNumber || typeof v === 'number') return 'number'
    if (typeof v === 'boolean') return 'boolean'
    if (typeof v === 'string') {
      if (DATE_LIKE.test(v)) {
        dateCount++
        if (!dateSample) dateSample = path
        if (date === 'date') return 'Date'
      }
      return 'string'
    }
    if (Array.isArray(v)) return inferArray(v, hint, path)
    if (isPlainObject(v)) {
      if (Object.keys(v).length === 0) {
        const t = obj === 'braces' ? '{}' : 'Record<string, unknown>'
        addCandidate(path, '空对象，无字段可推断', t)
        warnings.push(`${path}：空对象无法推断字段，按 ${t} 处理`)
        return t
      }
      return registerObject([v], hint, path)
    }
    warnings.push(`${path}：无法识别的值类型（${typeof v}），按 unknown 处理`)
    return 'unknown'
  }

  let rootDecl: string | null = null
  let usedTypeFallback = false
  if (isPlainObject(value)) {
    const fields = objectFields([value], '$')
    if (kind === 'interface') {
      interfaces.unshift({ name: rootName, lines: fieldLines(fields) })
    } else {
      rootDecl = `export type ${rootName} = {\n${fieldLines(fields)
        .map((l) => '  ' + l)
        .join('\n')}\n}`
    }
  } else {
    usedTypeFallback = kind === 'interface'
    rootDecl = `export type ${rootName} = ${infer(value, rootName, '$')}`
  }

  const blocks: string[] = []
  if (rootDecl) blocks.push(rootDecl)
  for (const it of interfaces) {
    blocks.push(`export interface ${it.name} {\n${it.lines.map((l) => '  ' + l).join('\n')}\n}`)
  }

  if (usedTypeFallback) notes.push('根节点不是对象，已改用 type 别名输出')
  if (dateCount > 0) {
    notes.push(
      date === 'date'
        ? `检测到 ${dateCount} 个日期样字符串（如 ${dateSample}），已按“转为 Date”输出（运行时仍是字符串）`
        : `检测到 ${dateCount} 个日期样字符串（如 ${dateSample}: "2024-01-01"），保持 string，不猜测为 Date`
    )
  }
  return { code: blocks.join('\n\n') + '\n', warnings, notes, candidates }
}

// ---------- 执行 ----------
const sig = () =>
  JSON.stringify([
    input.value,
    kind.value,
    rootName.value,
    optStrategy.value,
    ro.value,
    dateStrategy.value,
    arrStrategy.value,
    objStrategy.value,
    unionStrategy.value,
    overrides.value
  ])
const run = useToolRun(sig)

const rootNameErr = computed(() => {
  const n = rootName.value.trim()
  if (!n) return '请填写根类型名'
  if (!isValidIdent(n)) return `根类型名 “${n}” 不是合法的标识符（字母/数字/_/$，且不能以数字开头）`
  if (TS_RESERVED.has(n)) return `根类型名 “${n}” 是 TypeScript 保留字，请换一个`
  return ''
})

function execute() {
  warnings.value = []
  notes.value = []
  candidates.value = []
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    errDetail.value = ''
    return
  }
  if (rootNameErr.value) {
    output.value = ''
    errDetail.value = rootNameErr.value
    run.markFail(errDetail.value)
    return
  }
  try {
    const { value } = parseJson(input.value)
    const r = generateTypes(value, {
      kind: kind.value,
      rootName: rootName.value.trim(),
      optional: optStrategy.value,
      readonly: ro.value,
      date: dateStrategy.value,
      arr: arrStrategy.value,
      obj: objStrategy.value,
      union: unionStrategy.value,
      overrides: overrides.value
    })
    output.value = r.code
    warnings.value = r.warnings
    notes.value = r.notes
    candidates.value = r.candidates
    errDetail.value = ''
    run.markOk(r.notes.join('；') || `已生成 ${r.code.split('\n').length - 1} 行类型定义`)
  } catch (e) {
    output.value = ''
    const pos = jsonErrorPosition(e, input.value)
    errDetail.value = pos ? `JSON 第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : localizeJsonMessage(errMessage(e))
    run.markFail(errDetail.value)
  }
}

const adjustRows = computed(() => {
  const rows = candidates.value.map((c) => ({ ...c, overridden: !!overrides.value[c.path]?.trim() }))
  for (const p of Object.keys(overrides.value)) {
    if (overrides.value[p]?.trim() && !rows.some((r) => r.path === p)) {
      rows.push({ path: p, reason: '已手动指定类型', current: '—', overridden: true })
    }
  }
  return rows
})

function openAdjust() {
  draft.value = { ...overrides.value }
  adjustOpen.value = true
}
function clearOne(path: string) {
  const next = { ...draft.value }
  delete next[path]
  draft.value = next
}
function applyAdjust() {
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(draft.value)) if (v.trim()) next[k] = v.trim()
  overrides.value = next
  adjustOpen.value = false
  execute()
}
function resetAdjust() {
  overrides.value = {}
  draft.value = {}
  adjustOpen.value = false
  execute()
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    execute()
  } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
    if (output.value && run.status.value === 'ok') {
      e.preventDefault()
      clipboard.copy(output.value, '类型定义')
    }
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

function downloadTs() {
  if (!output.value) return
  downloadText('types.ts', output.value, 'text/plain;charset=utf-8')
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
</script>

<template>
  <div class="t27">
    <div class="t27__toolbar">
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        生成类型
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok' || !output" @click="clipboard.copy(output, '类型定义')">
        <DkIcon name="copy" :size="12" />
        复制
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok' || !output" @click="downloadTs">
        <DkIcon name="download" :size="12" />
        下载 .ts
      </DkButton>
      <span class="t27__sep"></span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入含 null、空数组、空对象、混合数组、嵌套对象的示例" @click="input = SAMPLE; execute()">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" @click="fileInput?.click()">
        <DkIcon name="upload" :size="12" />
        导入文件
      </DkButton>
      <input ref="fileInput" type="file" accept=".json,application/json,text/plain" class="t27__file" @change="onImportFile" />
      <DkButton size="sm" variant="ghost" :disabled="!input" @click="input = ''; execute()">
        <DkIcon name="trash" :size="12" />
        清空
      </DkButton>
      <span class="t27__kbd tertiary">⌘⏎ 生成类型 · ⌘⇧C 复制</span>
    </div>

    <div class="t27__params">
      <div class="t27__field">
        <span class="t27__label">目标</span>
        <DkSegmented
          size="sm"
          :model-value="kind"
          :options="[
            { value: 'interface', label: 'interface' },
            { value: 'type', label: 'type' }
          ]"
          @update:model-value="kind = $event as any"
        />
      </div>
      <div class="t27__field">
        <span class="t27__label">根类型名</span>
        <DkInput v-model="rootName" mono placeholder="Root" :error="!!rootNameErr" class="t27__name" />
      </div>
      <div class="t27__field">
        <span class="t27__label">可选属性</span>
        <DkSegmented
          size="sm"
          :model-value="optStrategy"
          :options="[
            { value: 'keep', label: '保持原样', title: '数组内对象缺失的键才标为可选（由实例证据决定）' },
            { value: 'all', label: '全部可选', title: '所有属性都生成 key?: T' },
            { value: 'required', label: '全部必填', title: '所有属性都生成 key: T' }
          ]"
          @update:model-value="optStrategy = $event as any"
        />
      </div>
      <div class="t27__field">
        <span class="t27__label">只读</span>
        <DkSegmented
          size="sm"
          :model-value="ro ? 'on' : 'off'"
          :options="[
            { value: 'off', label: '关闭' },
            { value: 'on', label: 'readonly' }
          ]"
          @update:model-value="ro = $event === 'on'"
        />
      </div>
      <div class="t27__field">
        <span class="t27__label">日期字段</span>
        <DkSegmented
          size="sm"
          :model-value="dateStrategy"
          :options="[
            { value: 'string', label: '保持 string' },
            { value: 'date', label: '转为 Date', title: '日期样字符串输出为 Date（运行时仍是字符串）' }
          ]"
          @update:model-value="dateStrategy = $event as any"
        />
      </div>
      <div class="t27__field">
        <span class="t27__label">空数组策略</span>
        <DkSegmented
          size="sm"
          :model-value="arrStrategy"
          :options="[
            { value: 'unknown', label: 'unknown' },
            { value: 'any', label: 'any' },
            { value: 'manual', label: '手动指定', title: '用「调整字段类型」为该字段填写元素类型' }
          ]"
          @update:model-value="arrStrategy = $event as any"
        />
      </div>
      <div class="t27__field">
        <span class="t27__label">空对象策略</span>
        <DkSegmented
          size="sm"
          :model-value="objStrategy"
          :options="[
            { value: 'record', label: 'Record<string, unknown>' },
            { value: 'braces', label: '{}' }
          ]"
          @update:model-value="objStrategy = $event as any"
        />
      </div>
      <div class="t27__field">
        <span class="t27__label">数组联合类型</span>
        <DkSegmented
          size="sm"
          :model-value="unionStrategy"
          :options="[
            { value: 'union', label: '联合类型', title: '混合数组按元素首次出现顺序合并为 (A | B)[]' },
            { value: 'first', label: '取首项类型', title: '混合数组只保留首个元素的类型' }
          ]"
          @update:model-value="unionStrategy = $event as any"
        />
      </div>
      <span class="grow"></span>
    </div>

    <div v-if="run.status.value !== 'idle' && (warnings.length || candidates.length)" class="t27__tip" :class="run.status.value === 'error' ? 't27__tip--err' : ''">
      <DkIcon :name="run.status.value === 'error' ? 'alert-circle' : 'alert-triangle'" :size="13" />
      <span class="t27__tip-text">
        <template v-if="run.status.value === 'error'">{{ errDetail }}</template>
        <template v-else>推断不确定：{{ warnings[0] || `${candidates.length} 个字段可手动指定类型` }}</template>
      </span>
      <span class="grow"></span>
      <DkButton v-if="run.status.value === 'ok' && adjustRows.length" size="sm" variant="ghost" @click="openAdjust">
        <DkIcon name="sliders" :size="12" />
        调整字段类型
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="['null → unknown', '空对象 → Record<string, unknown>', '大整数保持 number']"
      :retry="execute"
    />

    <div class="t27__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="JSON 输入"
            placeholder="粘贴 JSON 文本，或点击「载入示例」/「导入文件」"
            :error="run.status.value === 'error' ? errDetail : undefined"
            :height="'calc(50vh - 60px)'"
            filename="input.json"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            lang="TypeScript 结果"
            placeholder="生成的类型定义将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(50vh - 60px)'"
            filename="types.ts"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="run.status.value !== 'idle' && warnings.length" class="t27__warn">
      <p class="t27__warn-title">
        <DkIcon name="alert-triangle" :size="13" />
        推断警告（{{ warnings.length }}）
      </p>
      <ul>
        <li v-for="(w, i) in warnings" :key="i" class="mono">{{ w }}</li>
      </ul>
    </div>

    <DkCollapse title="推断规则与类型策略">
      <h4>推断规则</h4>
      <ul>
        <li>嵌套对象抽为独立命名的 <code>interface</code>（如 <code>address: Address</code>），数组内同构对象按结构去重命名。</li>
        <li>字段值本身为 <code>null</code> 且无其它类型证据时输出 <code>unknown</code>；空对象默认输出 <code>Record&lt;string, unknown&gt;</code>，可切换为 <code>{}</code>。</li>
        <li>空数组默认输出 <code>unknown[]</code>，可切换 <code>any[]</code>，或用「调整字段类型」按字段路径手动指定。</li>
        <li>混合数组按元素首次出现顺序合并为联合类型，如 <code>(boolean | number | null)[]</code>；也可改为「取首项类型」。</li>
        <li>可选属性「保持原样」时，数组内多个对象里缺失的键才标为可选（由实例证据决定）；「全部可选 / 全部必填」则统一覆盖。</li>
        <li>日期样字符串默认保持 <code>string</code>，可切换为 <code>Date</code>；大整数在类型推断里同样是 <code>number</code>。</li>
      </ul>
      <h4>失败处理</h4>
      <p>JSON 语法错误或根类型名非法时保留输入，并给出具体位置与修正方向。</p>
    </DkCollapse>

    <DkModal :open="adjustOpen" title="调整字段类型" width="560px" @close="adjustOpen = false">
      <p class="t27__modal-hint">为推断不确定的字段填写 TypeScript 类型；留空表示交回自动推断。JSON 路径用于定位字段（<code>[]</code> 表示数组元素）。空数组「手动指定」请填元素类型（如 <code>string</code>），其余字段填完整类型。</p>
      <div v-if="adjustRows.length" class="t27__rows">
        <div v-for="r in adjustRows" :key="r.path" class="t27__row">
          <div class="t27__row-meta">
            <code class="t27__row-path">{{ r.path }}</code>
            <span class="t27__row-reason">{{ r.reason }}</span>
            <span class="t27__row-cur mono">自动：{{ r.current }}</span>
          </div>
          <div class="t27__row-in">
            <DkInput :model-value="draft[r.path] ?? ''" mono placeholder="如 string[] / { id: number }" @update:model-value="draft[r.path] = $event" />
            <DkIconButton v-if="draft[r.path]" title="清除该字段的手动指定" @click="clearOne(r.path)">
              <DkIcon name="x" :size="13" />
            </DkIconButton>
          </div>
        </div>
      </div>
      <p v-else class="tertiary">当前没有需要手动指定的字段。</p>
      <template #footer>
        <DkButton size="sm" variant="ghost" :disabled="!Object.keys(overrides).length && !Object.values(draft).some((v) => v.trim())" @click="resetAdjust">全部清除</DkButton>
        <DkButton size="sm" variant="ghost" @click="adjustOpen = false">取消</DkButton>
        <DkButton size="sm" variant="primary" @click="applyAdjust">应用并重新生成</DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.t27 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t27__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t27__sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t27__file {
  display: none;
}
.t27__params {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  padding: 8px 12px;
}
.t27__field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t27__label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t27__name {
  width: 120px;
}
.t27__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t27__tip {
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
.t27__tip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t27__tip--err {
  border-color: var(--error);
  background: var(--error-soft);
  color: var(--error);
}
.t27__panes {
  min-height: 300px;
}
.t27__warn {
  border: 1px solid var(--warn);
  background: var(--warn-soft);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  max-height: 180px;
  overflow: auto;
}
.t27__warn-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--warn);
  font-weight: 600;
  margin-bottom: 4px;
}
.t27__warn ul {
  margin: 0;
  padding-left: 18px;
  list-style: disc;
  line-height: 1.7;
}
.t27__modal-hint {
  margin: 0 0 10px;
  font-size: 12px;
}
.t27__rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 46vh;
  overflow: auto;
}
.t27__row {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
.t27__row-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11.5px;
  margin-bottom: 6px;
}
.t27__row-path {
  background: var(--surface-subtle);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--text-primary);
}
.t27__row-reason {
  color: var(--text-tertiary);
}
.t27__row-cur {
  color: var(--text-secondary);
  margin-left: auto;
}
.t27__row-in {
  display: flex;
  align-items: center;
  gap: 6px;
}
.t27__row-in :deep(.dk-input) {
  width: 100%;
}
</style>
