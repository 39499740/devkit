<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

/* ---------------- 输入与参数 ---------------- */
const input = ref('')
const output = ref('')
const errInput = ref('')
const dir = ref<'csv2json' | 'json2csv'>('csv2json')
const sep = ref<string>(',')
const headerOn = ref(true) // 表头首行（CSV→JSON：首行作为键；JSON→CSV：输出表头行）
const infer = ref(false) // CSV→JSON 类型推断：默认关闭，全部按字符串（保留 007 等前导零）
const warnings = ref<string[]>([])
const previewData = ref<{ header: string[] | null; rows: string[][] } | null>(null)

/* JSON→CSV 字段路径：customFields 为 null 表示使用自动拍平结果（autoFields） */
const customFields = ref<string[] | null>(null)
const autoFields = ref<string[]>([])
const effectiveFields = computed(() => customFields.value ?? autoFields.value)

const SAMPLE_CSV = `姓名,部门,备注
张三,技术部,"熟悉 C++,与 ""Go"" 团队协作过"
李四,市场部,"预算,3000
超支需审批"
王五,人事部,普通备注`
const SAMPLE_JSON = `[
  {
    "工号": "007",
    "user": { "姓名": "张三", "部门": "技术部" },
    "skills": ["C++", "Go"],
    "备注": "熟悉 C++,\\"Go\\" 也会一些"
  },
  {
    "工号": "012",
    "user": { "姓名": "李四", "部门": "市场部" },
    "skills": ["沟通", "数据分析"],
    "备注": "预算,3000\\n超支需审批"
  },
  {
    "工号": "108",
    "user": { "姓名": "王五", "部门": "人事部" },
    "备注": "普通备注"
  }
]`

const sig = () => JSON.stringify([input.value, dir.value, sep.value, headerOn.value, infer.value, customFields.value])
const run = useToolRun(sig)

/* ---------------- CSV 解析（RFC 4180：引号内逗号 / 换行，"" 转义） ---------------- */
function parseCsv(text: string, separator: string): { rows: string[][]; warns: string[] } {
  const rows: string[][] = []
  const warns: string[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false // 当前字段已出现内容（含仅引号的空字段）
  let rowHasContent = false
  const endField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    rowHasContent = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          fieldStarted = true
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c // 引号内的换行 / 分隔符均按字面保留
        fieldStarted = true
      }
      continue
    }
    if (c === '"' && field === '' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (c === '"') {
      // 字段中间出现的裸引号：按字面保留
      field += c
      fieldStarted = true
      continue
    }
    if (c === separator) {
      endField()
      rowHasContent = true
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      if (rowHasContent || fieldStarted || field !== '') endRow()
      continue // 其余空行跳过
    }
    field += c
    fieldStarted = true
  }
  if (inQuotes) warns.push('存在未闭合的引号：末尾字段内容按字面保留，请检查是否缺少结束引号')
  if (rowHasContent || fieldStarted || field !== '') endRow()
  return { rows, warns }
}

/** CSV 单元格写出：仅在包含分隔符 / 引号 / 换行时加引号，引号翻倍转义 */
function csvCell(v: string, separator: string): string {
  if (v.includes('"') || v.includes(separator) || v.includes('\n') || v.includes('\r')) {
    return '"' + v.replace(/"/g, '""') + '"'
  }
  return v
}

/** 类型推断（开启后）：布尔 / null / 数字；前导零（007）始终保持字符串 */
function inferValue(s: string): unknown {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  if (/^-?(?:0|[1-9][0-9]*)$/.test(s)) {
    const n = Number(s)
    if (Number.isSafeInteger(n)) return n
  }
  if (/^-?(?:[1-9][0-9]*\.[0-9]*|0?\.[0-9]+)$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return n
  }
  return s
}

/* ---------------- JSON 拍平与取值 ---------------- */
function flattenPaths(v: unknown, prefix: string, out: string[]) {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNumber)) {
    for (const [k, val] of Object.entries(v)) flattenPaths(val, prefix ? `${prefix}.${k}` : k, out)
  } else {
    out.push(prefix)
  }
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function cellText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (v instanceof RawNumber) return v.raw
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return minifyJson(v) // 数组 / 对象值序列化为 JSON 字符串
}

function typeOf(v: unknown): string {
  if (v instanceof RawNumber) return 'number'
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v === 'object' ? 'object' : typeof v
}

