<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

const source = ref('')
const flags = ref('g')
const text = ref('')
const replacement = ref('')

interface WNamed {
  name: string
  value: string | null
}
interface WMatch {
  index: number
  end: number
  text: string
  groups: (string | null)[]
  named: WNamed[] | null
}
interface WResult {
  ok: boolean
  matches: WMatch[]
  replaced: string | null
  capped: boolean
  error?: string
}

const result = ref<WResult | null>(null)
const running = ref(false)
const lastMs = ref(0)
const clipboard = useClipboard()

const sig = () => JSON.stringify([source.value, flags.value, text.value, replacement.value])
const run = useToolRun(sig)

/** JS 合法 flags：d g i m s u v y；u/v 互斥 */
const VALID_FLAGS = 'dgimsuvy'

function validateFlags(f: string): string | null {
  if (!f) return null
  const seen = new Set<string>()
  for (const ch of f) {
    if (!VALID_FLAGS.includes(ch)) return `不支持的 flag「${ch}」（JavaScript 支持 d g i m s u v y）`
    if (seen.has(ch)) return `flag「${ch}」重复`
    seen.add(ch)
  }
  if (seen.has('u') && seen.has('v')) return 'u 与 v 不能同时使用'
  return null
}

/** 行内实时语法校验（构造正则不会执行匹配，同步安全） */
const liveError = computed(() => {
  const fe = validateFlags(flags.value)
  if (fe) return `flags 非法：${fe}`
  if (!source.value) return ''
  try {
    new RegExp(source.value, flags.value)
    return ''
  } catch (e) {
    return `表达式语法错误：${errMessage(e)}`
  }
})

/** Web Worker 内联脚本：Blob 创建，只在执行时实例化（SSR 安全） */
const WORKER_SRC = `
self.onmessage = function (e) {
  var d = e.data
  function serialize(m) {
    var groups = []
    for (var i = 1; i < m.length; i++) groups.push(m[i] === undefined ? null : m[i])
    var named = null
    if (m.groups) {
      named = []
      for (var k in m.groups) named.push({ name: k, value: m.groups[k] === undefined ? null : m.groups[k] })
    }
    return { index: m.index, end: m.index + m[0].length, text: m[0], groups: groups, named: named }
  }
  try {
    var re = new RegExp(d.source, d.flags)
    var matches = []
    var capped = false
    if (re.global || re.sticky) {
      var m
      var guard = 0
      while ((m = re.exec(d.text)) !== null) {
        matches.push(serialize(m))
        if (m[0] === '') re.lastIndex++
        if (++guard > 200000) { capped = true; break }
      }
    } else {
      var one = re.exec(d.text)
      if (one) matches.push(serialize(one))
    }
    var replaced = null
    if (d.replacement !== '') {
      replaced = d.text.replace(new RegExp(d.source, d.flags), d.replacement)
    }
    self.postMessage({ ok: true, matches: matches, replaced: replaced, capped: capped })
  } catch (err) {
    self.postMessage({ ok: false, matches: [], replaced: null, capped: false, error: String(err && err.message ? err.message : err) })
  }
}
`

const TIMEOUT_MS = 2000
let workerRef: Worker | null = null

function runInWorker(): Promise<WResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    const blob = new Blob([WORKER_SRC], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    const w = new Worker(url)
    workerRef = w
    const cleanup = () => {
      w.terminate()
      URL.revokeObjectURL(url)
      if (workerRef === w) workerRef = null
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('TIMEOUT'))
    }, TIMEOUT_MS)
    w.onmessage = (ev: MessageEvent<WResult>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      resolve(ev.data)
    }
    w.onerror = (ev: ErrorEvent) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      cleanup()
      reject(new Error(ev.message || 'Worker 执行错误'))
    }
    w.postMessage({
      source: source.value,
      flags: flags.value,
      text: text.value,
      replacement: replacement.value
    })
  })
}

