<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { csvToJson, jsonToCsv } from '~/utils/csv'

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

/* ---------------- CSV → JSON ---------------- */
function runCsv2Json(): string {
  const res = csvToJson(input.value, { separator: sep.value, header: headerOn.value, infer: infer.value })
  warnings.value = [...res.warnings]
  // 一行都没解析到（表头为空且无数据行）：保持「无预览」的既有行为
  if (!res.preview.rows.length && !res.preview.header?.length) {
    previewData.value = null
    run.markOk('未解析到任何数据行')
    return res.json
  }
  previewData.value = { header: res.preview.header, rows: res.preview.rows }
  if (headerOn.value) {
    run.markOk(
      res.rows
        ? `已转换 ${res.rows} 行数据${infer.value ? '（类型推断已开启）' : '（全部按字符串，保留前导零）'}`
        : '只有表头，没有数据行'
    )
    return res.json
  }
  run.markOk(`已转换 ${res.rows} 行数据（无表头，输出为数组的数组）`)
  return res.json
}

/* ---------------- JSON → CSV ---------------- */
function runJson2Csv(): string {
  const res = jsonToCsv(input.value, {
    separator: sep.value,
    header: headerOn.value,
    fields: customFields.value ?? undefined
  })
  warnings.value = [...res.warnings]
  autoFields.value = res.autoFields
  previewData.value = { header: res.preview.header, rows: res.preview.rows }
  run.markOk(
    `已生成 ${res.rows} 行 × ${res.columns.length} 列${customFields.value ? '（自定义字段）' : '（自动拍平字段，可在下方调整）'}`
  )
  return res.csv
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
    // 转换函数抛出的中文消息本身就是状态栏文案（与今天的 markFail 文案逐字一致）
    const msg = errMessage(e)
    output.value = ''
    errInput.value = msg
    run.markFail(msg)
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
