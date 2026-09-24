/**
 * P2-2 / P2-4 回归：XML 深度守卫 与 JSON→XML 元素名 / 嵌套数组告警。
 *
 * 背景（盲测 P2，已实证）：
 * - P2-2：formatXml / minifyXml / xmlToJson 的递归遍历对极深 XML（约 4000 层，DOMParser 接受）
 *   抛原生英文 `RangeError: Maximum call stack size exceeded`；t43 非 json2xml 分支直接
 *   errMessage(e) 会把英文回显给用户。修复：进入递归前迭代预检深度 / 节点数，超限抛中文错误。
 * - P2-4：jsonToXml 对非法元素名（'a b' / 'ns:x' / '1bad'）静默回退 item、无告警（与属性名
 *   告警不一致）；对嵌套数组 [[1,2],[3]] 静默拍平、层级丢失、无告警。
 *
 * Node 没有 DOMParser：深度预检用等价假 DOM 直接测；jsonToXml 是纯字符串生成可直接测；
 * 另外用假 DOMParser 让 formatXml / minifyXml / xmlToJson 在 Node 里走到预检分支。
 */
import { check, eq, throws } from './helpers.mjs'
import {
  assertXmlDepthWithinLimit,
  elementToJson,
  formatXml,
  jsonToXml,
  MAX_XML_DEPTH,
  MAX_XML_NODES,
  minifyXml,
  xmlToJson
} from '../app/utils/xml.ts'

export const cases = []

const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s)

/* ───────────────────────── 假 DOM 工具 ───────────────────────── */

/** 等价假 DOM 元素：只实现预检 / elementToJson 用到的成员 */
const el = (tagName, children = []) => ({
  tagName,
  attributes: [],
  children,
  childNodes: children,
  nodeType: 1
})

/** 构造 depth 层嵌套的假 DOM 树（迭代构造，避免测试自身爆栈） */
function chain(depth) {
  let node = el('a')
  for (let i = 1; i < depth; i += 1) node = el('a', [node])
  return node
}

/** 极简 XML 良构校验：标签配对 + 恰好一个根元素（无 DOMParser） */
function wellFormed(xml) {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  const tagRe = /<([!?/]?)([^\s/>]+)([^>]*?)(\/?)>/g
  const stack = []
  let rootCount = 0
  let m
  while ((m = tagRe.exec(body))) {
    const kind = m[1]
    const name = m[2]
    if (kind === '!' || kind === '?') continue
    if (kind === '/') {
      if (stack.pop() !== name) return false
    } else if (m[4] === '/') {
      if (!stack.length) rootCount += 1
    } else {
      if (!stack.length) rootCount += 1
      stack.push(name)
    }
  }
  return stack.length === 0 && rootCount === 1
}

/* ───────────────────────── 1. 深度 / 节点数预检（P2-2） ───────────────────────── */

// 上限常量合理：既让正常深度可用，又远低于递归爆栈的实测阈值（约 4000 层）
cases.push(check('P2-2 深度上限设置为 2000', () => MAX_XML_DEPTH === 2000))
cases.push(check('P2-2 节点数上限为正整数', () => Number.isInteger(MAX_XML_NODES) && MAX_XML_NODES > 0))

// 边界：恰好到上限不抛，超过上限抛中文错误
cases.push(
  check('P2-2 恰好到深度上限（2000 层）不抛错', () => {
    assertXmlDepthWithinLimit(chain(MAX_XML_DEPTH))
    return true
  })
)
cases.push(
  check('P2-2 单元素树深度为 1，不抛错', () => {
    assertXmlDepthWithinLimit(el('a'))
    return true
  })
)
cases.push(
  throws(
    'P2-2 超过深度上限抛中文「嵌套层级过深」',
    () => assertXmlDepthWithinLimit(chain(MAX_XML_DEPTH + 1)),
    /嵌套层级过深/
  )
)
cases.push(
  throws(
    'P2-2 深度错误文案含具体上限值与处理建议',
    () => assertXmlDepthWithinLimit(chain(MAX_XML_DEPTH + 1)),
    new RegExp(`超过 ${MAX_XML_DEPTH} 层.*已中止处理.*减少嵌套层级`)
  )
)
cases.push(
  check('P2-2 深度错误为中文且不含英文 Maximum call stack', () => {
    try {
      assertXmlDepthWithinLimit(chain(MAX_XML_DEPTH + 1))
      return false
    } catch (e) {
      return hasChinese(e.message) && !/Maximum call stack/i.test(e.message)
    }
  })
)

