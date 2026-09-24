/**
 * T04 CSV ⇄ JSON 的纯计算实现：
 * 组件与流程编排（app/workflow/executors）共用同一份逻辑，避免两份行为漂移。
 */
import { RawNumber, minifyJson, stringifyJson, parseJson, jsonErrorPosition, localizeJsonMessage } from './json'
import { errMessage } from './errors'

export interface CsvParseResult {
  rows: string[][]
  warns: string[]
}

/** CSV 解析（RFC 4180：引号内逗号 / 换行，"" 转义） */
export function parseCsv(text: string, separator: string): CsvParseResult {
  const rows: string[][] = []
  const warns: string[] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let fieldStarted = false // 当前字段已出现内容（含仅引号的空字段）
  let rowHasContent = false
  const endField = () => {
    row.push(field)
    field = ''
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
    rowHasContent = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          fieldStarted = true
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c // 引号内的换行 / 分隔符均按字面保留
        fieldStarted = true
      }
      continue
    }
    if (c === '"' && field === '' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (c === '"') {
      // 字段中间出现的裸引号：按字面保留
      field += c
      fieldStarted = true
      continue
    }
    if (c === separator) {
      endField()
      rowHasContent = true
      continue
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      if (rowHasContent || fieldStarted || field !== '') endRow()
      continue // 其余空行跳过
    }
    field += c
    fieldStarted = true
  }
  if (inQuotes) warns.push('存在未闭合的引号：末尾字段内容按字面保留，请检查是否缺少结束引号')
  if (rowHasContent || fieldStarted || field !== '') endRow()
  return { rows, warns }
}

/** CSV 单元格写出：仅在包含分隔符 / 引号 / 换行时加引号，引号翻倍转义 */
export function csvCell(value: string, separator: string): string {
  if (value.includes('"') || value.includes(separator) || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

/** 类型推断（开启后）：布尔 / null / 数字；前导零（007）始终保持字符串 */
export function inferCsvValue(s: string): unknown {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  if (/^-?(?:0|[1-9][0-9]*)$/.test(s)) {
    const n = Number(s)
    if (Number.isSafeInteger(n)) return n
  }
  if (/^-?(?:[1-9][0-9]*\.[0-9]*|0?\.[0-9]+)$/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return n
  }
  return s
}

/**
 * 拍平叶子字段路径：对象递归展开（数组与 RawNumber 视为叶子）。
 * warnings 可选：键名本身含 `.` 时收集中文告警（`.` 会被当作路径分隔符，可能导致取值失败）。
 */
export function flattenPaths(v: unknown, prefix: string, out: string[], warnings?: string[]): void {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNumber)) {
    for (const [k, val] of Object.entries(v)) {
      if (warnings && k.includes('.')) {
        const msg = `字段名 ${k} 含点号，按路径分隔符处理，可能导致取值失败；建议改用不含点号的键名`
        if (!warnings.includes(msg)) warnings.push(msg)
      }
      flattenPaths(val, prefix ? `${prefix}.${k}` : k, out, warnings)
    }
  } else {
    out.push(prefix)
  }
}

