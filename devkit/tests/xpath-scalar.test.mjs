/**
 * P2-1 回归：queryXPath 的标量结果（count()/string()/boolean()）在消费端不再被当成失败 / 空结果。
 *
 * 背景（盲测 P2-1，本批相关）：
 * - executors/text.ts 的 xml/xpath 步骤旧逻辑 `if (!res.matches.length) throw …`，
 *   标量表达式没有节点集 → 被当作假失败并中断流程；
 * - t43-xml-toolbox.vue 旧逻辑只读 res.matches → 标量结果输出 `[]`、徽标「0 个匹配」，
 *   却 markOk 显示成功（静默错误结果）。
 *
 * Node 无 DOMParser / XPathResult：注入假 DOMParser + 假 XPathResult 后走**真实** queryXPath，
 * 再直接调用真实 textExecutors.xml，验证标量分支不抛错、输出 value 且 note 带类型；
 * 节点集路径（匹配 1 个节点 / 空节点集失败文案）保持回归。
 * t43 是 SFC：用 @vue/compiler-sfc 自检 + 源码级断言（必须用到 res.value / res.type / scalarResult）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { textExecutors } from '../app/workflow/executors/text.ts'
import { check, eq, throws } from './helpers.mjs'

const projectRoot = process.cwd()

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 0. 假 DOMParser / XPathResult（与 xml-fidelity.test.mjs 同款，Node 没有原生实现）
 * ──────────────────────────────────────────────────────────── */

const XP = {
  ANY_TYPE: 0,
  NUMBER_TYPE: 1,
  STRING_TYPE: 2,
  BOOLEAN_TYPE: 3,
  UNORDERED_NODE_ITERATOR_TYPE: 4,
  ORDERED_NODE_ITERATOR_TYPE: 5,
  UNORDERED_NODE_SNAPSHOT_TYPE: 6,
  ORDERED_NODE_SNAPSHOT_TYPE: 7,
  ANY_UNORDERED_NODE_TYPE: 8,
  FIRST_ORDERED_NODE_TYPE: 9
}
const savedXPathResult = globalThis.XPathResult
const savedDOMParser = globalThis.DOMParser
globalThis.XPathResult = XP

function installFakeDom(evaluate) {
  globalThis.DOMParser = class {
    parseFromString() {
      return {
        querySelector: () => null,
        documentElement: { tagName: 'root' },
        getElementsByTagName: () => [],
        evaluate
      }
    }
  }
}

/** 直接调用真实的 xml 步骤执行器（xpath 分支） */
function execXPath(text, expr, config = {}) {
  return textExecutors.xml({ kind: 'text', text }, { mode: 'xpath', expr, ...config }, {})
}

/* ────────────────────────────────────────────────────────────
 * 1. 标量结果：不抛错 + 输出 value + note 带类型
 * ──────────────────────────────────────────────────────────── */

installFakeDom(() => ({ resultType: XP.NUMBER_TYPE, numberValue: 2 }))
const countRes = execXPath('<root/>', 'count(//book)')
cases.push(
  check('text 步骤 count() 不再抛「没有匹配到节点」并成功返回', () => !!countRes && countRes.payload.text === '2', JSON.stringify(countRes))
)
cases.push(eq('text 步骤 count() 输出 String(value)', countRes.payload.text, '2'))
cases.push(eq('text 步骤 count() note 标注 number = 2', countRes.note, 'XPath 结果：number = 2'))
cases.push(check('text 步骤 count() 输出为文本载荷（不是 JSON 节点数组）', () => countRes.payload.kind === 'text'))

installFakeDom(() => ({ resultType: XP.STRING_TYPE, stringValue: 'abc' }))
const strRes = execXPath('<root/>', 'string(//b)')
cases.push(eq('text 步骤 string() 输出 value', strRes.payload.text, 'abc'))
cases.push(check('text 步骤 string() note 标注 string 类型', () => /XPath 结果：string = abc/.test(strRes.note), strRes.note))

installFakeDom(() => ({ resultType: XP.BOOLEAN_TYPE, booleanValue: true }))
const trueRes = execXPath('<root/>', 'boolean(//b)')
cases.push(eq('text 步骤 boolean() true 输出 value', trueRes.payload.text, 'true'))
cases.push(check('text 步骤 boolean() note 标注 boolean', () => /boolean = true/.test(trueRes.note), trueRes.note))

// false 是合法标量结果，绝不能因为「假值」被误判为失败
installFakeDom(() => ({ resultType: XP.BOOLEAN_TYPE, booleanValue: false }))
const falseRes = execXPath('<root/>', 'boolean(//missing)')
cases.push(eq('text 步骤 boolean() false 仍成功输出 false', falseRes.payload.text, 'false'))
cases.push(check('text 步骤 boolean() false note 标注 boolean = false', () => /boolean = false/.test(falseRes.note), falseRes.note))

// 标量 + 告警：warnNote 仍要透传（未声明前缀）
installFakeDom(() => ({ resultType: XP.STRING_TYPE, stringValue: 'x' }))
const warnRes = execXPath('<root/>', 'ns:book')
cases.push(check('text 步骤标量结果仍透传中文告警', () => warnRes.note.includes('未声明的前缀'), warnRes.note))

