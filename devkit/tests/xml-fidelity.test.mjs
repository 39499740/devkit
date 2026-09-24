/**
 * XML 保真修复回归（P1-1 / P2-1 / P2-2 / P2-5）。
 *
 * 背景（均为既有缺陷，已实证）：
 * - P1-1：elementToJson 只收集 nodeType===3 文本，忽略 CDATASection(nodeType===4)
 *   → 纯 CDATA 元素变空串、混合内容丢 CDATA，且无告警。
 * - P2-1：escapeText/escapeAttr 不处理 XML 1.0 非法控制字符（U+0000–U+0008 / U+000B /
 *   U+000C / U+000E–U+001F），产出不可解析 XML 且无告警。
 * - P2-2：extractProlog 的 DOCTYPE 正则在整篇文本匹配，会把注释 / CDATA 里的
 *   `<!DOCTYPE …>` 当真实声明插入。
 * - P2-5：queryXPath 固定 ORDERED_NODE_SNAPSHOT_TYPE，count()/string()/boolean() 等
 *   数值 / 字符串 / 布尔结果被误报「表达式无效」（xpathSamples 里就有 count(//book)）。
 *
 * Node 没有 DOMParser / XPathResult：CDATA 用等价假 DOM 节点直测 elementToJson；
 * escapeText / escapeAttr / extractProlog 是纯函数直接测；queryXPath 通过注入假
 * DOMParser + 假 XPathResult 验证 ANY_TYPE 的标量 / 节点集分支；完整真实浏览器解析
 * 仍由 tests/xml.browser.mjs 覆盖。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { check, eq } from './helpers.mjs'
import { elementToJson, escapeAttr, escapeText, extractProlog, jsonToXml, queryXPath } from '../app/utils/xml.ts'

export const cases = []

/* ───────────────────────── 假 DOM 节点（只实现 elementToJson 用到的成员） ───────────────────────── */

const text = (value) => ({ nodeType: 3, nodeValue: value })
const cdata = (value) => ({ nodeType: 4, nodeValue: value })
const el = (tagName, opts = {}) => ({
  tagName,
  attributes: opts.attributes ?? [],
  children: opts.children ?? [],
  childNodes: opts.childNodes ?? []
})

/* ───────────────────────── 1. elementToJson 纳入 CDATA（P1-1） ───────────────────────── */

cases.push(
  eq('P1-1 纯 CDATA 元素保留内容（不再变空串）', elementToJson(el('a', { childNodes: [cdata('1 < 2 & 3')] })), '1 < 2 & 3')
)
cases.push(
  eq(
    'P1-1 带属性的纯 CDATA 元素写 #text',
    elementToJson(el('a', { attributes: [{ name: 'x', value: '1' }], childNodes: [cdata('hi')] })),
    { '@x': '1', '#text': 'hi' }
  )
)
cases.push(
  eq(
    'P1-1 混合内容按出现顺序拼接文本与 CDATA',
    elementToJson(
      el('p', {
        children: [el('b', { childNodes: [text('w')] })],
        childNodes: [text('Hello '), cdata('<x>'), text('!')]
      })
    ),
    { b: 'w', '#text': 'Hello <x>!' }
  )
)
cases.push(
  eq(
    'P1-1 子元素之后的 CDATA 也保留',
    elementToJson(
      el('r', { children: [el('b', { childNodes: [text('1')] })], childNodes: [cdata('tail')] })
    ),
    { b: '1', '#text': 'tail' }
  )
)
cases.push(
  eq(
    'P1-1 多个 CDATA 与文本交替保持顺序',
    elementToJson(el('a', { childNodes: [cdata('A'), text('B'), cdata('C')] })),
    'ABC'
  )
)
cases.push(
  eq(
    'P1-1 同名兄弟里 CDATA 各自保留',
    elementToJson(
      el('r', {
        children: [el('b', { childNodes: [cdata('1')] }), el('b', { childNodes: [cdata('2')] })]
      })
    ).b,
    ['1', '2']
  )
)

// 回归：既有文本合并语义不变
cases.push(eq('回归 纯文本仍直接给字符串', elementToJson(el('a', { childNodes: [text('hi')] })), 'hi'))
cases.push(
  eq(
    '回归 纯空白文本节点仍被忽略',
    elementToJson(
      el('r', { children: [el('b', { childNodes: [text('1')] })], childNodes: [text('\n  '), text('\n')] })
    ),
    { b: '1' }
  )
)
cases.push(
  eq(
    '回归 混合内容保留词语间空格',
    elementToJson(
      el('p', { children: [el('b', { childNodes: [text('w')] })], childNodes: [text('Hello '), text('!')] })
    ),
    { b: 'w', '#text': 'Hello !' }
  )
)