onUnmounted(() => {
  if (workerRef) {
    workerRef.terminate()
    workerRef = null
  }
})

async function execute() {
  if (running.value) return
  if (liveError.value) {
    result.value = null
    run.markFail(liveError.value)
    return
  }
  if (!source.value) {
    result.value = null
    run.markIdle()
    return
  }
  running.value = true
  const t0 = Date.now()
  try {
    const r = await runInWorker()
    lastMs.value = Date.now() - t0
    if (!r.ok) {
      result.value = null
      run.markFail(`表达式执行错误：${r.error ?? '未知错误'}`)
      return
    }
    result.value = r
    run.markOk(
      r.matches.length
        ? `找到 ${r.matches.length} 处匹配${r.capped ? '（超过 20 万已截断）' : ''}${flags.value.includes('g') || flags.value.includes('y') ? '' : '（未加 g/y 标志，仅返回首个匹配）'}`
        : '无匹配：表达式合法，但测试文本中没有匹配项'
    )
  } catch (e) {
    result.value = null
    const msg = errMessage(e)
    run.markFail(msg === 'TIMEOUT' ? '执行超时，可能是灾难性回溯，已中止（可简化表达式或缩短文本后重试）' : `执行失败：${msg}`)
  } finally {
    running.value = false
  }
}

/** 匹配高亮：测试文本 → span 序列 */
const segments = computed(() => {
  const r = result.value
  if (!r) return []
  const segs: { text: string; hit: boolean }[] = []
  let pos = 0
  for (const m of r.matches) {
    if (m.text === '') continue
    if (m.index > pos) segs.push({ text: text.value.slice(pos, m.index), hit: false })
    segs.push({ text: m.text, hit: true })
    pos = m.end
  }
  if (pos < text.value.length) segs.push({ text: text.value.slice(pos), hit: false })
  return segs
})

const LIST_CAP = 200

const sampleEmail = {
  source: '([\\w.+-]+)@([\\w-]+\\.[\\w.]+)',
  flags: 'g',
  text: `联系人名单：
- 陈立 chen.li@example.com
- 王小明 wxm@sub.company.org.cn（备用 wangxm1990@test.co）
- 无效地址：not-an-email@@broken
客服电话 400-100-1234（不含邮箱）`,
  replacement: ''
}

const sampleDate = {
  source: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})',
  flags: 'g',
  text: `版本计划：
- v1.0 发布日期 2024-03-15，冻结日期 2024-02-28
- v2.0 发布日期 2024-11-01
- 不是完整日期：2024-3-5（位数不足，不匹配）`,
  replacement: '$<year>年$<month>月$<day>日'
}

const sampleEvil = {
  source: '(a+)+$',
  flags: '',
  text: 'a'.repeat(26) + 'b',
  replacement: ''
}

function loadSample(s: typeof sampleEmail) {
  source.value = s.source
  flags.value = s.flags
  text.value = s.text
  replacement.value = s.replacement
  execute()
}
</script>

