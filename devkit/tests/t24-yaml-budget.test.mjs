/**
 * T24「YAML → Properties」别名放大（billion laughs）防护回归：
 *
 * P1：t24 之前直接 `yaml.load(JSON_SCHEMA)` 后 flatten / collectDottedKeys，
 *     对别名共享 DAG 无去重、无预算——bomb(8,9) 直接 JS heap OOM，自引用别名栈溢出，
 *     且错误回显 js-yaml / V8 英文原文。修复后：
 *   1. utils/json.ts 导出可复用的 assertYamlExpansionWithinBudget（阈值语义不变）；
 *   2. t24 在 yaml.load 之后、任何 flatten / dotted 遍历之前调用预算检查；
 *   3. flattenYaml / collectDottedKeys 加 WeakMap/WeakSet 记忆化（共享节点只遍历一次）；
 *   4. YAML 解析 / 处理错误统一走中文兜底，不回显英文原文；
 *   5. 正常缩进 / 点号键 / 数组 / 普通别名的输出行为不变。
 *
 * 测试策略（参考 page-errors.test.mjs）：@vue/compiler-sfc 自检 + 从源码抽取真实函数体，
 * 用 new Function 在受控环境执行页面里的实际实现（而非另写等价模型）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'js-yaml'
import { assertYamlExpansionWithinBudget } from '../app/utils/json.ts'
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

/** 与 t24 一致的加载方式（JSON_SCHEMA，别名共享同一对象引用） */
function loadYaml(text) {
  return yaml.load(text, { schema: yaml.JSON_SCHEMA })
}

function timeIt(fn) {
  const t0 = Date.now()
  let error = null
  let result = null
  try {
    result = fn()
  } catch (e) {
    error = e
  }
  return { ms: Date.now() - t0, error, result }
}

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. 预算辅助（utils/json.ts 导出）直接单测
 * ──────────────────────────────────────────────────────────── */
const big = timeIt(() => assertYamlExpansionWithinBudget(loadYaml(bomb(8, 9))))
cases.push(check('bomb(8,9) 预算检查抛错', () => big.error !== null))
cases.push(check('bomb(8,9) 错误为中文', () => big.error !== null && hasChinese(big.error.message)))
cases.push(
  check('bomb(8,9) 错误含「别名」「过大」', () => big.error !== null && /别名/.test(big.error.message) && /过大/.test(big.error.message))
)
cases.push(check(`bomb(8,9) 预算检查 < 1000ms（实际 ${big.ms}ms）`, () => big.ms < 1000))

cases.push(throws('bomb(6,9) 超限抛中文错', () => assertYamlExpansionWithinBudget(loadYaml(bomb(6, 9))), /别名/))
cases.push(
  check('浅层别名通过预算检查', () => {
    assertYamlExpansionWithinBudget(loadYaml(bomb(3, 2)))
    return true
  })
)
cases.push(
  check('普通映射通过预算检查', () => {
    assertYamlExpansionWithinBudget(loadYaml('a: 1\nb:\n  c: 2\narr: [1, 2]'))
    return true
  })
)
cases.push(
  check('自引用别名被预算检查拒绝（不栈溢出）', () => {
    const t = timeIt(() => assertYamlExpansionWithinBudget(loadYaml('a: &x\n  b: *x')))
    return t.error !== null && hasChinese(t.error.message) && /别名/.test(t.error.message) && t.ms < 1000
  })
)

/* ────────────────────────────────────────────────────────────
 * 2. t24 SFC 自检 + 源码层约束
 * ──────────────────────────────────────────────────────────── */
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