/* ───────────────────────── 2. XML 1.0 非法控制字符（P2-1） ───────────────────────── */

const NUL = '\u0000'
const CTRL_RUN = '\u0001\u0008\u000B\u000C\u000E\u001F'
/** 与实现同域的非法控制字符检测（用于断言产物里不再残留） */
const INVALID_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s)

cases.push(eq('P2-1 escapeText 把 NUL 替换为 &#xFFFD;', escapeText(`a${NUL}b`), 'a&#xFFFD;b'))
cases.push(
  eq('P2-1 escapeText 连续控制字符逐个替换', escapeText(`x${CTRL_RUN}y`), `x${'&#xFFFD;'.repeat(6)}y`)
)
cases.push(eq('P2-1 escapeText 合法 Tab/LF/CR 原样保留', escapeText('\t\n\r'), '\t\n\r'))
cases.push(eq('P2-1 escapeText 控制字符与 & 不互相污染', escapeText(`${NUL}&`), '&#xFFFD;&amp;'))
cases.push(eq('P2-1 escapeAttr 替换控制字符并转义引号', escapeAttr(`${NUL}"`), '&#xFFFD;&quot;'))

const ctrlXml = jsonToXml({ a: `x${NUL}y`, '@bad': `v${CTRL_RUN}` }, 'root')
cases.push(check('P2-1 jsonToXml 文本控制字符被替换', () => ctrlXml.xml.includes('<a>x&#xFFFD;y</a>')))
cases.push(
  check('P2-1 jsonToXml 属性控制字符被替换', () =>
    ctrlXml.xml.includes(`bad="v${'&#xFFFD;'.repeat(6)}"`)
  )
)
cases.push(check('P2-1 jsonToXml 产物不含原始控制字符（可解析）', () => !INVALID_RE.test(ctrlXml.xml)))
cases.push(
  check('P2-1 jsonToXml 追加中文告警且非静默', () =>
    ctrlXml.warnings.length > 0 && ctrlXml.warnings.some((w) => hasChinese(w) && /控制字符/.test(w))
  )
)
cases.push(
  check('P2-1 jsonToXml 控制字符告警去重为一条', () =>
    ctrlXml.warnings.filter((w) => w.includes('控制字符')).length === 1
  )
)

// 回归：无控制字符时行为不变
cases.push(eq('回归 无控制字符时无告警', jsonToXml({ a: 'ok' }).warnings, []))
cases.push(eq('回归 合法 Tab/LF 不触发告警', jsonToXml({ a: 'a\tb\nc' }).warnings, []))
cases.push(check('回归 合法 Tab/LF 原样输出', () => jsonToXml({ a: 'a\tb' }).xml.includes('<a>a\tb</a>')))

/* ───────────────────────── 3. extractProlog 仅识别前导区域（P2-2） ───────────────────────── */

const normal = extractProlog(
  '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE catalog SYSTEM "catalog.dtd"><catalog/>'
)
cases.push(eq('P2-2 正常文档：声明被提取', normal.declaration, '<?xml version="1.0" encoding="UTF-8"?>'))
cases.push(eq('P2-2 正常文档：DOCTYPE 被提取', normal.doctype, '<!DOCTYPE catalog SYSTEM "catalog.dtd">'))

const subset = extractProlog('<!DOCTYPE r [<!ENTITY x "y">]><r/>')
cases.push(eq('P2-2 内部子集 DOCTYPE 完整提取', subset.doctype, '<!DOCTYPE r [<!ENTITY x "y">]>'))
cases.push(eq('P2-2 无声明时为 null', subset.declaration, null))

cases.push(eq('P2-2 注释内的 DOCTYPE 不提取', extractProlog('<!-- <!DOCTYPE evil SYSTEM "e.dtd"> --><root/>').doctype, null))
cases.push(eq('P2-2 CDATA 内的 DOCTYPE 不提取', extractProlog('<![CDATA[<!DOCTYPE evil>]]><root/>').doctype, null))

const mixed = extractProlog('<?xml version="1.0"?><!-- c --><!DOCTYPE r><r/>')
cases.push(eq('P2-2 注释后的真实 DOCTYPE 仍提取', mixed.doctype, '<!DOCTYPE r>'))
cases.push(eq('P2-2 注释后的真实 DOCTYPE：声明也保留', mixed.declaration, '<?xml version="1.0"?>'))

cases.push(eq('P2-2 根元素之后的 DOCTYPE 不提取', extractProlog('<root/><!DOCTYPE late>').doctype, null))

