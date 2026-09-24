/**
 * T45 JSON Schema：从 JSON 推断 Schema，以及按 Draft 2020-12 子集校验实例。
 * 校验一次收集全部错误（不是遇到第一个就停），并给出 JSONPath 与 Schema 位置。
 */
import { regexRiskReason } from './regex'
import { RawNumber } from './json'

export type Draft = '2020-12' | 'draft-07'

/** 大整数原文是否按整数书写（供 RawNumber 判定 type: integer） */
const RAW_INTEGER_RE = /^-?\d+$/

/** 值是否为 RawNumber（parseJson 为保留大整数原文而使用的包装类型） */
function isRawNumber(v: unknown): v is RawNumber {
  return v instanceof RawNumber
}

/** RawNumber 还原成可比较的数值（超出精度时按 Number 近似，仅用于数值关键字） */
function numericValue(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (isRawNumber(v)) {
    const n = Number(v.raw)
    return Number.isFinite(n) ? n : null
  }
  return null
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
  if (isRawNumber(v)) return RAW_INTEGER_RE.test(v.raw) ? 'integer' : 'number'
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number'
  return typeof v
}

function actualType(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (isRawNumber(v)) return RAW_INTEGER_RE.test(v.raw) ? 'integer' : 'number'
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
      if (cur && typeof cur === 'object' && p in (cur as object)) cur = (cur as Record<string, unknown>)[p]
      else throw new Error(`$ref 指向的 ${ref} 在文档中不存在`)
    }
    return cur
  }

  function push(pointer: string, schemaPath: string, keyword: string, message: string) {
    if (sink.length >= max) return
    sink.push({ path: jsonPath(pointer), pointer: pointer || '/', schemaPath: schemaPath || '/', keyword, message })
  }

  function eq(a: unknown, b: unknown): boolean {
    // RawNumber 与普通值（或另一个 RawNumber）比较：数字按数值、大整数按原文
    if (isRawNumber(a) || isRawNumber(b)) {
      const rawA = isRawNumber(a) ? a.raw : null
      const rawB = isRawNumber(b) ? b.raw : null
      if (rawA !== null && rawB !== null) return rawA === rawB
      const raw = (rawA ?? rawB) as string
      const other = rawA !== null ? b : a
      if (typeof other === 'number') return Number(raw) === other
      if (typeof other === 'string') return raw === other
      return false
    }
    return JSON.stringify(a) === JSON.stringify(b)
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
      walk(inst, resolveRef(s.$ref), pointer, `${spath}/$ref`, depth + 1)
      return
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
    if (s.not) {
      const notErrors = isolate(() => walk(inst, s.not, pointer, `${spath}/not`, depth + 1))
      if (!notErrors.length) push(pointer, spath, 'not', '命中了 not 排除的 schema')
    }
    if (s.if) {
      const condErrors = isolate(() => walk(inst, s.if, pointer, `${spath}/if`, depth + 1))
      if (!condErrors.length) {
        if (s.then) walk(inst, s.then, pointer, `${spath}/then`, depth + 1)
      } else if (s.else) {
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

    if ('const' in s && !eq(inst, s.const)) {
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
      if (typeof s.minLength === 'number' && inst.length < s.minLength) {
        push(pointer, `${spath}/minLength`, 'minLength', `长度至少 ${s.minLength}，当前 ${inst.length}`)
      }
      if (typeof s.maxLength === 'number' && inst.length > s.maxLength) {
        push(pointer, `${spath}/maxLength`, 'maxLength', `长度至多 ${s.maxLength}，当前 ${inst.length}`)
      }
      if (typeof s.pattern === 'string') {
        // 先做静态风险判定：嵌套量词会在主线程同步 test() 时冻结页面
        if (regexRiskReason(s.pattern)) {
          throw new Error(`pattern 存在灾难性回溯风险（嵌套量词或重叠交替），可能冻结页面，请简化：/${s.pattern}/`)
        }
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

    const num = numericValue(inst)
    if (num !== null) {
      if (typeof s.minimum === 'number' && num < s.minimum) {
        push(pointer, `${spath}/minimum`, 'minimum', `不得小于 ${s.minimum}，当前 ${num}`)
      }
      if (typeof s.maximum === 'number' && num > s.maximum) {
        push(pointer, `${spath}/maximum`, 'maximum', `不得大于 ${s.maximum}，当前 ${num}`)
      }
      if (typeof s.exclusiveMinimum === 'number' && num <= s.exclusiveMinimum) {
        push(pointer, `${spath}/exclusiveMinimum`, 'exclusiveMinimum', `必须大于 ${s.exclusiveMinimum}，当前 ${num}`)
      }
      if (typeof s.exclusiveMaximum === 'number' && num >= s.exclusiveMaximum) {
        push(pointer, `${spath}/exclusiveMaximum`, 'exclusiveMaximum', `必须小于 ${s.exclusiveMaximum}，当前 ${num}`)
      }
      if (typeof s.multipleOf === 'number' && s.multipleOf > 0 && Math.abs(num / s.multipleOf - Math.round(num / s.multipleOf)) > 1e-9) {
        push(pointer, `${spath}/multipleOf`, 'multipleOf', `必须是 ${s.multipleOf} 的整数倍，当前 ${num}`)
      }
    }

    if (Array.isArray(inst)) {
      if (typeof s.minItems === 'number' && inst.length < s.minItems) {
        push(pointer, `${spath}/minItems`, 'minItems', `至少 ${s.minItems} 项，当前 ${inst.length} 项`)
      }
      if (typeof s.maxItems === 'number' && inst.length > s.maxItems) {
        push(pointer, `${spath}/maxItems`, 'maxItems', `至多 ${s.maxItems} 项，当前 ${inst.length} 项`)
      }
      if (s.uniqueItems === true) {
        const seen = new Set(inst.map((v) => JSON.stringify(v)))
        if (seen.size !== inst.length) push(pointer, `${spath}/uniqueItems`, 'uniqueItems', '数组元素存在重复')
      }
      const prefix = Array.isArray(s.prefixItems) ? (s.prefixItems as unknown[]) : null
      if (prefix) {
        prefix.forEach((sub, i) => {
          if (i < inst.length) walk(inst[i], sub, `${pointer}/${i}`, `${spath}/prefixItems/${i}`, depth + 1)
        })
      }
      const items = s.items
      if (items && typeof items === 'object' && !Array.isArray(items)) {
        inst.forEach((v, i) => walk(v, items, `${pointer}/${i}`, `${spath}/items`, depth + 1))
      } else if (Array.isArray(items)) {
        items.forEach((sub, i) => {
          if (i < inst.length) walk(inst[i], sub, `${pointer}/${i}`, `${spath}/items/${i}`, depth + 1)
        })
      }
      if (s.contains) {
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
          if (!(key in obj)) {
            const esc = key.replace(/~/g, '~0').replace(/\//g, '~1')
            push(`${pointer}/${esc}`, `${spath}/required`, 'required', '缺少必填字段')
          }
        }
      }
      const keys = Object.keys(obj)
      if (typeof s.minProperties === 'number' && keys.length < s.minProperties) {
        push(pointer, `${spath}/minProperties`, 'minProperties', `至少 ${s.minProperties} 个字段，当前 ${keys.length} 个`)
      }
      if (typeof s.maxProperties === 'number' && keys.length > s.maxProperties) {
        push(pointer, `${spath}/maxProperties`, 'maxProperties', `至多 ${s.maxProperties} 个字段，当前 ${keys.length} 个`)
      }
      for (const key of keys) {
        const childPointer = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
        let handled = false
        if (key in props) {
          walk(obj[key], props[key], childPointer, `${spath}/properties/${key}`, depth + 1)
          handled = true
        }
        for (const [pattern, sub] of Object.entries(patterns)) {
          // 同 s.pattern：patternProperties 的键也是用户可控正则，需先做风险判定
          if (regexRiskReason(pattern)) {
            throw new Error(`patternProperties 里的 /${pattern}/ 存在灾难性回溯风险（嵌套量词或重叠交替），可能冻结页面，请简化`)
          }
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
        if (s.propertyNames) walk(key, s.propertyNames, childPointer, `${spath}/propertyNames`, depth + 1)
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
          if (key in obj && Array.isArray(need)) {
            for (const n of need as string[]) {
              if (!(n in obj)) push(pointer, `${spath}/dependentRequired`, 'dependentRequired', `存在 ${key} 时必须有 ${n}`)
            }
          }
        }
      }
    }
  }

  function typeNameMatch(v: unknown, want: string): boolean {
    if (isRawNumber(v)) {
      if (want === 'integer') return RAW_INTEGER_RE.test(v.raw)
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
  for (const k of keys) properties[k] = inferNode(obj[k], opts)
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
