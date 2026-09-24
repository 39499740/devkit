/**
 * 大整数安全的 JSON 处理：
 * 解析时把数字的原始文本保留下来（19 位 ID 不丢精度），
 * 序列化时原样输出；同时检测重复键。
 */

import yaml from 'js-yaml'
import { errMessage } from './errors'

export class RawNumber {
  constructor(public raw: string) {}
}

/** 每次解析使用随机标记，用户字符串不可能与之冲突 */
function makeRawPrefix(): string {
  return '@@raw-' + Math.random().toString(36).slice(2) + Date.now().toString(36) + ':'
}

/** 把 JSON 文本中处于值位置的数字替换为带标记的字符串，再交给 JSON.parse */
function wrapNumbers(text: string, prefix: string): string {
  let out = ''
  let i = 0
  let inStr = false
  let esc = false
  let lastMeaningful = '' // 上一个非空白字符
  while (i < text.length) {
    const c = text[i]!
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      lastMeaningful = '"'
      i++
      continue
    }
    if (/\s/.test(c)) {
      out += c
      i++
      continue
    }
    // 值位置：开头、冒号/逗号/[/{ 之后
    const valuePos =
      lastMeaningful === '' || lastMeaningful === ':' || lastMeaningful === ',' || lastMeaningful === '[' || lastMeaningful === '{'
    if (valuePos && /[-0-9]/.test(c)) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
      if (m) {
        out += '"' + prefix + m[0] + '@@"'
        i += m[0].length
        lastMeaningful = '0'
        continue
      }
    }
    out += c
    lastMeaningful = c
    i++
  }
  return out
}

function makeUnwrap(prefix: string) {
  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith(prefix) && value.endsWith('@@')) {
      return new RawNumber(value.slice(prefix.length, -2))
    }
    return value
  }
}

/**
 * 把 parseJson 结果里的 RawNumber 还原成普通值：安全范围内转 number，超出范围（或会丢精度 / 下溢）
 * 保留原始字符串。
 * 这里统一走 isSafeJsonNumber，保证与 hasUnsafeRawNumber 的判定口径完全一致：
 * 不会出现「toPlainJson 已降级为字符串、hasUnsafeRawNumber 却不告警」的不一致。
 */
export function toPlainJson(v: unknown): unknown {
  if (v instanceof RawNumber) {
    return isSafeJsonNumber(v.raw) ? Number(v.raw) : v.raw
  }
  if (Array.isArray(v)) return v.map(toPlainJson)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = toPlainJson(val)
    return out
  }
  return v
}

/**
 * 递归检测解析结果中是否存在超出安全范围的 RawNumber（大整数 / 高精度小数）。
 * 这些值经 toPlainJson 会降级为字符串，数值类型判断与比较可能不精确；
 * 流程步骤据此追加中文告警（仅提示，不改变输出）。
 */
export function hasUnsafeRawNumber(v: unknown): boolean {
  if (v instanceof RawNumber) return !isSafeJsonNumber(v.raw)
  if (Array.isArray(v)) return v.some(hasUnsafeRawNumber)
  if (v !== null && typeof v === 'object') {
    for (const val of Object.values(v as Record<string, unknown>)) {
      if (hasUnsafeRawNumber(val)) return true
    }
  }
  return false
}

export interface JsonParseResult {
  value: unknown
  /** 重复键列表：路径 -> 键 */
  duplicateKeys: string[]
}

/** 解析 JSON：保留数字原始文本，检测重复键 */
export function parseJson(text: string): JsonParseResult {
  JSON.parse(text)
  const duplicateKeys = detectDuplicateKeys(text)
  const prefix = makeRawPrefix()
  const value = JSON.parse(
    wrapNumbers(text, prefix),
    makeUnwrap(prefix) as (this: unknown, k: string, v: unknown) => unknown
  )
  return { value, duplicateKeys }
}

