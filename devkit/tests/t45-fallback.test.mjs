/**
 * t45「JSON Schema 校验」同步回退与 Worker 分支语义一致性回归。
 *
 * 背景（盲测 P3-1）：t45 的 Worker 分支把原文交给 compute.worker.ts
 * （parseJson → RawNumber），而同步 fallback 曾用
 * `validateInstance(toPlainJson(instance), toPlainJson(schema), …)`，
 * toPlainJson 会把超出安全范围的整数降级为字符串 → 同一输入两条路径结论不同
 * （Worker valid / fallback invalid）。只在 Worker 构造失败（CSP 等）时暴露。
 *
 * 测试策略（参考 t24-yaml-budget.test.mjs / page-errors.test.mjs）：
 *  1. @vue/compiler-sfc 自检 t45 SFC（parse + compile <script setup>）；
 *  2. 源码层断言 fallback 直接调用 validateInstance(instance, schema, …)，不再包 toPlainJson；
 *  3. 抽取源码里真实的 fallback 箭头闭包，在受控环境执行（而非另写等价模型）；
 *  4. 用等价方式模拟 Worker 分支（parseJson → validateInstance），验证大整数 / 数值关键字
 *     与普通校验在两条路径下结论一致；
 *  5. 普通校验（通过 / 失败 / strict 透传）回归。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseJson, toPlainJson } from '../app/utils/json.ts'
import { validateInstance } from '../app/utils/jsonschema.ts'
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
  compileSfcScript(parsed.descriptor, { id: 't45-fallback' })
} catch (e) {
  compileError = e && e.message ? e.message : String(e)
}
cases.push(check('SFC 解析 t45-json-schema.vue 无错误', () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
cases.push(check('SFC 编译 t45 <script setup> 成功', () => !compileError, compileError))

/* ────────────────────────────────────────────────────────────
 * 2. 源码层约束：fallback 直接用 parseJson 结果（RawNumber）
 * ──────────────────────────────────────────────────────────── */