<template>
  <div class="t11">
    <div class="t11__toolbar">
      <span class="t11__engine" title="本工具使用浏览器内置的 JavaScript RegExp 引擎，与 Java 无关">
        <DkIcon name="zap" :size="12" />
        引擎：JavaScript（RegExp）
      </span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="全局邮箱提取示例" @click="loadSample(sampleEmail)">示例：邮箱提取</DkButton>
      <DkButton size="sm" variant="ghost" title="命名捕获组 + 替换模板示例" @click="loadSample(sampleDate)">示例：日期命名组</DkButton>
      <DkButton
        size="sm"
        variant="ghost"
        title="灾难性回溯示例：执行将触发 2 秒超时保护并被中止"
        @click="loadSample(sampleEvil)"
      >示例：回溯超时</DkButton>
      <DkButton size="sm" variant="primary" :loading="running" @click="execute">
        <DkIcon name="play" :size="12" />
        执行测试
      </DkButton>
    </div>

    <DkStatusBar
      :status="running ? 'running' : run.status.value"
      :message="running ? '正在 Worker 中执行匹配（超时保护 2 秒）…' : run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="result && result.ok ? [`匹配 ${result.matches.length} 处`, `耗时 ${lastMs}ms`] : []"
      :retry="execute"
    />

    <div class="t11__fields">
      <DkField label="正则表达式" class="t11__f-src" :error="liveError || undefined" help="不含两侧斜杠；语法错误会在下方行内提示">
        <DkInput v-model="source" mono placeholder="如 ([\w.+-]+)@([\w-]+\.[\w.]+)" :error="!!liveError" />
      </DkField>
      <DkField label="flags" class="t11__f-flags" help="d g i m s u v y">
        <DkInput v-model="flags" mono placeholder="g" :error="!!liveError" />
      </DkField>
      <DkField
        label="替换模板（可选）"
        class="t11__f-repl"
        help="支持 $1、$2 与 $&lt;name&gt; 命名组引用；留空不做替换预览"
      >
        <DkInput v-model="replacement" mono placeholder="如 $1@[$2] 或 $<year>年" />
      </DkField>
    </div>

    <div class="t11__panes">
      <SplitPanes :initial="46" :min="25" :max="70">
        <template #left>
          <DkEditor
            v-model="text"
            lang="测试文本"
            placeholder="输入或粘贴待匹配文本，然后点击「执行测试」"
            :height="'calc(56vh - 60px)'"
            filename="test-text.txt"
          />
        </template>
        <template #right>
          <div class="t11__out">
            <section class="t11__sec">
              <h4 class="t11__sec-title">
                匹配高亮
                <span v-if="result && result.ok" class="t11__count">共 {{ result.matches.length }} 处</span>
              </h4>
              <div class="t11__hl">
                <p v-if="!result" class="tertiary">执行后，测试文本会在此按匹配结果分段渲染（匹配部分蓝底）。</p>
                <p v-else-if="!result.matches.length" class="tertiary">无匹配：表达式合法，但测试文本中没有匹配项。</p>
                <template v-else>
                  <span v-for="(s, i) in segments" :key="i" class="t11__seg" :class="{ 't11__seg--hit': s.hit }">{{ s.text }}</span>
                </template>
              </div>
            </section>

            <section class="t11__sec">
              <h4 class="t11__sec-title">
                匹配列表
                <span v-if="result && result.ok && result.matches.length" class="t11__count">序号 / 位置 / 文本 / 捕获组</span>
              </h4>
              <div class="t11__list">
                <p v-if="!result" class="tertiary">执行后显示每处匹配的位置与捕获组。</p>
                <p v-else-if="!result.matches.length" class="tertiary">无匹配，列表为空。</p>
                <template v-else>
                  <div v-for="(m, i) in result.matches.slice(0, LIST_CAP)" :key="i" class="t11__match">
                    <span class="t11__match-no">#{{ i + 1 }}</span>
                    <span class="t11__match-pos">{{ m.index }}–{{ m.end }}</span>
                    <span class="t11__match-text">{{ m.text === '' ? '(空匹配)' : m.text }}</span>
                    <span class="t11__groups">
                      <template v-if="m.named && m.named.length">
                        <span v-for="g in m.named" :key="g.name" class="t11__grp t11__grp--named" :title="`命名捕获组 ${g.name}`">
                          {{ g.name }}={{ g.value === null ? '(未参与)' : g.value }}
                        </span>
                      </template>
                      <span v-for="(g, gi) in m.groups" :key="String(gi)" class="t11__grp" :title="`数字捕获组 $${gi + 1}`">
                        ${{ gi + 1 }}={{ g === null ? '(未参与)' : g }}
                      </span>
                    </span>
                  </div>
                  <p v-if="result.matches.length > LIST_CAP" class="tertiary">仅显示前 {{ LIST_CAP }} 条（共 {{ result.matches.length }} 条）。</p>
                </template>
              </div>
            </section>

            <section v-if="replacement !== ''" class="t11__sec">
              <h4 class="t11__sec-title">
                替换预览
                <span v-if="result && result.ok && !result.matches.length" class="t11__count">无匹配，替换结果与原文相同</span>
              </h4>
              <div class="t11__repl mono">
                <p v-if="!result" class="tertiary">执行后显示替换结果。</p>
                <template v-else>{{ result.replaced ?? text }}</template>
              </div>
              <div class="t11__repl-actions">
                <DkButton
                  size="sm"
                  variant="ghost"
                  :disabled="!result || run.status.value === 'stale'"
                  @click="result && clipboard.copy(result.replaced ?? text, '替换结果')"
                >复制替换结果</DkButton>
                <span class="tertiary">替换遵循 String.prototype.replace 语义（未加 g 标志时仅替换首处）</span>
              </div>
            </section>
          </div>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="使用说明">
      <ul>
        <li>引擎为浏览器内置 JavaScript RegExp（构造方式 <code>new RegExp(source, flags)</code>），与 Java 正则不同。</li>
        <li>匹配在 Web Worker 中执行，主线程 2 秒超时保护：疑似灾难性回溯（如 <code>(a+)+$</code>）会被强制中止并提示，输入全部保留。</li>
        <li>flags 支持 d g i m s u v y，组合非法（重复、u 与 v 同用）会给出行内提示。</li>
        <li>替换模板支持 <code>$1</code>、<code>$2</code> 数字组与 <code>$&lt;name&gt;</code> 命名组引用，预览结果与 <code>String.prototype.replace</code> 一致。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t11 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t11__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t11__engine {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.t11__fields {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.t11__f-src {
  flex: 2 1 320px;
  min-width: 220px;
}
.t11__f-flags {
  flex: 0 1 110px;
  min-width: 90px;
}
.t11__f-repl {
  flex: 1 1 220px;
  min-width: 200px;
}
.t11__panes {
  min-height: 300px;
}
.t11__out {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 56vh;
  overflow: auto;
  padding-right: 2px;
}
.t11__sec {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
  flex-shrink: 0;
}
.t11__sec-title {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}
.t11__count {
  margin-left: auto;
  font-weight: 400;
  color: var(--text-tertiary);
  font-size: 11px;
}
.t11__hl {
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: var(--code-font-size);
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  min-height: 52px;
  max-height: 200px;
  overflow: auto;
}
.t11__hl p {
  font-family: var(--font-ui);
  font-size: 13px;
}
.t11__seg--hit {
  background: var(--accent-soft);
  color: var(--accent);
  border-radius: 2px;
  box-shadow: inset 0 -2px 0 var(--accent-ring);
}
.t11__list {
  max-height: 240px;
  overflow: auto;
  padding: 6px 12px;
}
.t11__list p {
  font-size: 13px;
  padding: 6px 0;
}
.t11__match {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--border);
  font-size: 12px;
  flex-wrap: wrap;
}
.t11__match:last-of-type {
  border-bottom: none;
}
.t11__match-no {
  color: var(--text-tertiary);
  flex-shrink: 0;
  min-width: 34px;
}
.t11__match-pos {
  font-family: var(--font-mono);
  color: var(--text-secondary);
  flex-shrink: 0;
}
.t11__match-text {
  font-family: var(--font-mono);
  color: var(--text-primary);
  overflow-wrap: anywhere;
  min-width: 60px;
}
.t11__groups {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.t11__grp {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-subtle);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.t11__grp--named {
  background: var(--accent-soft);
  border-color: var(--accent-ring);
  color: var(--accent);
}
.t11__repl {
  padding: 10px 12px;
  font-size: var(--code-font-size);
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  max-height: 180px;
  overflow: auto;
}
.t11__repl p {
  font-family: var(--font-ui);
  font-size: 13px;
}
.t11__repl-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
}
</style>
