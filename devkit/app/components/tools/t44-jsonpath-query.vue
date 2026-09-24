<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { getTool } from '~/data/tools'
import { evalJsonPath, jsonPathSamples } from '~/utils/jsonpath'
import { jsonErrorPosition, localizeJsonMessage, toPlainJson } from '~/utils/json'
import { evalJmesPath, jmesPathSamples } from '~/utils/jmespath'
import { runComputation } from '~/workflow/workers/run-compute'

defineProps<{ tool: ToolMeta }>()

type Lang = 'jsonpath' | 'jmespath'

const toast = useToast()
const clipboard = useClipboard()
const transfer = useTransfer()

const lang = ref<Lang>('jsonpath')
const expr = ref('$.store.book[?(@.price < 100)].title')
const input = ref('')
const resultText = ref('')
const matches = ref<{ path: string; value: unknown }[]>([])
const warnings = ref<string[]>([])
const elapsed = ref(0)
const source = ref<{ from: string; at: number } | null>(null)

const SAMPLE = `{
  "store": {
    "name": "城南书店",
    "book": [
      { "title": "深入理解 Java 虚拟机", "price": 99 },
      { "title": "设计中的设计", "price": 68 },
      { "title": "Vue.js 设计与实现", "price": 119 },
      { "title": "代码整洁之道", "price": 59 },
      { "title": "重构：改善既有代码的设计", "price": 128 },
      { "title": "JavaScript 高级程序设计", "price": 149 }
    ],
    "bicycle": { "color": "red", "price": 399.0 }
  }
}`

const samples = computed(() =>
  lang.value === 'jsonpath'
    ? ['$.store.book[?(@.price < 100)].title', '$.store.book[*].title', '$..price', '$.store.book[-1].title']
    : ['store.book[?price < `100`].title', 'sort_by(store.book, &price)[*].title', 'length(store.book)', 'store.book[*].{t: title, p: price}']
)

const sig = () => JSON.stringify([lang.value, expr.value, input.value])
const run = useToolRun(sig)

/** 异步求值序号：只采纳最后一次发起的结果，避免慢请求覆盖新结果 */
let runToken = 0
/** 求值进行中（仅用于按钮 loading 反馈，不阻断后续输入触发的求值） */
const busy = ref(false)

const fromName = computed(() => (source.value ? (getTool(source.value.from)?.name ?? source.value.from) : ''))

const sourceAge = computed(() => {
  if (!source.value) return ''
  const diff = Date.now() - source.value.at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  return `${Math.floor(diff / 3_600_000)} 小时前`
})

// 接收其他工具的内存传递
onMounted(() => {
  const p = transfer.take('jsonpath-query')
  if (!p) return
  input.value = p.text
  source.value = { from: p.from, at: p.ts }
  if (p.kind === 'json') {
    expr.value = '$'
  }
  execute()
})

function resultSummary(value: unknown): string {
  if (Array.isArray(value)) {
    const types = [...new Set(value.map((v) => (v === null ? 'null' : Array.isArray(v) ? '数组' : typeof v === 'object' ? '对象' : typeof v === 'number' ? '数字' : typeof v === 'string' ? '字符串' : typeof v)))]
    return `${value.length} 项 · ${types.join(' / ')}数组`
  }
  if (value && typeof value === 'object') return `${Object.keys(value as object).length} 个字段 · 对象`
  return `单个值 · ${value === null ? 'null' : typeof value}`
}

/** JSON 语法错误中文化：给出「第 X 行第 Y 列附近：<中文>」，不回显 V8 英文原文 */
function localizeJsonParseError(e: unknown, text: string): string {
  const pos = jsonErrorPosition(e, text)
  return pos
    ? `JSON 解析失败：第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}`
    : `JSON 解析失败：${localizeJsonMessage(errMessage(e))}`
}

/**
 * 求值异常中文化：已有中文错误原样保留（如「必须以 $ 开头」）；
 * 栈溢出给出明确的深层嵌套提示；其它无 CJK 的英文错误统一映射为中性中文。
 */
function localizeQueryError(e: unknown): string {
  const msg = errMessage(e)
  if (/[\u4e00-\u9fa5]/.test(msg)) return msg
  if (/Maximum call stack/i.test(msg)) return '嵌套层级过深，超出计算上限，请减少嵌套层级'
  return '表达式求值失败：请检查表达式与输入'
}

