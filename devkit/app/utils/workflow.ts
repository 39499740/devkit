/**
 * 处理流程（S11 / S12）：把多个本地工具串成一条流水线。
 * 数据只在本次页面内存中按步骤传递，不写入 localStorage / IndexedDB，也不发送到服务器。
 */
import yaml from 'js-yaml'
import { parseJson, stringifyJson, toPlainJson } from './json'
import { evalJsonPath } from './jsonpath'
import { validateInstance } from './jsonschema'
import { base64ToBytes, bytesToText } from './bytes'

export type StepType =
  | 'base64-decode'
  | 'json-format'
  | 'jsonpath'
  | 'json2java'
  | 'schema-validate'
  | 'url-decode'
  | 'json-yaml'
  | 'download'

export interface StepConfigField {
  key: string
  label: string
  placeholder?: string
}

export interface StepDef {
  type: StepType
  name: string
  /** 步骤库里的分类文案，与工具分类同名 */
  cat: string
  desc: string
  fields: StepConfigField[]
}

export interface WorkflowStep {
  type: StepType
  config: Record<string, string>
}

export interface Workflow {
  id: string
  name: string
  desc: string
  steps: WorkflowStep[]
}

export interface StepResult {
  index: number
  type: StepType
  name: string
  status: 'ok' | 'fail' | 'skipped'
  output: string
  note: string
  logs: string[]
  ms: number
}

export const stepLibrary: StepDef[] = [
  { type: 'base64-decode', name: 'Base64 解码', cat: '编码与文本', desc: '把 Base64 文本还原为原始文本', fields: [] },
  { type: 'json-format', name: 'JSON 格式化', cat: '数据格式', desc: '解析并重新缩进 JSON', fields: [{ key: 'indent', label: '缩进', placeholder: '2' }] },
  { type: 'jsonpath', name: 'JSONPath 提取', cat: '数据格式', desc: '按表达式提取字段', fields: [{ key: 'expr', label: '查询表达式', placeholder: '$.store.book[*].title' }] },
  { type: 'json2java', name: 'JSON 转 Java', cat: 'Java 开发', desc: '按 JSON 结构生成 POJO', fields: [{ key: 'className', label: '类名', placeholder: 'Order' }] },
  { type: 'schema-validate', name: 'JSON Schema 校验', cat: '数据格式', desc: '用 Schema 校验上一级输出', fields: [{ key: 'schema', label: 'Schema', placeholder: '{ "type": "object" }' }] },
  { type: 'url-decode', name: 'URL 解码', cat: '编码与文本', desc: '百分号编码还原为原文', fields: [] },
  { type: 'json-yaml', name: 'JSON / YAML 转换', cat: '数据格式', desc: 'JSON 与 YAML 双向转换', fields: [{ key: 'direction', label: '方向', placeholder: 'json2yaml' }] },
  { type: 'download', name: '下载结果', cat: '文件与图片', desc: '把当前结果作为文件导出', fields: [{ key: 'filename', label: '文件名', placeholder: 'result.txt' }] }
]

export function stepDef(type: StepType): StepDef {
  return stepLibrary.find((s) => s.type === type) ?? stepLibrary[0]!
}

/** parseJson 会把数字包成 RawNumber（保证大整数不丢精度），下游计算前先还原成普通值 */
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

function validate(value: unknown, schemaText: string, strict: boolean) {
  const { value: schema } = parseJson(schemaText)
  return validateInstance(value, schema, { strict })
}

