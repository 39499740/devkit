/**
 * 文本、数据格式与文件步骤的执行器。
 * 所有算法都调用 utils/ 里的共享实现（与对应工具页是同一份代码），这里只负责参数与提示。
 */
import yaml from 'js-yaml'
import { base64ToBytes, bytesToBase64, textToBytes } from '../../utils/bytes'
import { csvToJson, jsonToCsv } from '../../utils/csv'
import { errMessage } from '../../utils/errors'
import { applyYamlRawMap, detectDuplicateKeys, hasUnsafeRawNumber, jsonErrorPosition, loadYamlPreservingNumbers, localizeJsonMessage, minifyJson, parseJson, RawNumber, stringifyJson, toPlainJson, toYamlJsonable } from '../../utils/json'
import { evalJmesPath } from '../../utils/jmespath'
import { evalJsonPath } from '../../utils/jsonpath'
import { inferSchema, validateInstance, type Draft, type ValidateResult } from '../../utils/jsonschema'
import { execRegexWithTimeout, localizeRegexMessage, validateFlags } from '../../utils/regex'
import { formatSql, minifySql, type SqlDialect } from '../../utils/sql'
import { tidyText } from '../../utils/text'
import { formatXml, jsonToXml, minifyXml, queryXPath, xmlToJson } from '../../utils/xml'
import { configBool, configNumber, configText } from '../catalog'
import { bytesPayload, textPayload } from '../types'
import { runComputation } from '../workers/run-compute'
import type { StepExecutor, StepPayload } from '../types'

