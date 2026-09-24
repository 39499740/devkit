/**
 * T45 JSON Schema：从 JSON 推断 Schema，以及按 Draft 2020-12 子集校验实例。
 * 校验一次收集全部错误（不是遇到第一个就停），并给出 JSONPath 与 Schema 位置。
 */
import { isSafeJsonNumber, RawNumber } from './json'

export type Draft = '2020-12' | 'draft-07'

/** 值是否为 RawNumber（parseJson 为保留大整数原文而使用的包装类型） */
function isRawNumber(v: unknown): v is RawNumber {
  return v instanceof RawNumber
}

/**
 * own-property 判断。不能用 `in`：`'constructor' in {}`、`'toString' in {}`、`'__proto__' in {}`
 * 都会沿原型链命中，导致 required / properties / $ref 等把原型成员误当作声明的键。
 */
function hasOwn(obj: object | null | undefined, key: string): boolean {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key)
}

/**
 * 数字原文是否为整数（供 RawNumber 判定 type: integer）。
 * 安全范围内按精确数值判断（1.0 / 1e2 / 100.0 均为整数）；
 * 超出安全范围的整数则回退到原文书写形式，避免 Number 近似导致的误判。
 */
function isIntegerRaw(raw: string): boolean {
  if (isSafeJsonNumber(raw)) return Number.isInteger(Number(raw))
  return /^-?\d+$/.test(raw)
}

/**
 * 数值关键字（minimum / maximum / multipleOf…）可接受的比较值：
 * number、RawNumber 或数字字符串；整数统一转 BigInt 精确比较，避免大整数丢精度。
 */
type Comparable = number | bigint

function rawToComparable(raw: string): Comparable | null {
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (/^[-+]?\d+$/.test(raw)) {
    try {
      return BigInt(raw)
    } catch {
      return n
    }
  }
  return n
}

function toComparable(v: unknown): Comparable | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null
    return Number.isInteger(v) ? BigInt(v) : v
  }
  if (isRawNumber(v)) return rawToComparable(v.raw)
  if (typeof v === 'string') return rawToComparable(v)
  return null
}

/**
 * 把 Comparable 精确转成 BigInt（仅当它确实表示整数时）；否则返回 null。
 * number 为整数（含 1000000000.0 这类可精确表示的整值）与 bigint 都视为可精确取模。
 */
function exactBigInt(c: Comparable): bigint | null {
  if (typeof c === 'bigint') return c
  return Number.isInteger(c) ? BigInt(c) : null
}

/**
 * multipleOf：整数用 BigInt 精确取模，其余比较 value 与最近的整数倍；非正因子按「不约束」处理。
 * 两侧都能精确表示为整数时必须走 BigInt：浮点容差会随 |value| 放大，1e9 量级下容差可达 1，
 * 会把余数为 1 的非法值误判成整数倍。
 */
function isMultipleOf(value: Comparable, factor: Comparable): boolean {
  const fnum = Number(factor)
  if (!(fnum > 0)) return true
  const vBig = exactBigInt(value)
  const fBig = exactBigInt(factor)
  if (vBig !== null && fBig !== null) return vBig % fBig === 0n
  const vnum = Number(value)
  if (!Number.isFinite(vnum)) return false
  // 仅在真正的小数场景使用容差，且按 ULP 量级（相对机器精度），不随 |value| 放大到放过余数
  const k = Math.round(vnum / fnum)
  if (!Number.isFinite(k)) return false
  const scale = Math.max(Math.abs(vnum), Math.abs(k * fnum))
  return Math.abs(vnum - k * fnum) <= 4 * Number.EPSILON * scale
}

/**
 * 长度 / 项数 / 字段数等计数类关键字（minLength / maxItems / minProperties…）：
 * 同样接受 number、RawNumber 或数字字符串，避免 schema 保留 RawNumber 后被 typeof === 'number' 跳过。
 */
function countValue(v: unknown): number | null {
  const c = toComparable(v)
  if (c === null) return null
  const n = Number(c)
  return Number.isFinite(n) ? n : null
}