/* ---------------- CSV → JSON ---------------- */
function runCsv2Json(): string {
  const { rows, warns } = parseCsv(input.value, sep.value)
  warnings.value = [...warns]
  const conv = (s: string) => (infer.value ? inferValue(s) : s)
  let header: string[] | null = null
  let data: string[][]
  if (headerOn.value) {
    header = rows.length ? rows[0]! : []
    data = rows.slice(1)
  } else {
    data = rows
  }
  if (!rows.length) {
    previewData.value = null
    run.markOk('未解析到任何数据行')
    return '[]'
  }
  if (headerOn.value) {
    const keys = (header as string[]).map((h, i) => (h === '' ? `列${i + 1}` : h))
    data.forEach((row, i) => {
      if (row.length !== keys.length) {
        warnings.value.push(`第 ${i + 2} 行（含表头）有 ${row.length} 列，与表头的 ${keys.length} 列不一致，该行已保留`)
      }
    })
    const arr = data.map((row) => {
      const obj: Record<string, unknown> = {}
      keys.forEach((k, ci) => {
        obj[k] = ci < row.length ? conv(row[ci]!) : null // 缺失的列补 null
      })
      return obj
    })
    previewData.value = { header: keys, rows: data }
    run.markOk(
      arr.length
        ? `已转换 ${arr.length} 行数据${infer.value ? '（类型推断已开启）' : '（全部按字符串，保留前导零）'}`
        : '只有表头，没有数据行'
    )
    return stringifyJson(arr, 2)
  }
  previewData.value = { header: null, rows: data }
  run.markOk(`已转换 ${data.length} 行数据（无表头，输出为数组的数组）`)
  return stringifyJson(data.map((row) => row.map(conv)), 2)
}

/* ---------------- JSON → CSV ---------------- */
function runJson2Csv(): string {
  warnings.value = []
  let value: unknown
  try {
    value = parseJson(input.value).value
  } catch (e) {
    const pos = jsonErrorPosition(e, input.value)
    const detail = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : errMessage(e)
    run.markFail(`JSON 解析失败：${detail}`)
    throw new Error('__fail__')
  }
  if (!Array.isArray(value)) {
    run.markFail(`JSON → CSV 需要顶层数组（对象数组），当前顶层是 ${typeOf(value)}。请提供形如 [ { … }, { … } ] 的数据`)
    throw new Error('__fail__')
  }
  if (!value.length) {
    run.markFail('数组为空，没有可转换的数据行')
    throw new Error('__fail__')
  }
  for (let i = 0; i < value.length; i++) {
    const t = typeOf(value[i])
    if (t !== 'object') {
      run.markFail(`第 ${i + 1} 个元素不是 JSON 对象（是 ${t}），无法按字段路径取值。请把每个元素改为 { … } 对象`)
      throw new Error('__fail__')
    }
  }
  // 自动拍平：按首个出现顺序合并所有行的叶子字段路径
  const union: string[] = []
  const seen = new Set<string>()
  for (const el of value as unknown[]) {
    const paths: string[] = []
    flattenPaths(el, '', paths)
    for (const p of paths) {
      if (!seen.has(p)) {
        seen.add(p)
        union.push(p)
      }
    }
  }
  const fields = customFields.value ? customFields.value.map((f) => f.trim()).filter(Boolean) : union
  autoFields.value = union
  if (!fields.length) {
    run.markFail('未找到可输出的字段路径（对象内没有叶子字段）。请检查数据或在下方手动配置字段路径')
    throw new Error('__fail__')
  }
  for (const f of fields) {
    if (!seen.has(f)) warnings.value.push(`字段路径 ${f} 在所有行中都不存在，将输出空列`)
  }
  const objs = value as Record<string, unknown>[]
  const lines: string[] = []
  if (headerOn.value) lines.push(fields.map((f) => csvCell(f, sep.value)).join(sep.value))
  for (const obj of objs) {
    lines.push(fields.map((f) => csvCell(cellText(getByPath(obj, f)), sep.value)).join(sep.value))
  }
  const out = lines.join('\n')
  // 预览：按同样的解析器读回输出，保证与结果一致
  const back = parseCsv(out + '\n', sep.value)
  previewData.value = { header: headerOn.value ? back.rows[0] ?? [] : null, rows: headerOn.value ? back.rows.slice(1) : back.rows }
  run.markOk(`已生成 ${objs.length} 行 × ${fields.length} 列${customFields.value ? '（自定义字段）' : '（自动拍平字段，可在下方调整）'}`)
  return out
}