/** 序列化（保留 RawNumber 原文；普通 number 按原文输出） */
export function stringifyJson(value: unknown, indent: number | '\t'): string {
  const pad = (depth: number) => (typeof indent === 'number' ? ' '.repeat(indent * depth) : indent.repeat(depth))
  const padClose = (depth: number) => (typeof indent === 'number' ? ' '.repeat(indent * depth) : indent.repeat(depth))
  const walk = (v: unknown, depth: number): string => {
    if (v instanceof RawNumber) return v.raw
    if (v === null) return 'null'
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v)
      case 'number':
        return Number.isFinite(v) ? String(v) : 'null'
      case 'boolean':
        return String(v)
      case 'object': {
        if (Array.isArray(v)) {
          if (v.length === 0) return '[]'
          const items = v.map((x) => pad(depth + 1) + walk(x, depth + 1))
          return '[\n' + items.join(',\n') + '\n' + padClose(depth) + ']'
        }
        const keys = Object.keys(v as Record<string, unknown>)
        if (keys.length === 0) return '{}'
        const items = keys.map((k) => `${pad(depth + 1)}${JSON.stringify(k)}: ${walk((v as Record<string, unknown>)[k], depth + 1)}`)
        return '{\n' + items.join(',\n') + '\n' + padClose(depth) + '}'
      }
      default:
        return 'null'
    }
  }
  return walk(value, 0)
}

/** 压缩序列化 */
export function minifyJson(value: unknown): string {
  const walk = (v: unknown): string => {
    if (v instanceof RawNumber) return v.raw
    if (v === null) return 'null'
    switch (typeof v) {
      case 'string':
        return JSON.stringify(v)
      case 'number':
        return Number.isFinite(v) ? String(v) : 'null'
      case 'boolean':
        return String(v)
      case 'object': {
        if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']'
        const keys = Object.keys(v as Record<string, unknown>)
        return '{' + keys.map((k) => `${JSON.stringify(k)}:${walk((v as Record<string, unknown>)[k])}`).join(',') + '}'
      }
      default:
        return 'null'
    }
  }
  return walk(value)
}

/** 反转义 JSON 字符串原文（含两端引号）；无法解析时退回去掉引号的内容 */
function unescapeJsonString(raw: string): string {
  if (raw.indexOf('\\') === -1) return raw.slice(1, -1)
  try {
    return JSON.parse(raw) as string
  } catch {
    return raw.slice(1, -1)
  }
}

/** 检测重复键（对合法 JSON 的对象逐层收集，单次扫描，O(n)） */
export function detectDuplicateKeys(text: string): string[] {
  const dups: string[] = []
  const stack: { isArr: boolean; keys: Set<string>; path: string }[] = []
  const pathParts: string[] = []
  let i = 0
  let inStr = false
  let esc = false
  let strStart = -1
  let pendingKey: string | null = null

  while (i < text.length) {
    const c = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') {
        inStr = false
        // 用原文切片取键，避免对前缀反复 slice + 正则（原实现 O(n²)）
        const raw = text.slice(strStart, i + 1)
        // 向后看是否为键
        let j = i + 1
        while (j < text.length && /\s/.test(text[j]!)) j++
        if (text[j] === ':') pendingKey = unescapeJsonString(raw)
      }
      i++
      continue
    }
    if (c === '"') {
      inStr = true
      strStart = i
      i++
      continue
    }
    if (c === '{' || c === '[') {
      const isArr = c === '['
      stack.push({ isArr, keys: new Set(), path: pathParts.join('.') })
      pathParts.push(isArr ? '[]' : '{}')
      i++
      continue
    }
    if (c === '}' || c === ']') {
      stack.pop()
      pathParts.pop()
      i++
      continue
    }
    if (c === ':' && pendingKey !== null) {
      const top = stack[stack.length - 1]
      if (top && !top.isArr) {
        const label = top.path ? `${top.path}.${pendingKey}` : pendingKey
        if (top.keys.has(pendingKey)) dups.push(label)
        else top.keys.add(pendingKey)
      }
      pendingKey = null
      i++
      continue
    }
    i++
  }
  return dups
}

/* ---------------- JSON → YAML 的数值保真（t03 工具页与流程执行器共用） ---------------- */