// 节点数：宽树（浅层但元素极多）触发节点数上限，避免只守深度漏掉“节点过巨”
cases.push(
  throws(
    'P2-2 元素节点过多抛中文「元素节点过多」',
    () => assertXmlDepthWithinLimit(el('root', new Array(MAX_XML_NODES + 1).fill(null).map(() => el('a')))),
    /元素节点过多/
  )
)

// elementToJson 是导出的递归入口：直接传深树也必须抛中文错误，而不是爆栈
cases.push(
  throws(
    'P2-2 elementToJson 深树抛中文错误（不回显英文爆栈）',
    () => elementToJson(chain(MAX_XML_DEPTH + 1)),
    /嵌套层级过深/
  )
)

/* ── 用假 DOMParser 让三个公开入口在 Node 里走到预检分支（P2-2） ── */

const savedDOMParser = globalThis.DOMParser

/** 安装返回指定根元素的假 DOMParser */
function installFakeDom(root) {
  globalThis.DOMParser = class {
    parseFromString() {
      return { querySelector: () => null, documentElement: root }
    }
  }
}

function restoreDom() {
  if (savedDOMParser === undefined) delete globalThis.DOMParser
  else globalThis.DOMParser = savedDOMParser
}

installFakeDom(chain(MAX_XML_DEPTH + 10))
cases.push(throws('P2-2 formatXml 深树抛中文错误', () => formatXml('<a/>'), /嵌套层级过深/))
cases.push(throws('P2-2 minifyXml 深树抛中文错误', () => minifyXml('<a/>'), /嵌套层级过深/))
cases.push(throws('P2-2 xmlToJson 深树抛中文错误', () => xmlToJson('<a/>'), /嵌套层级过深/))
cases.push(
  check('P2-2 formatXml 深树错误不含英文 Maximum call stack', () => {
    try {
      formatXml('<a/>')
      return false
    } catch (e) {
      return hasChinese(e.message) && !/Maximum call stack/i.test(e.message)
    }
  })
)
restoreDom()

/* ───────────────────────── 2. 非法元素名告警（P2-4） ───────────────────────── */

const badNames = jsonToXml({ 'a b': 1, 'ns:x': 2, '1bad': 3 }, 'root')

cases.push(
  check('P2-4 每个非法元素名都有中文告警且保留原键名', () =>
    ['a b', 'ns:x', '1bad'].every((k) =>
      badNames.warnings.some((w) => hasChinese(w) && w.includes(k) && /非法|不是合法/.test(w))
    )
  )
)
cases.push(check('P2-4 非法元素名不再静默（至少 3 条告警）', () => badNames.warnings.length >= 3))
cases.push(
  check('P2-4 非法元素名全部回退为 <item> 标签', () => (badNames.xml.match(/<item>/g) ?? []).length === 3)
)
cases.push(
  check('P2-4 输出不再出现原非法标签名', () =>
    !badNames.xml.includes('<a b') && !badNames.xml.includes('<ns:x') && !badNames.xml.includes('<1bad')
  )
)
cases.push(check('P2-4 非法元素名输出仍良构', () => wellFormed(badNames.xml)))
cases.push(
  eq(
    'P2-4 非法元素名精确输出（保留值顺序）',
    badNames.xml,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<root>',
      '  <item>1</item>',
      '  <item>2</item>',
      '  <item>3</item>',
      '</root>'
    ].join('\n')
  )
)

// 告警去重：同名非法键重复出现只提示一次（与属性名告警一致）
const dupName = jsonToXml([{ '1bad': 1 }, { '1bad': 2 }], 'root')
cases.push(
  check('P2-4 相同非法元素名重复出现：告警去重为 1 条', () =>
    dupName.warnings.filter((w) => w.includes('1bad')).length === 1
  )
)