async function execute() {
  if (!input.value.trim()) {
    runToken += 1
    busy.value = false
    run.markIdle()
    resultText.value = ''
    matches.value = []
    warnings.value = []
    return
  }
  const token = ++runToken
  // 快照入参：Worker 消息与同步回退读到同一份输入
  const dataText = input.value
  const query = expr.value
  const langSnapshot = lang.value
  // 先本地解析 JSON：语法错误直接给出中文定位，避免 Worker 回传 V8 英文
  let data: unknown
  try {
    data = toPlainJson(parseJson(dataText).value)
  } catch (e) {
    if (token !== runToken) return
    busy.value = false
    resultText.value = ''
    matches.value = []
    warnings.value = []
    run.markFail(localizeJsonParseError(e, dataText))
    return
  }
  busy.value = true
  const t0 = performance.now()
  try {
    // JSONPath 走 Worker + 超时，隔离 =~ 正则的灾难性回溯；
    // JMESPath 暂无 Worker 分支（其语法不含用户可控正则），保持同步求值。
    const res =
      langSnapshot === 'jsonpath'
        ? await runComputation(
            { fn: 'path', dataText, expr: query },
            () => evalJsonPath(data, query),
            2000
          )
        : evalJmesPath(data, query)
    if (token !== runToken) return
    matches.value = res.matches
    warnings.value = res.warnings
    resultText.value = JSON.stringify(
      res.matches.length === 1 ? res.matches[0]!.value : res.matches.map((m) => m.value),
      null,
      2
    )
    elapsed.value = Math.round(performance.now() - t0)
    run.markOk(`${res.matches.length} 个匹配`)
  } catch (e) {
    if (token !== runToken) return
    resultText.value = ''
    matches.value = []
    warnings.value = []
    run.markFail(localizeQueryError(e))
  } finally {
    if (token === runToken) busy.value = false
  }
}

function clearSource() {
  source.value = null
  toast.success('已清除来源标记，输入不会被保存')
}

function sendTo(slug: string) {
  if (!resultText.value) {
    toast.warning('还没有可传递的结果')
    return
  }
  transfer.send(resultText.value, 'jsonpath-query', 'json')
  transfer.deliver(slug)
}

async function paste() {
  try {
    const text = await navigator.clipboard.readText()
    if (!text.trim()) {
      toast.warning('剪贴板里没有文本')
      return
    }
    input.value = text
    execute()
  } catch {
    toast.warning('浏览器未授予剪贴板读取权限，请手动粘贴')
  }
}

const meta = computed(() => {
  const list: string[] = []
  if (input.value) list.push(`输入 ${lineCount(input.value)} 行 · ${formatBytes(byteLength(input.value))}`)
  if (run.status.value === 'ok') list.push(`耗时 ${elapsed.value} ms`)
  return list
})