/* ---------------- 执行 ---------------- */
function execute() {
  errInput.value = ''
  warnings.value = []
  previewData.value = null
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    return
  }
  try {
    output.value = dir.value === 'csv2json' ? runCsv2Json() : runJson2Csv()
  } catch (e) {
    if (errMessage(e) !== '__fail__') {
      output.value = ''
      errInput.value = errMessage(e)
      run.markFail(`转换失败：${errInput.value}`)
    } else {
      output.value = ''
      errInput.value = run.errorMsg.value
    }
    return
  }
}

watch([dir, sep, headerOn, infer], execute)

/* ---------------- 字段路径编辑 ---------------- */
function setField(i: number, v: string) {
  if (!customFields.value) customFields.value = [...autoFields.value]
  customFields.value[i] = v
}
function removeField(i: number) {
  if (!customFields.value) customFields.value = [...autoFields.value]
  customFields.value.splice(i, 1)
}
function addField() {
  if (!customFields.value) customFields.value = [...autoFields.value]
  customFields.value.push('')
}
function resetFields() {
  customFields.value = null
  execute()
}

/* ---------------- 预览 ---------------- */
const PREVIEW_LIMIT = 50
const previewRows = computed(() => (previewData.value ? previewData.value.rows.slice(0, PREVIEW_LIMIT) : []))
const previewCols = computed(() => {
  if (!previewData.value) return 0
  let n = previewData.value.header?.length ?? 0
  for (const r of previewData.value.rows) n = Math.max(n, r.length)
  return n
})

