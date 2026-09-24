/**
 * 盲测 P3 回归（四个小修）：
 *  1. P3-3 `applyYamlRawMap`：占位符编号 ≥ 1,000,000 时 padStart(6) 不再补齐，
 *     固定 `\d{6}zz` 匹配不到会把占位符泄漏到 YAML；改为 `\d+zz` 后正确回填原文。
 *  2. P3-1 t22 `analyzeMerged`：`k in o` 会命中 constructor / toString 等原型成员，
 *     把不存在的字段当成存在并误取到 Object 构造函数；改用 hasOwnProperty 判定。
 *     用 @vue/compiler-sfc 自检，再用 TypeScript transpileModule 去类型后抽取真实函数体执行。
 *  3. P3-4 `usePrefs.persist`：localStorage.setItem 在隐私模式 / 配额满时抛异常，
 *     现在用 try/catch 包裹，写入失败不崩溃。
 *  4. P3-2 t43 JSON→XML：解析失败不再回显 V8 英文，改用 jsonErrorPosition + localizeJsonMessage。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  applyYamlRawMap,
  jsonErrorPosition,
  localizeJsonMessage,
  parseJson,
  RawNumber,
  toYamlJsonable
} from '../app/utils/json.ts'
import { check, eq } from './helpers.mjs'

const projectRoot = process.cwd()
export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. P3-3 applyYamlRawMap 占位符位数
 * ──────────────────────────────────────────────────────────── */
const TOKEN = 'dkraw'

cases.push(
  eq(
    'applyYamlRawMap 6 位编号回填（历史行为不变）',
    applyYamlRawMap('id: dkraw000001zz', TOKEN, new Map([['dkraw000001zz', '9007199254740993']])),
    'id: 9007199254740993'
  )
)
cases.push(
  eq(
    'applyYamlRawMap 7 位编号（≥ 1,000,000）回填',
    applyYamlRawMap('id: dkraw1000000zz', TOKEN, new Map([['dkraw1000000zz', '12345678901234567890']])),
    'id: 12345678901234567890'
  )
)
cases.push(
  eq(
    'applyYamlRawMap 8 位编号回填',
    applyYamlRawMap('n: dkraw12345678zz', TOKEN, new Map([['dkraw12345678zz', '99999999999999999999']])),
    'n: 99999999999999999999'
  )
)
cases.push(
  eq(
    'applyYamlRawMap 不误伤 token 后非「数字+zz」内容',
    applyYamlRawMap('x: dkrawzz', TOKEN, new Map([['dkrawzz', '1']])),
    'x: dkrawzz'
  )
)
cases.push(eq('applyYamlRawMap 空 map 原样返回', applyYamlRawMap('a: 1', TOKEN, new Map()), 'a: 1'))

// 端到端：counter 从 1,000,000 起生成 7 位占位符并回填
{
  const counter = { n: 1_000_000 }
  const rawMap = new Map()
  const unsafe = []
  const jsonable = toYamlJsonable(parseJson('{"id":12345678901234567890}').value, TOKEN, counter, rawMap, unsafe, '$')
  const ph = jsonable.id
  cases.push(check('toYamlJsonable 编号 ≥ 1e6 时生成 7 位占位符', () => ph === 'dkraw1000000zz', `实际 ${ph}`))
  const out = applyYamlRawMap(`id: ${ph}`, TOKEN, rawMap)
  cases.push(
    check('端到端：≥ 1e6 的占位符被回填为原文（不泄漏 zz）', () => out === 'id: 12345678901234567890', out)
  )
}

/* ────────────────────────────────────────────────────────────
 * SFC 自检工具
 * ──────────────────────────────────────────────────────────── */
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

function sfcCheck(label, src, filename) {
  const parsed = parseSfc(src, { filename })
  let compileError = ''
  try {
    compileSfcScript(parsed.descriptor, { id: label })
  } catch (e) {
    compileError = e && e.message ? e.message : String(e)
  }
  cases.push(check(`SFC 解析 ${filename} 无错误`, () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
  cases.push(check(`SFC 编译 ${filename} <script setup> 成功`, () => !compileError, compileError))
}

/** 从 startMarker 起按括号配平截取整段（跳过字符串 / 模板 / 注释里的括号） */
function extractBalanced(src, startMarker) {
  const start = src.indexOf(startMarker)
  if (start < 0) throw new Error(`未找到 ${startMarker}`)
  let i = src.indexOf('{', start)
  if (i < 0) throw new Error(`${startMarker} 后没有 {`)
  let depth = 0
  let state = 'code'
  for (; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line'
        i++
      } else if (c === '/' && n === '*') {
        state = 'block'
        i++
      } else if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      else if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return src.slice(start, i + 1)
      }
    } else if (state === 'line') {
      if (c === '\n') state = 'code'
    } else if (state === 'block') {
      if (c === '*' && n === '/') {
        state = 'code'
        i++
      }
    } else if (state === 'sq') {
      if (c === '\\') i++
      else if (c === "'") state = 'code'
    } else if (state === 'dq') {
      if (c === '\\') i++
      else if (c === '"') state = 'code'
    } else if (state === 'tpl') {
      if (c === '\\') i++
      else if (c === '`') state = 'code'
    }
  }
  throw new Error(`${startMarker} 括号不配平`)
}