// 非法根名也不再静默
cases.push(
  check('P2-4 非法根标签名也追加中文告警', () => {
    const r = jsonToXml({ a: 1 }, '1root')
    return r.warnings.some((w) => hasChinese(w) && w.includes('1root') && /非法|不是合法/.test(w))
  })
)
cases.push(
  check('P2-4 顶层数组的非法根名也追加中文告警', () => {
    const r = jsonToXml([1], '1root')
    return r.warnings.some((w) => hasChinese(w) && w.includes('1root') && /非法|不是合法/.test(w))
  })
)

/* ───────────────────────── 3. 嵌套数组告警（P2-4） ───────────────────────── */

const nestedInObj = jsonToXml({ list: [[1, 2], [3]] }, 'root')
cases.push(
  check('P2-4 对象内嵌套数组有中文告警', () =>
    nestedInObj.warnings.some((w) => hasChinese(w) && /嵌套数组/.test(w))
  )
)
cases.push(
  check('P2-4 嵌套数组告警说明层级无法表达', () =>
    nestedInObj.warnings.some((w) => /嵌套数组/.test(w) && /层级/.test(w))
  )
)
cases.push(check('P2-4 嵌套数组输出仍良构', () => wellFormed(nestedInObj.xml)))
cases.push(
  check('P2-4 嵌套数组内层元素被平铺为重复 <list>（不再静默且与原行为一致）', () => {
    const xml = nestedInObj.xml
    return (xml.match(/<list>/g) ?? []).length === 3 && xml.includes('<list>3</list>')
  })
)

const nestedTop = jsonToXml([[1, 2], [3]], 'root')
cases.push(
  check('P2-4 顶层嵌套数组有中文告警', () => nestedTop.warnings.some((w) => hasChinese(w) && /嵌套数组/.test(w)))
)
cases.push(
  check('P2-4 顶层嵌套数组仍保留「顶层是数组」包裹告警', () =>
    nestedTop.warnings.some((w) => w.includes('顶层是数组'))
  )
)
cases.push(check('P2-4 顶层嵌套数组输出仍良构', () => wellFormed(nestedTop.xml)))

/* ───────────────────────── 4. 合法输入：输出与告警不变 ───────────────────────── */

cases.push(eq('回归 合法对象无任何告警', jsonToXml({ a: 1, b: { c: 2 } }).warnings, []))
cases.push(eq('回归 标量数组（可表达层级）无嵌套数组告警', jsonToXml({ a: [1, 2] }).warnings, []))
cases.push(eq('回归 顶层标量数组仅有「顶层是数组」1 条告警', jsonToXml([1, 2]).warnings.length, 1))
cases.push(
  eq(
    '回归 合法对象精确输出不变',
    jsonToXml({ a: 1 }).xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <a>1</a>\n</root>'
  )
)
cases.push(
  check('回归 合法子元素数组仍是重复同名标签（不套 item）', () => {
    const xml = jsonToXml({ a: [1, 2] }).xml
    return (xml.match(/<a>/g) ?? []).length === 2 && !xml.includes('<item>')
  })
)
cases.push(
  eq(
    '回归 非法元素名仍回退 item（既有输出不变）',
    jsonToXml({ '1bad': 1 }, 'root').xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <item>1</item>\n</root>'
  )
)
cases.push(
  check('回归 合法元素名不产生「元素名」告警', () => !jsonToXml({ a: 1 }).warnings.some((w) => /元素名/.test(w)))
)

// 元素名与属性名告警口径一致（都在告警中保留原名与回退名）
const mixed = jsonToXml({ '@1bad': 'v', 'ns:x': 'w' }, 'root')
cases.push(
  check('P2-4 元素名告警与既有属性名告警同时存在且都为中文', () => {
    const attrW = mixed.warnings.find((w) => w.includes('@1bad') || (w.includes('1bad') && w.includes('属性名')))
    const elemW = mixed.warnings.find((w) => w.includes('ns:x'))
    return !!attrW && !!elemW && hasChinese(attrW) && hasChinese(elemW)
  })
)