const piFirst = extractProlog('<?xml-stylesheet href="a.xsl"?><!DOCTYPE r><r/>')
cases.push(eq('P2-2 xml-stylesheet 不被当声明', piFirst.declaration, null))
cases.push(eq('P2-2 xml-stylesheet 之后的 DOCTYPE 仍提取', piFirst.doctype, '<!DOCTYPE r>'))

cases.push(eq('P2-2 空文本返回双 null', extractProlog(''), { declaration: null, doctype: null }))
cases.push(eq('P2-2 普通文档无声明无 DOCTYPE', extractProlog('<a><b/></a>'), { declaration: null, doctype: null }))

/* ───────────────────────── 4. queryXPath 结果类型（P2-5，假 DOMParser / XPathResult） ───────────────────────── */

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

installFakeDom(() => ({ resultType: XP.NUMBER_TYPE, numberValue: 3 }))
const num = queryXPath('<root/>', 'count(//book)')
cases.push(eq('P2-5 count() 返回 number 类型', num.type, 'number'))
cases.push(eq('P2-5 count() 返回值 3', num.value, 3))
cases.push(eq('P2-5 count() matches 为空数组', num.matches, []))
cases.push(eq('P2-5 count() 不再误报「表达式无效」且无匹配告警', num.warnings, []))

installFakeDom(() => ({ resultType: XP.STRING_TYPE, stringValue: 'abc' }))
const str = queryXPath('<root/>', 'string(//b)')
cases.push(eq('P2-5 string() 返回 string 类型', str.type, 'string'))
cases.push(eq('P2-5 string() 返回值 abc', str.value, 'abc'))
cases.push(eq('P2-5 string() matches 为空数组', str.matches, []))

installFakeDom(() => ({ resultType: XP.BOOLEAN_TYPE, booleanValue: true }))
const bool = queryXPath('<root/>', 'boolean(//b)')
cases.push(eq('P2-5 boolean() 返回 boolean 类型', bool.type, 'boolean'))
cases.push(eq('P2-5 boolean() 返回值 true', bool.value, true))

// 节点集：ANY_TYPE 下浏览器通常返回迭代器，既有 {path,value,type} 结构必须保持兼容
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
const nodeSet = queryXPath('<root><b>1</b></root>', '//b')
cases.push(eq('P2-5 迭代器节点集 type=nodeset', nodeSet.type, 'nodeset'))
cases.push(eq('P2-5 迭代器节点集 value=null', nodeSet.value, null))
cases.push(
  eq(
    'P2-5 节点集 matches 结构保持 {path,value,type}',
    nodeSet.matches.map((m) => ({ path: m.path, value: m.value, type: m.type })),
    [{ path: '/b', value: '1', type: 'element' }]
  )
)
cases.push(
  check('P2-5 节点集定位区间有效', () => nodeSet.matches[0].from >= 0 && nodeSet.matches[0].to > nodeSet.matches[0].from)
)

// 快照类型回归：既有的 ORDERED_NODE_SNAPSHOT 路径仍可用
installFakeDom(() => ({
  resultType: XP.ORDERED_NODE_SNAPSHOT_TYPE,
  snapshotLength: 1,
  snapshotItem: (i) => (i === 0 ? fakeNode : null)
}))
cases.push(eq('P2-5 快照节点集仍兼容（回归）', queryXPath('<root><b>1</b></root>', '//b').matches.length, 1))

// 空节点集仍给中文提示
installFakeDom(() => ({ resultType: XP.UNORDERED_NODE_ITERATOR_TYPE, iterateNext: () => null }))
const empty = queryXPath('<root/>', '//missing')
cases.push(eq('P2-5 空节点集 type=nodeset', empty.type, 'nodeset'))
cases.push(eq('P2-5 空节点集仍给中文提示', empty.warnings.length > 0, true))

// 代码级兜底：ANY_TYPE 与三种标量类型分支确实存在于实现里
const xmlSource = readFileSync(join(process.cwd(), 'app', 'utils', 'xml.ts'), 'utf8')
cases.push(check('P2-5 实现使用 XPathResult.ANY_TYPE', () => /XPathResult\.ANY_TYPE/.test(xmlSource)))
cases.push(
  check('P2-5 实现处理 NUMBER/STRING/BOOLEAN 三种结果', () =>
    /NUMBER_TYPE/.test(xmlSource) && /STRING_TYPE/.test(xmlSource) && /BOOLEAN_TYPE/.test(xmlSource)
  )
)

if (savedXPathResult === undefined) delete globalThis.XPathResult
else globalThis.XPathResult = savedXPathResult
if (savedDOMParser === undefined) delete globalThis.DOMParser
else globalThis.DOMParser = savedDOMParser