const t24src = readFileSync(join(projectRoot, 'app/components/tools/t24-properties-yaml.vue'), 'utf8')
const parsed = parseSfc(t24src, { filename: 't24-properties-yaml.vue' })
let compileError = ''
try {
  compileSfcScript(parsed.descriptor, { id: 't24-yaml-budget' })
} catch (e) {
  compileError = e && e.message ? e.message : String(e)
}
cases.push(check('SFC 解析 t24 无错误', () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
cases.push(check('SFC 编译 t24 <script setup> 成功', () => !compileError, compileError))
cases.push(check('t24 引入预算辅助 assertYamlExpansionWithinBudget', () => /assertYamlExpansionWithinBudget/.test(t24src)))
cases.push(
  check('预算检查位于 flatten / dotted 遍历之前', () => {
    const iBudget = t24src.indexOf('assertYamlExpansionWithinBudget(doc)')
    const iDotted = t24src.indexOf('collectDottedKeys(doc')
    const iFlat = t24src.indexOf("flattenYaml(doc, '', out)")
    return iBudget > 0 && iDotted > iBudget && iFlat > iBudget
  })
)
cases.push(
  check('flattenYaml / collectDottedKeys 使用 WeakMap / WeakSet 记忆化', () =>
    /WeakMap<object, FlatEntry\[\]>/.test(t24src) && /WeakMap<object, string\[\]>/.test(t24src) && /WeakSet<object>/.test(t24src)
  )
)
cases.push(
  check('t24 不再把英文 errMessage(e) 直接展示', () =>
    !/errDetail\.value = errMessage\(e\)/.test(t24src) && !/markFail\(errMessage\(e\)\)/.test(t24src)
  )
)
cases.push(
  check('t24 YAML 处理错误中文化兜底存在', () =>
    /localizeProcessError/.test(t24src) && /处理失败，请检查输入内容/.test(t24src) && /嵌套层级过深/.test(t24src)
  )
)

/* ────────────────────────────────────────────────────────────
 * 3. 抽取 t24 真实函数体，在受控环境执行
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
  api = new Function(factorySrc)()
} catch (e) {
  factoryError = e && e.message ? e.message : String(e)
}
cases.push(check('可从 t24 抽取真实函数体构建执行环境', () => !factoryError, factoryError))

const flatOf = (yamlText) => {
  const out = []
  api.flattenYaml(loadYaml(yamlText), '', out)
  return out
}
const mapOf = (entries) => Object.fromEntries(entries.map((e) => [e.key, e.value]))

/* 正常行为不变 */
cases.push(
  check('普通缩进映射拍平输出不变', () => {
    const m = mapOf(flatOf('a: 1\nb:\n  c: 2'))
    return m.a === '1' && m['b.c'] === '2'
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
  check('别名数组每处引用都输出下标键', () => {
    const keys = flatOf('arr: &a [10, 20]\nref: *a')
      .map((e) => e.key)
      .sort()
    return JSON.stringify(keys) === JSON.stringify(['arr[0]', 'arr[1]', 'ref[0]', 'ref[1]'])
  })
)
cases.push(
  check('嵌套别名共享节点仍正确展开', () => {
    const m = mapOf(flatOf('a: &x\n  k: 1\nb: &y\n  m: *x\nn: *y'))
    return m['a.k'] === '1' && m['b.m.k'] === '1' && m['n.m.k'] === '1'
  })
)
cases.push(
  check('含点键收集（含别名）去重后正确', () => {
    const out = []
    api.collectDottedKeys(loadYaml('a: &x\n  "p.q": 1\nb: *x'), out)
    return JSON.stringify([...new Set(out)]) === JSON.stringify(['p.q'])
  })
)
cases.push(
  check('自引用别名在抽取实现里被中文兜底拦截（不卡死）', () => {
    const t = timeIt(() => {
      const out = []
      api.flattenYaml(loadYaml('a: &x\n  b: *x'), '', out)
      return out
    })
    return t.error !== null && hasChinese(t.error.message) && /别名/.test(t.error.message) && t.ms < 1000
  })
)
cases.push(
  check('localizeProcessError 保留中文、英文兜底、栈溢出给提示', () => {
    return (
      api.localizeProcessError(new Error('YAML 别名展开后数据过大'), 'YAML') === 'YAML 别名展开后数据过大' &&
      api.localizeProcessError(new Error('boom engine failure'), 'YAML') === 'YAML 处理失败，请检查输入内容' &&
      /嵌套层级过深/.test(api.localizeProcessError(new RangeError('Maximum call stack size exceeded'), 'YAML'))
    )
  })
)
