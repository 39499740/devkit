<script setup lang="ts">
import yaml from 'js-yaml'
import type { ToolMeta } from '~/data/tools'
import { applyYamlRawMap, jsonErrorPosition, loadYamlPreservingNumbers, localizeJsonMessage, parseJson, stringifyJson, toYamlJsonable } from '~/utils/json'

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
// 数值保真逻辑与 utils/json.ts 共用：超出安全范围的数字用占位符替换，dump 后回填原文。

function runJson2Yaml(): string {
  let value: unknown
  let duplicateKeys: string[]
  try {
    const r = parseJson(input.value)
    value = r.value
    duplicateKeys = r.duplicateKeys
  } catch (e) {
    const pos = jsonErrorPosition(e, input.value)
    const detail = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : localizeJsonMessage(errMessage(e))
    run.markFail(`JSON 解析失败：${detail}`)
    throw new Error('__fail__')
  }
  const token = `dkyamlraw${Math.random().toString(36).slice(2, 10)}`
  const counter = { n: 0 }
  const rawMap = new Map<string, string>()
  const unsafe: string[] = []
  const jsonable = toYamlJsonable(value, token, counter, rawMap, unsafe, '$')
  const dumped = yaml.dump(jsonable, { indent: indentUnit.value, lineWidth: -1 })
  const out = applyYamlRawMap(dumped, token, rawMap)
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

/* ---------------- YAML → JSON ---------------- */
// 保真加载逻辑与 utils/json.ts 共用（JSON_SCHEMA + 数字覆盖 + 非法键 / .inf/.nan 检测）。

function runYaml2Json(): string {
  let value: unknown
  let notes: string[]
  try {
    const r = loadYamlPreservingNumbers(input.value)
    value = r.value
    notes = r.notes
  } catch (e) {
    run.markFail(errMessage(e))
    throw new Error('__fail__')
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
