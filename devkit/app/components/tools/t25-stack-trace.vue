<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { localizeRegexMessage } from '~/utils/regex'

const props = defineProps<{ tool: ToolMeta }>()
const clipboard = useClipboard()

const input = ref('')
const bizPrefix = ref('^com\\.example\\.')
const bizErr = ref('')
const errDetail = ref('')

const FRAMEWORK_PREFIXES = [
  'java.', 'javax.', 'jdk.', 'sun.', 'android.',
  'org.springframework.', 'org.apache.', 'io.netty.', 'org.junit.', 'junit.',
  'org.hibernate.', 'com.google.', 'org.eclipse.', 'jakarta.', 'org.slf4j.',
  'ch.qos.logback.', 'reactor.core.', 'org.jetbrains.', 'com.intellij.',
  'kotlin.', 'scala.', 'org.testng.', 'io.opentelemetry.', 'com.fasterxml.',
]

interface Frame { raw: string; fqcn: string; method: string; loc: string; kind: 'business' | 'framework' | 'other' }
interface FrameGroup { kind: 'business' | 'framework' | 'other'; frames: Frame[]; expanded: boolean }
interface ExcInfo {
  role: 'main' | 'caused' | 'suppressed'
  type: string
  message: string | null
  rawHeader: string
  pseudo: boolean
  messageLines: string[]
  groups: FrameGroup[]
  suppressed: ExcInfo[]
  commonOmitted: number | null
  commonRaw: string | null
  collapsed: boolean
}
type Segment = { type: 'log'; lines: string[] } | { type: 'trace'; chain: ExcInfo[] }

const segments = ref<Segment[]>([])
const stats = ref({ excs: 0, biz: 0, framework: 0, other: 0, traces: 0, logs: 0 })

const EXC_RE = /^((?:[A-Za-z_$][\w$]*\/)?(?:[A-Za-z_$][\w$]*\.)+[A-Za-z_$][\w$]*)(?::\s?(.*))?$/
const FRAME_RE = /^\s*at\s+([^\s(]+)\((.*)\)\s*$/
const MORE_RE = /^\s*\.\.\.\s+(\d+)\s+more\b/
const SUPPRESS_RE = /^\s*Suppressed:\s*/
const CAUSED_RE = /^Caused by:\s*/

function stripModule(fq: string): string {
  const i = fq.indexOf('/')
  return i >= 0 ? fq.slice(i + 1) : fq
}

function looksLikeStackContination(line: string): boolean {
  return /^\s*at\s/.test(line) || MORE_RE.test(line) || SUPPRESS_RE.test(line) || CAUSED_RE.test(line)
}

function parseTrace(text: string): Segment[] {
  const lines = text.split(/\r\n|\r|\n/)
  const segs: Segment[] = []
  let trace: Segment | null = null
  let cur: ExcInfo | null = null

  const pushLog = (line: string) => {
    if (trace) {
      trace = null
      cur = null
    }
    const last = segs[segs.length - 1]
    if (last && last.type === 'log') last.lines.push(line)
    else segs.push({ type: 'log', lines: [line] })
  }

  const ensureTrace = (): Extract<Segment, { type: 'trace' }> => {
    if (!trace) {
      const seg: Extract<Segment, { type: 'trace' }> = { type: 'trace', chain: [] }
      segs.push(seg)
      trace = seg
    }
    return trace as Extract<Segment, { type: 'trace' }>
  }

  const newExc = (role: ExcInfo['role'], type: string, message: string | null, rawHeader: string, pseudo = false): ExcInfo => ({
    role,
    type,
    message,
    rawHeader,
    pseudo,
    messageLines: [],
    groups: [],
    suppressed: [],
    commonOmitted: null,
    commonRaw: null,
    collapsed: role !== 'main',
  })

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!line.trim()) {
      pushLog(line)
      continue
    }
    const mFrame = FRAME_RE.exec(line)
    if (mFrame) {
      const seg = ensureTrace()
      if (!cur) {
        cur = newExc('main', '（未捕获到异常头）', null, '', true)
        seg.chain.unshift(cur)
      }
      const fqRaw = mFrame[1]!
      const fqcn = stripModule(fqRaw)
      const dot = fqcn.lastIndexOf('.')
      cur.groups.push({
        kind: 'other',
        expanded: true,
        frames: [
          {
            raw: line,
            fqcn,
            method: dot >= 0 ? fqcn.slice(dot + 1) : fqcn,
            loc: mFrame[2] || '',
            kind: 'other',
          },
        ],
      })
      continue
    }
    if (MORE_RE.test(line)) {
      if (cur) {
        cur.commonOmitted = parseInt(MORE_RE.exec(line)![1]!, 10)
        cur.commonRaw = line
      } else {
        pushLog(line)
      }
      continue
    }
    if (SUPPRESS_RE.test(line)) {
      const rest = line.replace(SUPPRESS_RE, '')
      const m = EXC_RE.exec(rest.trim())
      if (m) {
        const seg = ensureTrace()
        const owner = cur ?? seg.chain[0]
        const exc = newExc('suppressed', m[1]!, m[2] !== undefined ? m[2] : null, line)
        if (owner) owner.suppressed.push(exc)
        cur = exc
      } else {
        pushLog(line)
      }
      continue
    }
    if (CAUSED_RE.test(line)) {
      const rest = line.replace(CAUSED_RE, '')
      const m = EXC_RE.exec(rest.trim())
      if (m) {
        const seg = ensureTrace()
        const exc = newExc('caused', m[1]!, m[2] !== undefined ? m[2] : null, line)
        seg.chain.push(exc)
        cur = exc
      } else {
        pushLog(line)
      }
      continue
    }
    // 普通异常头（行首无缩进、全限定类名 [+ 消息]），以下一行佐证
    if (!/^\s/.test(line)) {
      const m = EXC_RE.exec(line.trim())
      const next = lines[i + 1] ?? ''
      if (m && (looksLikeStackContination(next) || /(?:Exception|Error|Throwable)$/.test(m[1]!))) {
        trace = null
        cur = null
        const seg: Extract<Segment, { type: 'trace' }> = { type: 'trace', chain: [] }
        segs.push(seg)
        trace = seg
        const exc = newExc('main', m[1]!, m[2] !== undefined ? m[2] : null, line)
        seg.chain.push(exc)
        cur = exc
        continue
      }
    }
    pushLog(line)
  }
  return segs
}

