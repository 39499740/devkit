<script setup lang="ts">
import type { ToolMeta } from '~/data/tools'
import yaml from 'js-yaml'

const props = defineProps<{ tool: ToolMeta }>()

const input = ref('')
const output = ref('')
const dir = ref<'p2y' | 'y2p'>('p2y')
const decodeUnicode = ref(true)
const escapeUnicodeOut = ref(false)
const arrayStrategy = ref<'array' | 'keep'>('array')
/** 含点字面键确认：原键 -> 是否按字面键（整体一个键名） */
const literalKeys = ref<Record<string, boolean>>({})

const dottedCandidates = ref<string[]>([])
const notes = ref<string[]>([])
const errDetail = ref('')

/* ---------------- Properties 解析（自写，遵循 java.util.Properties 规则） ---------------- */

interface PEntry { key: string; value: string }
interface ParsePropsResult {
  entries: PEntry[]
  errors: string[]
  unicodeDecoded: number
  dupKeys: string[]
}

/** 逻辑行拼接：行尾奇数个反斜杠 = 续行（去掉反斜杠，跳过下一行行首空白） */
function logicalLines(text: string): string[] {
  const lines: string[] = []
  let pending: string | null = null
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line: string = pending !== null ? pending + raw.replace(/^[ \t\f]*/, '') : raw
    const m = /(\\+)$/.exec(line)
    const trailing = m ? m[1]!.length : 0
    if (trailing % 2 === 1) {
      pending = line.slice(0, -1)
    } else {
      lines.push(line)
      pending = null
    }
  }
  if (pending !== null) lines.push(pending)
  return lines
}

function propUnescape(s: string, decode: boolean, res: { errors: string[]; unicodeDecoded: number }): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (c !== '\\') {
      out += c
      i++
      continue
    }
    const e = s[i + 1]
    if (e === undefined) {
      out += '\\'
      i++
      continue
    }
    if (e === 'u') {
      const hex = s.slice(i + 2, i + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        if (decode) {
          out += String.fromCharCode(parseInt(hex, 16))
          res.unicodeDecoded++
        } else {
          out += '\\u' + hex
        }
        i += 6
        continue
      }
      res.errors.push(`\\uXXXX 转义格式不合法：${s.slice(i, i + 6) || '\\u（已到行尾）'}（位于 "${s.slice(0, 12)}..." 附近）`)
      out += '\\u'
      i += 2
      continue
    }
    switch (e) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case 'f': out += '\f'; break
      default: out += e // \\ -> \，\= -> =，其他未知转义丢弃反斜杠（与 java.util.Properties 一致）
    }
    i += 2
  }
  return out
}

function parseProperties(text: string): ParsePropsResult {
  const res: ParsePropsResult = { entries: [], errors: [], unicodeDecoded: 0, dupKeys: [] }
  const seen = new Map<string, number>()
  for (const line of logicalLines(text)) {
    const t = line.replace(/^[ \t\f]+/, '')
    if (!t) continue
    if (t.startsWith('#') || t.startsWith('!')) continue
    // 键终止于第一个未转义的空白 / = / :
    let i = 0
    let keyRaw = ''
    while (i < t.length) {
      const c = t[i]!
      if (c === '\\') {
        keyRaw += t.slice(i, i + 2)
        i += 2
        continue
      }
      if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break
      keyRaw += c
      i++
    }
    // 跳过空白
    while (i < t.length && /[ \t\f]/.test(t[i]!)) i++
    // 可选分隔符 = 或 :
    if (t[i] === '=' || t[i] === ':') i++
    while (i < t.length && /[ \t\f]/.test(t[i]!)) i++
    const valueRaw = t.slice(i)
    const key = propUnescape(keyRaw, decodeUnicode.value, res).trim()
    const value = propUnescape(valueRaw, decodeUnicode.value, res)
    if (!key) {
      res.errors.push(`存在空键的属性行："${t.slice(0, 30)}"`)
      continue
    }
    if (seen.has(key)) {
      res.dupKeys.push(key)
      res.entries[seen.get(key)!] = { key, value }
    } else {
      seen.set(key, res.entries.length)
      res.entries.push({ key, value })
    }
  }
  return res
}

/* ---------------- 树构建（含冲突检测） ---------------- */

type PNode =
  | { kind: 'map'; children: Map<string, PNode> }
  | { kind: 'arr'; items: Map<number, PNode> }
  | { kind: 'val'; value: string }

function newMap(): PNode {
  return { kind: 'map', children: new Map() }
}

