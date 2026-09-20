<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'

defineProps<{ tool: ToolMeta }>()

interface NameRow {
  src: string
  words: string[]
  bad: string[]
  camel: string
  pascal: string
  snake: string
  kebab: string
  constant: string
}

type CaseKey = 'camel' | 'pascal' | 'snake' | 'kebab' | 'constant'

const clipboard = useClipboard()

const input = ref('')
const rows = ref<NameRow[]>([])
const stat = ref({ total: 0, ok: 0, warn: 0 })

const SAMPLE = ['user account id', 'HTTPServer', 'version2Name', 'already_snake_case', 'kebab-case-name'].join('\n')

const columns: { key: CaseKey; label: string }[] = [
  { key: 'camel', label: 'camelCase' },
  { key: 'pascal', label: 'PascalCase' },
  { key: 'snake', label: 'snake_case' },
  { key: 'kebab', label: 'kebab-case' },
  { key: 'constant', label: 'CONSTANT_CASE' }
]

/**
 * 分词：先按空白 / 下划线 / 连字符切分，再在词内应用
 * 驼峰边界（小写→大写）、连续大写缩略词（HTTPServer → HTTP Server）、
 * 字母↔数字边界（version2Name → version 2 name）。
 * 含其他字符（点号、emoji 等）的部分无法按规则分词：整段不参与转换，行标黄提示。
 */
function splitWords(line: string): { words: string[]; bad: string[] } {
  const bad = new Set<string>()
  const words: string[] = []
  for (const part of line.split(/[\s_-]+/)) {
    if (!part) continue
    const pieces = part
      .replace(/([\p{Ll}\p{Nd}])([\p{Lu}])/gu, '$1 $2')
      .replace(/([\p{Lu}]+)([\p{Lu}][\p{Ll}])/gu, '$1 $2')
      .replace(/([\p{L}])(\p{Nd}+)/gu, '$1 $2')
      .replace(/(\p{Nd}+)([\p{L}])/gu, '$1 $2')
      .split(' ')
    for (const w of pieces) {
      if (!w) continue
      if (/^[\p{L}\p{Nd}]+$/u.test(w)) {
        words.push(w)
      } else {
        for (const c of w) {
          if (!/^[\p{L}\p{Nd}]$/u.test(c)) bad.add(c)
        }
      }
    }
  }
  return { words, bad: [...bad] }
}

function toRow(src: string): NameRow {
  const { words, bad } = splitWords(src)
  const lower = words.map((w) => w.toLowerCase())
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)
  return {
    src,
    words,
    bad,
    camel: lower.map((w, i) => (i === 0 ? w : cap(w))).join(''),
    pascal: lower.map(cap).join(''),
    snake: lower.join('_'),
    kebab: lower.join('-'),
    constant: lower.map((w) => w.toUpperCase()).join('_')
  }
}

const sig = () => JSON.stringify([input.value])
const run = useToolRun(sig)

/** 实时转换：输入变化立即重算 */
function execute() {
  const src = input.value
  if (!src.trim()) {
    rows.value = []
    stat.value = { total: 0, ok: 0, warn: 0 }
    run.markIdle()
    return
  }
  const list = src.split('\n').filter((l) => l.trim() !== '')
  rows.value = list.map(toRow)
  const warn = rows.value.filter((r) => r.bad.length > 0).length
  const empty = rows.value.filter((r) => r.words.length === 0).length
  stat.value = { total: rows.value.length, ok: rows.value.length - warn - empty, warn }
  run.markOk(
    warn
      ? `${warn} 行包含无法按规则分词的字符（已标黄，对应部分未参与转换）`
      : empty
        ? `${empty} 行没有可转换的单词（结果以 — 占位）`
        : '全部行均已转换'
  )
}

watch(input, execute)

function copyColumn(key: CaseKey, label: string) {
  const usable = rows.value.filter((r) => r.words.length > 0)
  clipboard.copy(usable.map((r) => r[key]).join('\n'), `${label} 列（${usable.length} 行）`)
}
</script>

