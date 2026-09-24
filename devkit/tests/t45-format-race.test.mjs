/**
 * t45「JSON Schema 校验」格式化保真 + 校验竞态回归。
 *
 * 背景（盲测）：
 * - P2-1：t45 的「格式化」用 JSON.stringify(value, null, 2)，而 parseJson 得到的数值是
 *   RawNumber 对象，格式化后把 schema 数值关键字改写成 {"raw":"1"}，破坏 schema。
 *   应改用 stringifyJson(value, 2) 保留原文（或先 toPlainJson）。
 * - P2-6：validate() 只用 runToken 串行化并发校验，但输入 / schema 变化不会推进 runToken；
 *   await 返回后会把旧输入算出的结果写回，并 run.markOk 把 lastSig 刷成新签名 → 覆盖 stale。
 *
 * 测试策略（参考 t45-fallback.test.mjs / page-errors.test.mjs）：
 *  1. @vue/compiler-sfc 自检 t45 SFC（parse + compile <script setup>）；
 *  2. 源码层断言：格式化使用 stringifyJson（不再 JSON.stringify）；输入/schema 变化推进 runToken；
 *  3. 抽取源码里真实的 formatSchema() 在受控环境执行，验证数值关键字保留；
 *  4. 用 stringifyJson(parseJson(schema).value, 2) 直接验证；对照 JSON.stringify 会产出 raw 包装。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseJson, stringifyJson } from '../app/utils/json.ts'
import { check, eq } from './helpers.mjs'

const projectRoot = process.cwd()

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. SFC 自检
 * ──────────────────────────────────────────────────────────── */
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