/** 实例是否为数值（number 或 RawNumber）：数值关键字只对这两类实例生效 */
function isNumericInstance(v: unknown): v is number | RawNumber {
  return typeof v === 'number' || isRawNumber(v)
}

/** 两个 Comparable 是否数值相等（bigint 与 number 混比时按数值，避免 1n === 1 为 false） */
function comparableEqual(a: Comparable, b: Comparable): boolean {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a === b
  if (typeof a === 'bigint' || typeof b === 'bigint') return Number(a) === Number(b)
  return a === b
}

/**
 * 键序无关的深比较，用于 const / enum：
 * - 对象按键名排序后逐键递归，数组按序递归；
 * - RawNumber 保留既有语义：与 number 按数值比较、与字符串按原文比较、两个 RawNumber 按数值比较。
 * 替代原先依赖键顺序的 JSON.stringify 比较。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (isRawNumber(a) || isRawNumber(b)) {
    const rawA = isRawNumber(a) ? a.raw : null
    const rawB = isRawNumber(b) ? b.raw : null
    if (rawA !== null && rawB !== null) {
      const ca = rawToComparable(rawA)
      const cb = rawToComparable(rawB)
      if (ca !== null && cb !== null) return comparableEqual(ca, cb)
      return rawA === rawB
    }
    const raw = (rawA ?? rawB) as string
    const other = rawA !== null ? b : a
    if (typeof other === 'number') {
      if (!Number.isFinite(other)) return false
      const c = rawToComparable(raw)
      return c !== null && comparableEqual(c, Number.isInteger(other) ? BigInt(other) : other)
    }
    if (typeof other === 'string') return raw === other
    return false
  }
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  const aArr = Array.isArray(a)
  if (aArr !== Array.isArray(b)) return false
  if (aArr) {
    const A = a as unknown[]
    const B = b as unknown[]
    if (A.length !== B.length) return false
    for (let i = 0; i < A.length; i += 1) if (!deepEqual(A[i], B[i])) return false
    return true
  }
  const A = a as Record<string, unknown>
  const B = b as Record<string, unknown>
  const ak = Object.keys(A)
  if (ak.length !== Object.keys(B).length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(B, k)) return false
    if (!deepEqual(A[k], B[k])) return false
  }
  return true
}

/**
 * uniqueItems 用的规范键：对象键名排序、RawNumber / number 按数值归一，
 * 与 deepEqual 的「键序无关」语义一致，但保持 O(n·log n) 的集合判重。
 */
function canonicalKey(v: unknown): string {
  if (isRawNumber(v)) {
    const c = rawToComparable(v.raw)
    return 'n:' + (c === null ? v.raw : String(c))
  }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'n:' + String(v)
    return 'n:' + (Number.isInteger(v) ? BigInt(v).toString() : String(v))
  }
  if (v === null) return 'null'
  if (typeof v === 'string') return 's:' + JSON.stringify(v)
  if (typeof v === 'boolean') return 'b:' + v
  if (Array.isArray(v)) return '[' + v.map((x) => canonicalKey(x)).join(',') + ']'
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    return (
      '{' +
      Object.keys(obj)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonicalKey(obj[k]))
        .join(',') +
      '}'
    )
  }
  return typeof v + ':' + String(v)
}

/** 面向用户的取值展示：RawNumber 显示数字原文，避免泄漏 {"raw":…} */
function show(v: unknown): string {
  if (isRawNumber(v)) return v.raw
  return JSON.stringify(v)
}

export interface SchemaError {
  /** 实例位置，JSONPath 写法 */
  path: string
  /** 实例位置，JSON Pointer 写法 */
  pointer: string
  /** Schema 中的位置 */
  schemaPath: string
  keyword: string
  message: string
}

export interface ValidateResult {
  valid: boolean
  errors: SchemaError[]
  warnings: string[]
  checked: number
}

export interface InferOptions {
  draft: Draft
  strict: boolean
}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (isRawNumber(v)) return isIntegerRaw(v.raw) ? 'integer' : 'number'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function actualType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (isRawNumber(v)) return isIntegerRaw(v.raw) ? 'integer' : 'number'
  return typeof v
}

