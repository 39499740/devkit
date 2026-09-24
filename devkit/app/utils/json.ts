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
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // defineProperty：JSON 里字面量 "__proto__" 键必须保留为普通自有键，
      // 用 out[k] = … 会触发 Object.prototype 的原型 setter，导致该键丢失且结果原型被改写。
      Object.defineProperty(out, k, {
        value: toPlainJson(val),
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
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

/** 解析 JSON：保留数字原始文本，检测重复键（前导 BOM 会被剥离，避免 JSON.parse 直接失败） */
export function parseJson(text: string): JsonParseResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  JSON.parse(src)
  const duplicateKeys = detectDuplicateKeys(src)
  const prefix = makeRawPrefix()
  const value = JSON.parse(
    wrapNumbers(src, prefix),
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

/**
 * JSON 嵌套深度硬上限：超过即拒绝。
 * 深嵌套输入会让重复键扫描的栈帧 / 递归遍历开销随深度放大（旧实现每层都 join 完整路径 → O(depth²)，
 * 2 万层即 ~600MB / 1.3s，5 万层直接 OOM）。
 *
 * 取 2500 层，与 parseJson 内部 `JSON.parse(wrapNumbers(...), reviver)` 的递归上限协调
 * （实测 reviver 递归约 2950 层即抛 RangeError "Maximum call stack size exceeded"）：
 * 在重复键扫描阶段就抛中文「嵌套层级过深」，避免随后 reviver 递归栈溢出抛英文 RangeError，
 * 使 parseJson 与各调用方对深嵌套给出统一的中文提示，且不再 OOM。
 * 正常数据（含代码生成器产物）的嵌套层级远小于该值。
 */
export const JSON_MAX_NESTING_DEPTH = 2500

/** 嵌套过深时抛出的中文错误（parseJson / 调用方据此给出「嵌套层级过深」提示） */
function nestingTooDeepError(): Error {
  return new Error(`JSON 嵌套层级过深（超过 ${JSON_MAX_NESTING_DEPTH} 层），已拒绝处理，请减少嵌套层级后重试`)
}

/**
 * 重复键扫描的栈帧。
 * 关键点：不再为每一层预先保存完整路径字符串（那会使累计内存 / 时间达到 O(depth²)），
 * 只保留父帧引用与本层在父路径中的占位段；可读路径仅在真正发现重复键时才按需重建。
 */
interface DupKeyFrame {
  isArr: boolean
  keys: Set<string>
  /** 父容器帧；根容器为 null */
  parent: DupKeyFrame | null
  /** 本帧在父级路径中的占位段（'{}' / '[]'） */
  seg: string
  /** 惰性缓存的可读路径：仅在首次发现重复键时重建一次，同层后续重复直接复用 */
  path?: string
}

/** 沿父链重建帧所在路径（不含本帧占位段）：与旧实现每层 `pathParts.join('.')` 的结果完全一致 */
function rebuildFramePath(frame: DupKeyFrame): string {
  if (frame.path !== undefined) return frame.path
  const segs: string[] = []
  for (let f = frame.parent; f !== null; f = f.parent) segs.push(f.seg)
  segs.reverse()
  frame.path = segs.join('.')
  return frame.path
}

/**
 * 检测重复键（对合法 JSON 的对象逐层收集，单次扫描）。
 * 路径按需重建并缓存：整体 O(n + 含重复键的层数 × 深度)，深嵌套不再 OOM。
 * 嵌套超过 JSON_MAX_NESTING_DEPTH 时抛出中文错误。
 */
export function detectDuplicateKeys(text: string): string[] {
  const dups: string[] = []
  const stack: DupKeyFrame[] = []
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
      if (stack.length >= JSON_MAX_NESTING_DEPTH) throw nestingTooDeepError()
      const isArr = c === '['
      const parent = stack.length ? stack[stack.length - 1]! : null
      stack.push({ isArr, keys: new Set(), parent, seg: isArr ? '[]' : '{}' })
      i++
      continue
    }
    if (c === '}' || c === ']') {
      stack.pop()
      i++
      continue
    }
    if (c === ':' && pendingKey !== null) {
      const top = stack[stack.length - 1]
      if (top && !top.isArr) {
        if (top.keys.has(pendingKey)) {
          const path = rebuildFramePath(top)
          dups.push(path ? `${path}.${pendingKey}` : pendingKey)
        } else top.keys.add(pendingKey)
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
    for (const [k, val] of Object.entries(v)) {
      // 与 toPlainJson 同理：保留字面量 "__proto__" 键，避免原型 setter 丢键 / 改原型
      Object.defineProperty(o, k, {
        value: toYamlJsonable(val, token, counter, rawMap, unsafe, joinKey(path, k)),
        enumerable: true,
        writable: true,
        configurable: true
      })
    }
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
  // 已是中文的「嵌套层级过深」错误原样保留，避免被下方兜底文案覆盖（parseJson 对深嵌套的提示）
  if (/嵌套层级过深/.test(msg)) return msg
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

const YAML_NUM_TEXT = /^[-+]?(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+)$/
const YAML_INF_NAN_TEXT = /^(?:[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/
const JSON_NUM_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/** 非字符串键探针标记（含 NUL，正常字符串键不可能与之冲突） */
const NON_STRING_KEY_MARK = '\u0000devkit-nonstring-key\u0000'

/**
 * 探针层「复杂键」标记（映射/序列键）。带随机后缀，正常字符串键不可能与之冲突。
 * 不能再用字面量 "[object Object]" 判定复杂键——那会把合法的字符串键 `"[object Object]": 1` 误拒。
 */
const COMPLEX_KEY_MARK = '\u0000devkit-complex-key\u0000'

interface ComplexKeyMarks {
  /** 解析期间临时挂到 Object.prototype[Symbol.toStringTag] 的随机标记 */
  objectTag: string
  /** 解析期间临时替换 Array.prototype.toString 返回的随机标记 */
  arrayMark: string
}

/**
 * 生成一组随机复杂键标记。
 *
 * js-yaml 的 storeMappingPair 会把「普通对象键」直接替换成字面量 "[object Object]"（不调用 toString），
 * 且「序列键」最终也只是一个普通字符串（如 "1,2"），因此仅凭 load 之后的键值无法区分
 * 「复杂键」与「恰好叫 "[object Object]" / "1,2" 的合法字符串键」。
 * 这里在探测解析期间临时：
 * - 把 Object.prototype[Symbol.toStringTag] 设为随机标记 → 普通对象键 String() 出 `[object <标记>]`；
 * - 把 Array.prototype.toString 替换为返回随机标记 → 序列键 String() 出该标记。
 * 解析完成（含异常）立即还原，探测结果只用于校验，绝不泄漏到返回值或全局。
 */
function makeComplexKeyMarks(): ComplexKeyMarks {
  const rand = Math.random().toString(36).slice(2) + Date.now().toString(36)
  return { objectTag: `${COMPLEX_KEY_MARK}map-${rand}`, arrayMark: `${COMPLEX_KEY_MARK}seq-${rand}` }
}

/** 在临时复杂键标记的作用域内执行探测解析，结束后（含异常）还原原型 */
function withComplexKeyMarks<T>(marks: ComplexKeyMarks, run: () => T): T {
  const prevTagDesc = Object.getOwnPropertyDescriptor(Object.prototype, Symbol.toStringTag)
  const prevArrayToString = Array.prototype.toString
  Object.defineProperty(Object.prototype, Symbol.toStringTag, {
    value: marks.objectTag,
    configurable: true,
    writable: true,
    enumerable: false
  })
  Array.prototype.toString = function complexKeyArrayToString(): string {
    return marks.arrayMark
  }
  try {
    return run()
  } finally {
    if (prevTagDesc) Object.defineProperty(Object.prototype, Symbol.toStringTag, prevTagDesc)
    else Reflect.deleteProperty(Object.prototype, Symbol.toStringTag)
    Array.prototype.toString = prevArrayToString
  }
}

/**
 * 非字符串键探针：只在「键类型探测」这一趟解析里使用。
 *
 * js-yaml 构造映射键时会把非字符串键 String() 化（80 → "80"、true → "true"、对象 → "[object Object]"），
 * 加载完成后已无法凭键的类型区分。这里用一份独立的 Schema 再解析一遍，把 null / 布尔 / 数字标量
 * 构造成带唯一标记的探针对象：映射键经 String() 后会变成可识别的标记串，
 * 从而精确判断「键原本是不是字符串、是什么类型」。探测结果只用于校验，绝不泄漏到返回值。
 */
class NonStringKeyProbe {
  /** 标量所在行（0 基，-1 表示未知）；由探测解析的 listener 写入 */
  line = -1
  constructor(
    public type: string,
    public raw: string
  ) {}
  // 必须让 Object.prototype.toString.call(probe) !== "[object Object]"：
  // 否则 js-yaml 的 storeMappingPair 会先把对象键替换成字面量 "[object Object]" 而不调用 toString。
  get [Symbol.toStringTag](): string {
    return 'DevkitNonStringKeyProbe'
  }
  toString(): string {
    return NON_STRING_KEY_MARK + this.type + '\u0001' + this.line + '\u0001' + this.raw
  }
}

function makeNonStringKeyProbeSchema(): yaml.Schema {
  const probeType = (tag: string, type: string, resolve: (d: unknown) => boolean) =>
    new yaml.Type(tag, {
      kind: 'scalar',
      resolve,
      construct: (d: unknown) => new NonStringKeyProbe(type, String(d))
    })
  return yaml.JSON_SCHEMA.extend({
    implicit: [
      probeType('tag:yaml.org,2002:null', 'null', (d) => typeof d === 'string' && RE_NULL_KEY.test(d)),
      probeType('tag:yaml.org,2002:bool', '布尔值', (d) => typeof d === 'string' && RE_BOOL_KEY.test(d)),
      probeType(
        'tag:yaml.org,2002:int',
        '数字',
        (d) => typeof d === 'string' && (YAML_NUM_TEXT.test(d) || YAML_INF_NAN_TEXT.test(d))
      ),
      probeType(
        'tag:yaml.org,2002:float',
        '数字',
        (d) => typeof d === 'string' && (YAML_NUM_TEXT.test(d) || YAML_INF_NAN_TEXT.test(d))
      ),
      // 与正式解析一样支持 merge 键：否则重复的 << 在探测解析里会被误判成重复键
      new yaml.Type('tag:yaml.org,2002:merge', { kind: 'scalar', resolve: (d) => d === '<<' || d === null })
    ]
  })
}

const NON_STRING_KEY_PROBE_SCHEMA = makeNonStringKeyProbeSchema()

/** 探测解析的 listener：把标量行号写回探针，供错误信息使用 */
function attachProbeLine(event: string, state: { result?: unknown; line?: number }): void {
  if (event === 'close' && state.result instanceof NonStringKeyProbe && typeof state.line === 'number') {
    state.result.line = state.line
  }
}

interface NonStringKeyIssue {
  path: string
  key: string
  type: string
  line: number
  /** 是否为映射/序列这类复杂键（由探针层 COMPLEX_KEY_MARK 标记识别） */
  complex?: boolean
}

/** 从探针标记串还原原始键的类型、行号与原文 */
function decodeProbeKey(marked: string): { type: string; line: number; raw: string } {
  const rest = marked.slice(NON_STRING_KEY_MARK.length)
  const sep1 = rest.indexOf('\u0001')
  const sep2 = rest.indexOf('\u0001', sep1 + 1)
  return {
    type: rest.slice(0, sep1),
    line: Number(rest.slice(sep1 + 1, sep2)),
    raw: rest.slice(sep2 + 1)
  }
}

/**
 * 深度遍历「探测解析」结果，收集所有非字符串键（load 之后的自有属性/类型检查）：
 * - 键以 NON_STRING_KEY_MARK 开头 → 原本是 null / 布尔 / 数字（含带标签 !!int / 锚点 &k 的同类标量）；
 * - 键与探针层生成的随机复杂键标记（marks.arrayMark / `[object <objectTag>]`）完全相同
 *   → 原本是映射/序列等复杂键。不再用字面量 "[object Object]" 判定，合法字符串键 "[object Object]" 因此可通过。
 * WeakSet 去重，兼容别名共享节点与循环别名，整体为 O(不同节点数)。
 */
function findNonStringKey(
  v: unknown,
  path: string,
  seen: WeakSet<object>,
  out: NonStringKeyIssue[],
  marks: ComplexKeyMarks
): void {
  if (v instanceof NonStringKeyProbe) return
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) findNonStringKey(v[i], `${path}[${i}]`, seen, out, marks)
    return
  }
  if (v === null || typeof v !== 'object') return
  if (seen.has(v)) return
  seen.add(v)
  const mappingKey = '[object ' + marks.objectTag + ']'
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (k.startsWith(NON_STRING_KEY_MARK)) {
      const info = decodeProbeKey(k)
      out.push({ path: path || '$', key: info.raw, type: info.type, line: info.line + 1 })
      findNonStringKey(val, joinKey(path, info.raw), seen, out, marks)
    } else if (k === marks.arrayMark || k === mappingKey) {
      out.push({ path: path || '$', key: '', type: '映射或序列键', line: 0, complex: true })
      findNonStringKey(val, path ? `${path}{映射或序列}` : '{映射或序列}', seen, out, marks)
    } else {
      findNonStringKey(val, joinKey(path, k), seen, out, marks)
    }
  }
}

/** 把非字符串键问题整理成清晰的中文错误信息 */
function describeNonStringKeyIssues(issues: NonStringKeyIssue[]): string {
  const first = issues[0]!
  if (first.complex) {
    return '无法静默转换：存在非字符串键（映射或序列），JSON 对象的键必须是字符串。请改用字符串作为键'
  }
  const display = first.key || '（空键）'
  const where = first.line > 0 ? `第 ${first.line} 行的键` : '键'
  return (
    `无法静默转换：${where} ${JSON.stringify(display)} 是 ${first.type}，` +
    `JSON 对象的键必须是字符串（共 ${issues.length} 处）。请为键加引号，如 "${display}": …`
  )
}

/**
 * 查找无法映射为 JSON 的特殊数值（.inf / .nan）。
 * YAML 别名会让同一节点被多处引用（DAG），用 WeakSet 去重保证每个节点只访问一次，
 * 否则深层别名会指数级重复遍历、冻结主线程。
 */
export function findNonFinite(
  v: unknown,
  path: string,
  seen: WeakSet<object> = new WeakSet()
): { path: string; kind: string } | null {
  if (typeof v === 'number' && !Number.isFinite(v)) {
    return { path, kind: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity（.inf）' : '-Infinity（-.inf）' }
  }
  if (Array.isArray(v)) {
    if (seen.has(v)) return null
    seen.add(v)
    for (let i = 0; i < v.length; i++) {
      const r = findNonFinite(v[i], `${path}[${i}]`, seen)
      if (r) return r
    }
    return null
  }
  if (v !== null && typeof v === 'object') {
    if (seen.has(v)) return null
    seen.add(v)
    for (const [k, val] of Object.entries(v)) {
      const r = findNonFinite(val, joinKey(path, k), seen)
      if (r) return r
    }
  }
  return null
}

/* ---------------- YAML 别名放大（billion laughs）防护 ---------------- */

/** YAML 输入文本长度上限：超过直接拒绝，避免超大文本进入解析 */
const YAML_MAX_TEXT_LENGTH = 2_000_000
/**
 * 展开成树后的绝对节点数硬上限：与别名无关，纯粹防御「没有别名但条目极多」的输入把内存打爆。
 * 21 万节点的扁平数组（约 1.36MB 文本）远低于此值，不再被误拒。
 */
const YAML_MAX_EXPANDED_NODES = 20_000_000
/** 展开成树后的绝对字符数硬上限（同样与别名无关） */
const YAML_MAX_EXPANDED_CHARS = 8_000_000
/** 放大判定倍数：展开节点数超过「DAG 去重节点数」的这么多倍才算别名放大 */
const YAML_AMPLIFICATION_FACTOR = 10
/**
 * 放大判定余量：小结构里的少量别名（如前几层 * 展开到十几万节点）不算危险，
 * 只有超过 `unique * 10 + 余量` 才判为放大。
 * 取 20 万是为了让 `bomb(5,10)`（约 12 万节点，既有回归要求可用）继续通过，
 * 同时把 `bomb(6,9)`（约 60 万节点）拦下。
 */
const YAML_AMPLIFICATION_SLACK = 200_000

const YAML_ALIAS_AMPLIFIED_MESSAGE =
  'YAML 别名展开后数据过大（疑似别名放大），已拒绝处理；请避免深层嵌套的 * 别名'
const YAML_TOO_LARGE_MESSAGE = 'YAML 输入规模过大，请减少条目或嵌套后重试'

/**
 * 统计 DAG 去重后的节点数：每个不同的对象只计一次；标量按出现次数计
 * （js-yaml 用原始值表示标量，无法按引用去重）。
 * 别名共享的对象在这里只算一个节点，因此 `expandedNodes / uniqueNodes` 能反映「别名放大倍数」。
 */
function countUniqueYamlNodes(value: unknown): number {
  const seen = new WeakSet<object>()
  let count = 0
  const walk = (v: unknown): void => {
    if (v === null || typeof v !== 'object' || v instanceof RawNumber) {
      count++
      return
    }
    if (seen.has(v)) return
    seen.add(v)
    count++
    if (Array.isArray(v)) {
      for (const item of v) walk(item)
    } else {
      for (const val of Object.values(v as Record<string, unknown>)) walk(val)
    }
  }
  walk(value)
  return count
}

/**
 * 校验 YAML 值「展开成树」后的规模，拦截别名放大（billion laughs）。
 *
 * 判定口径（P2-1 修正后，按「放大程度」而非绝对展开量判定）：
 * 1. 计算 `uniqueNodes`（DAG 去重节点数）与 `expandedNodes`（展开成树的近似节点数）；
 * 2. 只有 `expandedNodes` 相对 `uniqueNodes` 显著放大（> unique*10 + 20 万）才判为「别名放大」——
 *    这样 21 万节点的合法扁平大数组（ratio≈1）不会被误拒；
 * 3. 另设绝对硬上限 `expandedNodes > 2000 万` 或字符数 > 800 万，防止无别名的超大数据 OOM；
 * 4. 自引用（循环别名）展开没有终点，直接按放大处理。
 *
 * 不真正展开：对每个对象只计算一次「自身子树的规模」（WeakMap 记忆化），
 * 被多处引用时按引用次数累加，整体复杂度为 O(不同节点数)。
 *
 * 导出供各工具页 / 执行器在 yaml.load 之后、任何展平 / 遍历之前复用，
 * 保证别名放大在膨胀前就被中文报错拦截。
 */
export function assertYamlExpansionWithinBudget(value: unknown): void {
  const sizeCache = new WeakMap<object, { nodes: number; chars: number }>()
  const computing = new WeakSet<object>()
  let cyclic = false

  const measure = (v: unknown): { nodes: number; chars: number } => {
    if (v === null || typeof v !== 'object' || v instanceof RawNumber) {
      const text = v === null ? 'null' : typeof v === 'string' ? v : String(v)
      return { nodes: 1, chars: text.length + 2 }
    }
    const cached = sizeCache.get(v)
    if (cached) return cached
    if (computing.has(v)) {
      // 循环别名：展开没有终点
      cyclic = true
      return { nodes: Infinity, chars: Infinity }
    }
    computing.add(v)
    let nodes = 1
    let chars = 2
    if (Array.isArray(v)) {
      for (const item of v) {
        const s = measure(item)
        nodes += s.nodes
        chars += s.chars
      }
    } else {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const s = measure(val)
        nodes += s.nodes
        chars += s.chars + k.length + 4
      }
    }
    computing.delete(v)
    const own = { nodes, chars }
    sizeCache.set(v, own)
    return own
  }

  const uniqueNodes = countUniqueYamlNodes(value)
  const { nodes: expandedNodes, chars: expandedChars } = measure(value)

  // 1) 别名放大：相对放大倍数超过阈值（含循环别名与指数级溢出到 Infinity 的情况）
  if (
    cyclic ||
    !Number.isFinite(expandedNodes) ||
    !Number.isFinite(expandedChars) ||
    expandedNodes > uniqueNodes * YAML_AMPLIFICATION_FACTOR + YAML_AMPLIFICATION_SLACK
  ) {
    throw new Error(YAML_ALIAS_AMPLIFIED_MESSAGE)
  }
  // 2) 绝对规模硬上限：与别名无关，防止超大数据把内存打爆
  if (expandedNodes > YAML_MAX_EXPANDED_NODES || expandedChars > YAML_MAX_EXPANDED_CHARS) {
    throw new Error(YAML_TOO_LARGE_MESSAGE)
  }
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
  if (text.length > YAML_MAX_TEXT_LENGTH) {
    throw new Error(`YAML 文本过长（${text.length} 字符，超过 ${YAML_MAX_TEXT_LENGTH} 上限），${YAML_TOO_LARGE_MESSAGE}`)
  }
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
  // 别名放大防护：共享节点（anchor/alias）本身很小，但展开成树会指数级膨胀，必须尽早拒绝
  assertYamlExpansionWithinBudget(value)
  // 非字符串键检测：用探针 Schema 再解析一遍（见 NonStringKeyProbe 注释），完全依赖 load 之后的类型判定。
  // 不再做文本层逐行正则扫描，既消除「一行大量 "- "」时的二次回溯，也避免把多行引号标量里的 "1: x" 误判为键。
  // 复杂键（映射/序列）只有探测解析能识别：解析期间临时给 Object.prototype / Array.prototype 打随机标记，
  // 使 storeMappingPair 对复杂键 String() 出带标记的串（详见 withComplexKeyMarks）。
  const keyIssues: NonStringKeyIssue[] = []
  try {
    const marks = makeComplexKeyMarks()
    const probeValue = withComplexKeyMarks(marks, () =>
      yaml.load(text, { schema: NON_STRING_KEY_PROBE_SCHEMA, listener: attachProbeLine })
    )
    findNonStringKey(probeValue, '$', new WeakSet(), keyIssues, marks)
  } catch {
    // 探测解析与正式解析同语法，理论上不会失败；万一失败也不再用字面量 "[object Object]" 判定复杂键
    // （会误伤合法字符串键），此处仅放弃键类型校验。
  }
  if (keyIssues.length) throw new Error(describeNonStringKeyIssues(keyIssues))
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
