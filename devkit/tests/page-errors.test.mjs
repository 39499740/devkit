/**
 * 页面错误中文化回归（P1-1 / W2 / P2-5）：
 *
 * 1. P1-1（T25 去正则）：t25-stack-trace.vue 的「业务包前缀」不再编译用户可控正则，
 *    改为按逗号/空白分隔的字面前缀做 startsWith/包含匹配——用 @vue/compiler-sfc 自检编译，
 *    并从源码抽取真实的 parseBizPrefixes / isBusinessFrame 函数体执行（测页面实际实现）。
 * 2. W2（T44/T45 JSON 语法错误中文化）：JSON.parse 失败改用 jsonErrorPosition + localizeJsonMessage，
 *    展示「第 X 行第 Y 列附近：<中文>」，不再回显 V8 英文；求值异常也中文兜底。
 *    同样自检编译并抽取真实函数体验证。T45 超时/异常时状态栏显示「已中断」，不残留「耗时 0 ms」。
 * 3. P2-5（executors/text.ts 深层嵌套中文化）：jsonpath / jmespath 求值异常若含
 *    「Maximum call stack」→ 中文「嵌套层级过深…」；已有中文错误不被吞掉。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { jsonErrorPosition, localizeJsonMessage } from '../app/utils/json.ts'
import { errMessage } from '../app/utils/errors.ts'
import { check, eq } from './helpers.mjs'

// 测试运行器把用例打包到 /tmp，import.meta.url 不可靠；npm/隔离运行器都以 devkit 为 cwd
const projectRoot = process.cwd()
const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. P2-5：executors/text.ts 深层嵌套中文化
 * ──────────────────────────────────────────────────────────── */
async function buildExecutorCases() {
  // JSONPath：6000 层括号的过滤表达式会触发 RangeError: Maximum call stack size exceeded
  const deepJp = '$[?(' + '('.repeat(6000) + '@.a' + ')'.repeat(6000) + ')]'
  const jp = await runStep(createStep('jsonpath', { expr: deepJp }), '[{"a":1}]', 0)
  cases.push(
    check('jsonpath 深层嵌套失败且为中文、不含 Maximum call stack', () => {
      const note = String(jp.note)
      return jp.status === 'fail' && hasChinese(note) && !/Maximum call stack/i.test(note)
    })
  )
  cases.push(
    check('jsonpath 深层嵌套给出「嵌套层级过深」中文提示', () => /嵌套层级过深/.test(String(jp.note)))
  )

  // JMESPath：6000 层括号同样触发 RangeError
  const deepJm = '('.repeat(6000) + '@' + ')'.repeat(6000)
  const jm = await runStep(createStep('jmespath', { expr: deepJm }), '[{"a":1}]', 0)
  cases.push(
    check('jmespath 深层嵌套失败且为中文、不含 Maximum call stack', () => {
      const note = String(jm.note)
      return jm.status === 'fail' && hasChinese(note) && !/Maximum call stack/i.test(note)
    })
  )
  cases.push(
    check('jmespath 深层嵌套给出「嵌套层级过深」中文提示', () => /嵌套层级过深/.test(String(jm.note)))
  )

  // 已有中文错误不被吞掉（回归：不能把所有错误都映射成中性兜底）
  const jpSyntax = await runStep(createStep('jsonpath', { expr: 'store.book' }), '[{"a":1}]', 0)
  cases.push(
    check('jsonpath 已有中文错误原样保留（不吞掉）', () => jpSyntax.status === 'fail' && /必须以 \$ 开头/.test(String(jpSyntax.note)))
  )
}
await buildExecutorCases()

/* ────────────────────────────────────────────────────────────
 * 2. 组件级：@vue/compiler-sfc 自检 + 抽取真实函数体
 * ──────────────────────────────────────────────────────────── */
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

/** 读取 SFC 源码，自检解析 + 编译 <script setup>，返回源码与编译错误 */
function readSfc(rel) {
  const src = readFileSync(join(projectRoot, rel), 'utf8')
  const parsed = parseSfc(src, { filename: rel })
  let compileError = ''
  try {
    compileSfcScript(parsed.descriptor, { id: 'page-errors-' + rel })
  } catch (e) {
    compileError = e && e.message ? e.message : String(e)
  }
  return { src, parsed, compileError }
}