<template>
  <div class="t09">
    <div class="t09__toolbar">
      <span class="t09__tip tertiary">每行一个标识符，输入后实时转换</span>
      <span class="grow"></span>
      <DkButton size="sm" variant="ghost" title="载入示例" @click="input = SAMPLE">载入示例</DkButton>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.staleNote.value"
      :meta="[`共 ${stat.total.toLocaleString()} 行`]"
      :retry="execute"
    />

    <DkEditor
      v-model="input"
      lang="标识符（每行一个）"
      placeholder="例如：&#10;user account id&#10;HTTPServer&#10;version2Name"
      :height="'240px'"
      filename="identifiers.txt"
    />

    <div class="t09__result">
      <div class="t09__scroll">
        <table v-if="rows.length" class="t09__table">
          <thead>
            <tr>
              <th class="t09__th t09__th--src">原文</th>
              <th v-for="c in columns" :key="c.key" class="t09__th" scope="col">
                <span class="t09__colname">{{ c.label }}</span>
                <button
                  class="t09__colcopy"
                  :title="`复制整列 ${c.label}`"
                  :disabled="stat.ok === 0"
                  @click="copyColumn(c.key, c.label)"
                >
                  <DkIcon name="copy" :size="12" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i" :class="{ 't09__row--warn': r.bad.length > 0 }">
              <td class="t09__td t09__td--src">
                <span class="mono">{{ r.src }}</span>
                <span
                  v-if="r.bad.length"
                  class="t09__bad"
                  :title="`包含无法按规则分词的字符：${r.bad.join(' ')}（该部分未参与转换）`"
                >
                  <DkIcon name="alert-triangle" :size="12" />
                </span>
              </td>
              <td v-for="c in columns" :key="c.key" class="t09__td">
                <span class="mono" :class="{ 't09__none': r.words.length === 0 }">
                  {{ r.words.length ? r[c.key] : '—' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="t09__empty tertiary">
          在上方输入标识符（每行一个），下方实时显示 camelCase、PascalCase、snake_case、kebab-case、CONSTANT_CASE 结果。
        </p>
      </div>
    </div>

    <DkCollapse title="分词策略">
      <ul>
        <li>空格、下划线 <code>_</code>、连字符 <code>-</code> 作为分隔符。</li>
        <li>驼峰边界：小写（或数字）→ 大写处切分，如 <code>versionName → version Name</code>。</li>
        <li>连续大写缩略词作为一个词：<code>HTTPServer → HTTP Server</code>，得到 <code>http_server</code> 而非 <code>h_t_t_p_server</code>。</li>
        <li>数字边界：<code>version2Name → version 2 Name</code>，得到 <code>version_2_name</code> / <code>version2Name</code>。</li>
        <li>无法按规则分词的字符（点号、emoji 等）：所在词不参与转换，整行标黄提示，结果以 — 占位。</li>
        <li>每列标题旁的复制按钮复制整列结果（不含 — 占位行），按行换行分隔。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t09 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t09__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 32px;
  flex-wrap: wrap;
}
.t09__tip {
  font-size: 12px;
}
.t09__result {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--editor-bg);
  overflow: hidden;
}
.t09__scroll {
  max-height: 340px;
  overflow: auto;
}
.t09__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.t09__th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
  border-bottom: 1px solid var(--border-strong);
  padding: 8px 12px;
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t09__th--src {
  min-width: 140px;
}
.t09__colname {
  font-family: var(--font-mono);
}
.t09__colcopy {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 6px;
  margin-left: 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  vertical-align: middle;
  transition: all 0.12s;
}
.t09__colcopy:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--accent);
}
.t09__colcopy:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.t09__td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-primary);
  font-size: var(--code-font-size);
  word-break: break-all;
}
.t09__td--src {
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.t09__row--warn {
  background: var(--warn-soft);
}
.t09__row--warn .t09__td--src {
  color: var(--text-primary);
}
.t09__bad {
  display: inline-flex;
  align-items: center;
  margin-left: 6px;
  color: var(--warn);
  cursor: help;
}
.t09__none {
  color: var(--text-tertiary);
}
.t09__empty {
  padding: 28px 16px;
  text-align: center;
  font-size: 13px;
}
</style>
