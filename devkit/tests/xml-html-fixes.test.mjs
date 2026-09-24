/**
 * F8 / F10 修复回归。
 *
 * 背景（已实证）：
 * - F8（P2）：utils/xml.ts 的 jsonToXml 对顶层数组逐个用同一 rootName 写出，
 *   生成多个根元素（非法 XML），而 warnings 却说「已用 <root> 包裹，每个元素生成一个 <item>」。
 * - F10（P2）：t32-html-format.vue 在每个非自闭合标签处 src.toLowerCase().indexOf(...)，
 *   每次 O(n)，标签数 m → O(n·m)，浅层兄弟标签多时主线程同步卡顿。
 *
 * Node 没有 DOMParser，jsonToXml 是纯字符串生成可直接测。
 * t32 是 SFC：用 @vue/compiler-sfc 自检，再把 formatHtml 及其依赖抽出来（esbuild 去类型）
 * 做行为等价与复杂度回归（统计「对整段 src 调 toLowerCase」的次数，确定性、不依赖计时）。
 * 动态 import 用运行时表达式，避免 esbuild 把 compiler-sfc / esbuild 及其可选依赖打进包。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { check, eq } from './helpers.mjs'
import { jsonToXml } from '../app/utils/xml.ts'

// 测试运行器把用例打包到 /tmp，import.meta.url 不可靠；npm/隔离运行器都以 devkit 为 cwd
const projectRoot = process.cwd()

export const cases = []

/* ───────────────────────── F8：jsonToXml 顶层数组 ───────────────────────── */

/** 极简 XML 良构检查（无 DOMParser）：返回是否良构 + 顶层根元素个数 */
function xmlShape(xml) {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  const tagRe = /<([!?/]?)([^\s/>]+)([^>]*?)(\/?)>/g
  const stack = []
  let rootCount = 0
  let m
  while ((m = tagRe.exec(body))) {
    const kind = m[1]
    const name = m[2]
    const selfClose = m[4] === '/'
    if (kind === '!' || kind === '?') continue
    if (kind === '/') {
      if (stack.pop() !== name) return { ok: false, rootCount, reason: `闭合标签不匹配 </${name}>` }
    } else if (selfClose) {
      if (!stack.length) rootCount += 1
    } else {
      if (!stack.length) rootCount += 1
      stack.push(name)
    }
  }
  return { ok: stack.length === 0, rootCount, reason: stack.length ? '存在未闭合标签' : '' }
}

const arr = jsonToXml([{ a: 1 }, { a: 2 }], 'root')

cases.push(
  eq(
    'F8 顶层数组：单一根 <root>，元素为 <item>（精确输出）',
    arr.xml,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<root>',
      '  <item>',
      '    <a>1</a>',
      '  </item>',
      '  <item>',
      '    <a>2</a>',
      '  </item>',
      '</root>'
    ].join('\n')
  )
)
cases.push(
  check('F8 顶层数组：输出良构且只有一个根元素', () => {
    const s = xmlShape(arr.xml)
    return s.ok && s.rootCount === 1
  })
)
cases.push(check('F8 顶层数组：不再出现多个 <root> 根', () => (arr.xml.match(/<root>/g) ?? []).length === 1))
cases.push(check('F8 顶层数组：每个元素生成一个 <item>', () => (arr.xml.match(/<item>/g) ?? []).length === 2))
cases.push(
  eq('F8 顶层数组：warning 文案与输出一致', arr.warnings, [
    '顶层是数组，已用 <root> 包裹，每个元素生成一个 <item>'
  ])
)
cases.push(
  check('F8 顶层数组：warning 提到的 <root>/<item> 都真实出现在输出里', () => {
    const w = arr.warnings[0] ?? ''
    return w.includes('<root>') && w.includes('<item>') && arr.xml.includes('<root>') && arr.xml.includes('<item>')
  })
)

// 空数组
const emptyArr = jsonToXml([], 'root')
cases.push(
  check('F8 空数组：单一自闭合根 <root/>', () => emptyArr.xml.endsWith('<root/>') && xmlShape(emptyArr.xml).rootCount === 1)
)
cases.push(eq('F8 空数组：同样给出包裹提示', emptyArr.warnings.length, 1))

// 标量数组
const primArr = jsonToXml([1, 'x', null], 'root')
cases.push(
  check('F8 标量数组：三个 <item>，含自闭合空值', () => {
    const items = primArr.xml.match(/<item(?:\/>|>)/g) ?? []
    return (
      items.length === 3 &&
      primArr.xml.includes('<item>1</item>') &&
      primArr.xml.includes('<item>x</item>') &&
      primArr.xml.includes('<item/>')
    )
  })
)
cases.push(check('F8 标量数组：输出良构', () => xmlShape(primArr.xml).ok))

