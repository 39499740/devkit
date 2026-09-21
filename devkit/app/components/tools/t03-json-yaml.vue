<script setup lang="ts">
import yaml from 'js-yaml'
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()
const toast = useToast()
const transfer = useTransfer()
const { prefs } = usePrefs()

/* ---------------- 输入与参数 ---------------- */
const input = ref('')
const output = ref('')
const errInput = ref('')
const dir = ref<'json2yaml' | 'yaml2json'>('json2yaml')
// YAML 不使用 Tab 缩进，偏好中的 tab 映射为 2 空格
const indent = ref<'2' | '4'>(prefs.value.defaultIndent === '4' ? '4' : '2')
const replaceAsk = ref<{ text: string; from: string } | null>(null)

const SAMPLE_JSON = `{
  "name": "陈立",
  "active": true,
  "released": "2024-01-01",
  "code": "007",
  "ratio": 0.85,
  "note": null,
  "tags": ["工具", "yaml", "2024-01-01"]
}`
const SAMPLE_YAML = `# 中文、布尔、数组与「易误判」字符串演示
name: 陈立
active: true
released: "2024-01-01"   # 引号包裹，保持字符串而非日期
code: "007"              # 引号包裹，保持字符串而非数字 7
ratio: 0.85
note: null
tags:
  - 工具
  - yaml
  - "2024-01-01"
`
const SAMPLE_BAD = `# 不兼容结构演示：数字键 与 YAML 标签（二者都无法无损映射到 JSON）
80: http
debug: !!timestamp 2024-01-01
`

const sig = () => JSON.stringify([input.value, dir.value, indent.value])
const run = useToolRun(sig)

const indentUnit = computed(() => (indent.value === '4' ? 4 : 2))