/**
 * 数字原文是否可安全转为 JS number（不丢精度）。
 * 与 toPlainJson / hasUnsafeRawNumber 共用这一份判定，口径必须保持一致：
 * - 指数形式使 |Number(raw)| 超出安全整数范围（1e21、1.5e30）→ 不安全；
 * - 下溢：Number(raw) === 0 但原文含非零有效数字（1e-400）→ 不安全；
 * - 整数按 Number.isSafeInteger，其余小数按有效数字位数（<= 15）估算。
 */
export function isSafeJsonNumber(raw: string): boolean {
  const n = Number(raw)
  if (!Number.isFinite(n)) return false
  // 超出安全整数范围：转 number 会静默改值（指数形式尤其容易被漏判）
  if (Math.abs(n) > Number.MAX_SAFE_INTEGER) return false
  // 下溢：原文有非零有效数字，却被解析成 0（如 1e-400）
  if (n === 0 && /[1-9]/.test(raw)) return false
  if (/^[-+]?\d+$/.test(raw)) return Number.isSafeInteger(n)
  const m = /^[-+]?([0-9]*)\.?([0-9]*)/.exec(raw)
  const sig = (((m?.[1] ?? '') + (m?.[2] ?? '')).replace(/^0+/, '')).length
  return sig <= 15
}

const escapeReg = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const SIMPLE_KEY = /^[A-Za-z_$][A-Za-z0-9_$\u4e00-\u9fa5]*$/