function buildTree(entries: PEntry[]): { root: PNode; conflicts: string[] } {
  const root = newMap()
  const conflicts: string[] = []
  for (const { key, value } of entries) {
    const literal = !!literalKeys.value[key]
    let parts: string[]
    if (literal) {
      parts = [key]
    } else {
      parts = key.split('.')
    }
    let node: PNode = root
    for (let i = 0; i < parts.length; i++) {
      let rawPart = parts[i]!
      const last = i === parts.length - 1
      // a.b[0] -> base a.b 下的数组下标 0（仅未勾选字面键时）
      let idx: number | null = null
      if (!literal) {
        const m = /^(.*)\[(\d+)\]$/.exec(rawPart)
        if (m) {
          rawPart = m[1] || '[]'
          idx = parseInt(m[2]!, 10)
        }
      }
      if (node.kind === 'val') {
        conflicts.push(`键 "${key}" 与已有标量键冲突：路径 "${parts.slice(0, i).join('.')}" 已有值，不能同时作为父路径`)
        node = newMap()
        break
      }
      if (node.kind === 'arr') {
        conflicts.push(`键 "${key}" 与数组下标键冲突：路径 "${parts.slice(0, i).join('.')}" 已是数组`)
        node = newMap()
        break
      }
      if (idx !== null && arrayStrategy.value === 'array') {
        let arr = node.children.get(rawPart)
        if (!arr) {
          arr = { kind: 'arr', items: new Map() }
          node.children.set(rawPart, arr)
        } else if (arr.kind !== 'arr') {
          conflicts.push(`键 "${key}" 冲突："${rawPart}" 已存在且不是数组（可能与 "${rawPart}=值" 或对象键共存）`)
          arr = { kind: 'arr', items: new Map() }
          node.children.set(rawPart, arr)
        }
        if (last) {
          const prev = arr.items.get(idx)
          if (prev && prev.kind !== 'val') {
            conflicts.push(`键 "${key}" 冲突：下标 [${idx}] 已被对象占用`)
          }
          arr.items.set(idx, { kind: 'val', value })
        } else {
          const next = arr.items.get(idx)
          if (!next) {
            const m2 = newMap()
            arr.items.set(idx, m2)
            node = m2
          } else if (next.kind === 'val') {
            conflicts.push(`键 "${key}" 与已有标量冲突："${rawPart}[${idx}]" 已有值，不能同时作为父路径`)
            const m2 = newMap()
            arr.items.set(idx, m2)
            node = m2
          } else {
            node = next
          }
        }
        continue
      }
      const part = idx !== null ? `${rawPart}[${idx}]` : rawPart
      if (last) {
        const prev = node.children.get(part)
        if (prev && prev.kind !== 'val') {
          conflicts.push(`父子键冲突："${key}" 想赋值，但 "${parts.slice(0, i + 1).join('.')}" 已是对象/数组（禁止静默覆盖）`)
        }
        node.children.set(part, { kind: 'val', value })
      } else {
        let next = node.children.get(part)
        if (!next) {
          next = newMap()
          node.children.set(part, next)
        } else if (next.kind === 'val') {
          conflicts.push(`父子键冲突："${parts.slice(0, i + 1).join('.')}" 已有标量值，但 "${key}" 把它当作父路径使用（禁止静默覆盖）`)
          next = newMap()
          node.children.set(part, next)
        }
        node = next
      }
    }
  }
  return { root, conflicts }
}

/* ---------------- YAML 输出（值一律加引号保字符串语义） ---------------- */