/** 帧分类 + 相邻同类型帧合并成组（框架组默认折叠） */
function classifyAndGroup(chain: ExcInfo[], bizRe: RegExp, st: { business: number; framework: number; other: number }) {
  for (const exc of chain) {
    const flat: Frame[] = []
    for (const g of exc.groups) flat.push(...g.frames)
    const groups: FrameGroup[] = []
    for (const f of flat) {
      if (bizRe.test(f.fqcn)) f.kind = 'business'
      else if (FRAMEWORK_PREFIXES.some((p) => f.fqcn.startsWith(p))) f.kind = 'framework'
      else f.kind = 'other'
      st[f.kind]++
      const lastG = groups[groups.length - 1]
      if (lastG && lastG.kind === f.kind) lastG.frames.push(f)
      else groups.push({ kind: f.kind, frames: [f], expanded: f.kind !== 'framework' })
    }
    exc.groups = groups
    classifyAndGroup(exc.suppressed, bizRe, st)
  }
}

/** 整理文本：完整原文，被折叠的框架帧替换为「... N more (collapsed)」 */
function tidyExc(exc: ExcInfo, out: string[]) {
  if (!exc.pseudo) {
    out.push(exc.rawHeader)
    out.push(...exc.messageLines)
  }
  for (const g of exc.groups) {
    if (g.kind === 'framework' && !g.expanded) {
      const indent = /^\s*/.exec(g.frames[0]?.raw ?? '')?.[0] ?? ''
      out.push(`${indent}... ${g.frames.length} more (collapsed)`)
    } else {
      out.push(...g.frames.map((f) => f.raw))
    }
  }
  for (const s of exc.suppressed) tidyExc(s, out)
  if (exc.commonRaw) out.push(exc.commonRaw)
}

function buildTidy(): string {
  const out: string[] = []
  for (const seg of segments.value) {
    if (seg.type === 'log') out.push(...seg.lines)
    else for (const exc of seg.chain) tidyExc(exc, out)
  }
  return out.join('\n')
}

