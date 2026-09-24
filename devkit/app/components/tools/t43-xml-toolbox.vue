<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { jsonErrorPosition, localizeJsonMessage } from '~/utils/json'
import { formatXml, minifyXml, xmlToJson, jsonToXml, queryXPath, type XPathMatch } from '~/utils/xml'

defineProps<{ tool: ToolMeta }>()

type Mode = 'format' | 'minify' | 'convert' | 'xpath'

const toast = useToast()
const clipboard = useClipboard()
const transfer = useTransfer()
const { prefs } = usePrefs()

const mode = ref<Mode>('xpath')
const indent = ref<'2' | '4'>(prefs.value.defaultIndent === '4' ? '4' : '2')
const direction = ref<'xml2json' | 'json2xml'>('xml2json')
const input = ref('')
const output = ref('')
const warnings = ref<string[]>([])
const elapsed = ref(0)

const expr = ref('//catalog/book/title')
const nsEnabled = ref(false)
const nsPrefix = ref('ns')
const nsUri = ref('urn:books')
const matches = ref<XPathMatch[]>([])
const highlight = ref('')

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="b-101" category="tech">
    <title>深入理解 Java 虚拟机</title>
    <author>周志明</author>
    <price currency="CNY">99.00</price>
  </book>
  <book id="b-102" category="design">
    <title>设计中的设计</title>
    <author>原研哉</author>
    <price currency="CNY">68.00</price>
  </book>
  <book id="b-103" category="tech">
    <title>Vue.js 设计与实现</title>
    <author>霍春阳</author>
    <price currency="CNY">119.00</price>
  </book>