function byteCountLabel(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function byteSize(text: string): string {
  return byteCountLabel(new TextEncoder().encode(text).length)
}

function lineSize(text: string): string {
  return `${text ? text.split('\n').length : 0} 行、${byteSize(text)}`
}

/** 文本类步骤不接受二进制的 Hex 视图：误解析会给出比「JSON 语法错误」更准确的提示 */
function requireText(input: StepPayload, what: string): string {
  if (input.kind === 'bytes') {
    throw new Error(`上一步输出是二进制数据（当前按 Hex 展示），${what}无法直接处理；请先解密或改用编码步骤`)
  }
  return input.text
}

function warnNote(warnings: string[]): string {
  return warnings.length ? `；${warnings.slice(0, 2).join('；')}` : ''
}

/** 与 json-minify 一致的重复键告警文案（无重复返回空串） */
function duplicateNote(dups: string[]): string {
  if (!dups.length) return ''
  return `；检测到重复键：${dups.slice(0, 3).join('、')}${dups.length > 3 ? ' 等' : ''}（后出现的键覆盖前者）`
}

/** 大整数精度告警文案：仅提示，不改变输出（实例 / schema 含超范围整数时追加） */
const UNSAFE_NUMBER_NOTE = '；检测到超出安全整数范围的数字，已按字符串处理，数值类型/比较可能不精确'

/**
 * 大整数告警文案（schema-validate 专用）：实例侧保留 RawNumber 原文做 integer 判定，
 * 不谎称已转字符串，避免与 Worker 分支语义不一致。
 */
const UNSAFE_NUMBER_RAW_NOTE = '；检测到超出安全整数范围的数字，按原文保真处理，数值类型/比较可能不精确'

/** 值中含超出安全范围的 RawNumber 时返回告警文案，否则空串 */
function unsafeNumberNote(v: unknown): string {
  return hasUnsafeRawNumber(v) ? UNSAFE_NUMBER_NOTE : ''
}

/**
 * JSON 解析失败时给出与工具页一致的中文定位（「第 X 行第 Y 列附近」），
 * 不再把 V8 的英文原文直接抛给用户。
 */
function parseJsonLocalized(text: string, what = 'JSON') {
  try {
    return parseJson(text)
  } catch (e) {
    const pos = jsonErrorPosition(e, text)
    if (pos) throw new Error(`${what} 解析失败：第 ${pos.line} 行第 ${pos.column} 列附近：${pos.message}`)
    throw new Error(`${what} 解析失败：${localizeJsonMessage(errMessage(e))}`)
  }
}

/**
 * JSONPath / JMESPath 求值异常中文化：
 * - 已有中文错误原样保留（不吞掉「必须以 $ 开头」这类明确提示）；
 * - 栈溢出（深层嵌套）给出「嵌套层级过深」的中文提示；
 * - 其它无 CJK 的英文错误统一映射为中性中文，不把引擎英文原文抛给用户。
 */
function localizeEvalError(e: unknown): Error {
  const msg = errMessage(e)
  if (/[\u4e00-\u9fa5]/.test(msg)) return new Error(msg)
  if (/Maximum call stack/i.test(msg)) return new Error('嵌套层级过深，超出计算上限，请减少嵌套层级')
  return new Error('表达式求值失败：请检查表达式与输入')
}

const base64Decode: StepExecutor = (input) => {
  const src = requireText(input, 'Base64 解码')
  const res = base64ToBytes(src.trim())
  if (res.error) throw new Error(res.error)
  const payload = bytesPayload(res.bytes)
  return {
    payload,
    note:
      payload.kind === 'bytes'
        ? `解码为 ${res.bytes.length} 字节二进制数据（界面按 Hex 展示，可直接交给加解密步骤）`
        : `解码为 ${byteSize(payload.text)} 文本`
  }
}

const base64Encode: StepExecutor = (input, config) => {
  const bytes = input.bytes ?? textToBytes(input.text)
  const urlSafe = configBool(config, 'urlSafe', false)
  let out = bytesToBase64(bytes)
  if (urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  if (configBool(config, 'lineBreak', false)) out = out.replace(/(.{76})/g, '$1\n').replace(/\n$/, '')
  return {
    payload: textPayload(out),
    note: `编码为 Base64${urlSafe ? 'URL' : ''}：${bytes.length} 字节 → ${out.length} 字符`
  }
}

const urlDecode: StepExecutor = (input) => {
  const src = requireText(input, 'URL 解码').trim()
  try {
    const text = decodeURIComponent(src)
    return { payload: textPayload(text), note: `解码为 ${byteSize(text)} 文本` }
  } catch {
    throw new Error('URL 解码失败：存在非法的百分号编码（例如单独的 % 或 %ZZ）')
  }
}

const urlEncode: StepExecutor = (input, config) => {
  const text = requireText(input, 'URL 编码')
  const component = configText(config, 'component', 'component') !== 'uri'
  let out: string
  try {
    out = component ? encodeURIComponent(text) : encodeURI(text)
  } catch {
    // 孤立代理项（如单独的高/低 surrogate）会让 encodeURIComponent 抛 URIError
    throw new Error('输入包含非法 Unicode（孤立代理项），无法进行 URL 编码')
  }
  return {
    payload: textPayload(out),
    note: `按${component ? '组件（encodeURIComponent）' : '整条 URI（encodeURI）'}编码，${text.length} 字符 → ${out.length} 字符`
  }
}

const textDedup: StepExecutor = (input, config) => {
  const text = requireText(input, '文本去重整理')
  const res = tidyText(text, {
    caseSensitive: configBool(config, 'caseSensitive', true),
    removeBlank: configBool(config, 'removeBlank', false),
    trim: configBool(config, 'trim', false),
    sort: configText(config, 'sort', 'keep') === 'dict' ? 'dict' : 'keep'
  })
  const parts: string[] = []
  if (res.dup > 0) parts.push(`删除重复 ${res.dup} 行`)
  if (res.blank > 0) parts.push(`删除空行 ${res.blank} 行`)
  return {
    payload: textPayload(res.text),
    note: `${res.inLines} 行 → ${res.outLines} 行${parts.length ? `；${parts.join('，')}` : '；未发现重复行'}`
  }
}

const regexReplace: StepExecutor = async (input, config) => {
  const text = requireText(input, '正则提取替换')
  const pattern = configText(config, 'pattern')
  if (!pattern) throw new Error('正则表达式为空：请在步骤参数里填写表达式')
  const flags = configText(config, 'flags', 'g')
  const flagErr = validateFlags(flags)
  if (flagErr) throw new Error(`flags 非法：${flagErr}`)
  try {
    new RegExp(pattern, flags)
  } catch (e) {
    throw new Error(`表达式语法错误：${localizeRegexMessage(errMessage(e), pattern)}`)
  }
  const mode = configText(config, 'mode', 'replace')
  const replacement = configText(config, 'replacement')
  // 一次执行同时拿到匹配与替换结果：Worker + 超时保护，避免灾难性回溯在主线程冻结页面
  const counted = await execRegexWithTimeout(pattern, flags, text, mode === 'match' ? undefined : replacement)
  if (!counted.ok) throw new Error(`正则执行失败：${counted.error ?? '未知错误'}`)

  if (mode === 'match') {
    if (!counted.matches.length) throw new Error('没有匹配到任何内容：表达式与 flags 合法，但当前输入里没有命中')
    const items = counted.matches.map((m) => {
      if (m.named && m.named.length) {
        const obj: Record<string, string | null> = {}
        for (const n of m.named) {
          // defineProperty：命名分组若为 "__proto__"，用 obj[n.name] = … 会被原型 setter 吞掉，
          // 必须写成自有可枚举属性才能出现在 JSON 输出里。
          Object.defineProperty(obj, n.name, {
            value: n.value,
            enumerable: true,
            writable: true,
            configurable: true
          })
        }
        return obj
      }
      return m.text
    })
    return {
      payload: textPayload(JSON.stringify(items, null, 2), 'json'),
      note: `提取到 ${counted.matches.length} 处匹配${counted.capped ? '（超过 20 万已截断）' : ''}`
    }
  }

  // 替换结果已在同一次执行里算好（replaced），不再单独跑一遍 text.replace
  const out = counted.replaced ?? text
  return {
    payload: textPayload(out),
    note: `替换完成，命中 ${counted.matches.length} 处${replacement === '' ? '（替换内容为空 = 删除匹配）' : ''}${counted.capped ? '（统计已截断在 20 万处）' : ''}`
  }
}

const jsonFormat: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON 格式化')
  const indent = Math.max(0, Math.min(8, configNumber(config, 'indent', 2)))
  const { value, duplicateKeys } = parseJsonLocalized(text)
  // 缩进 0 = 真正单行（minifyJson）；stringifyJson 在缩进 0 时仍会插换行
  const out = indent === 0 ? minifyJson(value) : stringifyJson(value, indent)
  return { payload: textPayload(out, 'json'), note: `格式化完成，${lineSize(out)}${duplicateNote(duplicateKeys)}` }
}

const jsonMinify: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON 压缩')
  const { value } = parseJsonLocalized(text)
  const out = minifyJson(value)
  const dups = configBool(config, 'checkDuplicateKeys', true) ? detectDuplicateKeys(text) : []
  return {
    payload: textPayload(out, 'json'),
    note: `压缩完成，${byteSize(out)}${
      dups.length
        ? `；检测到重复键：${dups.slice(0, 3).join('、')}${dups.length > 3 ? ' 等' : ''}（后出现的键覆盖前者）`
        : '；未检测到重复键'
    }`
  }
}