// runComputation 的同步回退箭头：() => validateInstance(instance, schema, { strict: useStrict })
const fallbackArrowMatch = t45src.match(
  /\(\)\s*=>\s*validateInstance\(instance,\s*schema,\s*\{\s*strict:\s*useStrict\s*\}\)/
)
cases.push(
  check(
    't45 同步 fallback 直接 validateInstance(instance, schema, …)',
    () => fallbackArrowMatch !== null,
    '未在源码中找到预期的 fallback 箭头（可能又被 toPlainJson 包裹）'
  )
)
cases.push(
  check('t45 同步 fallback 不再对 instance / schema 调用 toPlainJson', () => {
    return !/toPlainJson\(instance\)/.test(t45src) && !/toPlainJson\(schema\)/.test(t45src)
  })
)
cases.push(
  check('t45 解析仍走 parseJsonLocalized（保留 RawNumber）', () =>
    /parseJsonLocalized\(instanceText/.test(t45src) && /parseJsonLocalized\(currentSchema/.test(t45src)
  )
)

/* ────────────────────────────────────────────────────────────
 * 3. 抽取真实的 fallback 闭包并在受控环境执行
 * ──────────────────────────────────────────────────────────── */
let makeFallback = null
let extractError = ''
try {
  makeFallback = new Function(
    'instance',
    'schema',
    'useStrict',
    'validateInstance',
    `return (${fallbackArrowMatch ? fallbackArrowMatch[0] : 'undefined'});`
  )
} catch (e) {
  extractError = e && e.message ? e.message : String(e)
}
cases.push(check('可从 t45 源码抽取真实 fallback 闭包', () => !extractError && typeof makeFallback === 'function', extractError))

/** 执行 t45 的同步回退（与页面一致：先 parseJson 保留 RawNumber，再调用抽取出的箭头） */
function runFallback(instanceText, schemaText, strict = true) {
  const { value: instance } = parseJson(instanceText)
  const { value: schema } = parseJson(schemaText)
  return makeFallback(instance, schema, strict, validateInstance)()
}

/** 等价模拟 compute.worker.ts 的 validate 分支（parseJson 原文 → validateInstance） */
function runWorker(instanceText, schemaText, strict = true) {
  const instance = parseJson(instanceText).value
  const schema = parseJson(schemaText).value
  return validateInstance(instance, schema, { strict })
}

/* ── 3.1 关键回归：2^53+1 大整数 type:integer ── */
const BIG_INSTANCE = '{"id":9007199254740993}'
const BIG_SCHEMA = '{"type":"object","properties":{"id":{"type":"integer"}}}'
const bigFallback = runFallback(BIG_INSTANCE, BIG_SCHEMA)
const bigWorker = runWorker(BIG_INSTANCE, BIG_SCHEMA)

cases.push(
  check('fallback 对 2^53+1 保留 RawNumber：type:integer 判定为 valid', () => bigFallback.valid === true, JSON.stringify(bigFallback.errors))
)
cases.push(check('Worker 分支对同一输入同样 valid', () => bigWorker.valid === true))
cases.push(
  check('大整数：两条路径结论一致（P3-1 修复）', () =>
    bigFallback.valid === bigWorker.valid && bigFallback.errors.length === bigWorker.errors.length
  )
)
// 记录被修复的行为：旧实现 toPlainJson 会降级为字符串而被判 invalid
const bigPlain = validateInstance(
  toPlainJson(parseJson(BIG_INSTANCE).value),
  toPlainJson(parseJson(BIG_SCHEMA).value),
  { strict: true }
)
cases.push(
  check('对照：旧 toPlainJson 路径确实误判为 invalid（证明修复必要）', () => bigPlain.valid === false)
)

/* ── 3.2 数值关键字（minimum）精度一致 ── */
const MIN_SCHEMA = '{"type":"object","properties":{"n":{"type":"integer","minimum":9007199254740994}}}'
const minInvalidFb = runFallback('{"n":9007199254740993}', MIN_SCHEMA)
const minInvalidWk = runWorker('{"n":9007199254740993}', MIN_SCHEMA)
cases.push(
  check('大整数 minimum：低于下界判 invalid（fallback）', () => minInvalidFb.valid === false && minInvalidFb.errors.length > 0)
)
cases.push(check('大整数 minimum：两路径结论一致', () => minInvalidFb.valid === minInvalidWk.valid))
cases.push(check('大整数 minimum 恰好相等判 valid', () => runFallback('{"n":9007199254740993}', '{"type":"object","properties":{"n":{"type":"integer","minimum":9007199254740993}}}').valid === true))

/* ── 3.3 超长整数（> long）同样不被降级 ── */
const HUGE_INSTANCE = '{"id":12345678901234567890}'
cases.push(
  check('20 位整数：fallback 与 Worker 结论一致且 valid', () => {
    const fb = runFallback(HUGE_INSTANCE, BIG_SCHEMA)
    const wk = runWorker(HUGE_INSTANCE, BIG_SCHEMA)
    return fb.valid === true && wk.valid === true
  })
)

/* ────────────────────────────────────────────────────────────
 * 4. 普通校验回归（行为不变）
 * ──────────────────────────────────────────────────────────── */
const OK_INSTANCE = '{"name":"张三","age":28,"tags":["vip"]}'
const OK_SCHEMA =
  '{"type":"object","required":["name"],"properties":{"name":{"type":"string"},"age":{"type":"integer"},"tags":{"type":"array"}}}'
cases.push(check('普通对象校验通过（fallback）', () => runFallback(OK_INSTANCE, OK_SCHEMA).valid === true))
cases.push(check('普通对象校验：fallback 与 Worker 一致', () => runFallback(OK_INSTANCE, OK_SCHEMA).valid === runWorker(OK_INSTANCE, OK_SCHEMA).valid))

const BAD_INSTANCE = '{"name":"张三","age":1.5}'
const badFb = runFallback(BAD_INSTANCE, OK_SCHEMA)
const badWk = runWorker(BAD_INSTANCE, OK_SCHEMA)
cases.push(
  check('普通类型错误校验失败且带 type 关键字', () => {
    return badFb.valid === false && badFb.errors.length > 0 && badFb.errors.some((e) => e.keyword === 'type')
  })
)
cases.push(check('普通类型错误：两路径错误数一致', () => badFb.errors.length === badWk.errors.length))

cases.push(
  eq(
    '缺失必填项报 required',
    runFallback('{"age":28}', OK_SCHEMA).errors.some((e) => e.keyword === 'required'),
    true
  )
)

/* strict 透传：抽取出的闭包把 useStrict 传给 validateInstance（format 提示行为） */
const FORMAT_INSTANCE = '{"email":"not-an-email"}'
const FORMAT_SCHEMA = '{"type":"object","properties":{"email":{"type":"string","format":"email"}}}'
cases.push(
  check('strict 透传：严格模式把 format 当错误、宽松模式仅告警', () => {
    const strictFb = runFallback(FORMAT_INSTANCE, FORMAT_SCHEMA, true)
    const looseFb = runFallback(FORMAT_INSTANCE, FORMAT_SCHEMA, false)
    const strictWk = runWorker(FORMAT_INSTANCE, FORMAT_SCHEMA, true)
    const looseWk = runWorker(FORMAT_INSTANCE, FORMAT_SCHEMA, false)
    return (
      strictFb.valid === strictWk.valid &&
      looseFb.valid === looseWk.valid &&
      strictFb.warnings.length === strictWk.warnings.length
    )
  })
)
