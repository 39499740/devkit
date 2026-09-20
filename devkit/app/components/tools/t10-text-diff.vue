<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import { diffLines, diffWords } from 'diff'

defineProps<{ tool: ToolMeta }>()

const leftText = ref('')
const rightText = ref('')
/** 忽略空白：默认关闭——空白与换行差异默认不抹除 */
const ignoreWs = ref(false)
const syncScroll = ref(true)

interface Token {
  text: string
  changed: boolean
}
interface Row {
  type: 'equal' | 'modify' | 'add' | 'del'
  lno: number | null
  rno: number | null
  lTokens: Token[] | null
  rTokens: Token[] | null
}

const rows = ref<Row[]>([])
const stats = ref({ plus: 0, minus: 0, hunks: 0 })
const diffRowIdxs = ref<number[]>([])
const current = ref(-1)

const leftBody = ref<HTMLElement>()
const rightBody = ref<HTMLElement>()
let syncing = false

const sig = () => JSON.stringify([leftText.value, rightText.value, ignoreWs.value])
const run = useToolRun(sig)

const SAMPLE_L = `# 应用配置 v1
server:
  host: 127.0.0.1
  port: 8080
  timeout: 30s
logging:
  level: info
  format: json
storage:
  driver: local
  cache_size: 512MB
features:
  preview: true`

const SAMPLE_R = `# 应用配置 v2
server:
  host: 0.0.0.0
  port: 8080
  timeout: 60s
logging:
  level: debug
storage:
  driver: s3
  bucket: devkit-files
  cache_size: 512MB
features:
  preview: true
  beta: false`

/** diff 块 value → 行数组（结尾换行是行终止符，不算一行） */
function toLines(v: string): string[] {
  const s = v.endsWith('\n') ? v.slice(0, -1) : v
  return s.split('\n')
}