/* ────────────────────────────────────────────────────────────
 * 2. P3-1 t22 analyzeMerged 原型链
 * ──────────────────────────────────────────────────────────── */
const t22src = readFileSync(join(projectRoot, 'app/components/tools/t22-json2java.vue'), 'utf8')
sfcCheck('t22-p3', t22src, 't22-json2java.vue')

cases.push(
  check(
    't22 analyzeMerged 用 Object.prototype.hasOwnProperty.call(o, k) 判定字段存在',
    () => /Object\.prototype\.hasOwnProperty\.call\(o,\s*k\)/.test(t22src)
  )
)
cases.push(
  check(
    't22 analyzeMerged 不再用 `k in o` 过滤（旧的 present 表达式已消失）',
    () => !/const\s+present\s*=\s*objs\.filter\(\(o\)\s*=>\s*k\s+in\s+o\)/.test(t22src)
  )
)

// 用 TypeScript 去类型后抽取真实函数体（isLegalIdent … analyzeMerged）
let analyzeApi = null
let t22ExtractErr = ''
try {
  const constStart = t22src.indexOf('const JAVA_KEYWORDS')
  const wrappersStart = t22src.indexOf('const WRAPPERS')
  const wrappersEnd = t22src.indexOf('\n', wrappersStart)
  const consts = t22src.slice(constStart, wrappersEnd)
  const fnBlock = t22src.slice(
    t22src.indexOf('function isLegalIdent('),
    t22src.indexOf('/* ---------------- 代码生成')
  )
  const tsSource = `${consts}\n${fnBlock}\nreturn { analyzeMerged, analyzeObject, resolveElements };\n`
  const tsEntry = join(projectRoot, 'node_modules', 'typescript', 'lib', 'typescript.js')
  const tsMod = await import(pathToFileURL(tsEntry).href)
  const ts = tsMod.default ?? tsMod
  const js = ts.transpileModule(tsSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None }
  }).outputText
  analyzeApi = new Function('RawNumber', 'overrides', 'naming', 'decimalType', js)(
    RawNumber,
    { value: {} },
    { value: 'keep' },
    { value: 'double' }
  )
} catch (e) {
  t22ExtractErr = e && e.message ? e.message : String(e)
}

cases.push(
  check('可从 t22 源码抽取 analyzeMerged 并构建执行环境', () => !t22ExtractErr && typeof analyzeApi?.analyzeMerged === 'function', t22ExtractErr)
)

if (analyzeApi) {
  const { value: arr } = parseJson('[{"constructor":1},{"a":2}]')
  const ctx = { warnings: [], uncertains: [], usedClassNames: new Set() }
  const cls = analyzeApi.analyzeMerged(arr, 'Item', '$', ctx)
  const fieldOf = (name) => cls.fields.find((f) => f.jsonKey === name)

  cases.push(
    check(
      'analyzeMerged 对 [{"constructor":1},{"a":2}] 把 constructor 当自有 int（Integer）',
      () => fieldOf('constructor')?.type === 'Integer',
      JSON.stringify(cls.fields)
    )
  )
  cases.push(
    check(
      'analyzeMerged constructor 不再因继承成员被误判为 Object',
      () => fieldOf('constructor')?.type !== 'Object',
      JSON.stringify(fieldOf('constructor'))
    )
  )
  cases.push(
    check(
      'analyzeMerged 不产生 constructor 类型不一致告警',
      () => !ctx.warnings.some((w) => w.includes('constructor') && w.includes('不一致')),
      JSON.stringify(ctx.warnings)
    )
  )
  cases.push(check('analyzeMerged a 字段为 Integer（缺失→包装类型）', () => fieldOf('a')?.type === 'Integer'))

  // 正常输入回归
  const { value: arr2 } = parseJson('[{"x":1},{"y":"s"}]')
  const ctx2 = { warnings: [], uncertains: [], usedClassNames: new Set() }
  const cls2 = analyzeApi.analyzeMerged(arr2, 'Item', '$', ctx2)
  cases.push(
    check(
      'analyzeMerged 普通并集字段类型不变',
      () =>
        cls2.fields.find((f) => f.jsonKey === 'x')?.type === 'Integer' &&
        cls2.fields.find((f) => f.jsonKey === 'y')?.type === 'String'
    )
  )
}