const jsonpath: StepExecutor = async (input, config) => {
  const text = requireText(input, 'JSONPath 提取')
  const expr = configText(config, 'expr', '$').trim() || '$'
  const { value } = parseJsonLocalized(text)
  // 有 Worker 时把原始 JSON 文本交给 Worker 求值，隔离 =~ 正则的灾难性回溯；无 Worker 时用同步回退
  let res: { matches: { value: unknown }[]; warnings: string[] }
  try {
    res = await runComputation<{ matches: { value: unknown }[]; warnings: string[] }>(
      { fn: 'path', dataText: text, expr },
      () => evalJsonPath(toPlainJson(value), expr)
    )
  } catch (e) {
    // 深层嵌套会抛 RangeError（Maximum call stack…）；已有中文错误保留，其它英文错误兜底中文
    throw localizeEvalError(e)
  }
  if (!res.matches.length) throw new Error('匹配 0 项：检查表达式与字段名（区分大小写）')
  const out = JSON.stringify(
    res.matches.length === 1 ? res.matches[0]!.value : res.matches.map((m) => m.value),
    null,
    2
  )
  return {
    payload: textPayload(out, 'json'),
    note: `匹配 ${res.matches.length} 项${warnNote(res.warnings)}${unsafeNumberNote(value)}`
  }
}