const SAMPLE = `2026-09-20 10:15:32.314 ERROR [http-nio-8080-exec-1] o.a.c.c.C.[.[.[/demo] - Servlet.service() for servlet [dispatcherServlet] in context with path [/demo] threw exception [com.example.order.OrderServiceException: 创建订单失败：订单号 1234567890 已存在] with root cause
com.example.order.OrderServiceException: 创建订单失败：订单号 1234567890 已存在
	at com.example.order.OrderService.create(OrderService.java:64)
	at com.example.order.OrderController.create(OrderController.java:38)
	at java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)
	at java.base/java.lang.reflect.Method.invoke(Method.java:580)
	at org.springframework.web.method.support.InvocableHandlerMethod.doInvoke(InvocableHandlerMethod.java:205)
	at org.springframework.web.servlet.mvc.method.annotation.InvocableHandlerMethod.invokeForRequest(InvocableHandlerMethod.java:142)
	at org.springframework.aop.support.AopUtils.invokeJoinpointUsingReflection(AopUtils.java:354)
	at org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:219)
	Suppressed: com.example.order.InventoryLockException: 库存锁未释放，orderId=1234567890
		at com.example.order.InventoryLock.release(InventoryLock.java:95)
		at com.example.order.OrderService.create(OrderService.java:71)
		at java.base/java.lang.Thread.run(Thread.java:1583)
		... 2 more
Caused by: java.lang.NullPointerException: Cannot invoke "com.example.order.Customer.getVipLevel()" because "customer" is null
	at com.example.order.CustomerService.vipPrice(CustomerService.java:27)
	at com.example.order.OrderService.create(OrderService.java:58)
	at com.example.order.web.PriceFilter.apply(PriceFilter.java:22)
	at java.base/java.util.Objects.requireNonNull(Objects.java:233)
	... 1 more
2026-09-20 10:15:32.401 WARN [http-nio-8080-exec-1] c.e.o.OrderController - 订单创建失败已回滚`

const sig = () => JSON.stringify([input.value, bizPrefix.value])
const run = useToolRun(sig)

function execute() {
  bizErr.value = ''
  errDetail.value = ''
  if (!input.value.trim()) {
    run.markIdle()
    segments.value = []
    stats.value = { excs: 0, biz: 0, framework: 0, other: 0, traces: 0, logs: 0 }
    return
  }
  let bizRe: RegExp
  try {
    bizRe = new RegExp(bizPrefix.value)
  } catch (e) {
    bizErr.value = `业务包前缀不是合法正则：${localizeRegexMessage(errMessage(e), bizPrefix.value)}`
    run.markFail(bizErr.value)
    return
  }
  const segs = parseTrace(input.value)
  const st = { business: 0, framework: 0, other: 0 }
  let excs = 0
  let traces = 0
  const countExc = (list: ExcInfo[]) => {
    for (const ex of list) {
      excs++
      countExc(ex.suppressed)
    }
  }
  for (const seg of segs) {
    if (seg.type === 'trace') {
      traces++
      countExc(seg.chain)
      classifyAndGroup(seg.chain, bizRe, st)
    }
  }
  const logCount = segs.filter((s) => s.type === 'log').reduce((n, s) => n + (s as { lines: string[] }).lines.length, 0)
  segments.value = segs
  stats.value = { excs, biz: st.business, framework: st.framework, other: st.other, traces, logs: logCount }
  if (!traces) {
    errDetail.value =
      '未识别到 Java 堆栈模式：没有找到异常类行（如 com.example.XxxException: 消息）或以 at 开头的调用帧。请确认粘贴的是 Java 异常堆栈；输入已保留在左侧。'
    run.markFail(errDetail.value)
    return
  }
  run.markOk(
    logCount
      ? `已识别 ${traces} 段堆栈 / ${excs} 个异常；另有 ${logCount} 行非堆栈内容（日志行）已按原样保留`
      : `已识别 ${traces} 段堆栈 / ${excs} 个异常`,
  )
}

watch([bizPrefix], execute)