const t45src = readFileSync(join(projectRoot, 'app/components/tools/t45-json-schema.vue'), 'utf8')
const parsed = parseSfc(t45src, { filename: 't45-json-schema.vue' })
let compileError = ''
try {
  compileSfcScript(parsed.descriptor, { id: 't45-format-race' })
} catch (e) {
  compileError = e && e.message ? e.message : String(e)
}
cases.push(check('SFC 解析 t45-json-schema.vue 无错误', () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
cases.push(check('SFC 编译 t45 <script setup> 成功', () => !compileError, compileError))

/** 从 SFC 源码抽取真实函数体（执行页面里的实际实现，而不是另写等价模型） */
function extractFnBody(source, name) {
  const re = new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`)
  const m = source.match(re)
  if (!m) throw new Error(`未在源码中找到函数 ${name}()`)
  return m[1]
}

/* ────────────────────────────────────────────────────────────
 * 2. 源码层约束
 * ──────────────────────────────────────────────────────────── */
cases.push(
  check('t45 从 ~/utils/json 导入 stringifyJson', () =>
    /import\s*\{[^}]*\bstringifyJson\b[^}]*\}\s*from\s*['"]~\/utils\/json['"]/.test(t45src)
  )
)
cases.push(
  check('t45 格式化使用 stringifyJson(value, 2)', () => /schemaText\.value\s*=\s*stringifyJson\(value,\s*2\)/.test(t45src))
)
cases.push(
  check('t45 格式化不再用 JSON.stringify(value, null, 2) 直接序列化 parseJson 结果', () => {
    // 允许 inferSchema 产出的普通对象继续用 JSON.stringify，但 formatSchema 里不得再出现
    const body = extractFnBody(t45src, 'formatSchema')
    return !/JSON\.stringify\(value,\s*null,\s*2\)/.test(body)
  })
)

// P2-6：输入 / schema 文本变化推进 runToken（否则在途校验结果会覆盖新输入）
const inputWatchMatch = t45src.match(/watch\(\s*\[doc,\s*schemaText\][\s\S]*?\{ flush: 'sync' \}\s*\)/)
cases.push(
  check('t45 存在对 [doc, schemaText] 的 watch', () => inputWatchMatch !== null, '未找到 watch([doc, schemaText], …)')
)
cases.push(
  check('t45 输入/schema 变化推进 runToken', () =>
    inputWatchMatch !== null && /runToken\s*(?:\+=|=\s*runToken\s*\+|\+\+)/.test(inputWatchMatch[0])
  )
)
cases.push(
  check('t45 输入变化用 flush: sync（载入示例同 tick 改文本后立即校验不被误伤）', () => inputWatchMatch !== null)
)
cases.push(
  check('t45 输入变化后清 busy，避免在途校验作废后按钮永久 loading', () =>
    inputWatchMatch !== null && /busy\.value\s*=\s*false/.test(inputWatchMatch[0])
  )
)
cases.push(
  check('t45 validate 仍在 await 后以 token !== runToken 作废旧结果', () => {
    const body = extractFnBody(t45src, 'validate')
    return /const token = \+\+runToken/.test(body) && /token !== runToken/.test(body)
  })
)

/* ────────────────────────────────────────────────────────────
 * 3. 抽取真实的 formatSchema() 执行（数值关键字保真）
 * ──────────────────────────────────────────────────────────── */
const SCHEMA = `{
  "type": "object",
  "properties": {
    "n": { "type": "integer", "minimum": 1, "maximum": 10, "multipleOf": 2 },
    "s": { "type": "string", "minLength": 2 },
    "big": { "type": "integer", "minimum": 9007199254740993 }
  }
}`

let runFormatSchema = null
let extractError = ''
try {
  runFormatSchema = new Function(
    'parseJson',
    'stringifyJson',
    'schemaText',
    'toast',
    'localizeJsonParseError',
    extractFnBody(t45src, 'formatSchema')
  )
} catch (e) {
  extractError = e && e.message ? e.message : String(e)
}
cases.push(check('可从 t45 源码抽取真实 formatSchema 闭包', () => !extractError && typeof runFormatSchema === 'function', extractError))

function formatWithPage(schemaText) {
  const box = { value: schemaText }
  const toast = { success() {}, warning() {} }
  runFormatSchema(parseJson, stringifyJson, box, toast, (e) => (e && e.message) || String(e))
  return box.value
}

const formatted = formatWithPage(SCHEMA)
cases.push(
  check('格式化保留 minimum/maximum/multipleOf/minLength 数值关键字原文', () => {
    return (
      /"minimum":\s*1\b/.test(formatted) &&
      /"maximum":\s*10\b/.test(formatted) &&
      /"multipleOf":\s*2\b/.test(formatted) &&
      /"minLength":\s*2\b/.test(formatted)
    )
  })
)
cases.push(
  check('格式化不产生 {"raw": …} 包装', () => !/"raw"\s*:/.test(formatted))
)
cases.push(
  check('格式化保留超出安全范围的大整数原文（不被改写 / 科学计数）', () =>
    /"minimum":\s*9007199254740993\b/.test(formatted) && !/9\.007199254740992e\+15/i.test(formatted)
  )
)
cases.push(
  check('格式化输出仍是合法 JSON 且数值关键字为数字类型', () => {
    const back = JSON.parse(formatted)
    return (
      back.properties.n.minimum === 1 &&
      back.properties.n.maximum === 10 &&
      back.properties.n.multipleOf === 2 &&
      back.properties.s.minLength === 2
    )
  })
)

/* ────────────────────────────────────────────────────────────
 * 4. stringifyJson(parseJson(schema).value, 2) 直接验证 + 对照
 * ──────────────────────────────────────────────────────────── */
const viaStringify = stringifyJson(parseJson(SCHEMA).value, 2)
const viaJsonStringify = JSON.stringify(parseJson(SCHEMA).value, null, 2)

cases.push(
  check('stringifyJson 路径保留数值关键字', () =>
    /"minimum":\s*1\b/.test(viaStringify) && /"multipleOf":\s*2\b/.test(viaStringify)
  )
)
cases.push(
  check('对照：JSON.stringify 会把数值关键字写成 {"raw":"1"}（证明修复必要）', () =>
    /"raw"\s*:\s*"1"/.test(viaJsonStringify) && /"raw"\s*:\s*"2"/.test(viaJsonStringify)
  )
)
cases.push(
  eq(
    'stringifyJson 结果可被 JSON.parse 还原为数字',
    JSON.parse(viaStringify).properties.n.minimum,
    1
  )
)