/** 忽略空白开启时：每行 trim + 归并连续空行 */
function normalize(s: string): string {
  const out: string[] = []
  for (const raw of s.split('\n')) {
    const line = raw.trim()
    if (line === '') {
      if (out.length > 0 && out[out.length - 1] === '') continue
      out.push('')
    } else {
      out.push(line)
    }
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** 行内差异：修改行的两侧 token 序列，changed 部分用 strong 色块 */
function inlineTokens(l: string, r: string): { l: Token[]; r: Token[] } {
  const changes = diffWords(l, r)
  const lt: Token[] = []
  const rt: Token[] = []
  for (const c of changes) {
    if (c.added) rt.push({ text: c.value, changed: true })
    else if (c.removed) lt.push({ text: c.value, changed: true })
    else {
      lt.push({ text: c.value, changed: false })
      rt.push({ text: c.value, changed: false })
    }
  }
  return { l: lt, r: rt }
}

function buildRows(): Row[] {
  const a = ignoreWs.value ? normalize(leftText.value) : leftText.value
  const b = ignoreWs.value ? normalize(rightText.value) : rightText.value
  const changes = diffLines(a, b)
  const out: Row[] = []
  let lnL = 0
  let lnR = 0
  let i = 0
  while (i < changes.length) {
    const c = changes[i]!
    const lines = toLines(c.value)
    if (!c.added && !c.removed) {
      for (const l of lines) {
        out.push({ type: 'equal', lno: ++lnL, rno: ++lnR, lTokens: [{ text: l, changed: false }], rTokens: [{ text: l, changed: false }] })
      }
      i++
    } else if (c.removed && changes[i + 1]?.added) {
      // 删除块 + 新增块配对：逐行成 modify 行，行内做 diffWords；多出的行退化为纯增/纯删
      const add = toLines(changes[i + 1]!.value)
      const n = Math.max(lines.length, add.length)
      for (let k = 0; k < n; k++) {
        const hasL = k < lines.length
        const hasR = k < add.length
        if (hasL && hasR) {
          const t = inlineTokens(lines[k]!, add[k]!)
          out.push({ type: 'modify', lno: ++lnL, rno: ++lnR, lTokens: t.l, rTokens: t.r })
        } else if (hasL) {
          out.push({ type: 'del', lno: ++lnL, rno: null, lTokens: [{ text: lines[k]!, changed: true }], rTokens: null })
        } else {
          out.push({ type: 'add', lno: null, rno: ++lnR, lTokens: null, rTokens: [{ text: add[k]!, changed: true }] })
        }
      }
      i += 2
    } else if (c.removed) {
      for (const l of lines) out.push({ type: 'del', lno: ++lnL, rno: null, lTokens: [{ text: l, changed: true }], rTokens: null })
      i++
    } else {
      for (const r of lines) out.push({ type: 'add', lno: null, rno: ++lnR, lTokens: null, rTokens: [{ text: r, changed: true }] })
      i++
    }
  }
  return out
}

function execute() {
  current.value = -1
  if (!leftText.value && !rightText.value) {
    rows.value = []
    stats.value = { plus: 0, minus: 0, hunks: 0 }
    diffRowIdxs.value = []
    run.markIdle()
    return
  }
  const rs = buildRows()
  rows.value = rs
  const plus = rs.filter((r) => r.type === 'add' || r.type === 'modify').length
  const minus = rs.filter((r) => r.type === 'del' || r.type === 'modify').length
  const idxs: number[] = []
  rs.forEach((r, i) => {
    if (r.type !== 'equal') idxs.push(i)
  })
  diffRowIdxs.value = idxs
  stats.value = { plus, minus, hunks: idxs.length }
  if (plus === 0 && minus === 0) {
    run.markOk(
      leftText.value === rightText.value
        ? '两段文本完全相同'
        : '按当前规则视为相同：两段文本仅存在空白/换行差异（忽略空白已开启）'
    )
  } else {
    run.markOk(`比较完成：${idxs.length} 行存在差异`)
  }
}

/** 差异定位：滚动两个结果面板到第 idx 行 */
function jumpTo(idx: number) {
  current.value = idx
  nextTick(() => {
    for (const body of [leftBody.value, rightBody.value]) {
      if (!body) continue
      const el = body.querySelector(`[data-di="${idx}"]`) as HTMLElement | null
      if (el) body.scrollTo({ top: Math.max(0, el.offsetTop - body.clientHeight / 2 + el.offsetHeight / 2), behavior: 'smooth' })
    }
  })
}

function nextDiff() {
  const idxs = diffRowIdxs.value
  if (!idxs.length) return
  const pos = idxs.findIndex((i) => i > current.value)
  jumpTo(pos === -1 ? idxs[0]! : idxs[pos]!)
}

function prevDiff() {
  const idxs = diffRowIdxs.value
  if (!idxs.length) return
  const before = idxs.filter((i) => i < current.value)
  const target = before.length ? before[before.length - 1]! : idxs[idxs.length - 1]!
  jumpTo(target)
}

/** 左右结果面板同步滚动 */
function onScrollBody(which: 'l' | 'r') {
  if (!syncScroll.value || syncing) return
  syncing = true
  const src = which === 'l' ? leftBody.value : rightBody.value
  const dst = which === 'l' ? rightBody.value : leftBody.value
  if (src && dst) dst.scrollTop = src.scrollTop
  requestAnimationFrame(() => {
    syncing = false
  })
}

function loadSample() {
  leftText.value = SAMPLE_L
  rightText.value = SAMPLE_R
  execute()
}

function rowClass(r: Row, side: 'l' | 'r') {
  const cls: string[] = []
  if (r.type === 'modify') cls.push(side === 'l' ? 'drow--del' : 'drow--add')
  else if (r.type === 'del') cls.push(side === 'l' ? 'drow--del' : 'drow--ph')
  else if (r.type === 'add') cls.push(side === 'r' ? 'drow--add' : 'drow--ph')
  return cls
}
</script>

<template>
  <div class="t10">
    <div class="t10__toolbar">
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="diff" :size="12" />
        比较
      </DkButton>
      <DkButton size="sm" variant="ghost" title="载入两段配置文本示例（含新增、删除与单词修改）" @click="loadSample">载入示例</DkButton>
      <DkCheckbox v-model="ignoreWs" label="忽略空白" title="开启后比较前对每行 trim 并归并空行；默认关闭，空白与换行差异会被如实标出" />
      <DkCheckbox v-model="syncScroll" label="同步滚动" />
      <span class="grow"></span>
      <span class="t10__stat t10__stat--minus" :title="`${stats.minus} 行删除/修改`">-{{ stats.minus }}</span>
      <span class="t10__stat t10__stat--plus" :title="`${stats.plus} 行新增/修改`">+{{ stats.plus }}</span>
      <DkButton size="sm" :disabled="!stats.hunks" title="定位上一处差异" @click="prevDiff">
        <DkIcon name="chevron-up" :size="12" />
        上一处
      </DkButton>
      <DkButton size="sm" :disabled="!stats.hunks" title="定位下一处差异" @click="nextDiff">
        <DkIcon name="chevron-down" :size="12" />
        下一处
      </DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? run.errorMsg.value : run.staleNote.value"
      :meta="stats.hunks ? [`差异行 ${stats.hunks}`, `原文 ${lineCount(leftText) || 0} 行`, `改文 ${lineCount(rightText) || 0} 行`] : []"
      :retry="execute"
    />

    <SplitPanes :initial="50" :min="25" :max="75">
      <template #left>
        <DkEditor
          v-model="leftText"
          lang="原文"
          placeholder="粘贴左侧文本，或点击「载入示例」"
          :height="'calc(34vh - 60px)'"
          filename="left.txt"
        />
      </template>
      <template #right>
        <DkEditor
          v-model="rightText"
          lang="改文"
          placeholder="粘贴右侧文本"
          :height="'calc(34vh - 60px)'"
          filename="right.txt"
        />
      </template>
    </SplitPanes>

    <div class="t10__results">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <div class="t10__panel t10__panel--l">
            <div class="t10__panel-head">
              <span>原文（差异结果）</span>
              <span class="t10__panel-count t10__stat--minus">-{{ stats.minus }}</span>
            </div>
            <div ref="leftBody" class="t10__panel-body" @scroll="onScrollBody('l')">
              <p v-if="!rows.length" class="t10__empty tertiary">输入两侧文本并点击「比较」，差异结果将显示在这里。</p>
              <template v-else>
                <div
                  v-for="(r, i) in rows"
                  :key="i"
                  class="drow"
                  :class="[...rowClass(r, 'l'), { 'drow--cur': i === current }]"
                  :data-di="r.type !== 'equal' ? i : undefined"
                >
                  <span class="drow__no">{{ r.lno ?? '' }}</span>
                  <span class="drow__code">
                    <span
                      v-for="(t, ti) in r.lTokens"
                      :key="ti"
                      class="drow__tok"
                      :class="{ 'drow__tok--chg': t.changed }"
                    >{{ t.text }}</span>
                  </span>
                </div>
              </template>
            </div>
          </div>
        </template>
        <template #right>
          <div class="t10__panel t10__panel--r">
            <div class="t10__panel-head">
              <span>改文（差异结果）</span>
              <span class="t10__panel-count t10__stat--plus">+{{ stats.plus }}</span>
            </div>
            <div ref="rightBody" class="t10__panel-body" @scroll="onScrollBody('r')">
              <p v-if="!rows.length" class="t10__empty tertiary">输入两侧文本并点击「比较」，差异结果将显示在这里。</p>
              <template v-else>
                <div
                  v-for="(r, i) in rows"
                  :key="i"
                  class="drow"
                  :class="[...rowClass(r, 'r'), { 'drow--cur': i === current }]"
                  :data-di="r.type !== 'equal' ? i : undefined"
                >
                  <span class="drow__no">{{ r.rno ?? '' }}</span>
                  <span class="drow__code">
                    <span
                      v-for="(t, ti) in r.rTokens"
                      :key="ti"
                      class="drow__tok"
                      :class="{ 'drow__tok--chg': t.changed }"
                    >{{ t.text }}</span>
                  </span>
                </div>
              </template>
            </div>
          </div>
        </template>
      </SplitPanes>
    </div>

    <DkCollapse title="使用说明">
      <ul>
        <li>逐行比较新增/删除行（绿底为新增、红底为删除），成对的修改行内会用深色块高亮变化的词。</li>
        <li>「忽略空白」默认关闭：行尾空白、缩进与空行差异都会如实标出；开启后比较前会对每行 trim 并归并连续空行。</li>
        <li>「上一处 / 下一处」在两侧结果面板中滚动定位差异行；「同步滚动」可联动两个结果面板。</li>
        <li>行号列独立于内容列，折行时行号始终对齐该行首行，不会与内容混淆。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t10 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t10__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t10__stat {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.t10__stat--plus {
  color: var(--diff-add-text);
  background: var(--diff-add);
}
.t10__stat--minus {
  color: var(--diff-del-text);
  background: var(--diff-del);
}
.t10__results {
  min-height: 200px;
}
.t10__panel {
  display: flex;
  flex-direction: column;
  height: 38vh;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--editor-bg);
  overflow: hidden;
}
.t10__panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.t10__panel-count {
  margin-left: auto;
  font-family: var(--font-mono);
  font-weight: 600;
  padding: 0 8px;
  border-radius: 10px;
}
.t10__panel-body {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 0;
}
.t10__empty {
  padding: 18px 14px;
  font-size: 13px;
}
.drow {
  display: flex;
  min-height: calc(var(--code-font-size) * 1.6);
  line-height: 1.6;
  align-items: flex-start;
}
.drow__no {
  width: 46px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 10px;
  color: var(--gutter-text);
  font-family: var(--font-mono);
  font-size: var(--code-font-size);
  border-right: 1px solid var(--border);
  user-select: none;
}
.drow__code {
  flex: 1;
  min-width: 0;
  padding-right: 10px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  font-size: var(--code-font-size);
  color: var(--text-primary);
}
.drow--add {
  background: var(--diff-add);
}
.drow--add .drow__no {
  color: var(--diff-add-text);
}
.drow--del {
  background: var(--diff-del);
}
.drow--del .drow__no {
  color: var(--diff-del-text);
}
.drow--ph {
  background: var(--surface-subtle);
}
.drow--cur {
  outline: 1.5px solid var(--accent);
  outline-offset: -1.5px;
}
/* 行内高亮：左面板用删除色，右面板用新增色 */
.drow__tok--chg {
  border-radius: 2px;
}
.t10__panel--l .drow__tok--chg {
  background: var(--diff-del-strong);
  color: var(--diff-del-text);
}
.t10__panel--r .drow__tok--chg {
  background: var(--diff-add-strong);
  color: var(--diff-add-text);
}
</style>