/* ────────────────────────────────────────────────────────────
 * 2. 节点集路径回归：结构与失败文案保持不变
 * ──────────────────────────────────────────────────────────── */

const fakeNode = {
  nodeType: 1,
  tagName: 'b',
  parentNode: null,
  childNodes: [],
  attributes: [],
  children: [],
  nodeValue: null,
  textContent: '1'
}
installFakeDom(() => {
  let i = 0
  return { resultType: XP.UNORDERED_NODE_ITERATOR_TYPE, iterateNext: () => (i++ === 0 ? fakeNode : null) }
})
const nodeRes = execXPath('<root><b>1</b></root>', '//b')
cases.push(eq('text 步骤节点集仍输出 JSON 载荷', nodeRes.payload.kind, 'json'))
cases.push(
  eq('text 步骤节点集结构保持 {path,value,type}', JSON.parse(nodeRes.payload.text), [
    { path: '/b', value: '1', type: 'element' }
  ])
)
cases.push(check('text 步骤节点集 note 仍为「匹配 1 个节点」', () => /匹配 1 个节点/.test(nodeRes.note), nodeRes.note))

installFakeDom(() => ({ resultType: XP.UNORDERED_NODE_ITERATOR_TYPE, iterateNext: () => null }))
cases.push(throws('text 步骤空节点集仍抛原失败文案', () => execXPath('<root/>', '//missing'), /XPath 没有匹配到节点/))
cases.push(
  throws('text 步骤空表达式仍抛原参数错误', () => execXPath('<root/>', '   '), /XPath 表达式为空/)
)

/* ────────────────────────────────────────────────────────────
 * 3. t43 SFC：@vue/compiler-sfc 自检 + 源码级断言
 * ──────────────────────────────────────────────────────────── */

const compilerEntry = join(projectRoot, 'node_modules', '@vue', 'compiler-sfc', 'dist', 'compiler-sfc.cjs.js')
const sfcCompiler = await import(pathToFileURL(compilerEntry).href)
const parseSfc = sfcCompiler.parse ?? sfcCompiler.default.parse
const compileSfcScript = sfcCompiler.compileScript ?? sfcCompiler.default.compileScript

const t43src = readFileSync(join(projectRoot, 'app', 'components', 'tools', 't43-xml-toolbox.vue'), 'utf8')
const t43parsed = parseSfc(t43src, { filename: 't43-xml-toolbox.vue' })
let t43CompileError = ''
try {
  compileSfcScript(t43parsed.descriptor, { id: 'xpath-scalar' })
} catch (e) {
  t43CompileError = e && e.message ? e.message : String(e)
}
cases.push(check('SFC 解析 t43-xml-toolbox.vue 无错误', () => t43parsed.errors.length === 0, JSON.stringify(t43parsed.errors)))
cases.push(check('SFC 编译 t43 <script setup> 成功', () => !t43CompileError, t43CompileError))

cases.push(
  check('t43 用 res.type !== \'nodeset\' 进入标量分支', () => /res\.type !== 'nodeset'/.test(t43src))
)
cases.push(check('t43 标量分支用 String(res.value) 作为输出', () => /String\(res\.value\)/.test(t43src)))
cases.push(
  check('t43 记录标量结果 { type, value } 供模板使用', () =>
    /scalarResult\.value\s*=\s*\{\s*type:\s*res\.type,\s*value:\s*res\.value\s*\}/.test(t43src)
  )
)
cases.push(
  check('t43 模板展示标量值并标注类型', () =>
    /scalarResult/.test(t43src) && /String\(scalarResult\.value\)/.test(t43src) && /标量/.test(t43src)
  )
)
cases.push(
  check('t43 徽标在标量时不再显示「0 个匹配」', () => {
    const badge = t43src.match(/class="t43__badge"[\s\S]{0,500}?个匹配/)
    return badge !== null && /scalarResult/.test(badge[0])
  })
)
cases.push(
  check('t43 节点集输出表达式保持回归', () => /res\.matches\.map\(\(m\) => m\.value\)/.test(t43src))
)

/* ────────────────────────────────────────────────────────────
 * 4. text.ts 源码级约束（标量处理与节点集失败文案并存）
 * ──────────────────────────────────────────────────────────── */

const textSrc = readFileSync(join(projectRoot, 'app', 'workflow', 'executors', 'text.ts'), 'utf8')
cases.push(
  check('text.ts xpath 分支使用 res.type !== \'nodeset\' 进入标量路径', () =>
    /res\.type !== 'nodeset'/.test(textSrc)
  )
)
cases.push(
  check('text.ts 标量 note 含「XPath 结果：<type> = <value>」', () => /XPath 结果：\$\{res\.type\} = \$\{value\}/.test(textSrc))
)
cases.push(
  check('text.ts 节点集 0 匹配仍保留原失败文案', () => /XPath 没有匹配到节点/.test(textSrc))
)

/* 还原全局，避免污染同进程其它测试 */
if (savedXPathResult === undefined) delete globalThis.XPathResult
else globalThis.XPathResult = savedXPathResult
if (savedDOMParser === undefined) delete globalThis.DOMParser
else globalThis.DOMParser = savedDOMParser
