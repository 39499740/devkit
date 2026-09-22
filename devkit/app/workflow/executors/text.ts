/**
 * 文本、数据格式与文件步骤的执行器。
 * 所有算法都调用 utils/ 里的共享实现（与对应工具页是同一份代码），这里只负责参数与提示。
 */
import yaml from 'js-yaml'
import { base64ToBytes, bytesToBase64, textToBytes } from '../../utils/bytes'
import { csvToJson, jsonToCsv } from '../../utils/csv'
import { errMessage } from '../../utils/errors'
import { detectDuplicateKeys, minifyJson, parseJson, stringifyJson, toPlainJson } from '../../utils/json'
import { evalJmesPath } from '../../utils/jmespath'
import { evalJsonPath } from '../../utils/jsonpath'
import { inferSchema, validateInstance, type Draft } from '../../utils/jsonschema'
import { execRegex, validateFlags } from '../../utils/regex'
import { formatSql, minifySql, type SqlDialect } from '../../utils/sql'
import { tidyText } from '../../utils/text'
import { formatXml, jsonToXml, minifyXml, queryXPath, xmlToJson } from '../../utils/xml'
import { configBool, configNumber, configText } from '../catalog'
import { bytesPayload, textPayload } from '../types'
import type { StepExecutor, StepPayload } from '../types'

function byteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
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

const base64Decode: StepExecutor = (input) => {
  const res = base64ToBytes(input.text.trim())
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
  else if (configBool(config, 'lineBreak', false)) out = out.replace(/(.{76})/g, '$1\n').replace(/\n$/, '')
  return {
    payload: textPayload(out),
    note: `编码为 Base64${urlSafe ? 'URL' : ''}：${bytes.length} 字节 → ${out.length} 字符`
  }
}

const urlDecode: StepExecutor = (input) => {
  const src = input.text.trim()
  try {
    const text = decodeURIComponent(src)
    return { payload: textPayload(text), note: `解码为 ${byteSize(text)} 文本` }
  } catch {
    throw new Error('URL 解码失败：存在非法的百分号编码（例如单独的 % 或 %ZZ）')
  }
}

const urlEncode: StepExecutor = (input, config) => {
  const component = configText(config, 'component', 'component') !== 'uri'
  const out = component ? encodeURIComponent(input.text) : encodeURI(input.text)
  return {
    payload: textPayload(out),
    note: `按${component ? '组件（encodeURIComponent）' : '整条 URI（encodeURI）'}编码，${input.text.length} 字符 → ${out.length} 字符`
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

const regexReplace: StepExecutor = (input, config) => {
  const text = requireText(input, '正则提取替换')
  const pattern = configText(config, 'pattern')
  if (!pattern) throw new Error('正则表达式为空：请在步骤参数里填写表达式')
  const flags = configText(config, 'flags', 'g')
  const flagErr = validateFlags(flags)
  if (flagErr) throw new Error(`flags 非法：${flagErr}`)
  try {
    new RegExp(pattern, flags)
  } catch (e) {
    throw new Error(`表达式语法错误：${errMessage(e)}`)
  }
  const counted = execRegex(pattern, flags, text, '')
  if (!counted.ok) throw new Error(`正则执行失败：${counted.error ?? '未知错误'}`)
  const mode = configText(config, 'mode', 'replace')

  if (mode === 'match') {
    if (!counted.matches.length) throw new Error('没有匹配到任何内容：表达式与 flags 合法，但当前输入里没有命中')
    const items = counted.matches.map((m) => {
      if (m.named && m.named.length) {
        const obj: Record<string, string | null> = {}
        for (const n of m.named) obj[n.name] = n.value
        return obj
      }
      return m.text
    })
    return {
      payload: textPayload(JSON.stringify(items, null, 2), 'json'),
      note: `提取到 ${counted.matches.length} 处匹配${counted.capped ? '（超过 20 万已截断）' : ''}`
    }
  }

  const replacement = configText(config, 'replacement')
  const out = text.replace(new RegExp(pattern, flags), replacement)
  return {
    payload: textPayload(out),
    note: `替换完成，命中 ${counted.matches.length} 处${replacement === '' ? '（替换内容为空 = 删除匹配）' : ''}${counted.capped ? '（统计已截断在 20 万处）' : ''}`
  }
}

const jsonFormat: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON 格式化')
  const indent = Math.max(0, Math.min(8, configNumber(config, 'indent', 2)))
  const { value } = parseJson(text)
  const out = stringifyJson(value, indent)
  return { payload: textPayload(out, 'json'), note: `格式化完成，${lineSize(out)}` }
}

const jsonMinify: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON 压缩')
  const { value } = parseJson(text)
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

const jsonpath: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSONPath 提取')
  const expr = configText(config, 'expr', '$').trim() || '$'
  const { value } = parseJson(text)
  const res = evalJsonPath(toPlainJson(value), expr)
  if (!res.matches.length) throw new Error('匹配 0 项：检查表达式与字段名（区分大小写）')
  const out = JSON.stringify(
    res.matches.length === 1 ? res.matches[0]!.value : res.matches.map((m) => m.value),
    null,
    2
  )
  return {
    payload: textPayload(out, 'json'),
    note: `匹配 ${res.matches.length} 项${warnNote(res.warnings)}`
  }
}