/* ────────────────────────────────────────────────────────────
 * 3. P3-4 usePrefs.persist 容错
 * ──────────────────────────────────────────────────────────── */
const prefsSrc = readFileSync(join(projectRoot, 'app/composables/usePrefs.ts'), 'utf8')

cases.push(
  check(
    'usePrefs.persist 用 try/catch 包裹 localStorage.setItem',
    () =>
      /function persist\(\)\s*\{[\s\S]*?try\s*\{[\s\S]*?localStorage\.setItem\(STORAGE_KEY[\s\S]*?\}\s*catch/.test(prefsSrc)
  )
)

let runPersist = null
let persistExtractErr = ''
try {
  const fn = extractBalanced(prefsSrc, 'function persist(')
  const body = fn.replace(/^function persist\([^)]*\)\s*\{/, '').replace(/\}\s*$/, '')
  const code = body.replace(/import\.meta\.server/g, 'false')
  runPersist = new Function('localStorage', 'prefs', 'STORAGE_KEY', code)
} catch (e) {
  persistExtractErr = e && e.message ? e.message : String(e)
}

cases.push(
  check('可从 usePrefs 抽取 persist 函数体构建执行环境', () => !persistExtractErr && typeof runPersist === 'function', persistExtractErr)
)

if (runPersist) {
  const calls = []
  const okLS = { setItem: (k, v) => calls.push([k, v]) }
  runPersist(okLS, { value: { theme: 'dark' } }, 'devkit.prefs.v1')
  cases.push(
    check(
      'persist 正常时写入 localStorage（key/value 正确）',
      () => calls.length === 1 && calls[0][0] === 'devkit.prefs.v1' && JSON.parse(calls[0][1]).theme === 'dark',
      JSON.stringify(calls)
    )
  )

  const throwingLS = {
    setItem() {
      throw new Error('QuotaExceededError')
    }
  }
  let threw = false
  try {
    runPersist(throwingLS, { value: { theme: 'dark' } }, 'devkit.prefs.v1')
  } catch {
    threw = true
  }
  cases.push(check('persist 在 setItem 抛异常时静默失败、不向外抛', () => !threw))
}

/* ────────────────────────────────────────────────────────────
 * 4. P3-2 t43 JSON→XML 错误中文化
 * ──────────────────────────────────────────────────────────── */
const t43src = readFileSync(join(projectRoot, 'app/components/tools/t43-xml-toolbox.vue'), 'utf8')
sfcCheck('t43-p3', t43src, 't43-xml-toolbox.vue')

cases.push(
  check(
    't43 从 ~/utils/json 引入 jsonErrorPosition 与 localizeJsonMessage',
    () => /import\s*\{[^}]*jsonErrorPosition[^}]*\}\s*from\s*['"]~\/utils\/json['"]/.test(t43src) &&
      /import\s*\{[^}]*localizeJsonMessage[^}]*\}\s*from\s*['"]~\/utils\/json['"]/.test(t43src)
  )
)
cases.push(
  check(
    't43 JSON→XML 分支用 jsonErrorPosition(e, input.value) 定位',
    () => /jsonErrorPosition\(e,\s*input\.value\)/.test(t43src)
  )
)
cases.push(
  check(
    't43 回退用 localizeJsonMessage(errMessage(e)) 输出中文',
    () => /localizeJsonMessage\(errMessage\(e\)\)/.test(t43src)
  )
)
cases.push(
  check(
    't43 catch 内按 direction === json2xml 分支给出「JSON 解析失败」中文定位',
    () =>
      /direction\.value === 'json2xml'/.test(t43src) &&
      /JSON 解析失败：第 \$\{pos\.line\} 行第 \$\{pos\.column\} 列附近：\$\{pos\.message\}/.test(t43src)
  )
)

// 支撑性回归：jsonErrorPosition + localizeJsonMessage 本身确实产出中文定位
{
  const badJson = '{"a":1,}'
  let caught = null
  try {
    JSON.parse(badJson)
  } catch (e) {
    caught = e
  }
  const pos = caught ? jsonErrorPosition(caught, badJson) : null
  cases.push(
    check(
      'jsonErrorPosition 给出中文 message 与行号',
      () => !!pos && /[\u4e00-\u9fa5]/.test(pos.message) && pos.line === 1 && !/Expected/.test(pos.message),
      JSON.stringify(pos)
    )
  )
  cases.push(
    check(
      'localizeJsonMessage 不泄漏 V8 英文（Expected / Unexpected）',
      () => {
        const msg = localizeJsonMessage(caught ? caught.message : '')
        return /[\u4e00-\u9fa5]/.test(msg) && !/Expected|Unexpected/.test(msg)
      }
    )
  )
}