/** 从 SFC 源码抽取真实函数体（执行页面里的实际实现，而不是另写等价模型） */
function extractFnBody(source, name) {
  const re = new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`)
  const m = source.match(re)
  if (!m) throw new Error(`未在源码中找到函数 ${name}()`)
  return m[1]
}

/* ── T25：业务包前缀去正则 ── */
const t25 = readSfc('app/components/tools/t25-stack-trace.vue')
cases.push(check('SFC 解析 t25-stack-trace.vue 无错误', () => t25.parsed.errors.length === 0, JSON.stringify(t25.parsed.errors)))
cases.push(check('SFC 编译 t25 <script setup> 成功', () => !t25.compileError, t25.compileError))
cases.push(check('T25 源码不再出现 new RegExp', () => !/new RegExp/.test(t25.src)))
cases.push(
  check('T25 文案已从「正则」改为「字面匹配」', () =>
    /业务包前缀（字面匹配）/.test(t25.src) && !/业务包前缀（正则）/.test(t25.src) && !/支持正则/.test(t25.src)
  )
)

const parseBizPrefixes = new Function('raw', extractFnBody(t25.src, 'parseBizPrefixes'))
const isBusinessFrame = new Function('fqcn', 'prefixes', extractFnBody(t25.src, 'isBusinessFrame'))

cases.push(eq('T25 parseBizPrefixes 按逗号/空白拆分并去空', parseBizPrefixes('com.a, org.b  com.c'), ['com.a', 'org.b', 'com.c']))
cases.push(eq('T25 空前缀解析为空数组', parseBizPrefixes('   '), []))
cases.push(check('T25 字面前缀 startsWith 命中业务帧', () => isBusinessFrame('com.example.order.OrderService', ['com.example.']) === true))
cases.push(check('T25 字面前缀包含命中业务帧', () => isBusinessFrame('com.foo.com.example.Bar', ['com.example.']) === true))
cases.push(check('T25 不匹配前缀归为非业务帧', () => isBusinessFrame('org.springframework.Foo', ['com.example.']) === false))
cases.push(check('T25 空前缀不匹配任何帧', () => isBusinessFrame('com.example.A', parseBizPrefixes('')) === false))
cases.push(
  check('T25 点号按字面处理（不再当正则通配）', () => isBusinessFrame('comXexampleY', ['com.example.']) === false)
)
cases.push(
  check('T25 危险正则字面量只作字面匹配、不编译', () => isBusinessFrame('^(a+)+$ literal', ['^(a+)+$']) === true)
)

/* ── T44：JSONPath / JMESPath 错误中文化 ── */
const t44 = readSfc('app/components/tools/t44-jsonpath-query.vue')
cases.push(check('SFC 解析 t44-jsonpath-query.vue 无错误', () => t44.parsed.errors.length === 0, JSON.stringify(t44.parsed.errors)))
cases.push(check('SFC 编译 t44 <script setup> 成功', () => !t44.compileError, t44.compileError))
cases.push(check('T44 使用 jsonErrorPosition + localizeJsonMessage', () => /jsonErrorPosition/.test(t44.src) && /localizeJsonMessage/.test(t44.src)))
cases.push(check('T44 不再把英文 errMessage(e) 直接交给 markFail', () => !/markFail\(errMessage\(e\)\)/.test(t44.src) && !/toast\.warning\(errMessage\(e\)\)/.test(t44.src)))

const t44Parse = new Function(
  'e',
  'text',
  'jsonErrorPosition',
  'localizeJsonMessage',
  'errMessage',
  extractFnBody(t44.src, 'localizeJsonParseError')
)
const t44Eval = new Function('e', 'errMessage', extractFnBody(t44.src, 'localizeQueryError'))

cases.push(
  check('T44 JSON 语法错误给出「第 X 行第 Y 列附近」中文', () => {
    const out = t44Parse(new Error("Expected property name or '}' in JSON at position 1"), '{}', jsonErrorPosition, localizeJsonMessage, errMessage)
    return /JSON 解析失败：第 \d+ 行第 \d+ 列附近：/.test(out) && hasChinese(out) && !/Expected property name/.test(out)
  })
)
cases.push(
  check('T44 无位置信息的 JSON 错误也中文兜底', () => {
    const out = t44Parse(new Error('Unexpected end of JSON input'), '{', jsonErrorPosition, localizeJsonMessage, errMessage)
    return /JSON 解析失败：/.test(out) && hasChinese(out) && !/Unexpected end/.test(out)
  })
)
cases.push(check('T44 求值栈溢出中文化', () => /嵌套层级过深/.test(t44Eval(new RangeError('Maximum call stack size exceeded'), errMessage))))
cases.push(check('T44 已有中文求值错误原样保留', () => t44Eval(new Error('必须以 $ 开头'), errMessage) === '必须以 $ 开头'))
cases.push(
  check('T44 其它英文求值错误映射为中性中文', () => {
    const out = t44Eval(new Error('boom engine failure'), errMessage)
    return hasChinese(out) && !/boom|engine/.test(out)
  })
)

/* ── T45：JSON Schema 错误中文化 + 中断不残留耗时 ── */
const t45 = readSfc('app/components/tools/t45-json-schema.vue')
cases.push(check('SFC 解析 t45-json-schema.vue 无错误', () => t45.parsed.errors.length === 0, JSON.stringify(t45.parsed.errors)))
cases.push(check('SFC 编译 t45 <script setup> 成功', () => !t45.compileError, t45.compileError))
cases.push(check('T45 使用 jsonErrorPosition + localizeJsonMessage', () => /jsonErrorPosition/.test(t45.src) && /localizeJsonMessage/.test(t45.src)))
cases.push(check('T45 不再把英文 errMessage(e) 直接交给 markFail', () => !/markFail\(errMessage\(e\)\)/.test(t45.src) && !/toast\.warning\(errMessage\(e\)\)/.test(t45.src)))
cases.push(check('T45 超时/异常显示「已中断」且不残留「耗时 0 ms」', () => /已中断/.test(t45.src) && /interrupted/.test(t45.src)))

const t45Parse = new Function(
  'e',
  'text',
  'what',
  'jsonErrorPosition',
  'localizeJsonMessage',
  'errMessage',
  extractFnBody(t45.src, 'localizeJsonParseError')
)
const t45Eval = new Function('e', 'errMessage', extractFnBody(t45.src, 'localizeEvalError'))

cases.push(
  check('T45 Schema 语法错误给出中文定位', () => {
    const out = t45Parse(new Error("Expected ',' or '}' after property value in JSON at position 5"), '{"a":1', 'JSON Schema', jsonErrorPosition, localizeJsonMessage, errMessage)
    return /JSON Schema 解析失败：第 \d+ 行第 \d+ 列附近：/.test(out) && hasChinese(out) && !/Expected/.test(out)
  })
)
cases.push(check('T45 求值栈溢出中文化', () => /嵌套层级过深/.test(t45Eval(new RangeError('Maximum call stack size exceeded'), errMessage))))
cases.push(check('T45 已有中文错误原样保留', () => t45Eval(new Error('Schema 必须是对象或布尔值'), errMessage) === 'Schema 必须是对象或布尔值'))