function copyRaw() {
  clipboard.copy(input.value, '原文')
}
function copyTidy() {
  clipboard.copy(buildTidy(), '整理文本')
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
  <div class="t25">
    <div class="t25__toolbar">
      <div class="t25__biz">
        <span class="t25__opt-label">业务包前缀（正则）</span>
        <DkInput v-model="bizPrefix" mono placeholder="^com\.example\." :error="!!bizErr" />
        <span v-if="bizErr" class="t25__biz-err">{{ bizErr }}</span>
      </div>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入示例堆栈（业务异常 + Caused by + Suppressed + ... N more）" @click="input = SAMPLE; execute()">
        载入示例
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="!input" @click="copyRaw">
        <DkIcon name="copy" :size="12" />
        复制原文
      </DkButton>
      <DkButton size="sm" variant="ghost" :disabled="run.status.value !== 'ok'" title="完整原文，折叠的框架帧替换为 ... N more (collapsed)" @click="copyTidy">
        <DkIcon name="copy" :size="12" />
        复制整理文本
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        整理
      </DkButton>
      <span class="t25__kbd tertiary">⌘/Ctrl + Enter</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="[`异常 ${stats.excs}`, `业务帧 ${stats.biz}`, `框架帧 ${stats.framework}`]"
      :retry="execute"
    />

    <div class="t25__panes">
      <SplitPanes :initial="45" :min="25" :max="65">
        <template #left>
          <DkEditor
            v-model="input"
            lang="日志 / 堆栈输入"
            placeholder="粘贴包含 Java 异常堆栈的日志（支持 Caused by:、Suppressed:、... N more 与混入的普通日志行）"
            :height="'calc(62vh - 60px)'"
            filename="stacktrace.log"
          />
        </template>
        <template #right>
          <div class="t25__out" :class="{ 't25__out--empty': !segments.length }">
            <p v-if="!segments.length" class="tertiary">整理结果将显示在这里。</p>
            <div v-else class="t25__note tertiary">
              Caused by 链最深处通常接近根因，但需人工判断；本工具只做结构化整理，不自动定位根因。
            </div>
            <template v-for="(seg, si) in segments" :key="si">
              <div v-if="seg.type === 'log'" class="t25__log">
                <span class="t25__badge">非堆栈内容</span>
                <pre class="t25__log-lines mono">{{ seg.lines.join('\n') }}</pre>
              </div>
              <div v-else class="t25__trace">
                <div v-for="(exc, ei) in seg.chain" :key="ei" class="t25__exc" :class="{ 't25__exc--collapsed': exc.collapsed && exc.role !== 'main' }">
                  <button class="t25__exc-head" @click="exc.role === 'main' ? null : (exc.collapsed = !exc.collapsed)">
                    <span v-if="exc.role === 'caused'" class="t25__tag t25__tag--caused">Caused by</span>
                    <span v-else-if="exc.role === 'suppressed'" class="t25__tag t25__tag--sup">Suppressed</span>
                    <span v-else class="t25__tag">主异常</span>
                    <span class="t25__exc-type mono">{{ exc.type }}</span>
                    <span v-if="exc.message" class="t25__exc-msg">{{ exc.message.length > 72 ? exc.message.slice(0, 72) + '…' : exc.message }}</span>
                    <DkIcon v-if="exc.role !== 'main'" class="t25__chev" :size="13" name="chevron-right" />
                  </button>
                  <div v-show="!exc.collapsed || exc.role === 'main'" class="t25__exc-body">
                    <p v-if="exc.pseudo" class="tertiary t25__pseudo">未捕获到异常头（粘贴内容可能不完整），以下为孤立的调用帧。</p>
                    <template v-for="(g, gi) in exc.groups" :key="gi">
                      <div v-if="g.kind === 'framework' && !g.expanded" class="t25__fold" role="button" tabindex="0" @click="g.expanded = true" @keydown.enter="g.expanded = true">
                        … 已折叠 {{ g.frames.length }} 个框架帧
                      </div>
                      <template v-else>
                        <div v-if="g.kind === 'framework'" class="t25__fold t25__fold--open" role="button" tabindex="0" @click="g.expanded = false" @keydown.enter="g.expanded = false">
                          … 已折叠 {{ g.frames.length }} 个框架帧（点击收起）
                        </div>
                        <div
                          v-for="(f, fi) in g.frames"
                          :key="fi"
                          class="t25__frame mono"
                          :class="{ 't25__frame--biz': f.kind === 'business', 't25__frame--fw': f.kind === 'framework' }"
                        >
                          {{ f.raw.trim() }}
                        </div>
                      </template>
                    </template>
                    <div v-if="exc.commonOmitted !== null" class="t25__frame t25__frame--omit mono">
                      … {{ exc.commonOmitted }} more（与前一个异常重叠的公共帧，堆栈省略标记）
                    </div>
                    <div v-if="exc.suppressed.length" class="t25__sup-wrap">
                      <div v-for="(s, si2) in exc.suppressed" :key="si2" class="t25__exc t25__exc--sup">
                        <button class="t25__exc-head" @click="s.collapsed = !s.collapsed">
                          <span class="t25__tag t25__tag--sup">Suppressed</span>
                          <span class="t25__exc-type mono">{{ s.type }}</span>
                          <span v-if="s.message" class="t25__exc-msg">{{ s.message.length > 60 ? s.message.slice(0, 60) + '…' : s.message }}</span>
                          <DkIcon class="t25__chev" :size="13" name="chevron-right" />
                        </button>
                        <div v-show="!s.collapsed" class="t25__exc-body">
                          <template v-for="(g, gi) in s.groups" :key="gi">
                            <div v-if="g.kind === 'framework' && !g.expanded" class="t25__fold" role="button" tabindex="0" @click="g.expanded = true" @keydown.enter="g.expanded = true">
                              … 已折叠 {{ g.frames.length }} 个框架帧
                            </div>
                            <template v-else>
                              <div v-if="g.kind === 'framework'" class="t25__fold t25__fold--open" role="button" tabindex="0" @click="g.expanded = false" @keydown.enter="g.expanded = false">
                                … 已折叠 {{ g.frames.length }} 个框架帧（点击收起）
                              </div>
                              <div
                                v-for="(f, fi) in g.frames"
                                :key="fi"
                                class="t25__frame mono"
                                :class="{ 't25__frame--biz': f.kind === 'business', 't25__frame--fw': f.kind === 'framework' }"
                              >
                                {{ f.raw.trim() }}
                              </div>
                            </template>
                          </template>
                          <div v-if="s.commonOmitted !== null" class="t25__frame t25__frame--omit mono">
                            … {{ s.commonOmitted }} more（与前一个异常重叠的公共帧，堆栈省略标记）
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="用法说明">
      <ul>
        <li>识别的堆栈元素：异常链头行、<code>at</code> 调用帧、<code>Caused by:</code>、<code>Suppressed:</code>、<code>... N more</code> 公共帧省略标记；混入的普通日志行标注「非堆栈内容」原样保留。</li>
        <li>「业务包前缀」支持正则（默认 <code>^com\.example\.</code>），命中的帧高亮；java. / javax. / jdk. / sun. / org.springframework. / org.apache. / io.netty. 等常见框架帧默认折叠为一行，点击可展开。</li>
        <li>复制整理文本 = 完整原文，但被折叠的框架帧替换为 <code>... N more (collapsed)</code> 行；复制原文 = 输入内容一字不动。</li>
        <li>Caused by 最深处通常接近根因，但需人工判断；本工具不自动定位根因，也不修改任何堆栈内容。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t25 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t25__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t25__biz {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 320px;
  flex: 0 1 420px;
}
.t25__biz-err {
  font-size: 12px;
  color: var(--error);
}
.t25__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t25__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t25__panes {
  min-height: 320px;
}
.t25__out {
  height: 100%;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.t25__out--empty {
  align-items: center;
  justify-content: center;
}
.t25__note {
  font-size: 12px;
}
.t25__log {
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: var(--surface-subtle);
}
.t25__badge {
  display: inline-block;
  font-size: 11px;
  color: var(--text-tertiary);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  margin-bottom: 6px;
}
.t25__log-lines {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
  white-space: pre-wrap;
  word-break: break-all;
}
.t25__trace {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.t25__exc {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}
.t25__exc--sup {
  margin: 8px 0 0 10px;
}
.t25__exc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: var(--surface-subtle);
  text-align: left;
  font-size: 13px;
}
.t25__exc--collapsed > .t25__exc-head {
  background: transparent;
}
.t25__tag {
  font-size: 11px;
  border-radius: 999px;
  padding: 1px 8px;
  background: var(--accent-soft);
  color: var(--accent);
  white-space: nowrap;
}
.t25__tag--caused {
  background: var(--warn-soft, rgba(212, 167, 44, 0.15));
  color: var(--warn, #b45309);
}
.t25__tag--sup {
  background: var(--surface-subtle);
  color: var(--text-tertiary);
  border: 1px solid var(--border);
}
.t25__exc-type {
  font-weight: 600;
  color: var(--error);
  font-size: 12.5px;
}
.t25__exc-msg {
  color: var(--text-secondary);
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.t25__chev {
  color: var(--text-tertiary);
  transition: transform 0.15s;
}
.t25__exc-body {
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.t25__pseudo {
  font-size: 12px;
}
.t25__fold {
  font-size: 12px;
  color: var(--text-tertiary);
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: var(--surface-subtle);
  cursor: pointer;
  margin: 2px 0;
  align-self: flex-start;
}
.t25__fold--open {
  color: var(--text-secondary);
}
.t25__frame {
  font-size: 12px;
  line-height: 1.6;
  padding: 1px 8px;
  border-radius: 4px;
  color: var(--text-secondary);
  word-break: break-all;
}
.t25__frame--biz {
  background: var(--accent-soft);
  color: var(--text-primary);
  box-shadow: inset 2px 0 0 var(--accent);
}
.t25__frame--fw {
  color: var(--text-tertiary);
}
.t25__frame--omit {
  color: var(--text-tertiary);
  font-style: italic;
}
.t25__sup-wrap {
  margin-top: 6px;
}
</style>