const jmespath: StepExecutor = (input, config) => {
  const text = requireText(input, 'JMESPath 提取')
  const expr = configText(config, 'expr').trim()
  if (!expr) throw new Error('JMESPath 表达式为空：请在步骤参数里填写表达式')
  const { value } = parseJson(text)
  const res = evalJmesPath(toPlainJson(value), expr)
  if (!res.matches.length) throw new Error(`匹配 0 项：${res.warnings[0] ?? '检查表达式与字段名'}`)
  const out = JSON.stringify(
    res.matches.length === 1 ? res.matches[0]!.value : res.matches.map((m) => m.value),
    null,
    2
  )
  return {
    payload: textPayload(out, 'json'),
    note: `匹配 ${res.matches.length} 项${warnNote(res.warnings)}`
  }
}

const jsonYaml: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON / YAML 转换')
  if (configText(config, 'direction', 'json2yaml') === 'yaml2json') {
    const obj = yaml.load(text)
    return { payload: textPayload(JSON.stringify(obj, null, 2), 'json'), note: 'YAML 已转为 JSON' }
  }
  const { value } = parseJson(text)
  const out = yaml.dump(toPlainJson(value), { indent: 2, lineWidth: -1 })
  return { payload: textPayload(out), note: 'JSON 已转为 YAML' }
}

const schemaValidate: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON Schema 校验')
  const schemaText = configText(config, 'schema')
  if (!schemaText.trim()) throw new Error('该步骤还没有配置 Schema')
  const { value } = parseJson(text)
  const { value: schema } = parseJson(schemaText)
  const res = validateInstance(toPlainJson(value), schema, { strict: true })
  if (res.valid) {
    return { payload: textPayload(text, 'json'), note: `校验通过，检查了 ${res.checked} 个节点` }
  }
  const lines = res.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`)
  throw new Error(`校验失败 · ${res.errors.length} 个错误：${lines.slice(0, 2).join('；')}`)
}

const jsonSchemaGen: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON Schema 生成')
  const draft = (configText(config, 'draft', '2020-12') === 'draft-07' ? 'draft-07' : '2020-12') as Draft
  const strict = configBool(config, 'strict', false)
  const { value } = parseJson(text)
  const schema = inferSchema(toPlainJson(value), { draft, strict })
  const out = JSON.stringify(schema, null, 2)
  return {
    payload: textPayload(out, 'json'),
    note: `已按 ${draft}${strict ? '（严格模式）' : ''} 反推 Schema，${lineSize(out)}`
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
    const { value } = parseJson(text)
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

const download: StepExecutor = (input, config) => {
  const name = configText(config, 'filename', 'result.txt').trim() || 'result.txt'
  return { payload: input, note: `将导出为 ${name}，${byteSize(input.text)}` }
}

/* ── JSON 转 Java：与 t22 工具页同一套命名与类型推断规则 ── */

function javaTypeOf(value: unknown): string {
  if (value === null) return 'Object'
  if (Array.isArray(value)) return 'List<Object>'
  if (typeof value === 'number') return Number.isInteger(value) ? 'long' : 'double'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'String'
  return 'Object'
}

function javaName(key: string): string {
  const parts = key.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (!parts.length) return 'field'
  const first = parts[0]!
  return (
    first.charAt(0).toLowerCase() +
    first.slice(1) +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('')
  )
}

function pascal(key: string): string {
  const n = javaName(key)
  return n.charAt(0).toUpperCase() + n.slice(1)
}

/** 紧凑版 POJO 生成：嵌套对象生成静态内部类，数组按首个非空元素推断元素类型 */
function javaFromJson(value: unknown, className: string): string {
  let needsList = false

  function classOf(obj: Record<string, unknown>, name: string): string {
    const fields: string[] = []
    const methods: string[] = []
    const inners: string[] = []
    for (const [key, v] of Object.entries(obj)) {
      const prop = javaName(key)
      let type: string
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = pascal(key)
        type = inner
        inners.push(classOf(v as Record<string, unknown>, inner))
      } else if (Array.isArray(v)) {
        needsList = true
        const first = v.find((x) => x !== null && x !== undefined)
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          const inner = pascal(key)
          type = `List<${inner}>`
          inners.push(classOf(first as Record<string, unknown>, inner))
        } else {
          type = `List<${first === undefined ? 'Object' : javaTypeOf(first)}>`
        }
      } else {
        type = javaTypeOf(v)
      }
      fields.push(`    private ${type} ${prop};`)
      methods.push(
        `    public ${type} get${pascal(key)}() {`,
        `        return this.${prop};`,
        '    }',
        '',
        `    public void set${pascal(key)}(${type} ${prop}) {`,
        `        this.${prop} = ${prop};`,
        '    }'
      )
    }
    const body = [...fields, ...(fields.length ? [''] : []), ...methods]
    const innerText = inners.map((code) => code.split('\n').map((l) => (l ? `    ${l}` : l)).join('\n'))
    const all = [...body, ...(innerText.length ? ['', ...innerText] : [])]
    return [`public class ${name} {`, ...all, '}'].join('\n')
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return `public class ${className} {\n    // 顶层不是对象，无法生成字段；请先用 JSONPath 提取出对象\n}`
  }
  const code = classOf(value as Record<string, unknown>, className)
  return needsList ? `import java.util.List;\n\n${code}` : code
}

const json2java: StepExecutor = (input, config) => {
  const text = requireText(input, 'JSON 转 Java')
  const { value } = parseJson(text)
  const cls = configText(config, 'className', 'Order').trim() || 'Order'
  const code = javaFromJson(toPlainJson(value), cls)
  return { payload: textPayload(code), note: `生成 ${cls}，${lineSize(code)}` }
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