/* ---------------- JSON → YAML ---------------- */
/** 数字原文是否可安全转为 JS number（不丢精度） */
function isSafeJsonNumber(raw: string): boolean {
  const n = Number(raw)
  if (!Number.isFinite(n)) return false
  if (/^[-+]?\d+$/.test(raw)) return Number.isSafeInteger(n)
  const m = /^[-+]?([0-9]*)\.?([0-9]*)/.exec(raw)
  const sig = (((m?.[1] ?? '') + (m?.[2] ?? '')).replace(/^0+/, '')).length
  return sig <= 15
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$\u4e00-\u9fa5]*$/
const joinKey = (path: string, k: string) => (SIMPLE_KEY.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`)

/**
 * 把 parseJson 的结果（含 RawNumber）转成可交给 js-yaml 的普通值；
 * 超出安全范围的大数用占位符替代（dump 后替换回原文，保证 YAML 文本不丢精度）。
 */
function toJsonable(
  v: unknown,
  token: string,
  counter: { n: number },
  rawMap: Map<string, string>,
  unsafe: string[],
  path: string
): unknown {
  if (v instanceof RawNumber) {
    if (isSafeJsonNumber(v.raw)) return Number(v.raw)
    unsafe.push(path)
    const ph = `${token}${String(counter.n++).padStart(6, '0')}zz`
    rawMap.set(ph, v.raw)
    return ph
  }
  if (Array.isArray(v)) {
    return v.map((x, i) => toJsonable(x, token, counter, rawMap, unsafe, `${path}[${i}]`))
  }
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) o[k] = toJsonable(val, token, counter, rawMap, unsafe, joinKey(path, k))
    return o
  }
  return v
}

function runJson2Yaml(): string {
  let value: unknown
  let duplicateKeys: string[]
  try {
    const r = parseJson(input.value)
    value = r.value
    duplicateKeys = r.duplicateKeys
  } catch (e) {
    const pos = jsonErrorPosition(e, input.value)
    const detail = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : errMessage(e)
    run.markFail(`JSON 解析失败：${detail}`)
    throw new Error('__fail__')
  }
  const token = `dkyamlraw${Math.random().toString(36).slice(2, 10)}`
  const counter = { n: 0 }
  const rawMap = new Map<string, string>()
  const unsafe: string[] = []
  const jsonable = toJsonable(value, token, counter, rawMap, unsafe, '$')
  const dumped = yaml.dump(jsonable, { indent: indentUnit.value, lineWidth: -1 })
  let out = dumped
  if (rawMap.size) {
    out = dumped.replace(new RegExp(escapeReg(token) + '\\d{6}zz', 'g'), (m) => rawMap.get(m) ?? m)
  }
  const notes: string[] = []
  if (duplicateKeys.length) {
    notes.push(
      `检测到 ${duplicateKeys.length} 个重复键：${duplicateKeys.slice(0, 3).join('、')}${duplicateKeys.length > 3 ? ' 等' : ''}（后者生效）`
    )
  }
  if (unsafe.length) {
    notes.push(
      `${unsafe.length} 个数值超出 JS 安全范围（如 ${unsafe[0]}），已按原文输出以保留精度；注意部分工具按数值解析时仍可能丢失精度`
    )
  }
  run.markOk(notes.join('；'))
  return out
}

/* ---------------- YAML 非字符串键扫描 ---------------- */
const RE_BOOL_KEY = /^(?:true|false|True|False|TRUE|FALSE)$/
const RE_NULL_KEY = /^(?:~|null|Null|NULL)$/
const RE_INT_KEY = /^[-+]?(?:[0-9][0-9_]*|0x[0-9a-fA-F_]+|0o[0-7_]+)$/
const RE_FLOAT_KEY = /^[-+]?(?:[0-9][0-9_]*\.[0-9_]*(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[0-9][0-9_]*[eE][-+]?[0-9]+)$/
const RE_INF_KEY = /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/

interface KeyIssue {
  line: number
  key: string
  type: string
}

function keyIssueType(k: string): string | null {
  if (RE_NULL_KEY.test(k)) return 'null'
  if (RE_BOOL_KEY.test(k)) return '布尔值'
  if (RE_INT_KEY.test(k) || RE_FLOAT_KEY.test(k) || RE_INF_KEY.test(k)) return '数字'
  return null
}

/** 去掉行内注释（引号内的 # 保留） */
function stripComment(line: string): string {
  let out = ''
  let inS = false
  let inD = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (inS) {
      out += c
      if (c === "'") inS = false
    } else if (inD) {
      out += c
      if (c === '\\') {
        out += line[++i] ?? ''
      } else if (c === '"') inD = false
    } else if (c === "'") {
      inS = true
      out += c
    } else if (c === '"') {
      inD = true
      out += c
    } else if (c === '#') {
      break
    } else {
      out += c
    }
  }
  return out
}

/**
 * 扫描 YAML 文本中的非字符串键（数字 / 布尔 / null）。
 * 覆盖常见的块式与流式写法；跳过块标量内容、引号键与带标签/锚点的键。
 * js-yaml 加载后对象键已被字符串化，无法事后区分，故在文本层检测。
 */
function scanNonStringKeys(text: string): KeyIssue[] {
  const issues: KeyIssue[] = []
  const lines = text.split('\n')
  let blockIndent: number | null = null
  const checkKeyText = (k: string, lineNo: number) => {
    const type = keyIssueType(k)
    if (type) issues.push({ line: lineNo, key: k, type })
  }
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1
    if (blockIndent !== null) {
      if (rawLine.trim() === '') return
      if (/^ */.exec(rawLine)![0]!.length > blockIndent) return
      blockIndent = null
    }
    const line = stripComment(rawLine)
    if (!line.trim()) return
    // 块标量头部（key: | / key: >- / - | 等）：其后更深缩进的行是纯文本，跳过
    if (/:(?:\s|$)/.test(line) && /[|>][+-]?\d*\s*$/.test(line)) {
      blockIndent = /^ */.exec(line)![0]!.length
      return
    }
    if (/^ *(?:- +)+[|>][+-]?\d*\s*$/.test(line)) {
      blockIndent = /^ */.exec(line)![0]!.length
      return
    }
    // 块式键：行首（可带列表破折号前缀），冒号后必须有空格或行尾（YAML 规则）
    const m = /^ *(?:- +)*(?:"(?:[^"\\]|\\.)*"|'(?:[^'])*'|([^:#{}[\],&*!?'%\s][^:]*?)) *:(?=\s|$)/.exec(line)
    if (m && m[1]) checkKeyText(m[1].trim(), lineNo)
    // 形如「: value」的空键在 YAML 中是 null 键
    if (/^ *(?:- +)*:(?=\s|$)/.test(line)) checkKeyText('~', lineNo)
    // 流式键：{80: x, true: y}
    const flowRe = /(?:\{|,|&|\*) *("(?:[^"\\]|\\.)*"|'(?:[^'])*'|([^:{}[\],&*!?'%\s#][^:{}[\],]*?)) *:(?=[ \t}]|$)/g
    let fm: RegExpExecArray | null
    while ((fm = flowRe.exec(line)) !== null) {
      const k = (fm[2] ?? '').trim()
      if (k) checkKeyText(k, lineNo)
    }
  })
  return issues
}

/** 查找无法映射为 JSON 的特殊数值（.inf / .nan） */
function findNonFinite(v: unknown, path: string): { path: string; kind: string } | null {
  if (typeof v === 'number' && !Number.isFinite(v)) {
    return { path, kind: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity（.inf）' : '-Infinity（-.inf）' }
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findNonFinite(v[i], `${path}[${i}]`)
      if (r) return r
    }
    return null
  }
  if (v !== null && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      const r = findNonFinite(val, joinKey(path, k))
      if (r) return r
    }
  }
  return null
}

const YAML_NUM_TEXT = /^[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/
const YAML_INF_NAN_TEXT = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/
const JSON_NUM_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

function runYaml2Json(): string {
  const stringKept: string[] = []
  const rawKept: string[] = []
  const numberValue = (raw: string): unknown => {
    if (YAML_INF_NAN_TEXT.test(raw)) {
      if (/nan/i.test(raw)) return NaN
      return raw.startsWith('-') ? -Infinity : Infinity
    }
    if (!JSON_NUM_TEXT.test(raw)) {
      stringKept.push(raw)
      return raw
    }
    if (!isSafeJsonNumber(raw)) rawKept.push(raw)
    return new RawNumber(raw)
  }
  const numberType = (tag: string) =>
    new yaml.Type(tag, {
      kind: 'scalar',
      resolve: (d: unknown) => typeof d === 'string' && (YAML_NUM_TEXT.test(d) || YAML_INF_NAN_TEXT.test(d)),
      construct: (d: unknown) => numberValue(String(d))
    })
  const schema = yaml.JSON_SCHEMA.extend({
    implicit: [numberType('tag:yaml.org,2002:int'), numberType('tag:yaml.org,2002:float')]
  })
  let value: unknown
  try {
    // JSON_SCHEMA：只识别 null/bool/number/string，日期等不会被自动转对象
    value = yaml.load(input.value, { schema })
  } catch (e) {
    const msg = errMessage(e)
    run.markFail(`YAML 解析失败：${msg.split('\n')[0]!.trim()}。请按提示修正缩进或语法后重试`)
    throw new Error('__fail__')
  }
  const keyIssues = scanNonStringKeys(input.value)
  if (keyIssues.length) {
    const first = keyIssues[0]!
    run.markFail(
      `无法静默转换：第 ${first.line} 行的键 ${JSON.stringify(first.key || '（空键）')} 是 ${first.type}，` +
        `JSON 对象的键必须是字符串（共 ${keyIssues.length} 处）。请为键加引号，如 "${first.key || '键名'}": …`
    )
    throw new Error('__fail__')
  }
  const nf = findNonFinite(value, '$')
  if (nf) {
    run.markFail(`无法静默转换：${nf.path} 的值是 ${nf.kind}，JSON 数字不支持无穷或 NaN。请改为字符串或有限数值`)
    throw new Error('__fail__')
  }
  const notes: string[] = []
  if (stringKept.length) {
    notes.push(
      `${stringKept.length} 个标量不是 JSON 数字字面量（如 ${stringKept[0]}），已按字符串保留原文，避免 007 等被改写为数字`
    )
  }
  if (rawKept.length) {
    notes.push(`${rawKept.length} 个数值超出 JS 安全范围（如 ${rawKept[0]}），已按原文输出以保留精度`)
  }
  run.markOk(notes.join('；'))
  return stringifyJson(value, indentUnit.value)
}

/* ---------------- 执行 ---------------- */
function execute() {
  errInput.value = ''
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    return
  }
  try {
    output.value = dir.value === 'json2yaml' ? runJson2Yaml() : runYaml2Json()
  } catch (e) {
    if (errMessage(e) !== '__fail__') {
      // 理论上不会到这里：保留兜底并给出方向
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

watch([dir, indent], execute)

function loadSample() {
  input.value = dir.value === 'json2yaml' ? SAMPLE_JSON : SAMPLE_YAML
  execute()
}

function loadBadSample() {
  dir.value = 'yaml2json'
  input.value = SAMPLE_BAD
  execute()
}

function useOutputAsInput() {
  if (!output.value) {
    toast.warning('暂无输出')
    return
  }
  input.value = output.value
  dir.value = dir.value === 'json2yaml' ? 'yaml2json' : 'json2yaml' // 切换方向后 watch 会自动重算
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
  const p = transfer.take('json-yaml')
  if (p && p.from !== 'json-yaml') {
    if (input.value.trim()) replaceAsk.value = { text: p.text, from: p.from }
    else applyIncoming(p.text)
  }
})

function applyIncoming(text: string) {
  input.value = text
  replaceAsk.value = null
  execute()
}
</script>

<template>
  <div class="t03">
    <div class="t03__toolbar">
      <DkSegmented
        :model-value="dir"
        :options="[
          { value: 'json2yaml', label: 'JSON → YAML' },
          { value: 'yaml2json', label: 'YAML → JSON' }
        ]"
        @update:model-value="dir = $event as any"
      />
      <div class="t03__indent">
        <span class="t03__indent-label">缩进</span>
        <DkSegmented
          size="sm"
          :model-value="indent"
          :options="[
            { value: '2', label: '2 空格' },
            { value: '4', label: '4 空格' }
          ]"
          @update:model-value="indent = $event as any"
        />
      </div>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入与当前方向匹配的示例" @click="loadSample">载入示例</DkButton>
      <DkButton size="sm" variant="ghost" title="载入无法无损转换的 YAML（数字键 / 标签）" @click="loadBadSample">不兼容示例</DkButton>
      <DkButton size="sm" variant="ghost" title="把结果填入输入并切换方向，验证往返转换" @click="useOutputAsInput">
        <DkIcon name="swap" :size="12" />输出转输入
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />转换
      </DkButton>
      <span class="t03__kbd-hint tertiary">⌘/Ctrl + Enter 执行</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="[dir === 'json2yaml' ? 'js-yaml · 不折行' : 'JSON_SCHEMA（日期保持字符串）']"
      :retry="execute"
    />

    <div class="t03__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="dir === 'json2yaml' ? 'JSON 输入' : 'YAML 输入'"
            :placeholder="dir === 'json2yaml' ? '粘贴 JSON 文本，或点击「载入示例」' : '粘贴 YAML 文本，或点击「载入示例」'"
            :error="errInput"
            :height="'calc(56vh - 60px)'"
            :filename="dir === 'json2yaml' ? 'input.json' : 'input.yaml'"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            :lang="dir === 'json2yaml' ? 'YAML 结果' : 'JSON 结果'"
            placeholder="结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :height="'calc(56vh - 60px)'"
            :filename="dir === 'json2yaml' ? 'output.yaml' : 'output.json'"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="output && run.status.value === 'ok'" class="t03__send">
      <SendToMenu :text="output" from="json-yaml" :kind="dir === 'yaml2json' ? 'json' : 'text'" />
    </div>

    <DkCollapse title="转换规则与限制">
      <ul class="t03__notes">
        <li>YAML 解析使用 <span class="mono">JSON_SCHEMA</span>：只识别 null / 布尔 / 数字 / 字符串，<span class="mono">2024-01-01</span> 等日期保持字符串；<span class="mono">007</span> 等不是 JSON 数字字面量的标量按原文保留为字符串，超出 JS 安全范围的整数 / 小数按原文输出，均不再静默改写（加引号可确保任意标量保持字符串）。</li>
        <li>无法无损映射的情况会直接报错而非静默转换：非字符串键（如 <span class="mono">80:</span>）、YAML 标签（如 <span class="mono">!!timestamp</span>）、<span class="mono">.inf / .nan</span>、重复键。</li>
        <li>JSON → YAML 使用 <span class="mono">js-yaml dump</span>（<span class="mono">lineWidth: -1</span> 不折行）；超出 JS 安全范围的数字按原文输出以保留精度。</li>
        <li>复制 / 下载请使用结果编辑器右上角按钮，内容不含行号。</li>
      </ul>
    </DkCollapse>

    <DkModal :open="!!replaceAsk" title="替换当前输入？" width="420px" @close="replaceAsk = null">
      <p>
        来自其他工具的结果准备发送到本工具，但当前已有输入。
        替换后原输入将丢失（不会自动保存）。
      </p>
      <template #footer>
        <DkButton size="sm" @click="replaceAsk = null">保留当前输入</DkButton>
        <DkButton size="sm" variant="primary" @click="replaceAsk && applyIncoming(replaceAsk.text)">替换并转换</DkButton>
      </template>
    </DkModal>
  </div>
</template>

<style scoped>
.t03 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t03__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t03__indent {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t03__indent-label {
  font-size: 12px;
  color: var(--text-secondary);
}
.t03__kbd-hint {
  font-size: 11px;
  white-space: nowrap;
}
.t03__panes {
  min-height: 320px;
}
.t03__send {
  display: flex;
  justify-content: flex-end;
}
.t03__notes {
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