export function getByPath(obj: Record<string, unknown>, path: string): unknown {
  let cur: unknown = obj
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function cellText(v: unknown): string {
  if (v === undefined || v === null) return ''
  if (v instanceof RawNumber) return v.raw
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return minifyJson(v) // 数组 / 对象值序列化为 JSON 字符串
}

/** 值的类型标签：仅用于错误文案 */
function typeOf(v: unknown): string {
  if (v instanceof RawNumber) return 'number'
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v === 'object' ? 'object' : typeof v
}

export interface Csv2JsonOptions {
  separator: string
  header: boolean
  infer: boolean
}

export interface Csv2JsonResult {
  /** 已格式化的 JSON 文本（缩进 2） */
  json: string
  /** 数据行数（不含表头行） */
  rows: number
  /** 有表头时为键名数组（空表头替换为 列N），无表头时为空数组 */
  columns: string[]
  preview: { header: string[] | null; rows: string[][] }
  warnings: string[]
}

export function csvToJson(text: string, opts: Csv2JsonOptions): Csv2JsonResult {
  const { rows, warns } = parseCsv(text, opts.separator)
  const warnings = [...warns]
  const conv = (s: string) => (opts.infer ? inferCsvValue(s) : s)
  const header: string[] | null = opts.header ? (rows.length ? rows[0]! : []) : null
  const data = opts.header ? rows.slice(1) : rows
  if (!rows.length) {
    // 无表头时 header 为 null，有表头但一行都没解析到时为 []；调用方据此判断「没有数据」
    return { json: '[]', rows: 0, columns: [], preview: { header, rows: [] }, warnings }
  }
  if (opts.header) {
    const keys = (header as string[]).map((h, i) => (h === '' ? `列${i + 1}` : h))
    // 重复表头：后列覆盖前列会静默丢列，显式告警（最多列出 3 个重复键）
    const keyCols = new Map<string, number[]>()
    keys.forEach((k, i) => {
      const cols = keyCols.get(k)
      if (cols) cols.push(i + 1)
      else keyCols.set(k, [i + 1])
    })
    const dups = [...keyCols.entries()].filter(([, cols]) => cols.length > 1)
    if (dups.length) {
      const shown = dups.slice(0, 3).map(([k, cols]) => `${k}（第 ${cols.join('、')} 列）`).join('、')
      const more = dups.length > 3 ? ` 等 ${dups.length} 个重复列名` : ''
      warnings.push(`表头存在重复列名：${shown}${more}，后一列会覆盖前一列`)
    }
    data.forEach((row, i) => {
      if (row.length !== keys.length) {
        warnings.push(`第 ${i + 2} 行（含表头）有 ${row.length} 列，与表头的 ${keys.length} 列不一致，该行已保留`)
      }
    })
    const arr = data.map((row) => {
      const obj: Record<string, unknown> = {}
      keys.forEach((k, ci) => {
        obj[k] = ci < row.length ? conv(row[ci]!) : null // 缺失的列补 null
      })
      return obj
    })
    return {
      json: stringifyJson(arr, 2),
      rows: arr.length,
      columns: keys,
      preview: { header: keys, rows: data },
      warnings
    }
  }
  // 无表头：输出「数组的数组」
  return {
    json: stringifyJson(data.map((row) => row.map(conv)), 2),
    rows: data.length,
    columns: [],
    preview: { header: null, rows: data },
    warnings
  }
}

export interface Json2CsvOptions {
  separator: string
  header: boolean
  fields?: string[]
}

export interface Json2CsvResult {
  csv: string
  /** 对象行数 */
  rows: number
  /** 实际使用的字段路径 */
  columns: string[]
  /** 自动拍平得到的字段路径（用于组件回填 customFields） */
  autoFields: string[]
  preview: { header: string[] | null; rows: string[][] }
  warnings: string[]
}

/** 非法输入一律 throw Error（中文消息），由调用方决定如何呈现 */
export function jsonToCsv(text: string, opts: Json2CsvOptions): Json2CsvResult {
  const warnings: string[] = []
  let value: unknown
  try {
    value = parseJson(text).value
  } catch (e) {
    const pos = jsonErrorPosition(e, text)
    const detail = pos ? `第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}` : localizeJsonMessage(errMessage(e))
    throw new Error(`JSON 解析失败：${detail}`)
  }
  if (!Array.isArray(value)) {
    throw new Error(`JSON → CSV 需要顶层数组（对象数组），当前顶层是 ${typeOf(value)}。请提供形如 [ { … }, { … } ] 的数据`)
  }
  if (!value.length) {
    throw new Error('数组为空，没有可转换的数据行')
  }
  for (let i = 0; i < value.length; i++) {
    const t = typeOf(value[i])
    if (t !== 'object') {
      throw new Error(`第 ${i + 1} 个元素不是 JSON 对象（是 ${t}），无法按字段路径取值。请把每个元素改为 { … } 对象`)
    }
  }
  // 自动拍平：按首个出现顺序合并所有行的叶子字段路径
  const union: string[] = []
  const seen = new Set<string>()
  for (const el of value as unknown[]) {
    const paths: string[] = []
    flattenPaths(el, '', paths, warnings)
    for (const p of paths) {
      if (!seen.has(p)) {
        seen.add(p)
        union.push(p)
      }
    }
  }
  const fields = opts.fields ? opts.fields.map((f) => f.trim()).filter(Boolean) : union
  if (!fields.length) {
    throw new Error('未找到可输出的字段路径（对象内没有叶子字段）。请检查数据或在下方手动配置字段路径')
  }
  for (const f of fields) {
    if (!seen.has(f)) warnings.push(`字段路径 ${f} 在所有行中都不存在，将输出空列`)
  }
  const objs = value as Record<string, unknown>[]
  const lines: string[] = []
  if (opts.header) lines.push(fields.map((f) => csvCell(f, opts.separator)).join(opts.separator))
  for (const obj of objs) {
    lines.push(fields.map((f) => csvCell(cellText(getByPath(obj, f)), opts.separator)).join(opts.separator))
  }
  const csv = lines.join('\n')
  // 预览：按同样的解析器读回输出，保证与结果一致
  const back = parseCsv(csv + '\n', opts.separator)
  return {
    csv,
    rows: objs.length,
    columns: fields,
    autoFields: union,
    preview: { header: opts.header ? back.rows[0] ?? [] : null, rows: opts.header ? back.rows.slice(1) : back.rows },
    warnings
  }
}