// 自定义 rootName：warning 应反映实际根名
const customArr = jsonToXml([{ a: 1 }], 'catalog')
cases.push(
  check('F8 自定义 rootName：外层用 <catalog>，元素仍为 <item>', () =>
    customArr.xml.includes('<catalog>') && customArr.xml.includes('</catalog>') && customArr.xml.includes('<item>')
  )
)
cases.push(
  check('F8 自定义 rootName：warning 不再硬编码 <root>', () =>
    customArr.warnings[0].includes('<catalog>') && !customArr.warnings[0].includes('<root>')
  )
)

// 对象输入回归：既有行为不变，且不误报数组提示
cases.push(
  eq(
    'F8 回归 对象输入（默认 root）精确输出不变',
    jsonToXml({ a: 1 }).xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <a>1</a>\n</root>'
  )
)
cases.push(eq('F8 回归 对象输入无数组 warning', jsonToXml({ a: 1 }).warnings, []))
cases.push(
  check('F8 回归 属性与 #text', () => jsonToXml({ '@id': '1', '#text': 'hi' }).xml.includes('<root id="1">hi</root>'))
)
cases.push(
  check('F8 回归 对象内数组仍是重复同名子元素（不套 item）', () => {
    const xml = jsonToXml({ a: [1, 2] }).xml
    return (xml.match(/<a>/g) ?? []).length === 2 && !xml.includes('<item>')
  })
)
cases.push(check('F8 回归 对象输入的根名仍由 rootName 决定', () => jsonToXml({ a: 1 }, 'data').xml.includes('<data>')))

/* ───────────────────────── F10：t32 组件级 ───────────────────────── */

const sfcPath = join(projectRoot, 'app', 'components', 'tools', 't32-html-format.vue')
const source = readFileSync(sfcPath, 'utf8')

// 动态 import（参数为运行时表达式）避免 esbuild 打包 compiler-sfc 的可选模板引擎依赖
const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript
const compileSfcTemplate = sfcCompiler.compileTemplate ?? sfcCompiler.default.compileTemplate

const parsed = parseSfc(source, { filename: 't32-html-format.vue' })
cases.push(check('F10 SFC 解析无错误', () => parsed.errors.length === 0, JSON.stringify(parsed.errors)))
cases.push(check('F10 SFC 含 <script setup>', () => !!parsed.descriptor.scriptSetup))
cases.push(
  check('F10 SFC 含模板', () => !!parsed.descriptor.template && parsed.descriptor.template.content.includes('t32'))
)

let templateError = ''
try {
  const compiled = compileSfcTemplate({
    source: parsed.descriptor.template?.content ?? '',
    filename: 't32-html-format.vue',
    id: 't32test'
  })
  if (compiled.errors && compiled.errors.length) templateError = JSON.stringify(compiled.errors)
} catch (e) {
  templateError = e && e.message ? e.message : String(e)
}
cases.push(check('F10 模板可被 @vue/compiler-sfc 编译且无错误', () => !templateError, templateError))

let compileError = ''
try {
  compileSfcScript(parsed.descriptor, { id: 't32test' })
} catch (e) {
  compileError = e && e.message ? e.message : String(e)
}
cases.push(check('F10 <script setup> 可被编译', () => !compileError, compileError))

const setup = parsed.descriptor.scriptSetup?.content ?? ''

// 代码级断言：循环内不再对整段 src 调 toLowerCase，且已提到循环外
cases.push(check('F10 formatHtml 内不再出现 src.toLowerCase().indexOf', () => !/src\.toLowerCase\(\)\.indexOf/.test(setup)))
cases.push(
  check('F10 formatHtml 已把 toLowerCase 提到循环外（lowerSrc）', () =>
    setup.includes('const lowerSrc = src.toLowerCase()') && setup.includes('lowerSrc.indexOf(')
  )
)
cases.push(
  check('F10 formatHtml 内对整段 src 的 toLowerCase 只出现一次（注释除外）', () => {
    const code = setup.replace(/^\s*\/\/.*$/gm, '')
    return (code.match(/src\.toLowerCase\(\)/g) ?? []).length === 1
  })
)

// 抽取 formatHtml 及其依赖（countChar + HTML 段），去类型后在 Node 侧执行
const countStart = setup.indexOf('function countChar')
const countEnd = setup.indexOf('function curLine')
const htmlStart = setup.indexOf('// ----- HTML -----')
const cssStart = setup.indexOf('// ----- CSS -----')
const snippet = setup.slice(countStart, countEnd) + '\n' + setup.slice(htmlStart, cssStart)

// 同样动态 import esbuild，避免把 esbuild 打进测试包
const esbuildEntry = join(projectRoot, 'node_modules', 'esbuild', 'lib', 'main.js')
const esbuildMod = await import(pathToFileURL(esbuildEntry).href)
const transformSync = esbuildMod.transformSync ?? esbuildMod.default.transformSync

function buildFormatHtml(code) {
  const js = transformSync(code, { loader: 'ts', format: 'esm' }).code
  const factory = new Function(`${js}\nreturn { formatHtml, parseTag, findTagEnd };`)
  return factory()
}

const fixed = buildFormatHtml(snippet)
cases.push(check('F10 抽取的 formatHtml 可执行', () => typeof fixed.formatHtml === 'function'))