function jsonPath(pointer: string): string {
  if (!pointer) return '$'
  return (
    '$' +
    pointer
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        const key = seg.replace(/~1/g, '/').replace(/~0/g, '~')
        return /^\d+$/.test(key) ? `[${key}]` : /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `['${key}']`
      })
      .join('')
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/
const URI_RE = /^[a-zA-Z][a-zA-Z\d+\-.]*:/
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/

function checkFormat(value: string, format: string): boolean | null {
  switch (format) {
    case 'email':
      return EMAIL_RE.test(value)
    case 'date':
      return DATE_RE.test(value)
    case 'date-time':
      return DATETIME_RE.test(value)
    case 'uri':
    case 'uri-reference':
      return URI_RE.test(value)
    case 'uuid':
      return UUID_RE.test(value)
    case 'ipv4':
      return IPV4_RE.test(value)
    default:
      return null
  }
}

/** 严格模式下把 format 断言当作错误，否则仅提示 */
export function validateInstance(
  instance: unknown,
  schema: unknown,
  opts: { strict: boolean; maxErrors?: number } = { strict: true }
): ValidateResult {
  const errors: SchemaError[] = []
  const warnings: string[] = []
  const max = opts.maxErrors ?? 50
  let checked = 0
  /** 深度上限告警只提示一次，避免深层结构刷屏 */
  let depthWarned = false
  /** 当前收集器：组合关键字在隔离收集器里试算，避免失败分支的错误污染最终结果 */
  let sink: SchemaError[] = errors

  /** 把隔离分支收集到的错误合并进当前收集器（受 maxErrors 限制） */
  function merge(list: SchemaError[]) {
    for (const e of list) {
      if (sink.length >= max) return
      sink.push(e)
    }
  }

  /**
   * 在隔离收集器里跑一段校验：错误与警告都收在局部，不改动外层结果。
   * 分支确实失败时（没人会上报它）连它产生的 format 提示一起丢掉，避免失败分支的警告泄漏到最终结果里。
   */
  function isolate(fn: () => void): SchemaError[] {
    const saved = sink
    const savedWarnings = warnings.length
    const local: SchemaError[] = []
    sink = local
    try {
      fn()
    } finally {
      sink = saved
    }
    if (local.length) warnings.length = savedWarnings
    return local
  }

  const resolveRef = (ref: string): unknown => {
    if (!ref.startsWith('#')) throw new Error(`只支持文档内的 $ref，收到 ${ref}`)
    const parts = ref
      .slice(1)
      .split('/')
      .filter(Boolean)
      .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    let cur: unknown = schema
    for (const p of parts) {
      if (cur && typeof cur === 'object' && hasOwn(cur, p)) cur = (cur as Record<string, unknown>)[p]
      else throw new Error(`$ref 指向的 ${ref} 在文档中不存在`)
    }
    return cur
  }

  function push(pointer: string, schemaPath: string, keyword: string, message: string) {
    if (sink.length >= max) return
    sink.push({ path: jsonPath(pointer), pointer: pointer || '/', schemaPath: schemaPath || '/', keyword, message })
  }

  function eq(a: unknown, b: unknown): boolean {
    // 键序无关的深比较；RawNumber 语义见 deepEqual
    return deepEqual(a, b)
  }

  function walk(inst: unknown, sch: unknown, pointer: string, spath: string, depth: number) {
    if (depth > 64) {
      if (!depthWarned) {
        depthWarned = true
        warnings.push('校验深度超过上限（64），更深的节点未校验，结果可能不完整')
      }
      return
    }
    if (sink.length >= max) return
    if (sch === true || sch === undefined) return
    if (sch === false) {
      push(pointer, spath, 'false', '该位置不允许出现任何值（schema 为 false）')
      return
    }
    if (typeof sch !== 'object') throw new Error(`Schema 在 ${spath || '/'} 不是对象`)
    const s = sch as Record<string, unknown>
    checked += 1

    if (typeof s.$ref === 'string') {
      // 解析失败（含 #/__proto__、#/constructor 这类命中原型成员的路径）按校验错误上报，
      // 不静默成功，也不抛出「Schema 不是对象」这类内部错误。
      let target: unknown
      try {
        target = resolveRef(s.$ref)
      } catch (err) {
        push(pointer, `${spath}/$ref`, '$ref', err instanceof Error ? err.message : String(err))
        return
      }
      walk(inst, target, pointer, `${spath}/$ref`, depth + 1)
      // 2020-12 中 $ref 只是普通关键字：解析并校验目标后继续处理同级关键字，不 return 丢弃
    }

    // 组合关键字：每个分支在隔离收集器里试算，只有确定失败的才上报
    for (const kw of ['allOf', 'anyOf', 'oneOf'] as const) {
      const list = s[kw]
      if (!Array.isArray(list)) continue
      const branchErrors = list.map((sub, i) =>
        isolate(() => walk(inst, sub, pointer, `${spath}/${kw}/${i}`, depth + 1))
      )
      const passedIdx = branchErrors.map((errs, i) => (errs.length === 0 ? i : -1)).filter((i) => i >= 0)

      if (kw === 'allOf') {
        branchErrors.forEach((errs, i) => {
          if (!errs.length) return
          push(pointer, `${spath}/allOf/${i}`, kw, `不满足 allOf 第 ${i + 1} 个子 schema`)
          merge(errs)
        })
      } else if (kw === 'anyOf') {
        if (!passedIdx.length) {
          push(pointer, spath, kw, `不满足 anyOf 中的任何一个子 schema（共 ${list.length} 个分支）`)
          branchErrors.slice(0, 3).forEach((errs, i) => {
            const first = errs[0]
            if (first) push(pointer, `${spath}/anyOf/${i}`, kw, `分支 ${i + 1} 未通过：${first.message}`)
          })
        }
      } else if (kw === 'oneOf') {
        if (!passedIdx.length) {
          push(pointer, spath, kw, `oneOf 没有任何分支通过（共 ${list.length} 个分支）`)
        } else if (passedIdx.length > 1) {
          push(
            pointer,
            spath,
            kw,
            `oneOf 要求恰好 1 个分支通过，实际通过 ${passedIdx.length} 个（分支 ${passedIdx.map((i) => i + 1).join('、')}）`
          )
        }
      }
    }
    // 布尔子 schema 是合法 schema（false 恒不通过、true 恒通过），
    // 必须用 hasOwn 区分「未声明」与布尔值，不能用真值短路漏掉 false。
    if (hasOwn(s, 'not')) {
      const notErrors = isolate(() => walk(inst, s.not, pointer, `${spath}/not`, depth + 1))
      if (!notErrors.length) push(pointer, spath, 'not', '命中了 not 排除的 schema')
    }
    if (hasOwn(s, 'if')) {
      const condErrors = isolate(() => walk(inst, s.if, pointer, `${spath}/if`, depth + 1))
      if (!condErrors.length) {
        if (hasOwn(s, 'then')) walk(inst, s.then, pointer, `${spath}/then`, depth + 1)
      } else if (hasOwn(s, 'else')) {
        walk(inst, s.else, pointer, `${spath}/else`, depth + 1)
      }
    }

    // type
    if (typeof s.type === 'string' || Array.isArray(s.type)) {
      const want = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string]
      const ok = want.some((w) => typeNameMatch(inst, w))
      if (!ok) {
        push(pointer, `${spath}/type`, 'type', `应为 ${want.join(' 或 ')}，当前为 ${actualType(inst)}`)
        return
      }
    }

    if (hasOwn(s, 'const') && !eq(inst, s.const)) {
      push(pointer, `${spath}/const`, 'const', `应为常量 ${show(s.const)}，当前为 ${show(inst)}`)
    }
    if (Array.isArray(s.enum) && !s.enum.some((v) => eq(v, inst))) {
      push(
        pointer,
        `${spath}/enum`,
        'enum',
        `应为枚举值之一（${s.enum.map((v) => show(v)).join('、')}），当前为 ${show(inst)}`
      )
    }

    if (typeof inst === 'string') {
      // minLength/maxLength 按 Unicode 码点计数（JSON Schema 定义），不能用 UTF-16 码元的 inst.length，
      // 否则代理对（如 emoji）会被算成 2。
      const codePointLen = Array.from(inst).length
      const minLen = countValue(s.minLength)
      if (minLen !== null && codePointLen < minLen) {
        push(pointer, `${spath}/minLength`, 'minLength', `长度至少 ${minLen}，当前 ${codePointLen}`)
      }
      const maxLen = countValue(s.maxLength)
      if (maxLen !== null && codePointLen > maxLen) {
        push(pointer, `${spath}/maxLength`, 'maxLength', `长度至多 ${maxLen}，当前 ${codePointLen}`)
      }
      if (typeof s.pattern === 'string') {
        // 不做静态风险硬门禁：schema.pattern 由调用方在 Worker 中执行并带超时保护，
        // 静态启发式会误伤合法表达式（如 ^[a-z]+(\.[a-z]+)*$），这里只校验语法是否合法。
        let re: RegExp
        try {
          re = new RegExp(s.pattern)
        } catch {
          throw new Error(`pattern 不是合法正则：${s.pattern}`)
        }
        if (!re.test(inst)) push(pointer, `${spath}/pattern`, 'pattern', `不匹配正则 /${s.pattern}/`)
      }
      if (typeof s.format === 'string') {
        const pass = checkFormat(inst, s.format)
        if (pass === false) {
          if (opts.strict) push(pointer, `${spath}/format`, 'format', `不是合法的 ${s.format}（严格模式已开启）`)
          else warnings.push(`${jsonPath(pointer)} 不符合 format: ${s.format}（非严格模式仅提示）`)
        }
        if (pass === null) warnings.push(`暂不校验 ${jsonPath(pointer)} 上的 format: ${s.format}，已跳过`)
      }
    }

    // 数值关键字仅作用于 number / RawNumber 实例：字符串、布尔、数组、对象、null 一律跳过
    const num = isNumericInstance(inst) ? toComparable(inst) : null
    if (num !== null) {
      const min = toComparable(s.minimum)
      if (min !== null && num < min) {
        push(pointer, `${spath}/minimum`, 'minimum', `不得小于 ${min}，当前 ${num}`)
      }
      const max = toComparable(s.maximum)
      if (max !== null && num > max) {
        push(pointer, `${spath}/maximum`, 'maximum', `不得大于 ${max}，当前 ${num}`)
      }
      const exMin = toComparable(s.exclusiveMinimum)
      if (exMin !== null && num <= exMin) {
        push(pointer, `${spath}/exclusiveMinimum`, 'exclusiveMinimum', `必须大于 ${exMin}，当前 ${num}`)
      }
      const exMax = toComparable(s.exclusiveMaximum)
      if (exMax !== null && num >= exMax) {
        push(pointer, `${spath}/exclusiveMaximum`, 'exclusiveMaximum', `必须小于 ${exMax}，当前 ${num}`)
      }
      const multiple = toComparable(s.multipleOf)
      if (multiple !== null && !isMultipleOf(num, multiple)) {
        push(pointer, `${spath}/multipleOf`, 'multipleOf', `必须是 ${multiple} 的整数倍，当前 ${num}`)
      }
    }

    if (Array.isArray(inst)) {
      const minItems = countValue(s.minItems)
      if (minItems !== null && inst.length < minItems) {
        push(pointer, `${spath}/minItems`, 'minItems', `至少 ${minItems} 项，当前 ${inst.length} 项`)
      }
      const maxItems = countValue(s.maxItems)
      if (maxItems !== null && inst.length > maxItems) {
        push(pointer, `${spath}/maxItems`, 'maxItems', `至多 ${maxItems} 项，当前 ${inst.length} 项`)
      }
      if (s.uniqueItems === true) {
        // 键序无关的规范键：{a:1,b:2} 与 {b:2,a:1} 视为重复
        const seen = new Set(inst.map((v) => canonicalKey(v)))
        if (seen.size !== inst.length) push(pointer, `${spath}/uniqueItems`, 'uniqueItems', '数组元素存在重复')
      }
      const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as unknown[]) : null
      // 2020-12：prefixItems 逐元素校验前 N 项，items 只作用于其后的剩余元素（起点 N）。
      // 未声明 prefixItems 时 N=0，items 仍覆盖全部元素（既有行为）。
      const prefixLen = prefix ? prefix.length : 0
      if (prefix) {
        prefix.forEach((sub, i) => {
          if (i < inst.length) walk(inst[i], sub, `${pointer}/${i}`, `${spath}/prefixItems/${i}`, depth + 1)
        })
      }
      if (hasOwn(s, 'items')) {
        const items = s.items
        if (Array.isArray(items)) {
          // draft-07 的元组写法：逐个前缀匹配（2020-12 已由 prefixItems 取代，故不叠加 prefixLen）
          items.forEach((sub, i) => {
            if (i < inst.length) walk(inst[i], sub, `${pointer}/${i}`, `${spath}/items/${i}`, depth + 1)
          })
          // additionalItems 仅在 items 为数组（draft-07 元组）时生效，作用于元组越界的剩余元素
          if (inst.length > items.length) {
            const extra = s.additionalItems
            if (extra === false) {
              for (let i = items.length; i < inst.length; i += 1) {
                push(
                  `${pointer}/${i}`,
                  `${spath}/additionalItems`,
                  'additionalItems',
                  'additionalItems:false 不允许 items 元组之外的额外元素'
                )
              }
            } else if (extra !== undefined && extra !== true) {
              for (let i = items.length; i < inst.length; i += 1) {
                walk(inst[i], extra, `${pointer}/${i}`, `${spath}/additionalItems`, depth + 1)
              }
            }
          }
        } else if (items !== undefined) {
          // 布尔 schema（true 恒通过、false 剩余元素逐个报错）与普通对象 schema 都交给 walk
          for (let i = prefixLen; i < inst.length; i += 1) {
            walk(inst[i], items, `${pointer}/${i}`, `${spath}/items`, depth + 1)
          }
        }
      }
      if (hasOwn(s, 'contains')) {
        const any = inst.some(
          (v) => isolate(() => walk(v, s.contains, pointer, `${spath}/contains`, depth + 1)).length === 0
        )
        if (!any) push(pointer, `${spath}/contains`, 'contains', '没有任何元素满足 contains 条件')
      }
    }

    if (inst && typeof inst === 'object' && !Array.isArray(inst) && !isRawNumber(inst)) {
      const obj = inst as Record<string, unknown>
      const props = (s.properties ?? {}) as Record<string, unknown>
      const patterns = (s.patternProperties ?? {}) as Record<string, unknown>
      if (Array.isArray(s.required)) {
        for (const key of s.required as string[]) {
          if (!hasOwn(obj, key)) {
            const esc = key.replace(/~/g, '~0').replace(/\//g, '~1')
            push(`${pointer}/${esc}`, `${spath}/required`, 'required', '缺少必填字段')
          }
        }
      }
      const keys = Object.keys(obj)
      const minProps = countValue(s.minProperties)
      if (minProps !== null && keys.length < minProps) {
        push(pointer, `${spath}/minProperties`, 'minProperties', `至少 ${minProps} 个字段，当前 ${keys.length} 个`)
      }
      const maxProps = countValue(s.maxProperties)
      if (maxProps !== null && keys.length > maxProps) {
        push(pointer, `${spath}/maxProperties`, 'maxProperties', `至多 ${maxProps} 个字段，当前 ${keys.length} 个`)
      }
      for (const key of keys) {
        const childPointer = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
        let handled = false
        if (hasOwn(props, key)) {
          walk(obj[key], props[key], childPointer, `${spath}/properties/${key}`, depth + 1)
          handled = true
        }
        for (const [pattern, sub] of Object.entries(patterns)) {
          // 同 s.pattern：不做静态风险硬门禁，交由调用方的 Worker + 超时保护，只校验语法
          let re: RegExp
          try {
            re = new RegExp(pattern)
          } catch {
            throw new Error(`patternProperties 里的 ${pattern} 不是合法正则`)
          }
          if (re.test(key)) {
            walk(obj[key], sub, childPointer, `${spath}/patternProperties/${pattern}`, depth + 1)
            handled = true
          }
        }
        if (hasOwn(s, 'propertyNames')) walk(key, s.propertyNames, childPointer, `${spath}/propertyNames`, depth + 1)
        if (!handled) {
          const ap = s.additionalProperties
          if (ap === false) {
            push(childPointer, `${spath}/additionalProperties`, 'additionalProperties', 'schema 中未声明该字段')
          } else if (ap && typeof ap === 'object') {
            walk(obj[key], ap, childPointer, `${spath}/additionalProperties`, depth + 1)
          }
        }
      }
      const dep = s.dependentRequired
      if (dep && typeof dep === 'object') {
        for (const [key, need] of Object.entries(dep as Record<string, unknown>)) {
          if (hasOwn(obj, key) && Array.isArray(need)) {
            for (const n of need as string[]) {
              if (!hasOwn(obj, n)) push(pointer, `${spath}/dependentRequired`, 'dependentRequired', `存在 ${key} 时必须有 ${n}`)
            }
          }
        }
      }
      const depSchemas = s.dependentSchemas
      if (depSchemas && typeof depSchemas === 'object') {
        for (const [key, sub] of Object.entries(depSchemas as Record<string, unknown>)) {
          if (hasOwn(obj, key)) walk(inst, sub, pointer, `${spath}/dependentSchemas/${key}`, depth + 1)
        }
      }
    }
  }

  function typeNameMatch(v: unknown, want: string): boolean {
    if (isRawNumber(v)) {
      if (want === 'integer') return isIntegerRaw(v.raw)
      if (want === 'number') return true
      return false
    }
    if (want === 'array') return Array.isArray(v)
    if (want === 'object') return !!v && typeof v === 'object' && !Array.isArray(v)
    if (want === 'null') return v === null
    if (want === 'integer') return typeof v === 'number' && Number.isInteger(v)
    if (want === 'number') return typeof v === 'number'
    return typeof v === want
  }

  walk(instance, schema, '', '', 0)
  return { valid: errors.length === 0, errors, warnings, checked }
}