const jmespath: StepExecutor = async (input, config) => {
  const text = requireText(input, 'JMESPath 提取')
  const expr = configText(config, 'expr').trim()
  if (!expr) throw new Error('JMESPath 表达式为空：请在步骤参数里填写表达式')
  const { value } = parseJsonLocalized(text)
  // 有 Worker 时把原始 JSON 文本交给 Worker 求值（与 t44 工具页同一份实现）；无 Worker 时用同步回退
  let res: { matches: { value: unknown }[]; warnings: string[] }
  try {
    res = await runComputation<{ matches: { value: unknown }[]; warnings: string[] }>(
      { fn: 'jmespath', dataText: text, expr },
      () => evalJmesPath(toPlainJson(value), expr)
    )
  } catch (e) {
    // 深层嵌套会抛 RangeError（Maximum call stack…）；已有中文错误保留，其它英文错误兜底中文
    throw localizeEvalError(e)
  }
  if (!res.matches.length) throw new Error(`匹配 0 项：${res.warnings[0] ?? '检查表达式与字段名'}`)
  const out = JSON.stringify(
    res.matches.length === 1 ? res.matches[0]!.value : res.matches.map((m) => m.value),
    null,
    2
  )
  return {
    payload: textPayload(out, 'json'),
    note: `匹配 ${res.matches.length} 项${warnNote(res.warnings)}${unsafeNumberNote(value)}`
  }
}

const jsonYaml: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON / YAML 转换')
  if (configText(config, 'direction', 'json2yaml') === 'yaml2json') {
    const { value, notes } = loadYamlPreservingNumbers(text)
    return {
      payload: textPayload(stringifyJson(value, 2), 'json'),
      note: `YAML 已转为 JSON${notes.length ? `；${notes.join('；')}` : ''}`
    }
  }
  const { value, duplicateKeys } = parseJsonLocalized(text)
  const token = `dkyamlraw${Math.random().toString(36).slice(2, 10)}`
  const counter = { n: 0 }
  const rawMap = new Map<string, string>()
  const unsafe: string[] = []
  const jsonable = toYamlJsonable(value, token, counter, rawMap, unsafe, '$')
  const dumped = yaml.dump(jsonable, { indent: 2, lineWidth: -1 })
  const out = applyYamlRawMap(dumped, token, rawMap)
  const notes: string[] = []
  if (unsafe.length) {
    notes.push(
      `${unsafe.length} 个数值超出 JS 安全范围（如 ${unsafe[0]}），已按原文输出以保留精度；部分工具按数值解析时仍可能丢失精度（超出安全整数范围的数值尤其如此）`
    )
  }
  return {
    payload: textPayload(out),
    note: `JSON 已转为 YAML${notes.length ? `；${notes.join('；')}` : ''}${duplicateNote(duplicateKeys)}`
  }
}