</catalog>`

const SAMPLES = ["//catalog/book/title", "//book[@category='tech']", '//book/price']

const sig = () =>
  JSON.stringify([
    mode.value,
    indent.value,
    direction.value,
    input.value,
    expr.value,
    nsEnabled.value,
    nsPrefix.value,
    nsUri.value
  ])
const run = useToolRun(sig)

// G01/G09：接收来自其他工具的内存传递
onMounted(() => {
  const p = transfer.take('xml-toolbox')
  if (p && p.from !== 'xml-toolbox') {
    input.value = p.text
    execute()
  }
})

function namespaces() {
  return nsEnabled.value && nsPrefix.value.trim() && nsUri.value.trim()
    ? [{ prefix: nsPrefix.value.trim(), uri: nsUri.value.trim() }]
    : []
}

function execute() {
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    matches.value = []
    warnings.value = []
    highlight.value = ''
    return
  }
  const t0 = performance.now()
  try {
    if (mode.value === 'xpath') {
      const res = queryXPath(input.value, expr.value, namespaces())
      matches.value = res.matches
      warnings.value = res.warnings
      highlight.value = input.value
      output.value = JSON.stringify(
        res.matches.map((m) => m.value),
        null,
        2
      )
      elapsed.value = Math.round(performance.now() - t0)
      run.markOk(res.warnings.join(' · '))
      return
    }
    matches.value = []
    if (mode.value === 'format') {
      const res = formatXml(input.value, Number(indent.value))
      output.value = res.xml
      warnings.value = res.warnings
      run.markOk(`${res.nodes} 个元素`)
    } else if (mode.value === 'minify') {
      const res = minifyXml(input.value)
      output.value = res.xml
      warnings.value = res.warnings
      run.markOk(`压缩后 ${res.chars} 字符`)
    } else if (direction.value === 'xml2json') {
      const res = xmlToJson(input.value)
      output.value = JSON.stringify(res.value, null, 2)
      warnings.value = [...res.warnings, '属性写成 @name，纯文本写成 #text，同名子节点合并为数组']
      run.markOk('已转为 JSON')
    } else {
      const parsed = parseJson(input.value)
      const res = jsonToXml(parsed.value)
      output.value = res.xml
      warnings.value = res.warnings
      run.markOk('已转为 XML')
    }
    elapsed.value = Math.round(performance.now() - t0)
  } catch (e) {
    output.value = ''
    matches.value = []
    warnings.value = []
    highlight.value = ''
    // JSON → XML 的输入是 JSON，解析失败时按其它 JSON 工具页的口径给出中文定位，
    // 不再直接回显 V8 英文原文；其余模式（XML / XPath）沿用 XML 工具自身的中文错误。
    if (mode.value === 'convert' && direction.value === 'json2xml') {
      const pos = jsonErrorPosition(e, input.value)
      run.markFail(
        pos
          ? `JSON 解析失败：第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}`
          : `JSON 解析失败：${localizeJsonMessage(errMessage(e))}`
      )
    } else {
      run.markFail(errMessage(e))
    }
  }
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

function copyPaths() {
  const text = matches.value.map((m) => m.path).join('\n')
  if (!text) {
    toast.warning('还没有可复制的路径')
    return
  }
  clipboard.copy(text, '匹配路径')
}

const sourceLines = computed(() => {
  const text = highlight.value
  if (!text) return [] as { n: number; parts: { text: string; hit: boolean }[] }[]
  const ranges = matches.value
    .filter((m) => m.from >= 0)
    .map((m) => [m.from, m.to] as [number, number])
    .sort((a, b) => a[0] - b[0])
  const lines: { n: number; parts: { text: string; hit: boolean }[] }[] = []
  let offset = 0
  text.split('\n').forEach((line, i) => {
    const start = offset
    const end = offset + line.length
    const parts: { text: string; hit: boolean }[] = []
    let cursor = start
    for (const [f, t] of ranges) {
      if (t <= start || f >= end) continue
      const a = Math.max(f, start)
      const b = Math.min(t, end)
      if (a > cursor) parts.push({ text: text.slice(cursor, a), hit: false })
      if (b > a) parts.push({ text: text.slice(a, b), hit: true })
      cursor = b
    }
    if (cursor < end) parts.push({ text: text.slice(cursor, end), hit: false })
    lines.push({ n: i + 1, parts: parts.length ? parts : [{ text: line, hit: false }] })
    offset = end + 1
  })
  return lines
})

const hitCount = computed(() => matches.value.filter((m) => m.from >= 0).length)

/** 结果内容类型：XPath 结果与 XML→JSON 输出是 JSON，其余（格式化 / 压缩 / JSON→XML）是文本 */
const resultKind = computed<'json' | 'text'>(() =>
  mode.value === 'xpath' || (mode.value === 'convert' && direction.value === 'xml2json') ? 'json' : 'text'
)

const inputMeta = computed(() => {
  if (!input.value) return []
  return [`${lineCount(input.value)} 行`, formatBytes(byteLength(input.value))]
})

const outputMeta = computed(() => {
  const list = [...inputMeta.value]
  if (run.status.value === 'ok') list.push(`耗时 ${elapsed.value} ms`)
  return list
})

watch([mode, indent, direction, nsEnabled, nsPrefix, nsUri], execute)

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
  <div class="t43">
    <div class="t43__tabs" role="tablist" aria-label="XML 模式">
      <button
        v-for="t in [
          { v: 'format', label: '格式化' },
          { v: 'minify', label: '压缩' },
          { v: 'convert', label: 'XML ↔ JSON' },
          { v: 'xpath', label: 'XPath' }
        ]"
        :key="t.v"
        class="t43__tab"
        :class="{ 't43__tab--on': mode === t.v }"
        role="tab"
        :aria-selected="mode === t.v"
        @click="mode = t.v as Mode"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="t43__toolbar">
      <template v-if="mode === 'xpath'">
        <label class="t43__switch">
          <DkSwitch :on="nsEnabled" label="启用命名空间" @toggle="nsEnabled = !nsEnabled" />
          <span class="t43__label">启用命名空间</span>
        </label>
        <label v-if="nsEnabled" class="t43__ns">
          <span class="t43__label">前缀</span>
          <input v-model="nsPrefix" class="t43__input t43__input--sm mono" aria-label="命名空间前缀" />
          <span class="t43__label mono">→</span>
          <input v-model="nsUri" class="t43__input t43__input--md mono" aria-label="命名空间 URI" />
        </label>
        <DkButton size="sm" variant="primary" @click="execute">
          <DkIcon name="play" :size="12" />查询
        </DkButton>
        <DkButton size="sm" :disabled="!output || run.status.value !== 'ok'" @click="clipboard.copy(output, '查询结果')">
          <DkIcon name="copy" :size="12" />复制
        </DkButton>
      </template>
      <template v-else>
        <span class="t43__label">缩进</span>
        <DkSegmented
          size="sm"
          :model-value="indent"
          :options="[
            { value: '2', label: '2' },
            { value: '4', label: '4' }
          ]"
          aria-label="缩进宽度"
          @update:model-value="indent = $event as '2' | '4'"
        />
        <template v-if="mode === 'convert'">
          <span class="t43__sep"></span>
          <DkSegmented
            size="sm"
            :model-value="direction"
            :options="[
              { value: 'xml2json', label: 'XML → JSON' },
              { value: 'json2xml', label: 'JSON → XML' }
            ]"
            aria-label="转换方向"
            @update:model-value="direction = $event as 'xml2json' | 'json2xml'"
          />
        </template>
        <DkButton size="sm" variant="primary" @click="execute">
          <DkIcon name="play" :size="12" />执行
        </DkButton>
      </template>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" @click="paste">
        <DkIcon name="clipboard" :size="12" />粘贴
      </DkButton>
      <DkButton size="sm" variant="ghost" @click="input = SAMPLE; execute()">
        <DkIcon name="zap" :size="12" />载入示例
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : warnings.join(' · ')"
      :meta="outputMeta"
      :retry="execute"
    />

    <div class="t43__panes">
      <SplitPanes :initial="46" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            lang="XML 输入"
            placeholder="粘贴 XML 文档，或点击「载入示例」"
            :height="'calc(60vh - 60px)'"
            filename="input.xml"
            :error="run.status.value === 'error' ? run.errorMsg.value : ''"
          />
        </template>
        <template #right>
          <div v-if="mode !== 'xpath'" class="t43__result">
            <DkEditor
              :model-value="output"
              readonly
              :lang="mode === 'convert' && direction === 'xml2json' ? '结果 · JSON' : '结果 · XML'"
              placeholder="结果将显示在这里"
              :stale="run.status.value === 'stale'"
              :height="'calc(60vh - 60px)'"
              :filename="mode === 'convert' && direction === 'xml2json' ? 'result.json' : 'result.xml'"
            />
          </div>
          <div v-else class="t43__xpath">
            <div class="t43__panelhead">
              <span class="t43__panel-title">XPath 查询</span>
              <span v-if="run.status.value === 'ok'" class="t43__badge" :class="matches.length ? 't43__badge--ok' : ''">
                <DkIcon name="circle-check" :size="12" />{{ matches.length }} 个匹配
              </span>
              <span class="grow"></span>
              <DkButton
                size="sm"
                variant="ghost"
                :disabled="!output || run.status.value !== 'ok'"
                @click="downloadText('xpath-result.json', output, 'application/json')"
              >
                <DkIcon name="download" :size="12" />导出结果
              </DkButton>
              <DkButton size="sm" variant="ghost" :disabled="!matches.length" @click="copyPaths">
                <DkIcon name="copy" :size="12" />复制路径
              </DkButton>
            </div>

            <div class="t43__expr">
              <div class="t43__expr-head">
                <span class="t43__label">XPath 表达式</span>
                <span v-if="nsEnabled" class="tertiary mono">{{ nsPrefix }} = {{ nsUri }}</span>
                <span class="grow"></span>
                <span class="t43__badge t43__badge--plain">XPath 1.0</span>
              </div>
              <div class="t43__expr-row">
                <DkIcon name="search" :size="14" />
                <input
                  v-model="expr"
                  class="t43__expr-input mono"
                  aria-label="XPath 表达式"
                  placeholder="//catalog/book/title"
                  @keydown.enter.prevent="execute"
                />
                <DkButton size="sm" variant="primary" @click="execute">查询</DkButton>
              </div>
              <div class="t43__chips">
                <span class="tertiary">示例</span>
                <button v-for="s in SAMPLES" :key="s" class="t43__chip mono" @click="expr = s; execute()">
                  {{ s }}
                </button>
              </div>
            </div>

            <div class="t43__listhead">
              <span>匹配节点</span>
              <span class="tertiary">节点路径</span>
            </div>
            <div class="t43__list">
              <p v-if="!matches.length" class="t43__empty">还没有匹配结果，输入表达式后点击「查询」。</p>
              <div v-for="(m, i) in matches" :key="`${m.path}-${i}`" class="t43__item">
                <span class="t43__idx mono">{{ i + 1 }}</span>
                <div class="t43__item-body">
                  <span class="t43__item-path mono">{{ m.path }}</span>
                  <span class="t43__item-value">{{ m.value || '（空节点）' }}</span>
                </div>
                <span class="t43__badge t43__badge--plain">{{ m.type }}</span>
              </div>
            </div>

            <div class="t43__listhead">
              <span>匹配定位</span>
              <span class="tertiary">高亮 {{ hitCount }} 处匹配</span>
            </div>
            <div class="t43__locate mono">
              <div v-for="l in sourceLines" :key="l.n" class="t43__line">
                <span class="t43__ln">{{ l.n }}</span>
                <span class="t43__code">
                  <template v-for="(p, pi) in l.parts" :key="pi">
                    <mark v-if="p.hit" class="t43__hit">{{ p.text }}</mark>
                    <template v-else>{{ p.text }}</template>
                  </template>
                </span>
              </div>
            </div>
          </div>
        </template>
      </SplitPanes>
    </div>

    <div v-if="output && run.status.value === 'ok'" class="t43__send">
      <span class="tertiary">继续处理：</span>
      <SendToMenu :text="output" from="xml-toolbox" :kind="resultKind" />
    </div>
  </div>
</template>

<style scoped>
.t43 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t43__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}
.t43__tab {
  height: 36px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.t43__tab--on {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 500;
}
.t43__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t43__label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t43__switch {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
}
.t43__ns {
  display: flex;
  align-items: center;
  gap: 6px;
}
.t43__input {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  font-size: 12px;
  color: var(--text-primary);
}
.t43__input--sm {
  width: 64px;
}
.t43__input--md {
  width: 150px;
}
.t43__sep {
  width: 1px;
  height: 20px;
  background: var(--border);
}
.t43__panes {
  min-height: 320px;
}
.t43__result {
  min-width: 0;
  height: 100%;
}
.t43__xpath {
  display: flex;
  flex-direction: column;
  height: calc(60vh - 60px);
  min-height: 320px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t43__panelhead {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.t43__panel-title {
  font-size: 13px;
  font-weight: 600;
}
.t43__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 21px;
  padding: 0 8px;
  border-radius: 11px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
  white-space: nowrap;
}
.t43__badge--ok {
  background: var(--ok-soft);
  color: var(--ok);
}
.t43__badge--plain {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.t43__expr {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.t43__expr-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.t43__expr-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
}
.t43__expr-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  color: var(--text-primary);
}
.t43__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  flex-wrap: wrap;
  font-size: 11.5px;
}
.t43__chip {
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  background: var(--surface-subtle);
  color: var(--text-secondary);
  font-size: 11.5px;
}
.t43__chip:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.t43__listhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  font-size: 11.5px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.t43__list {
  max-height: 152px;
  overflow: auto;
  flex-shrink: 0;
}
.t43__empty {
  padding: 12px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.t43__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.t43__idx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  font-size: 11px;
  flex-shrink: 0;
}
.t43__item-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.t43__item-path {
  font-size: 12px;
  color: var(--text-secondary);
}
.t43__item-value {
  font-size: 12.5px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t43__locate {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 0;
  font-size: var(--code-font-size);
  line-height: 1.7;
  background: var(--editor-bg);
}
.t43__line {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  white-space: pre;
  padding: 0 12px;
}
.t43__ln {
  width: 22px;
  text-align: right;
  color: var(--gutter-text);
  flex-shrink: 0;
}
.t43__code {
  flex: 1;
  min-width: 0;
}
.t43__hit {
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 3px;
  outline: 1px solid var(--accent-ring);
}
.t43__send {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 12px;
}
</style>