function loadSample() {
  input.value = dir.value === 'csv2json' ? SAMPLE_CSV : SAMPLE_JSON
  customFields.value = null
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
</script>

<template>
  <div class="t04">
    <div class="t04__toolbar">
      <DkSegmented
        :model-value="dir"
        :options="[
          { value: 'csv2json', label: 'CSV → JSON' },
          { value: 'json2csv', label: 'JSON → CSV' }
        ]"
        @update:model-value="dir = $event as any"
      />
      <div class="t04__sep">
        <span class="t04__label">分隔符</span>
        <DkSelect
          :model-value="sep"
          :options="[
            { value: ',', label: '逗号 ,' },
            { value: ';', label: '分号 ;' },
            { value: '\t', label: '制表符 Tab' }
          ]"
          @update:model-value="sep = $event"
        />
      </div>
      <span class="t04__opt" title="开启后：CSV→JSON 把首行作为对象键；JSON→CSV 在首行输出字段路径">
        <DkCheckbox v-model="headerOn" label="表头首行" />
      </span>
      <span
        class="t04__opt"
        :title="
          dir === 'csv2json'
            ? '默认关闭：所有单元格保持字符串（保留 007 等前导零）。开启后推断 true/false/null 与数字（前导零仍保持字符串）'
            : '仅在 CSV → JSON 方向有效'
        "
      >
        <DkCheckbox v-model="infer" label="类型推断" :disabled="dir === 'json2csv'" />
      </span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入与当前方向匹配的示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />转换
      </DkButton>
      <span class="t04__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[
        dir === 'csv2json'
          ? `RFC 4180${infer ? ' · 类型推断' : ' · 全字符串'}`
          : `${effectiveFields.length} 个字段${headerOn ? ' · 含表头' : ''}`
      ]"
      :retry="execute"
    />

    <div v-if="warnings.length && run.status.value === 'ok'" class="t04__warns">
      <span class="t04__warns-title"><DkIcon name="alert-triangle" :size="13" />警告（{{ warnings.length }}）</span>
      <ul>
        <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
      </ul>
    </div>

    <div v-if="dir === 'json2csv'" class="t04__fields">
      <div class="t04__fields-head">
        <span class="t04__fields-title">CSV 字段路径</span>
        <span class="t04__fields-help">嵌套对象用 . 连接（如 user.姓名）；数组与对象值输出为 JSON 字符串；某行缺少该字段时输出空单元格</span>
        <span class="grow"></span>
        <DkButton size="sm" variant="ghost" title="丢弃手动修改，按当前输入自动拍平生成路径" @click="resetFields">
          <DkIcon name="refresh" :size="12" />按输入重新生成
        </DkButton>
        <DkButton size="sm" variant="ghost" @click="addField"><DkIcon name="plus" :size="12" />添加字段</DkButton>
      </div>
      <div class="t04__fields-list">
        <div v-for="(f, i) in effectiveFields" :key="i" class="t04__field-row">
          <span class="t04__field-no tertiary">{{ i + 1 }}</span>
          <DkInput :model-value="f" mono placeholder="如 user.name 或 skills" class="t04__field-input" @update:model-value="(v: string) => setField(i, v)" />
          <DkButton size="sm" variant="ghost" title="删除该字段列" @click="removeField(i)"><DkIcon name="x" :size="12" /></DkButton>
        </div>
        <p v-if="!effectiveFields.length" class="t04__fields-empty tertiary">
          执行转换后将按输入自动拍平生成默认路径（如 user.姓名），之后可自由增删改。
        </p>
      </div>
    </div>

    <div class="t04__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="dir === 'csv2json' ? 'CSV 输入' : 'JSON 输入'"
            :placeholder="dir === 'csv2json' ? '粘贴 CSV 文本（支持引号内逗号、换行与双引号转义），或点击「载入示例」' : '粘贴对象数组 JSON，或点击「载入示例」'"
            :error="errInput"
            :height="'calc(42vh - 60px)'"
            :filename="dir === 'csv2json' ? 'input.csv' : 'input.json'"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            :lang="dir === 'csv2json' ? 'JSON 结果' : 'CSV 结果'"
            placeholder="结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(42vh - 60px)'"
            :filename="dir === 'csv2json' ? 'output.json' : 'output.csv'"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="output && run.status.value === 'ok'" class="t04__send">
      <SendToMenu :text="output" from="csv-json" :kind="dir === 'csv2json' ? 'json' : 'text'" />
    </div>

    <div v-if="previewData && run.status.value === 'ok'" class="t04__preview">
      <div class="t04__preview-head">
        <span class="t04__preview-title">表格预览</span>
        <span class="t04__preview-note tertiary">
          共 {{ previewData.rows.length }} 行，展示前 {{ previewRows.length }} 行；单元格内换行按原样显示
        </span>
      </div>
      <div class="t04__preview-scroll">
        <table class="t04__table">
          <thead v-if="previewData.header && previewData.header.length">
            <tr>
              <th v-for="(h, i) in previewData.header" :key="i">{{ h }}</th>
              <th v-for="j in Math.max(0, previewCols - (previewData.header?.length ?? 0))" :key="'x' + j"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in previewRows" :key="i">
              <td v-for="j in previewCols" :key="j">{{ row[j - 1] ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <DkCollapse title="转换规则与限制">
      <ul class="t04__notes">
        <li>CSV 解析遵循 RFC 4180：支持引号内的分隔符与换行、<span class="mono">""</span> 转义为单个引号；空行跳过；未闭合引号会给出警告并按字面保留。</li>
        <li>CSV → JSON 默认所有单元格为字符串（保留 <span class="mono">007</span> 等前导零）；开启「类型推断」后推断 true/false/null 与数字，前导零仍保持字符串。列数与表头不一致的行保留并在警告中列出。</li>
        <li>JSON → CSV 仅接受对象数组；嵌套对象自动拍平为点路径（可在上方增删改），数组与对象值序列化为 JSON 字符串，缺失字段输出空单元格。也可以拒绝嵌套结构：把输入改为拍平后的对象数组即可。</li>
        <li>复制 / 下载请使用结果编辑器右上角按钮，内容不含行号。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t04 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t04__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t04__label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t04__sep {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t04__sep :deep(.dk-select) {
  width: 120px;
}
.t04__opt {
  display: inline-flex;
}
.t04__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t04__warns {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: var(--warn-soft);
  font-size: 12px;
}
.t04__warns-title {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--warn);
  font-weight: 500;
}
.t04__warns ul {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  line-height: 1.7;
}
.t04__fields {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t04__fields-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.t04__fields-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.t04__fields-help {
  font-size: 11px;
  color: var(--text-tertiary);
}
.t04__fields-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 150px;
  overflow: auto;
}
.t04__field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t04__field-no {
  width: 18px;
  text-align: right;
  font-size: 11px;
  flex-shrink: 0;
}
.t04__field-input {
  flex: 1;
}
.t04__field-row :deep(.dk-btn) {
  flex-shrink: 0;
}
.t04__fields-empty {
  margin: 0;
  font-size: 12px;
}
.t04__panes {
  min-height: 280px;
}
.t04__send {
  display: flex;
  justify-content: flex-end;
}
.t04__preview {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.t04__preview-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}
.t04__preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.t04__preview-note {
  font-size: 11px;
}
.t04__preview-scroll {
  max-height: 220px;
  overflow: auto;
}
.t04__table {
  border-collapse: collapse;
  width: 100%;
  font-size: 12px;
}
.t04__table th,
.t04__table td {
  border: 1px solid var(--border);
  padding: 4px 10px;
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  word-break: break-word;
}
.t04__table th {
  background: var(--surface-subtle);
  font-weight: 600;
  color: var(--text-primary);
}
.t04__table td {
  color: var(--text-secondary);
}
.t04__notes {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.7;
}
</style>