const schemaValidate: StepExecutor = async (input, config) => {
  const text = requireText(input, 'JSON Schema 校验')
  const schemaText = configText(config, 'schema')
  if (!schemaText.trim()) throw new Error('该步骤还没有配置 Schema')
  const { value } = parseJsonLocalized(text)
  const { value: schemaRaw } = parseJsonLocalized(schemaText, 'Schema')
  if (schemaRaw instanceof RawNumber || schemaRaw === null || Array.isArray(schemaRaw) || (typeof schemaRaw !== 'object' && typeof schemaRaw !== 'boolean')) {
    throw new Error('Schema 必须是对象或布尔值（true/false），当前不是合法的 JSON Schema')
  }
  // 实例 / Schema 里的数字超出安全范围时给出告警（成功与失败路径都要给）
  const unsafeNote = hasUnsafeRawNumber(value) || hasUnsafeRawNumber(schemaRaw) ? UNSAFE_NUMBER_RAW_NOTE : ''
  // 有 Worker 时把原始 JSON 文本交给 Worker：实例与 schema 都保留 RawNumber，
  // 数值关键字（minimum / multipleOf…）才能精确比较；
  // 无 Worker（Node / SSR / 测试）时用同步回退，同样直接传 schema 原始 parse 结果（不 toPlainJson，
  // 否则大整数约束会降级为字符串，被 typeof === 'number' 整条跳过）。
  const res = await runComputation<ValidateResult>(
    { fn: 'validate', instanceText: text, schemaText, strict: true },
    () => validateInstance(value, schemaRaw, { strict: true })
  )
  const warn = warnNote(res.warnings)
  if (res.valid) {
    return { payload: textPayload(text, 'json'), note: `校验通过，检查了 ${res.checked} 个节点${warn}${unsafeNote}` }
  }
  const lines = res.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`)
  throw new Error(`校验失败 · ${res.errors.length} 个错误：${lines.slice(0, 2).join('；')}${warn}${unsafeNote}`)
}

const jsonSchemaGen: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON Schema 生成')
  const draft = (configText(config, 'draft', '2020-12') === 'draft-07' ? 'draft-07' : '2020-12') as Draft
  const strict = configBool(config, 'strict', false)
  const { value } = parseJsonLocalized(text)
  const schema = inferSchema(toPlainJson(value), { draft, strict })
  const out = JSON.stringify(schema, null, 2)
  return {
    payload: textPayload(out, 'json'),
    note: `已按 ${draft}${strict ? '（严格模式）' : ''} 反推 Schema，${lineSize(out)}${unsafeNumberNote(value)}`
  }
}

const csvJson: StepExecutor = (input, config) => {
  const text = requireText(input, 'CSV / JSON 转换')
  const separator = configText(config, 'separator', ',')
  const header = configBool(config, 'header', true)
  if (configText(config, 'direction', 'csv2json') === 'json2csv') {
    const res = jsonToCsv(text, { separator, header })
    return {
      payload: textPayload(res.csv),
      note: `已生成 ${res.rows} 行 × ${res.columns.length} 列${warnNote(res.warnings)}`
    }
  }
  const infer = configBool(config, 'infer', false)
  if (!text.trim()) throw new Error('CSV 输入为空：请提供至少一行表头或数据')
  const res = csvToJson(text, { separator, header, infer })
  return {
    payload: textPayload(res.json, 'json'),
    note: `已转换 ${res.rows} 行数据${infer ? '（类型推断已开启）' : '（全部按字符串，保留前导零）'}${warnNote(res.warnings)}`
  }
}

const sqlFormatStep: StepExecutor = (input, config) => {
  const text = requireText(input, 'SQL 格式化')
  const dialect = configText(config, 'dialect', 'mysql') as SqlDialect
  if (!['mysql', 'postgres', 'sqlite'].includes(dialect)) throw new Error(`不支持的 SQL 方言：${dialect}`)
  const mode = configText(config, 'mode', 'format')
  const res =
    mode === 'minify'
      ? minifySql(text, dialect)
      : formatSql(text, {
          dialect,
          indent: Math.max(1, Math.min(8, configNumber(config, 'indent', 2))),
          uppercaseKeywords: configBool(config, 'upperKeywords', true)
        })
  return {
    payload: textPayload(res.sql),
    note: `${mode === 'minify' ? '压缩' : '格式化'}完成，${res.lines} 行 / ${res.chars} 字符${warnNote([...res.notes, ...res.warnings])}`
  }
}

function parseNamespaces(text: string): { prefix: string; uri: string }[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf('=')
      if (at <= 0) throw new Error(`命名空间格式错误：「${pair}」应为 前缀=URI`)
      return { prefix: pair.slice(0, at).trim(), uri: pair.slice(at + 1).trim() }
    })
}

const xmlStep: StepExecutor = (input, config) => {
  const text = requireText(input, 'XML 处理')
  if (typeof DOMParser === 'undefined') throw new Error('XML 处理需要浏览器环境（当前环境没有 DOMParser）')
  const mode = configText(config, 'mode', 'format')
  const indent = Math.max(1, Math.min(8, configNumber(config, 'indent', 2)))

  if (mode === 'minify') {
    const res = minifyXml(text)
    return { payload: textPayload(res.xml), note: `压缩完成，${res.nodes} 个节点 / ${res.chars} 字符${warnNote(res.warnings)}` }
  }
  if (mode === 'xml2json') {
    const res = xmlToJson(text)
    const out = JSON.stringify(res.value, null, 2)
    return { payload: textPayload(out, 'json'), note: `XML 已转为 JSON，${lineSize(out)}${warnNote(res.warnings)}` }
  }
  if (mode === 'json2xml') {
    const { value } = parseJsonLocalized(text)
    const res = jsonToXml(toPlainJson(value), 'root')
    return { payload: textPayload(res.xml), note: `JSON 已转为 XML，${res.nodes} 个节点${warnNote(res.warnings)}` }
  }
  if (mode === 'xpath') {
    const expr = configText(config, 'expr').trim()
    if (!expr) throw new Error('XPath 表达式为空：请在步骤参数里填写表达式')
    const res = queryXPath(text, expr, parseNamespaces(configText(config, 'namespaces')))
    if (!res.matches.length) throw new Error(`XPath 没有匹配到节点${warnNote(res.warnings)}`)
    const out = JSON.stringify(res.matches.map((m) => ({ path: m.path, value: m.value, type: m.type })), null, 2)
    return { payload: textPayload(out, 'json'), note: `匹配 ${res.matches.length} 个节点${warnNote(res.warnings)}` }
  }
  const res = formatXml(text, indent)
  return { payload: textPayload(res.xml), note: `格式化完成，${res.nodes} 个节点 / ${res.lines} 行${warnNote(res.warnings)}` }
}

/** 文件名清理：与流程页 outputFilename 一致，去掉首尾空白与路径分隔符 / 非法字符 */
function sanitizeFilename(name: string): string {
  return name.trim().replace(/[/\\:*?"<>|]/g, '')
}

const download: StepExecutor = (input, config) => {
  const name = sanitizeFilename(configText(config, 'filename', 'result.txt')) || 'result.txt'
  // 二进制载荷按真实字节数（input.text 是 Hex 视图，长度是两倍），文本按 UTF-8 长度
  const bytes = input.bytes ?? textToBytes(input.text)
  return { payload: input, note: `将导出为 ${name}，${byteCountLabel(bytes.length)}` }
}

/* ── JSON 转 Java：与 t22 工具页同一套命名与类型推断规则 ── */

const INT_MIN = -2147483648n
const INT_MAX = 2147483647n
const LONG_MIN = -(2n ** 63n)
const LONG_MAX = 2n ** 63n - 1n

/**
 * 数字原文的 Java 类型（紧凑版：int 范围也统一用 long，超出 long 用 String 并告警）。
 * 与 t22 的 numberFamily 语义保持一致，但不引入 wrapper / 类型确认机制。
 */
function javaNumberType(raw: string, warnings: string[], label: string): string {
  if (/^-?\d+$/.test(raw)) {
    const b = BigInt(raw)
    if (b >= INT_MIN && b <= INT_MAX) return 'long'
    if (b >= LONG_MIN && b <= LONG_MAX) return 'long'
    warnings.push(`字段 ${label} 的整数超出 long 范围（> 2^63-1 或 < -2^63），已按 String 输出`)
    return 'String'
  }
  return 'double'
}

/** 标量值的 Java 类型；RawNumber 保留原文做范围判断，避免大整数被降级成字符串 */
function javaTypeOf(value: unknown, warnings: string[], label: string): string {
  if (value instanceof RawNumber) return javaNumberType(value.raw, warnings, label)
  if (value === null) return 'Object'
  if (Array.isArray(value)) return 'List<Object>'
  if (typeof value === 'number') return Number.isInteger(value) ? 'long' : 'double'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'String'
  return 'Object'
}

/** Java 关键字（含字面量），字段名归一化后若命中需加后缀 `_` 规避编译错误 */
const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp',
  'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void',
  'volatile', 'while', 'true', 'false', 'null'
])

/** 把标识符净化成合法 Java 名：非法首字符加前缀，关键字加后缀 `_` */
function sanitizeJavaIdent(name: string, prefix: string): string {
  let out = name
  if (!/^[A-Za-z_$]/.test(out)) out = prefix + out.charAt(0).toUpperCase() + out.slice(1)
  if (JAVA_KEYWORDS.has(out)) out += '_'
  return out
}

/**
 * 校验顶层类名（用户可配置）：合法返回空串，非法返回中文原因。
 * 与 t22 工具页的 validateClassName 同规则：字母 / _ / $ 开头，只含字母、数字、_、$，且不能是 Java 关键字。
 */
function validateJavaClassName(name: string): string {
  const s = name.trim()
  if (!s) return ''
  if (/^[0-9]/.test(s)) return `类名 "${s}" 以数字开头，Java 类名必须以字母 / _ / $ 开头`
  if (JAVA_KEYWORDS.has(s)) return `类名 "${s}" 是 Java 关键字，请换一个名称`
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s)) {
    const bad = [...s].filter((c) => !/[A-Za-z0-9_$]/.test(c)).join(' ')
    return `类名 "${s}" 含非法字符（${bad}），只允许字母、数字、_ 与 $`
  }
  return ''
}

function javaName(key: string): string {
  const parts = key.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!parts.length) return 'field'
  const first = parts[0]!
  const out =
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  return sanitizeJavaIdent(out, 'field')
}

function pascal(key: string): string {
  const n = javaName(key)
  return sanitizeJavaIdent(n.charAt(0).toUpperCase() + n.slice(1), 'Item')
}

/** 紧凑版 POJO 生成：嵌套对象生成静态内部类，数组按首个非空元素推断元素类型 */
function javaFromJson(value: unknown, className: string, warnings: string[] = []): string {
  let needsList = false

  function classOf(obj: Record<string, unknown>, name: string, path: string): string {
    const fields: string[] = []
    const methods: string[] = []
    const inners: string[] = []
    const usedProps = new Set<string>()
    for (const [key, v] of Object.entries(obj)) {
      const base = javaName(key)
      // 同一类内字段名归一化后可能重名（a-b / a_b 都得到 aB），追加序号保证唯一
      let prop = base
      let seq = 2
      while (usedProps.has(prop)) prop = `${base}${seq++}`
      usedProps.add(prop)
      // getter/setter 跟随去重后的字段名，避免重名字段产生重复方法
      const accessor = prop.charAt(0).toUpperCase() + prop.slice(1)
      const fp = `${path}.${key}`
      let type: string
      // RawNumber 是对象类型，但绝不能当成嵌套对象展开
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RawNumber)) {
        const inner = pascal(key)
        type = inner
        inners.push(classOf(v as Record<string, unknown>, inner, fp))
      } else if (Array.isArray(v)) {
        needsList = true
        const first = v.find((x) => x !== null && x !== undefined)
        if (first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof RawNumber)) {
          const inner = pascal(key)
          type = `List<${inner}>`
          inners.push(classOf(first as Record<string, unknown>, inner, `${fp}[]`))
        } else {
          type = `List<${first === undefined ? 'Object' : javaTypeOf(first, warnings, `${fp}[]`)}>`
        }
      } else {
        type = javaTypeOf(v, warnings, fp)
      }
      fields.push(`    private ${type} ${prop};`)
      methods.push(
        `    public ${type} get${accessor}() {`,
        `        return this.${prop};`,
        '    }',
        '',
        `    public void set${accessor}(${type} ${prop}) {`,
        `        this.${prop} = ${prop};`,
        '    }'
      )
    }
    const body = [...fields, ...(fields.length ? [''] : []), ...methods]
    const innerText = inners.map((code) => code.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n'))
    const all = [...body, ...(innerText.length ? ['', ...innerText] : [])]
    return [`public class ${name} {`, ...all, '}'].join('\n')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof RawNumber) {
    return `public class ${className} {\n    // 顶层不是对象，无法生成字段；请先用 JSONPath 提取出对象\n}`
  }
  const code = classOf(value as Record<string, unknown>, className, '$')
  return needsList ? `import java.util.List;\n\n${code}` : code
}

const json2java: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON 转 Java')
  const { value } = parseJsonLocalized(text)
  const rawCls = configText(config, 'className', 'Order').trim()
  // 空值仍按历史默认 Order；非空则必须是合法 Java 类名，否则给出中文原因，不产出无法编译的源码
  const clsErr = validateJavaClassName(rawCls)
  if (clsErr) throw new Error(clsErr)
  const cls = rawCls || 'Order'
  const warnings: string[] = []
  const code = javaFromJson(value, cls, warnings)
  const warn = warnings.length ? `；${warnings.slice(0, 2).join('；')}` : ''
  return { payload: textPayload(code), note: `生成 ${cls}，${lineSize(code)}${warn}` }
}

export const textExecutors: Partial<Record<string, StepExecutor>> = {
  'base64-decode': base64Decode,
  'base64-encode': base64Encode,
  'url-decode': urlDecode,
  'url-encode': urlEncode,
  'text-dedup': textDedup,
  'regex-replace': regexReplace,
  'json-format': jsonFormat,
  'json-minify': jsonMinify,
  jsonpath,
  jmespath,
  'json-yaml': jsonYaml,
  'schema-validate': schemaValidate,
  'json-schema-gen': jsonSchemaGen,
  'csv-json': csvJson,
  'sql-format': sqlFormatStep,
  xml: xmlStep,
  json2java,
  download
}
