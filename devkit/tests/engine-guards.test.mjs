/**
 * 引擎守卫回归：正则灾难性回溯的静态判定 + schema 语义修正 + 错误中文化。
 *
 * 说明：Node 无 Worker / DOMParser，验证的是同步回退路径与静态守卫本身；
 * 浏览器里的真实 Worker 超时与 parsererror 中文由浏览器验证线程覆盖。
 *
 * 覆盖：
 * - regexRiskReason：重叠交替分支（(a|aa)+ / (a|a?)+ / (a|ab)*）判定为危险，
 *   前缀无关的安全交替（(a|b)+ / (ab|ac)+）与无交替结构不误伤；
 * - jsonschema：RawNumber 大整数按 number/integer 判定（不再误报 string）、
 *   深度超限给出 warning、未知 format 给出 warning、失败信息不泄漏 {"raw":…}；
 * - xml 步骤：非法 XML 在无 DOM 环境失败且为中文，不含 parsererror 英文原文；
 * - url-encode：孤立代理项失败且为中文；
 * - download：文件名做与页面一致的非法字符清洗。
 */
import { regexRiskReason } from '../app/utils/regex.ts'
import { validateInstance } from '../app/utils/jsonschema.ts'
import { parseJson } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { hasWorker } from '../app/workflow/workers/run-compute.ts'
import { check } from './helpers.mjs'

export const cases = []

/* ─────────────── 1. regexRiskReason：重叠交替分支 ─────────────── */

const dangerousAlternation = [
  String.raw`^(a|aa)+$`,
  String.raw`(a|a?)+`,
  String.raw`(a|ab)*`,
  String.raw`((a|aa))+`
]
for (const p of dangerousAlternation) {
  cases.push(check(`重叠交替判定为危险：${p}`, () => regexRiskReason(p) !== null))
}

// 保留原有「嵌套无界量词」判定
for (const p of [String.raw`^(a+)+$`, String.raw`(a*)*`, String.raw`(?:a+)+`]) {
  cases.push(check(`嵌套量词仍判定为危险：${p}`, () => regexRiskReason(p) !== null))
}

const safeAlternation = [
  String.raw`(?:ab)+`,
  String.raw`(a|b)+`,
  String.raw`\d+`,
  String.raw`[0-9]{2,4}`,
  String.raw`(?<y>\d{4})`,
  String.raw`(ab|ac)+`,
  String.raw`(jpg|jpeg|png)+`
]
for (const p of safeAlternation) {
  cases.push(check(`安全结构判定为 null：${p}`, () => regexRiskReason(p) === null))
}

/* ─────────────── 2. jsonschema：RawNumber 大整数语义 ─────────────── */

const bigInstance = () => parseJson('{"id":12345678901234567890}').value

cases.push(
  check('RawNumber 大整数按 type:integer 通过（不误报 string）', () => {
    const r = validateInstance(bigInstance(), { type: 'object', properties: { id: { type: 'integer' } } }, { strict: true })
    return r.valid === true && r.errors.length === 0
  })
)
cases.push(
  check('RawNumber 大整数按 type:number 通过', () => {
    const r = validateInstance(bigInstance(), { type: 'object', properties: { id: { type: 'number' } } }, { strict: true })
    return r.valid === true
  })
)
cases.push(
  check('RawNumber 大整数对 type:string 仍失败', () => {
    const r = validateInstance(bigInstance(), { type: 'object', properties: { id: { type: 'string' } } }, { strict: true })
    return r.valid === false
  })
)
cases.push(
  check('RawNumber 失败信息不泄漏 {"raw":…}', () => {
    const r = validateInstance(bigInstance(), { type: 'object', properties: { id: { type: 'string' } } }, { strict: true })
    return r.errors.every((e) => !e.message.includes('raw'))
  })
)
cases.push(
  check('RawNumber 与字符串形式的 const 比较相等', () => {
    const r = validateInstance(bigInstance(), { type: 'object', properties: { id: { const: '12345678901234567890' } } }, { strict: true })
    return r.valid === true
  })
)
cases.push(
  check('RawNumber 参与数值关键字校验（minimum 生效）', () => {
    const inst = parseJson('{"n":5}').value
    const r = validateInstance(inst, { type: 'object', properties: { n: { type: 'integer', minimum: 10 } } }, { strict: true })
    return r.valid === false && r.errors.some((e) => e.keyword === 'minimum')
  })
)

/* ─────────────── 3. jsonschema：深度上限与 format 警告 ─────────────── */

function deepPair(n) {
  let inst = 1
  let schema = { type: 'integer' }
  for (let i = 0; i < n; i += 1) {
    inst = { a: inst }
    schema = { type: 'object', properties: { a: schema } }
  }
  return { inst, schema }
}

cases.push(
  check('深度超过 64 给出中文 warning（不静默通过）', () => {
    const { inst, schema } = deepPair(70)
    const r = validateInstance(inst, schema, { strict: true })
    return r.warnings.some((w) => /深度/.test(w) && /64/.test(w) && /[\u4e00-\u9fa5]/.test(w))
  })
)
cases.push(
  check('浅层结构不产生深度 warning', () => {
    const r = validateInstance({ a: 1 }, { type: 'object', properties: { a: { type: 'integer' } } }, { strict: true })
    return r.warnings.length === 0
  })
)
cases.push(
  check('未知 format 给出 warning（不静默通过）', () => {
    const r = validateInstance('x', { type: 'string', format: 'custom-thing' }, { strict: true })
    return r.valid === true && r.warnings.some((w) => w.includes('custom-thing'))
  })
)

/* ─────────────── 4. xml 步骤：非法 XML 中文且不泄漏英文 ─────────────── */

async function buildCases() {
  // Node 无 DOMParser：步骤应先以中文提示「需要浏览器」，且绝不出现 parsererror 英文原文
  const xmlBad = await runStep(createStep('xml', { mode: 'format' }), '<a><b></a>', 0)
  cases.push(
    check('非法 XML 步骤失败且为中文、不含 parsererror 英文原文', () => {
      const note = String(xmlBad.note)
      return xmlBad.status === 'fail' && /[\u4e00-\u9fa5]/.test(note) && !/parsererror|This page contains|error on line/i.test(note)
    })
  )

  /* ─────────────── 5. url-encode：孤立代理项中文失败 ─────────────── */
  const urlBad = await runStep(createStep('url-encode'), '\uD800', 0)
  cases.push(
    check('url-encode 孤立代理项失败且为中文', () => {
      const note = String(urlBad.note)
      return urlBad.status === 'fail' && /[\u4e00-\u9fa5]/.test(note) && !/URIError|URI malformed/i.test(note)
    })
  )

  /* ─────────────── 6. download：文件名非法字符清洗 ─────────────── */
  const dl = await runStep(createStep('download', { filename: 'a/b:c*?.txt' }), 'x', 0)
  cases.push(
    check('download 文件名清洗 / \\ : * ? " < > |', () => dl.status === 'ok' && dl.note.includes('将导出为 abc.txt'))
  )
  const dlEmpty = await runStep(createStep('download', { filename: '///' }), 'x', 0)
  cases.push(check('download 清洗后为空时回退 result.txt', () => dlEmpty.status === 'ok' && dlEmpty.note.includes('result.txt')))

  /* ─────────────── 7. Node 环境 hasWorker 为 false ─────────────── */
  cases.push(check('Node 环境 hasWorker() 为 false', () => hasWorker() === false))

  return cases
}

await buildCases()