/** 单步执行：输入与输出都是文本，便于串成流水线 */
export function runStep(step: WorkflowStep, input: string, index: number): StepResult {
  const def = stepDef(step.type)
  const t0 = Date.now()
  const logs: string[] = [`运行步骤 ${index + 1} · ${def.name}`, `输入 ${byteSize(input)}`]
  const done = (status: StepResult['status'], output: string, note: string): StepResult => {
    logs.push(`${status === 'ok' ? '完成' : '失败'}：${note}`)
    logs.push(`耗时 ${Math.max(1, Date.now() - t0)} ms`)
    return { index, type: step.type, name: def.name, status, output, note, logs, ms: Math.max(1, Date.now() - t0) }
  }
  try {
    switch (step.type) {
      case 'base64-decode': {
        const res = base64ToBytes(input.trim())
        if (res.error) throw new Error(res.error)
        const text = bytesToText(res.bytes)
        if (text.error) throw new Error(text.error)
        return done('ok', text.text, `解码为 ${byteSize(text.text)} 文本`)
      }
      case 'url-decode': {
        const text = decodeURIComponent(input.trim())
        return done('ok', text, `解码为 ${byteSize(text)} 文本`)
      }
      case 'json-format': {
        const indent = Math.max(0, Math.min(8, Number(step.config.indent ?? 2) || 2))
        const { value } = parseJson(input)
        const text = stringifyJson(value, indent)
        return done('ok', text, `格式化完成，${lineSize(text)}`)
      }
      case 'jsonpath': {
        const expr = (step.config.expr ?? '$').trim()
        const { value } = parseJson(input)
        const res = evalJsonPath(toPlainJson(value), expr)
        const out = JSON.stringify(
          res.matches.length === 1 ? res.matches[0]!.value : res.matches.map((m) => m.value),
          null,
          2
        )
        if (!res.matches.length) return done('fail', out, '匹配 0 项，检查表达式与字段名')
        return done('ok', out, `匹配 ${res.matches.length} 项`)
      }
      case 'json2java': {
        const { value } = parseJson(input)
        const cls = (step.config.className ?? 'Order').trim() || 'Order'
        const code = javaFromJson(toPlainJson(value), cls)
        return done('ok', code, `生成 ${cls}，${lineSize(code)}`)
      }
      case 'schema-validate': {
        const schemaText = step.config.schema ?? ''
        if (!schemaText.trim()) throw new Error('该步骤还没有配置 Schema')
        const { value } = parseJson(input)
        const res = validate(toPlainJson(value), schemaText, true)
        if (res.valid) return done('ok', input, `校验通过，检查了 ${res.checked} 个节点`)
        const lines = res.errors.map((e) => `${e.path} [${e.keyword}] ${e.message}`)
        return done('fail', input, `校验失败 · ${res.errors.length} 个错误：${lines.slice(0, 2).join('；')}`)
      }
      case 'json-yaml': {
        const dir = (step.config.direction ?? 'json2yaml').trim()
        if (dir === 'yaml2json') {
          const obj = yaml.load(input)
          const text = JSON.stringify(obj, null, 2)
          return done('ok', text, 'YAML 已转为 JSON')
        }
        const { value } = parseJson(input)
        const text = yaml.dump(toPlainJson(value), { indent: 2, lineWidth: -1 })
        return done('ok', text, 'JSON 已转为 YAML')
      }
      case 'download': {
        const name = (step.config.filename ?? 'result.txt').trim() || 'result.txt'
        return done('ok', input, `将导出为 ${name}，${byteSize(input)}`)
      }
      default:
        throw new Error(`未知步骤类型 ${step.type}`)
    }
  } catch (e) {
    return done('fail', '', errMessage(e))
  }
}

export interface WorkflowRunResult {
  results: StepResult[]
  finalOutput: string
  status: 'ok' | 'fail'
  ms: number
}

/** 顺序执行整条流程；失败时可按「失败时中断流程」配置决定是否继续 */
export function runWorkflow(
  workflow: Workflow,
  input: string,
  opts: { stopOnError: boolean; onlyFrom?: number }
): WorkflowRunResult {
  const t0 = Date.now()
  const results: StepResult[] = []
  let cur = input
  let status: 'ok' | 'fail' = 'ok'
  const start = opts.onlyFrom ?? 0
  for (let i = start; i < workflow.steps.length; i += 1) {
    const r = runStep(workflow.steps[i]!, cur, i)
    results.push(r)
    if (r.status === 'ok') {
      cur = r.output
      continue
    }
    status = 'fail'
    if (opts.stopOnError) break
    cur = r.output || cur
  }
  return { results, finalOutput: cur, status, ms: Date.now() - t0 }
}

function byteSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function lineSize(text: string): string {
  return `${text ? text.split('\n').length : 0} 行、${byteSize(text)}`
}

/** 示例流程：三条都是可直接跑通的最小流水线 */
export function defaultWorkflows(): Workflow[] {
  return [
    {
      id: 'wf-order-snapshot',
      name: '订单快照解析',
      desc: '把 Base64 订单快照解码后转成 Java 实体类',
      steps: [
        { type: 'base64-decode', config: {} },
        { type: 'json-format', config: { indent: '2' } },
        { type: 'jsonpath', config: { expr: '$.order' } },
        { type: 'json2java', config: { className: 'Order' } }
      ]
    },
    {
      id: 'wf-config-convert',
      name: '配置格式互转',
      desc: '把 JSON 配置格式化后转成 YAML',
      steps: [
        { type: 'json-format', config: { indent: '2' } },
        { type: 'json-yaml', config: { direction: 'json2yaml' } },
        { type: 'download', config: { filename: 'config.yaml' } }
      ]
    },
    {
      id: 'wf-response-check',
      name: '接口响应校验',
      desc: 'URL 解码响应体，格式化后按 Schema 校验',
      steps: [
        { type: 'url-decode', config: {} },
        { type: 'json-format', config: { indent: '2' } },
        { type: 'schema-validate', config: { schema: '{ "type": "object", "required": ["code"], "properties": { "code": { "type": "integer" } } }' } }
      ]
    }
  ]
}