function yamlQuoteKey(key: string, force: boolean): string {
  const need =
    force ||
    key === '' ||
    /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(key) ||
    /^(?:true|false|null|yes|no|on|off|~)$/i.test(key) ||
    /[{}\[\],&*?|>'"%@`#\n]/.test(key) ||
    /[:]/.test(key) ||
    /^[ \t]|[ \t]$/.test(key) ||
    /^[-?!]/.test(key)
  if (!need) return key
  return `"${key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function yamlQuoteVal(v: string): string {
  const esc = v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  return `"${esc}"`
}

function emitMap(node: Extract<PNode, { kind: 'map' }>, indent: number): string[] {
  const ind = '  '.repeat(indent)
  const lines: string[] = []
  for (const [key, child] of node.children) {
    const force = !!literalKeys.value[key]
    if (child.kind === 'val') {
      lines.push(`${ind}${yamlQuoteKey(key, force)}: ${yamlQuoteVal(child.value)}`)
    } else if (child.kind === 'map') {
      if (child.children.size === 0) {
        lines.push(`${ind}${yamlQuoteKey(key, force)}: {}`)
      } else {
        lines.push(`${ind}${yamlQuoteKey(key, force)}:`, ...emitMap(child, indent + 1))
      }
    } else {
      if (child.items.size === 0) {
        lines.push(`${ind}${yamlQuoteKey(key, force)}: []`)
      } else {
        lines.push(`${ind}${yamlQuoteKey(key, force)}:`, ...emitArr(child, indent + 1))
      }
    }
  }
  return lines
}

function emitArr(node: Extract<PNode, { kind: 'arr' }>, indent: number): string[] {
  const ind = '  '.repeat(indent)
  const lines: string[] = []
  const idxs = [...node.items.keys()].sort((a, b) => a - b)
  for (const idx of idxs) {
    const item = node.items.get(idx)!
    if (item.kind === 'val') {
      lines.push(`${ind}- ${yamlQuoteVal(item.value)}`)
    } else if (item.kind === 'map') {
      const inner = item.children.size ? emitMap(item, indent + 1) : []
      if (!inner.length) {
        lines.push(`${ind}- {}`)
      } else {
        inner[0] = `${ind}- ` + inner[0]!.slice(ind.length + 2)
        lines.push(...inner)
      }
    } else {
      const inner = item.items.size ? emitArr(item, indent + 1) : []
      if (!inner.length) {
        lines.push(`${ind}- []`)
      } else {
        inner[0] = `${ind}- ` + inner[0]!.slice(ind.length + 2)
        lines.push(...inner)
      }
    }
  }
  return lines
}

/* ---------------- YAML -> Properties ---------------- */

function escapePropKey(k: string): string {
  return k.replace(/[\\=: #!]/g, (c) => '\\' + c)
}

function escapePropValue(v: string): string {
  let s = v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\f/g, '\\f')
  if (escapeUnicodeOut.value) {
    s = s.replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  }
  return s
}

function flattenYaml(
  value: unknown,
  prefix: string,
  out: { key: string; value: string; bare: boolean }[],
): void {
  if (value === null || value === undefined) {
    out.push({ key: prefix, value: '', bare: false })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => flattenYaml(item, `${prefix}[${i}]`, out))
    return
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const literal = !!literalKeys.value[k]
      const seg = literal ? k : escapePropKey(k)
      flattenYaml(v, prefix ? `${prefix}.${seg}` : seg, out)
    }
    return
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push({ key: prefix, value: String(value), bare: true })
    return
  }
  out.push({ key: prefix, value: escapePropValue(String(value)), bare: false })
}

function collectDottedKeys(value: unknown, out: string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.includes('.')) out.push(k)
    collectDottedKeys(v, out)
  }
}

/* ---------------- 执行 ---------------- */

const SAMPLE = `# 应用基础配置（中文注释仅作说明）
server.port=8080
server.servlet.context-path=/api
spring.application.name=demo
spring.profiles.active=dev
logging.level.root=INFO
app.owner=开发工具箱
app.title=Java \\u5f00\\u53d1\\u5de5\\u5177
my.app.version=1.0
db.hosts[0]=127.0.0.1
db.hosts[1]=192.168.1.10`

const SAMPLE_YAML = `server:
  port: 8080
spring:
  application:
    name: demo
logging:
  level:
    root: INFO
app:
  owner: 开发工具箱
  retries: 3
  enabled: true
my.app.version: 1.0
`

const sig = () =>
  JSON.stringify([input.value, dir.value, decodeUnicode.value, escapeUnicodeOut.value, arrayStrategy.value, Object.keys(literalKeys.value).sort().map((k) => `${k}=${literalKeys.value[k]}`)])
const run = useToolRun(sig)

function execute() {
  notes.value = []
  if (!input.value.trim()) {
    run.markIdle()
    output.value = ''
    errDetail.value = ''
    dottedCandidates.value = []
    return
  }
  try {
    if (dir.value === 'p2y') {
      const parsed = parseProperties(input.value)
      if (parsed.errors.length) {
        errDetail.value = parsed.errors[0]!
        run.markFail(`Properties 解析失败：${parsed.errors.join('；')}`)
        return
      }
      dottedCandidates.value = [...new Set(parsed.entries.map((e) => e.key).filter((k) => k.includes('.')))]
      if (parsed.dupKeys.length) {
        notes.value.push(`重复键 ${parsed.dupKeys.length} 个（${parsed.dupKeys.slice(0, 3).join('、')}${parsed.dupKeys.length > 3 ? ' 等' : ''}），后者生效`)
      }
      if (parsed.unicodeDecoded > 0) {
        notes.value.push(`已按选项解码 ${parsed.unicodeDecoded} 处 \\uXXXX 转义`)
      }
      const literals = dottedCandidates.value.filter((k) => literalKeys.value[k])
      if (literals.length) {
        notes.value.push(`按字面键输出（整体作为键名，加引号）：${literals.join('、')}`)
      } else if (dottedCandidates.value.length) {
        notes.value.push(`检测到 ${dottedCandidates.value.length} 个含点键（默认按点路径嵌套，可在下方改为字面键）`)
      }
      const { root, conflicts } = buildTree(parsed.entries)
      if (conflicts.length) {
        errDetail.value = conflicts[0]!
        run.markFail(`存在父子键冲突，禁止静默覆盖：${conflicts.join('；')}`)
        return
      }
      const lines = emitMap(root as Extract<PNode, { kind: 'map' }>, 0)
      output.value = lines.join('\n') + '\n'
      run.markOk('YAML 中所有值都加了引号：按 Properties 语义一律视为字符串（"8080" 不会变成数字）')
    } else {
      let doc: unknown
      try {
        doc = yaml.load(input.value, { schema: yaml.JSON_SCHEMA })
      } catch (e) {
        errDetail.value = `YAML 解析失败：${errMessage(e)}`
        run.markFail(errDetail.value)
        return
      }
      if (doc === null || doc === undefined) {
        errDetail.value = 'YAML 内容为空（或只有注释），没有可转换的键值'
        run.markFail(errDetail.value)
        return
      }
      if (typeof doc !== 'object' || Array.isArray(doc)) {
        errDetail.value = '顶层必须是 YAML 映射（键值对），当前是数组或标量'
        run.markFail(errDetail.value)
        return
      }
      const dotted: string[] = []
      collectDottedKeys(doc, dotted)
      dottedCandidates.value = [...new Set(dotted)]
      if (dottedCandidates.value.length) {
        const literals = dottedCandidates.value.filter((k) => literalKeys.value[k])
        notes.value.push(
          literals.length
            ? `按字面键输出（含点不拆分）：${literals.join('、')}`
            : `检测到 ${dottedCandidates.value.length} 个含点键（默认按点路径拆分为嵌套 Properties 键，可在下方改为字面键）`,
        )
      }
      const out: { key: string; value: string; bare: boolean }[] = []
      flattenYaml(doc, '', out)
      if (escapeUnicodeOut.value) notes.value.push('已开启中文转 \\uXXXX 输出')
      output.value = out.map((l) => `${l.key}=${l.value}`).join('\n') + '\n'
      run.markOk('数字 / 布尔按原样裸输出：Properties 本身无类型，回读时一律是字符串；null 输出为空值')
    }
  } catch (e) {
    errDetail.value = errMessage(e)
    run.markFail(errDetail.value)
  }
}

watch([dir, decodeUnicode, escapeUnicodeOut, arrayStrategy, literalKeys], execute, { deep: true })

function toggleLiteral(key: string, v: boolean) {
  literalKeys.value = { ...literalKeys.value, [key]: v }
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
  <div class="t24">
    <div class="t24__toolbar">
      <DkSegmented
        :model-value="dir"
        :options="[
          { value: 'p2y', label: 'Properties → YAML' },
          { value: 'y2p', label: 'YAML → Properties' },
        ]"
        @update:model-value="dir = $event as any"
      />
      <div v-if="dir === 'p2y'" class="t24__opt">
        <span class="t24__opt-label">数组下标键</span>
        <DkSelect
          :model-value="arrayStrategy"
          :options="[
            { value: 'array', label: '转 YAML 数组' },
            { value: 'keep', label: '保留下标键' },
          ]"
          @update:model-value="arrayStrategy = $event as any"
        />
      </div>
      <DkCheckbox v-if="dir === 'p2y'" v-model="decodeUnicode" label="解码 \uXXXX 转义" />
      <DkCheckbox v-if="dir === 'y2p'" v-model="escapeUnicodeOut" label="中文转 \uXXXX 输出" />
      <span class="grow"></span>
      <DkButton
        size="sm"
        variant="ghost"
        @click="input = dir === 'p2y' ? SAMPLE : SAMPLE_YAML; execute()"
      >
        载入示例
      </DkButton>
      <DkButton size="sm" variant="primary" @click="execute">
        <DkIcon name="play" :size="12" />
        转换
      </DkButton>
      <span class="t24__kbd tertiary">⌘/Ctrl + Enter</span>
    </div>

    <DkStatusBar
      :status="run.status.value"
      :message="run.status.value === 'error' ? errDetail : run.staleNote.value"
      :meta="[dir === 'p2y' ? '自写 Properties 解析' : 'js-yaml · JSON_SCHEMA']"
      :retry="execute"
    />

    <div class="t24__panes">
      <SplitPanes :initial="50" :min="25" :max="75">
        <template #left>
          <DkEditor
            v-model="input"
            :lang="dir === 'p2y' ? 'Properties 输入' : 'YAML 输入'"
            :placeholder="dir === 'p2y' ? '粘贴 .properties 内容，支持 = / : 分隔、# ! 注释、行尾 \\ 续行、\\uXXXX 转义' : '粘贴 YAML 内容（映射）'"
            :height="'calc(56vh - 60px)'"
            :filename="dir === 'p2y' ? 'application.properties' : 'application.yml'"
          />
        </template>
        <template #right>
          <DkEditor
            :model-value="output"
            readonly
            :lang="dir === 'p2y' ? 'YAML 输出' : 'Properties 输出'"
            placeholder="转换结果将显示在这里"
            :stale="run.status.value === 'stale'"
            :error="run.status.value === 'error' ? errDetail : ''"
            :height="'calc(56vh - 60px)'"
            :filename="dir === 'p2y' ? 'application.yml' : 'application.properties'"
          />
        </template>
      </SplitPanes>
    </div>

    <div v-if="dottedCandidates.length" class="t24__literal">
      <div class="t24__section-title">含点字面键确认（默认按点路径嵌套；勾选后该键整体作为一个键名，不拆分）</div>
      <div v-for="k in dottedCandidates" :key="k" class="t24__literal-row">
        <DkCheckbox
          :model-value="!!literalKeys[k]"
          :label="`字面键：${k}`"
          @update:model-value="toggleLiteral(k, $event)"
        />
        <span class="mono t24__literal-key">{{ k }}</span>
      </div>
    </div>

    <div v-if="notes.length && run.status.value === 'ok'" class="t24__notes">
      <span v-for="(nt, i) in notes" :key="i">{{ nt }}</span>
    </div>

    <DkCollapse title="用法说明">
      <ul>
        <li>Properties 解析遵循 <code>java.util.Properties</code> 规则：<code>=</code> 与 <code>:</code> 分隔（也支持空白分隔）、<code>#</code> / <code>!</code> 注释、行尾 <code>\</code> 续行；键两侧空白 trim，值只去除分隔符后的前导空白，尾部空白按 <code>java.util.Properties</code> 保留；<code>\uXXXX</code> 解码可关闭。</li>
        <li>Properties → YAML：点路径自动嵌套（server.port → server: {port:}），a.b[0] / a.b[1] 可选转数组或保留下标键；所有值一律加引号，保持字符串语义（"8080" 回读仍是字符串，注明不改变语义）。</li>
        <li>父子键冲突（a=1 与 a.b=2 共存）会直接报错并列出冲突键，禁止静默覆盖。</li>
        <li>YAML → Properties：使用 js-yaml（JSON_SCHEMA，日期保持字符串）拍平为点路径；数字 / 布尔裸输出并注明类型语义变化（Properties 无类型，回读均为字符串，且 <code>1.0</code> 这类数字字面会按解析值输出为 <code>1</code>）；中文默认不转义，可开启 <code>\uXXXX</code> 输出。</li>
        <li>含点的键（如 my.app.version 整体是键名）无法与点路径自动区分，请在「含点字面键确认」中逐键指定；字面键在 YAML 输出中加引号，在 Properties 输出中保持原样。</li>
      </ul>
    </DkCollapse>
  </div>
</template>

<style scoped>
.t24 {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.t24__toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 40px;
  flex-wrap: wrap;
}
.t24__opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.t24__opt-label {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}
.t24__kbd {
  font-size: 11px;
  white-space: nowrap;
}
.t24__panes {
  min-height: 320px;
}
.t24__literal {
  border: 1px solid var(--warn, #d4a72c);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.t24__section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}
.t24__literal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.t24__literal-key {
  color: var(--accent);
  font-size: 12px;
}
.t24__notes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
