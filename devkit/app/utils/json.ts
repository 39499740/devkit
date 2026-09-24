/**
 * 大整数安全的 JSON 处理：
 * 解析时把数字的原始文本保留下来（19 位 ID 不丢精度），
 * 序列化时原样输出；同时检测重复键。
 */

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

/** 把 parseJson 结果里的 RawNumber 还原成普通值：安全范围内转 number，超出范围保留原始字符串 */
export function toPlainJson(v: unknown): unknown {
  if (v instanceof RawNumber) {
    const n = Number(v.raw)
    return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : v.raw
  }
  if (Array.isArray(v)) return v.map(toPlainJson)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = toPlainJson(val)
    return out
  }
  return v
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

/** 检测重复键（对合法 JSON 的对象逐层收集） */
export function detectDuplicateKeys(text: string): string[] {
  const dups: string[] = []
  const stack: { isArr: boolean; keys: Set<string>; path: string }[] = []
  let pathParts: string[] = []
  let i = 0
  let inStr = false
  let esc = false
  let pendingKey: string | null = null

  while (i < text.length) {
    const c = text[i]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') {
        inStr = false
        // 向后看是否为键
        let j = i + 1
        while (j < text.length && /\s/.test(text[j]!)) j++
        if (text[j] === ':') pendingKey = text.slice(0, i + 1).match(/"((?:[^"\\]|\\.)*)"$/)?.[1] ?? ''
      }
      i++
      continue
    }
    if (c === '"') {
      inStr = true
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

/** 数字原文是否可安全转为 JS number（不丢精度） */
export function isSafeJsonNumber(raw: string): boolean {
  const n = Number(raw)
  if (!Number.isFinite(n)) return false
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
  const m = /position (\d+)/.exec(msg)
  if (m) {
    const pos = Math.min(parseInt(m[1]!, 10), text.length)
    const before = text.slice(0, pos)
    const line = before.split('\n').length
    const column = pos - before.lastIndexOf('\n')
    return { line, column, message: msg }
  }
  const lm = /line (\d+) column (\d+)/.exec(msg)
  if (lm) return { line: parseInt(lm[1]!, 10), column: parseInt(lm[2]!, 10), message: msg }
  return null
}
