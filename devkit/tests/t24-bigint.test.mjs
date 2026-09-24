/**
 * T24「YAML → Properties」大整数保真回归（盲测 P2-2）：
 *
 * 背景：t24 之前直接 `yaml.load(input, {schema: JSON_SCHEMA})`，未走 t03 / 流程的
 *       `loadYamlPreservingNumbers` 保真链路；`flattenYaml` 对 number 直接 `String(value)`，
 *       于是 `orderId: 9007199254740993` 被静默改写为 `9007199254740992`。
 * 修复后：
 *   1. t24 的 yaml2properties 改用 `loadYamlPreservingNumbers`（import 自 ~/utils/json）解析；
 *   2. `flattenYaml` 对 RawNumber 用 `raw` 原文裸输出，精度不再丢失；
 *   3. 普通数字 / 布尔 / null / 字符串行为不变；
 *   4. 别名放大（billion laughs）/ 自引用别名仍被中文错误拦截。
 *
 * 测试策略（与 t24-yaml-budget.test.mjs 一致）：@vue/compiler-sfc 自检 + 从源码抽取真实
 * 函数体，在受控环境注入同一个 RawNumber 类执行页面里的实际实现（而非另写等价模型）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { RawNumber, assertYamlExpansionWithinBudget, loadYamlPreservingNumbers } from '../app/utils/json.ts'
import { check, throws } from './helpers.mjs'

const projectRoot = process.cwd()
const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)

/** 每层 aN: &aN [*a(N-1) × width]，展开成树后节点数随 depth 指数增长 */
function bomb(depth, width) {
  const lines = ['a0: &a0 x']
  for (let i = 1; i <= depth; i++) {
    const refs = Array.from({ length: width }, () => `*a${i - 1}`).join(', ')
    lines.push(`a${i}: &a${i} [${refs}]`)
  }
  return lines.join('\n')
}

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. SFC 自检 + 源码层约束
 * ──────────────────────────────────────────────────────────── */
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