function inferNode(value: unknown, opts: InferOptions): Record<string, unknown> {
  if (value === null) return { type: 'null' }
  if (typeof value === 'number') return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' }
  if (typeof value === 'boolean') return { type: 'boolean' }
  if (typeof value === 'string') return { type: 'string' }
  if (Array.isArray(value)) {
    if (!value.length) return { type: 'array', items: {} }
    const itemSchemas = value.map((v) => inferNode(v, opts))
    const merged = itemSchemas.every((s) => JSON.stringify(s) === JSON.stringify(itemSchemas[0]))
      ? itemSchemas[0]
      : { anyOf: dedupe(itemSchemas) }
    return { type: 'array', items: merged }
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  if (!keys.length) return { type: 'object', properties: {} }
  const properties: Record<string, unknown> = {}
  for (const k of keys) {
    // defineProperty：字面量 "__proto__" 键必须落成普通自有键，
    // 用 properties[k] = … 会触发原型 setter，导致 properties 丢键而 required 仍保留该键。
    Object.defineProperty(properties, k, {
      value: inferNode(obj[k], opts),
      enumerable: true,
      writable: true,
      configurable: true
    })
  }
  const out: Record<string, unknown> = { type: 'object', properties, required: keys }
  if (opts.strict) out.additionalProperties = false
  return out
}

function dedupe(list: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>()
  const out: Record<string, unknown>[] = []
  for (const s of list) {
    const k = JSON.stringify(s)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/** 从 JSON 推断 Schema；只反映这一份样本，不猜测取值范围 */
export function inferSchema(value: unknown, opts: InferOptions): Record<string, unknown> {
  const body = inferNode(value, opts)
  const uri =
    opts.draft === '2020-12'
      ? 'https://json-schema.org/draft/2020-12/schema'
      : 'http://json-schema.org/draft-07/schema#'
  return { $schema: uri, ...body }
}