/** 把 JSON 路径与键拼成可读路径：简单键用 .key，其余用 ["key"] */
export function joinKey(path: string, k: string): string {
  return SIMPLE_KEY.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`
}

/**
 * 把 parseJson 的结果（含 RawNumber）转成可交给 js-yaml 的普通值；
 * 超出安全范围的大数用占位符替代（dump 后由 applyYamlRawMap 替换回原文，保证 YAML 文本不丢精度）。
 */
export function toYamlJsonable(
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
    return v.map((x, i) => toYamlJsonable(x, token, counter, rawMap, unsafe, `${path}[${i}]`))
  }
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v)) o[k] = toYamlJsonable(val, token, counter, rawMap, unsafe, joinKey(path, k))
    return o
  }
  return v
}

/** 把 dump 结果中的占位符回填为数字原文；无占位符时原样返回 */
export function applyYamlRawMap(dumped: string, token: string, rawMap: Map<string, string>): string {
  if (!rawMap.size) return dumped
  return dumped.replace(new RegExp(escapeReg(token) + '\\d{6}zz', 'g'), (m) => rawMap.get(m) ?? m)
}

/** 从 JSON.parse 错误中提取行列位置 */
export function jsonErrorPosition(e: unknown, text: string): { line: number; column: number; message: string } | null {
  const msg = e instanceof Error ? e.message : String(e)
  const detail = localizeJsonMessage(msg)
  const m = /position (\d+)/.exec(msg)
  if (m) {
    const pos = Math.min(parseInt(m[1]!, 10), text.length)
    const before = text.slice(0, pos)
    const line = before.split('\n').length
    const column = pos - before.lastIndexOf('\n')
    return { line, column, message: detail }
  }
  const lm = /line (\d+) column (\d+)/.exec(msg)
  if (lm) return { line: parseInt(lm[1]!, 10), column: parseInt(lm[2]!, 10), message: detail }
  return null
}

/**
 * 把 V8 的常见英文 JSON 错误翻成中文（未知错误也回退中文，不再泄漏英文原文）。
 * jsonErrorPosition 与各调用方都复用它，保证工具页 / 流程 / CSV 呈现一致。
 */
export function localizeJsonMessage(msg: string): string {
  if (/Expected property name or '}'/.test(msg)) return '属性名缺失或格式不正确（可能是多余逗号或缺少引号）'
  if (/Expected double-quoted property name/.test(msg)) return '属性名必须用双引号（常见于多余逗号或使用了单引号/无引号键）'
  if (/Expected ':' after property name/.test(msg)) return '属性名后缺少冒号'
  if (/Expected ',' or ']' after array element/.test(msg)) return '数组元素之间缺少逗号或右方括号'
  if (/Expected ',' or '}' after property value/.test(msg)) return '对象属性之间缺少逗号或右花括号'
  if (/Unexpected end of JSON input/.test(msg)) return 'JSON 提前结束（可能缺少右括号、引号或值）'
  if (/Unterminated string/.test(msg)) return '字符串缺少结束引号'
  if (/Bad control character/.test(msg)) return '字符串中包含非法控制字符'
  if (/Bad escaped character/.test(msg)) return '包含非法的转义字符'
  if (/Unexpected non-whitespace character/.test(msg)) return 'JSON 结束后还有多余内容'
  if (/Unexpected token/.test(msg)) return '出现意外字符，不是合法的 JSON'
  if (/Unexpected number/.test(msg)) return '出现意外的数字'
  if (/Unexpected string/.test(msg)) return '出现意外的字符串'
  // 兜底也用中文，确保不再泄漏 V8 英文原文
  return 'JSON 语法错误，请检查该位置附近的内容'
}

/* ---------------- YAML → JSON 的保真加载（t03 工具页与流程执行器共用） ---------------- */

const RE_BOOL_KEY = /^(?:true|false|True|False|TRUE|FALSE)$/
const RE_NULL_KEY = /^(?:~|null|Null|NULL)$/
const RE_INT_KEY = /^[-+]?(?:[0-9][0-9_]*|0x[0-9a-fA-F_]+|0o[0-7_]+)$/
const RE_FLOAT_KEY = /^[-+]?(?:[0-9][0-9_]*\.[0-9_]*(?:[eE][-+]?[0-9]+)?|\.[0-9_]+(?:[eE][-+]?[0-9]+)?|[0-9][0-9_]*[eE][-+]?[0-9]+)$/
const RE_INF_KEY = /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/

const YAML_NUM_TEXT = /^[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/
const YAML_INF_NAN_TEXT = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/
const JSON_NUM_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

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
export function scanNonStringKeys(text: string): KeyIssue[] {
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
export function findNonFinite(v: unknown, path: string): { path: string; kind: string } | null {
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

/**
 * 深度查找 yaml.load 之后残留的非字符串键。
 *
 * js-yaml 在构造映射键时会把非字符串键强制转成字符串：带标签/锚点的数字键（!!int 1: / &k 1: a）
 * 经自定义 Type 构造成 RawNumber 对象后，作为键会被 String() 成 "[object Object]"。
 * 此时文本层的 scanNonStringKeys 因首字符是 & / ! 已被跳过，加载后再也拿不到原始键，
 * 只能据此拒绝，避免把数据静默损坏成 "[object Object]"。
 */
function findNonStringKey(v: unknown, path: string, seen: WeakSet<object>): string | null {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const r = findNonStringKey(v[i], `${path}[${i}]`, seen)
      if (r) return r
    }
    return null
  }
  if (v === null || typeof v !== 'object' || v instanceof RawNumber) return null
  if (seen.has(v)) return null
  seen.add(v)
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    // Object.entries 的键静态上恒为 string，但 "[object Object]" 是非字符串键被强转后的残留标记
    if (typeof k !== 'string' || k === '[object Object]') return path || '$'
    const r = findNonStringKey(val, joinKey(path, k), seen)
    if (r) return r
  }
  return null
}

/**
 * 把 js-yaml 的英文 reason 映射成中文；未知 reason 也回退中文，不回显英文原文。
 * 若错误带 mark，会在前面补上「第 X 行第 Y 列附近：」。
 */
export function localizeYamlMessage(e: unknown): string {
  const raw = errMessage(e)
  const reason = raw.split('\n')[0]!.trim().replace(/\s*\(\d+:\d+\)\s*$/, '')
  const mark = (e as { mark?: { line?: number; column?: number } } | null)?.mark
  let where = ''
  if (mark && typeof mark.line === 'number' && typeof mark.column === 'number') {
    where = `第 ${mark.line + 1} 行第 ${mark.column + 1} 列附近：`
  }
  return where + mapYamlReason(reason)
}

function mapYamlReason(reason: string): string {
  if (/unexpected end of the stream within a flow collection/i.test(reason)) return '流式集合（[ 或 {）未正确闭合，内容提前结束'
  if (/bad indentation of a (?:mapping|sequence) entry/i.test(reason)) return '缩进不正确，请检查该行与上一级的缩进'
  if (/end of the stream or a document separator is expected/i.test(reason)) return '文档意外结束或分隔符位置不正确（常见于使用了 Tab 缩进或缺少换行）'
  if (/found character '\\t' that cannot start any token/i.test(reason)) return '使用了制表符（Tab）缩进，请改为空格'
  if (/duplicated mapping key/i.test(reason)) return '存在重复的键'
  if (/mapping values are not allowed/i.test(reason)) return '此处不允许出现映射值（冒号用法不正确）'
  if (/could not find expected ':'/i.test(reason)) return '缺少冒号（键与值之间需要冒号）'
  if (/cannot read a block mapping entry/i.test(reason)) return '无法解析块映射条目，请检查缩进与冒号'
  if (/unknown tag/i.test(reason)) {
    const tag = /tag:[^>]+/.exec(reason)?.[0]
    return tag ? `存在当前 Schema 不支持的 YAML 标签（${tag}）` : '存在当前 Schema 不支持的 YAML 标签'
  }
  if (/unresolved tag|cannot resolve a node/i.test(reason)) return '存在无法解析的 YAML 标签'
  if (/found unexpected ':'|unexpected ':'/i.test(reason)) return '出现了意外的冒号'
  if (/a block sequence is not allowed/i.test(reason)) return '此处不允许块序列，请检查缩进'
  return 'YAML 语法不正确，请检查缩进、冒号与引号'
}

/**
 * 保真加载 YAML：
 * - 用 yaml.JSON_SCHEMA（日期等不会被自动转成对象），并补上 merge 类型，
 *   使 `<<: *anchor` 按 YAML 合并语义展开（否则会变成一个普通的 "<<" 键，静默出错）；
 * - 数字用自定义 Type 覆盖；
 * - 不是 JSON 数字字面量的标量（如 007、0x1f）按字符串保留原文；
 * - 超出 JS 安全范围的数值用 RawNumber 保留原文；
 * - 非字符串键、.inf / .nan 等无法映射的情况抛出中文 Error。
 * 返回 notes 描述发生的保真处理（可直接拼接展示）。
 */
export function loadYamlPreservingNumbers(text: string): { value: unknown; notes: string[] } {
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
  // JSON_SCHEMA 不含 merge 类型，`<<: *anchor` 会被当成普通键（键名 "<<"）静默保留。
  // 补一个与 js-yaml 内置等价的 merge 类型，让合并键按 YAML 语义真正展开、且不残留 "<<"。
  const mergeType = new yaml.Type('tag:yaml.org,2002:merge', {
    kind: 'scalar',
    resolve: (d: unknown) => d === '<<' || d === null
  })
  const schema = yaml.JSON_SCHEMA.extend({
    implicit: [numberType('tag:yaml.org,2002:int'), numberType('tag:yaml.org,2002:float'), mergeType]
  })
  let value: unknown
  try {
    value = yaml.load(text, { schema })
  } catch (e) {
    throw new Error(`YAML 解析失败：${localizeYamlMessage(e)}。请按提示修正缩进或语法后重试`)
  }
  const keyIssues = scanNonStringKeys(text)
  if (keyIssues.length) {
    const first = keyIssues[0]!
    throw new Error(
      `无法静默转换：第 ${first.line} 行的键 ${JSON.stringify(first.key || '（空键）')} 是 ${first.type}，` +
        `JSON 对象的键必须是字符串（共 ${keyIssues.length} 处）。请为键加引号，如 "${first.key || '键名'}": …`
    )
  }
  // 文本层扫不到、但加载后已损坏成 "[object Object]" 的非字符串键（标签/锚点导致）兜底
  const badKeyPath = findNonStringKey(value, '$', new WeakSet())
  if (badKeyPath) {
    throw new Error(
      `YAML 的键必须是字符串：存在非字符串键（可能是标签/锚点导致），无法无损转为 JSON（位置 ${badKeyPath}）`
    )
  }
  const nf = findNonFinite(value, '$')
  if (nf) {
    throw new Error(`无法静默转换：${nf.path} 的值是 ${nf.kind}，JSON 数字不支持无穷或 NaN。请改为字符串或有限数值`)
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
  return { value, notes }
}