const t24src = readFileSync(join(projectRoot, 'app/components/tools/t24-properties-yaml.vue'), 'utf8')
const parsed = parseSfc(t24src, { filename: 't24-properties-yaml.vue' })
let compileError = ''
try {
  compileSfcScript(parsed.descriptor, { id: 't24-bigint' })
} catch (e) {
  compileError = e && e.message ? e.message : String(e)
}
cases.push(check('SFC 解析 t24 无错误', () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
cases.push(check('SFC 编译 t24 <script setup> 成功', () => !compileError, compileError))
cases.push(
  check('t24 引入 loadYamlPreservingNumbers（保真解析）', () =>
    /import\s*\{[^}]*loadYamlPreservingNumbers[^}]*\}\s*from\s*['"]~\/utils\/json['"]/.test(t24src)
  )
)
cases.push(check('t24 不再裸用 yaml.load / JSON_SCHEMA', () => !/yaml\.load\(/.test(t24src) && !/yaml\.JSON_SCHEMA/.test(t24src)))
cases.push(
  check('flattenYaml 对 RawNumber 使用 raw 原文', () =>
    /value instanceof RawNumber/.test(t24src) && /Object\(value\)\.raw/.test(t24src)
  )
)

/* ────────────────────────────────────────────────────────────
 * 2. 抽取 t24 真实函数体，注入同一个 RawNumber 类执行
 * ──────────────────────────────────────────────────────────── */
function extractFnBody(source, name) {
  const re = new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`)
  const m = source.match(re)
  if (!m) throw new Error(`未在源码中找到函数 ${name}()`)
  return m[1]
}
/** 去掉函数体内仅有的简单 TS 类型标注，使其可作为普通 JS 在 new Function 中执行 */
const stripTypes = (s) => s.replace(/:\s*(?:FlatEntry|string)\[\]/g, '')
const body = (n) => stripTypes(extractFnBody(t24src, n))
const factorySrc = `
  let literalKeys = { value: {} };
  let escapeUnicodeOut = { value: false };
  function errMessage(e){ return e instanceof Error ? e.message : String(e) }
  function escapePropKey(k){ ${body('escapePropKey')} }
  function escapePropValue(v){ ${body('escapePropValue')} }
  function appendWithPrefix(rel, prefix, isArr, out){ ${body('appendWithPrefix')} }
  function buildRelative(value, memo, active){ ${body('buildRelative')} }
  function flattenYaml(value, prefix, out, memo = new WeakMap(), active = new WeakSet()){ ${body('flattenYaml')} }
  function collectDottedKeys(value, out, memo = new WeakMap(), active = new WeakSet()){ ${body('collectDottedKeys')} }
  function localizeProcessError(e, what){ ${body('localizeProcessError')} }
  return { flattenYaml, collectDottedKeys, localizeProcessError, literalKeys, escapeUnicodeOut };
`
let api = null
let factoryError = ''
try {
  // 关键：把页面 import 的 RawNumber 注入抽取环境，使 loader 产出的实例能通过 instanceof。
  api = new Function('RawNumber', factorySrc)(RawNumber)
} catch (e) {
  factoryError = e && e.message ? e.message : String(e)
}
cases.push(check('可从 t24 抽取真实函数体并注入 RawNumber 构建执行环境', () => !factoryError, factoryError))

/** 用 t24 真实解析链路（loadYamlPreservingNumbers）+ 真实 flattenYaml 产出 FlatEntry[] */
const flatOf = (yamlText) => {
  const out = []
  api.flattenYaml(loadYamlPreservingNumbers(yamlText).value, '', out)
  return out
}
const mapOf = (entries) => Object.fromEntries(entries.map((e) => [e.key, e.value]))
const propsOf = (yamlText) => flatOf(yamlText).map((l) => `${l.key}=${l.value}`).join('\n') + '\n'

/* ────────────────────────────────────────────────────────────
 * 3. 大整数保真
 * ──────────────────────────────────────────────────────────── */
const BIG = '9007199254740993' // 2^53 + 1，裸 yaml.load 会静默变成 9007199254740992
cases.push(
  check('大整数键值按原文输出（不含 .raw 子键）', () => {
    const out = flatOf(`orderId: ${BIG}`)
    return out.length === 1 && out[0].key === 'orderId' && out[0].value === BIG
  })
)
cases.push(check('大整数输出文本精确保真', () => propsOf(`orderId: ${BIG}`) === `orderId=${BIG}\n`))
cases.push(check('大整数不再被改写为 9007199254740992', () => !propsOf(`orderId: ${BIG}`).includes('9007199254740992')))
cases.push(
  check('嵌套 / 数组中的大整数同样保真', () => {
    const m = mapOf(flatOf(`a:\n  b: ${BIG}\narr: [${BIG}, ${BIG}]`))
    return m['a.b'] === BIG && m['arr[0]'] === BIG && m['arr[1]'] === BIG
  })
)
cases.push(
  check('负的大整数保真', () => {
    const m = mapOf(flatOf('n: -9007199254740993'))
    return m.n === '-9007199254740993'
  })
)
cases.push(
  check('超出安全范围的高精度小数保真', () => {
    const m = mapOf(flatOf('d: 0.1234567890123456789012345'))
    return m.d === '0.1234567890123456789012345'
  })
)

/* ────────────────────────────────────────────────────────────
 * 4. 普通值行为不变
 * ──────────────────────────────────────────────────────────── */
cases.push(
  check('普通数字 / 布尔 / null / 字符串输出不变', () => {
    const m = mapOf(flatOf('a: 1\nb: true\nc: false\nn: null\ns: text\ne:\n  f: 2'))
    return m.a === '1' && m.b === 'true' && m.c === 'false' && m.n === '' && m.s === 'text' && m['e.f'] === '2'
  })
)
cases.push(check('普通数字不因保真链路而带引号 / 加 raw 子键', () => propsOf('n: 42') === 'n=42\n'))
// 与 t03 / 流程共用同一保真链路：数字原文保留（1.0 输出 1.0，而非旧 JSON_SCHEMA 的 1）。
cases.push(check('小数原文保留（与 t03 一致）', () => propsOf('v: 1.0') === 'v=1.0\n'))
cases.push(
  check('字符串含数字仍按字符串处理', () => {
    const m = mapOf(flatOf('code: "007"'))
    return m.code === '007'
  })
)
cases.push(
  check('数组按下标拍平输出不变', () => {
    const keys = flatOf('arr: [1, two]').map((e) => e.key)
    return JSON.stringify(keys) === JSON.stringify(['arr[0]', 'arr[1]'])
  })
)
cases.push(
  check('普通别名每处引用都输出（记忆化不丢数据）', () => {
    const out = flatOf('base: &a\n  x: 1\nref: *a')
    const m = mapOf(out)
    return out.length === 2 && m['base.x'] === '1' && m['ref.x'] === '1'
  })
)
cases.push(
  check('含点键收集（含别名）去重后正确', () => {
    const out = []
    api.collectDottedKeys(loadYamlPreservingNumbers('a: &x\n  "p.q": 1\nb: *x').value, out)
    return JSON.stringify([...new Set(out)]) === JSON.stringify(['p.q'])
  })
)

/* ────────────────────────────────────────────────────────────
 * 5. 别名放大仍中文拒绝
 * ──────────────────────────────────────────────────────────── */
cases.push(
  throws('bomb(6,9) loadYamlPreservingNumbers 抛中文错（含「别名」）', () => loadYamlPreservingNumbers(bomb(6, 9)), /别名/)
)
cases.push(
  check('bomb 错误信息为中文且含「过大」', () => {
    try {
      loadYamlPreservingNumbers(bomb(8, 9))
      return false
    } catch (e) {
      return hasChinese(e.message) && /别名/.test(e.message) && /过大/.test(e.message)
    }
  })
)
cases.push(throws('自引用别名 loadYamlPreservingNumbers 中文拒绝', () => loadYamlPreservingNumbers('a: &x\n  b: *x'), /别名/))
cases.push(
  throws(
    'assertYamlExpansionWithinBudget 仍中文拒绝别名炸弹（t24 保留该检查）',
    () => assertYamlExpansionWithinBudget(yaml.load(bomb(6, 9), { schema: yaml.JSON_SCHEMA })),
    /别名/
  )
)

/* ────────────────────────────────────────────────────────────
 * 6. 解析异常中文兜底（不回显英文）
 * ──────────────────────────────────────────────────────────── */
cases.push(
  check('YAML 语法错误中文前缀，不泄漏英文', () => {
    try {
      loadYamlPreservingNumbers('a: [1, 2')
      return false
    } catch (e) {
      return /YAML 解析失败/.test(e.message) && hasChinese(e.message) && !/unexpected end/i.test(e.message)
    }
  })
)
cases.push(
  check('localizeProcessError 保留中文、英文兜底为中文', () => {
    const keep = api.localizeProcessError(new Error('YAML 别名展开后数据过大'), 'YAML')
    const fallback = api.localizeProcessError(new Error('boom engine failure'), 'YAML')
    return keep === 'YAML 别名展开后数据过大' && hasChinese(fallback) && !/boom/.test(fallback)
  })
)