watch(lang, () => {
  expr.value = samples.value[0]!
  execute()
})
watch([expr, input], execute)

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
  <div class="t44">
    <div v-if="source" class="t44__source">
      <DkIcon name="corner-right-down" :size="14" />
      <span class="t44__source-text">
        来源：{{ fromName }} · {{ sourceAge }}接收 1 次
      </span>
      <span class="t44__badge">
        <DkIcon name="shield-check" :size="11" />输入仅存于本次页面内存
      </span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="clearSource">
        <DkIcon name="x" :size="12" />清除来源
      </DkButton>
    </div>

    <div class="t44__toolbar">
      <DkSegmented
        size="sm"
        :model-value="lang"
        :options="[
          { value: 'jsonpath', label: 'JSONPath' },
          { value: 'jmespath', label: 'JMESPath' }
        ]"
        aria-label="查询语法"
        @update:model-value="lang = $event as Lang"
      />
      <label class="t44__expr">
        <DkIcon name="search" :size="14" />
        <input
          v-model="expr"
          class="t44__expr-input mono"
          :aria-label="lang === 'jsonpath' ? 'JSONPath 表达式' : 'JMESPath 表达式'"
          placeholder="$.store.book[?(@.price < 100)].title"
          @keydown.enter.prevent="execute"
        />
      </label>
      <DkButton size="sm" variant="primary" :loading="busy" @click="execute">
        <DkIcon name="play" :size="12" />运行
      </DkButton>
      <DkButton
        size="sm"
        :disabled="!resultText || run.status.value !== 'ok'"
        @click="clipboard.copy(resultText, '查询结果')"
      >
        <DkIcon name="copy" :size="12" />复制结果
      </DkButton>
      <DkButton size="sm" :disabled="!resultText || run.status.value !== 'ok'" @click="sendTo('json2java')">
        <DkIcon name="coffee" :size="12" />JSON 转 Java
      </DkButton>
      <DkButton size="sm" :disabled="!resultText || run.status.value !== 'ok'" @click="sendTo('json-schema')">
        <DkIcon name="shield-check" :size="12" />JSON Schema
      </DkButton>
    </div>

    <div class="t44__chips">
      <span class="tertiary">示例</span>
      <button v-for="s in samples" :key="s" class="t44__chip mono" @click="expr = s; execute()">{{ s }}</button>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="paste">
        <DkIcon name="clipboard" :size="12" />粘贴
      </DkButton>
      <DkButton size="sm" variant="ghost" @click="input = SAMPLE; source = null; execute()">
        <DkIcon name="zap" :size="12" />载入示例
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : warnings.join(' · ')"
      :meta="meta"
      :retry="execute"
    />

    <div class="t44__panes">
      <SplitPanes :initial="48" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="JSON 输入"
            placeholder="粘贴 JSON 文本，或点击「载入示例」"
            :height="'calc(60vh - 60px)'"
            filename="input.json"
            :error="run.status.value === 'error' ? run.errorMsg.value : ''"
          />
        </template>
        <template #right>
          <div class="t44__result">
            <div class="t44__result-head">
              <span class="t44__panel-title">查询结果</span>
              <span v-if="run.status.value === 'ok'" class="t44__badge t44__badge--ok">
                <DkIcon name="circle-check" :size="11" />{{ matches.length }} 个匹配
              </span>
              <span class="grow"></span>
              <DkButton
                size="sm"
                variant="ghost"
                :disabled="!resultText || run.status.value !== 'ok'"
                @click="clipboard.copy(resultText, '查询结果')"
              >
                <DkIcon name="copy" :size="12" />复制结果
              </DkButton>
              <DkButton
                size="sm"
                variant="ghost"
                :disabled="!resultText || run.status.value !== 'ok'"
                @click="downloadText('query-result.json', resultText, 'application/json')"
              >
                <DkIcon name="download" :size="12" />导出
              </DkButton>
            </div>
            <div class="t44__result-sub">
              <span>结果 JSON</span>
              <span class="tertiary">{{ resultText ? resultSummary(matches.length === 1 ? matches[0]!.value : matches.map((m) => m.value)) : '尚未运行' }}</span>
            </div>
            <div class="t44__result-body">
              <DkEditor
                :model-value="resultText"
                readonly
                hide-toolbar
                lang="JSON"
                placeholder="结果将显示在这里"
                :stale="run.status.value === 'stale'"
                :height="'100%'"
                filename="query-result.json"
              />
            </div>
            <div class="t44__result-sub">
              <span>匹配路径</span>
              <span class="tertiary">按文档顺序 · 共 {{ matches.length }} 项</span>
            </div>
            <div class="t44__paths">
              <p v-if="!matches.length" class="t44__empty">还没有匹配结果。</p>
              <div v-for="(m, i) in matches" :key="`${m.path}-${i}`" class="t44__pathrow">
                <span class="t44__idx mono">{{ i }}</span>
                <span class="t44__path mono">{{ m.path }}</span>
                <span class="t44__val">{{ typeof m.value === 'object' ? JSON.stringify(m.value) : String(m.value) }}</span>
              </div>
            </div>
            <div class="t44__result-foot mono">
              {{ lang === 'jsonpath' ? 'JSONPath' : 'JMESPath' }} · UTF-8
              <span class="t44__badge t44__badge--plain">
                <DkIcon name="shield-check" :size="11" />本地执行
              </span>
              <span class="grow"></span>
              <span v-if="run.status.value === 'ok'">耗时 {{ elapsed }} ms</span>
            </div>
          </div>
        </template>
      </SplitPanes>
    </div>

    <div v-if="resultText && run.status.value === 'ok'" class="t44__send">
      <span class="tertiary">继续处理：</span>
      <SendToMenu :text="resultText" from="jsonpath-query" kind="json" />
    </div>
  </div>
</template>

<style scoped>
.t44 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t44__source {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
}
.t44__source-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t44__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  flex-wrap: wrap;
}
.t44__expr {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 240px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.t44__expr-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-primary);
}
.t44__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11.5px;
}
.t44__chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
}
.t44__chip:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.t44__panes {
  min-height: 320px;
}
.t44__result {
  display: flex;
  flex-direction: column;
  height: calc(60vh - 60px);
  min-height: 340px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t44__result-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.t44__result-sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 11.5px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.t44__result-body {
  flex: 1 1 auto;
  min-height: 120px;
  overflow: hidden;
}
.t44__paths {
  max-height: 148px;
  overflow: auto;
  flex-shrink: 0;
}
.t44__empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.t44__pathrow {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.t44__idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}
.t44__path {
  color: var(--text-secondary);
  flex-shrink: 0;
}
.t44__val {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t44__result-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 26px;
  padding: 0 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.t44__panel-title {
  font-size: 13px;
  font-weight: 600;
}
.t44__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--accent);
  font-size: 11px;
  white-space: nowrap;
}
.t44__badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.t44__badge--plain {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.t44__send {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
}
</style>