// 参考实现：还原成「循环内每次 src.toLowerCase()」的旧写法
const referenceSnippet = snippet
  .replace(/const lowerSrc = src\.toLowerCase\(\)/, '')
  .replace('lowerSrc.indexOf(`</${name}`, i)', 'src.toLowerCase().indexOf(`</${name}`, i)')
const reference = buildFormatHtml(referenceSnippet)
cases.push(check('F10 参考实现（旧写法）可执行', () => typeof reference.formatHtml === 'function'))

const opts = (over = {}) => ({ eol: '\n', attrEach: false, keepBlank: false, ...over })

// 行为等价：覆盖大小写、void、raw、注释、属性换行、保留空行、嵌套
const fixtures = [
  '<div><p>hi</p></div>',
  '<DIV CLASS="x">Hi</DIV>',
  '<span>行内</span>',
  '<img src="a.png" alt="图"><br>',
  '<ul><li>a</li><li>b</li></ul>',
  '<div><span>a</span><span>b</span><span>c</span></div>',
  '<script>if (a < b) { x() }</script>',
  '<style>.a{color:red}</style>',
  '<pre>  keep\n  me  </pre>',
  '<!-- c --><div><!-- inner -->x</div>',
  '<input type="text" value="x">',
  '<a><b><c/></b></a>',
  '<p>跨行\n第二行</p>',
  '<div\n\n\n><span>x</span></div>',
  '<div><section><article><span>deep</span></article></section></div>'
]
const optsVariants = [opts(), opts({ attrEach: true }), opts({ keepBlank: true }), opts({ eol: '\r\n' })]
let behaviorEqual = true
let behaviorDetail = ''
for (const src of fixtures) {
  for (const o of optsVariants) {
    let a
    let b
    try {
      a = fixed.formatHtml(src, '  ', o)
    } catch (e) {
      a = `ERR:${e.message}`
    }
    try {
      b = reference.formatHtml(src, '  ', o)
    } catch (e) {
      b = `ERR:${e.message}`
    }
    if (a !== b) {
      behaviorEqual = false
      behaviorDetail = `src=${JSON.stringify(src)} opts=${JSON.stringify(o)}\n  fixed=${JSON.stringify(a)}\n  ref=${JSON.stringify(b)}`
      break
    }
  }
  if (!behaviorEqual) break
}
cases.push(check('F10 修复版与旧写法在所有样例上输出完全一致', () => behaviorEqual || behaviorDetail))
cases.push(
  check('F10 具体输出回归：短行内元素保持单行', () => fixed.formatHtml('<span>行内</span>', '  ', opts()) === '<span>行内</span>\n')
)
cases.push(
  check('F10 具体输出回归：void 元素不增加缩进', () =>
    fixed.formatHtml('<div><img src="a.png"></div>', '  ', opts()) === '<div>\n  <img src="a.png">\n</div>\n'
  )
)
cases.push(
  check('F10 具体输出回归：嵌套缩进', () =>
    fixed.formatHtml('<a><b><c/></b></a>', '  ', opts()) === '<a>\n  <b>\n    <c/>\n  </b>\n</a>\n'
  )
)

// 复杂度回归：统计「对整段 src 调 toLowerCase」的次数（确定性，不依赖计时）
function countFullLowercaseCalls(fn, src, unit, o) {
  const orig = String.prototype.toLowerCase
  let fullCalls = 0
  let totalChars = 0
  String.prototype.toLowerCase = function () {
    const r = orig.call(this)
    if (this.length >= src.length) {
      fullCalls += 1
      totalChars += this.length
    }
    return r
  }
  try {
    return { out: fn(src, unit, o), fullCalls, totalChars }
  } finally {
    String.prototype.toLowerCase = orig
  }
}

// 浅层兄弟标签：40000 个 <span>x</span>，每个都会走 closeIdx 检索
const bigSrc = `<div>${'<span>x</span>'.repeat(40000)}</div>`
const fixedBig = countFullLowercaseCalls(fixed.formatHtml, bigSrc, '  ', opts())
const refBig = countFullLowercaseCalls(reference.formatHtml, bigSrc, '  ', opts())

cases.push(check('F10 大输入：修复版只对整段 src 小写化 1 次', () => fixedBig.fullCalls === 1))
cases.push(check('F10 大输入：旧写法对整段 src 小写化约每个标签一次', () => refBig.fullCalls >= 40000))
cases.push(check('F10 大输入：修复版小写化总字符数 = 源长度（线性）', () => fixedBig.totalChars === bigSrc.length))
cases.push(check('F10 大输入：旧写法小写化总字符数呈 O(n·m)', () => refBig.totalChars >= bigSrc.length * 40000))
cases.push(check('F10 大输入：修复版输出与旧写法一致', () => fixedBig.out === refBig.out))
cases.push(
  check('F10 大输入：修复版输出仍包含全部 span', () => (fixedBig.out.match(/<span>x<\/span>/g) ?? []).length === 40000)
)
