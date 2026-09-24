/**
 * P1-1 / P2-2 回归：queryXPath 的路径计算性能 与 命名空间前缀处理。
 *
 * 背景（盲测，既有）：
 * - P1-1：queryXPath 对每个匹配节点调用 nodePath()，其中
 *   `Array.from(el.parentNode.children).filter(c => c.tagName === el.tagName)` 对同父下每个节点全量扫描，
 *   `//a` 在 n 个同名兄弟下是 O(n²)（n=1000 约 1980ms，n=1500 约 2875ms，万级分钟级）。
 *   且 queryXPath 只 parse 文本，未调用 assertXmlDepthWithinLimit，节点 / 深度上限对它无效。
 * - P2-2：resolver 对「标准 xml 前缀」返回 null，`//*[@xml:lang]` 被 evaluate 拒绝后误报「表达式无效」；
 *   未声明前缀的告警是死代码（evaluate 先抛异常）。
 *
 * 本文件两部分：
 * 1. Node 侧：用假 DOM 直接测 buildSameNameIndex / nodePath 的等价性（索引结果必须与朴素扫描逐字一致）。
 * 2. 真实浏览器：XPath 依赖 DOMParser / document.evaluate，用 tests/dom.mjs 同款 ego-browser 注入方式，
 *    把探针打成 IIFE 注入 about:blank 求值后回传结果；Node 无原生实现，不能用替身糊弄性能与命名空间行为。
 *
 * 性能断言取宽松上限（2000 个 <a> < 1500ms），避免 CI 抖动误报；实测见报告。
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { buildSameNameIndex, MAX_XML_DEPTH, nodePath, queryXPath } from '../app/utils/xml.ts'
import { check, eq, throws } from './helpers.mjs'

// 测试文件本身会被 tests/run.mjs 打成 bundle：静态 import esbuild 会把 esbuild 一起打包，
// 触发其内部 `require('fs')` 的 Dynamic require 报错。这里改用 createRequire 在运行时按
// 真实 node_modules 解析（隔离运行器 / npm test 两种路径都能找到 esbuild）。
const requireHere = createRequire(import.meta.url)
const { build } = requireHere('esbuild')

export const cases = []

/* ────────────────────────────────────────────────────────────
 * 1. Node 侧：索引函数的等价单测（假 DOM，只依赖 tagName / children / parentNode / nodeType）
 * ──────────────────────────────────────────────────────────── */

/** 等价假 DOM 元素；把子节点的 parentNode 指回自己，模拟真实 DOM 的双向关系 */
function fakeEl(tagName, children = []) {
  const node = { nodeType: 1, tagName, parentNode: null, children: [] }
  for (const c of children) {
    c.parentNode = node
    node.children.push(c)
  }
  return node
}

/** 深度优先收集元素 + 属性 + 文本，供逐节点对比两种路径算法 */
function collectNodes(node, out = []) {
  if (node.nodeType === 1) {
    out.push(node)
    for (const c of node.children) collectNodes(c, out)
    if (node.attributes) for (const a of node.attributes) collectNodes(a, out)
  } else {
    out.push(node)
  }
  return out
}

// 同名兄弟：r > (b > b), b —— 覆盖「多同名带序号」与「唯一同名不带序号」
const innerB = fakeEl('b')
const outerB = fakeEl('b', [innerB])
const secondB = fakeEl('b')
const root = fakeEl('r', [outerB, secondB])
const attrX = { nodeType: 2, name: 'x', parentNode: secondB }
const textNode = { nodeType: 3, nodeValue: '2', parentNode: secondB }

const index = buildSameNameIndex(root)

cases.push(
  eq('索引：同名兄弟 1-based 序号', [index.get(outerB).index, index.get(secondB).index], [1, 2])
)
cases.push(eq('索引：同名兄弟组大小', [index.get(outerB).total, index.get(secondB).total], [2, 2]))
cases.push(eq('索引：唯一同名子元素组大小为 1', index.get(innerB).total, 1))

const allNodes = [...collectNodes(root), attrX, textNode]
cases.push(
  check('nodePath 走索引与朴素扫描逐字一致', () => {
    for (const n of allNodes) {
      const withIndex = nodePath(n, index)
      const naive = nodePath(n)
      if (withIndex !== naive) return false
    }
    return true
  })
)

// 逐条锁定格式（与 tests/xml.browser.mjs 的既有路径断言口径一致）
cases.push(eq('索引路径：外层第一个同名带 [1]', nodePath(outerB, index), '/r/b[1]'))
cases.push(eq('索引路径：第二个同名带 [2]', nodePath(secondB, index), '/r/b[2]'))
cases.push(eq('索引路径：嵌套内层唯一同名不带序号', nodePath(innerB, index), '/r/b[1]/b'))
cases.push(eq('索引路径：属性节点', nodePath(attrX, index), '/r/b[2]/@x'))
cases.push(eq('索引路径：文本节点', nodePath(textNode, index), '/r/b[2]/text()'))
cases.push(eq('朴素路径（回归口径）', nodePath(innerB), '/r/b[1]/b'))

// 唯一子元素 / 不同 tag：都不应出现 [1]
const uniqRoot = fakeEl('root', [fakeEl('a'), fakeEl('b')])
const uniqIndex = buildSameNameIndex(uniqRoot)
cases.push(eq('不同 tag 的唯一子元素不带序号（a）', nodePath(uniqRoot.children[0], uniqIndex), '/root/a'))
cases.push(eq('不同 tag 的唯一子元素不带序号（b）', nodePath(uniqRoot.children[1], uniqIndex), '/root/b'))

// 缺省 children 的测试替身：索引函数与深度预检都不应抛 TypeError（真实 DOM 一定有 children）
cases.push(
  check('缺省 children 的节点：索引为空且 nodePath 可回退', () => {
    const bare = { nodeType: 1, tagName: 'root', parentNode: null }
    const map = buildSameNameIndex(bare)
    return map.size === 0 && nodePath(bare, map) === '/root'
  })
)

/* ────────────────────────────────────────────────────────────
 * 1b. Node 侧：queryXPath 复用深度上限（假 DOM；真实浏览器不适合解析 >2000 层）
 * ──────────────────────────────────────────────────────────── */

/** 与实现同域的 XPathResult 常量（Node 无原生实现，queryXPath 会读它） */
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

/** 深度 1..depth 的假 DOM 链（tagName 非 parsererror） */
function fakeChain(depth) {
  let node = fakeEl('a')
  for (let i = 1; i < depth; i += 1) node = fakeEl('a', [node])
  return node
}

const savedDOMParser = globalThis.DOMParser
const savedXPathResult = globalThis.XPathResult
try {
  globalThis.DOMParser = class {
    parseFromString() {
      return { querySelector: () => null, documentElement: fakeChain(MAX_XML_DEPTH + 1) }
    }
  }
  // 超深文档必须在 evaluate 之前由 assertXmlDepthWithinLimit 中文中止（旧实现未调用，会一路走到 evaluate）
  cases.push(
    throws('queryXPath 对超深文档抛中文「嵌套层级过深」', () => queryXPath('<a/>', '//a'), /嵌套层级过深/)
  )
  // 上限之内不得误伤（深度恰好 MAX_XML_DEPTH，evaluate 走假实现返回空节点集）
  globalThis.XPathResult = XP
  globalThis.DOMParser = class {
    parseFromString() {
      return {
        querySelector: () => null,
        documentElement: fakeChain(MAX_XML_DEPTH),
        getElementsByTagName: () => [],
        evaluate: () => ({ resultType: 4, iterateNext: () => null })
      }
    }
  }
  cases.push(
    check('queryXPath 对恰好到上限的文档不抛深度错误', () => {
      const r = queryXPath('<a/>', '//a')
      return r.type === 'nodeset' && r.matches.length === 0
    })
  )
} finally {
  if (savedDOMParser === undefined) delete globalThis.DOMParser
  else globalThis.DOMParser = savedDOMParser
  if (savedXPathResult === undefined) delete globalThis.XPathResult
  else globalThis.XPathResult = savedXPathResult
}

/* ────────────────────────────────────────────────────────────
 * 2. 真实浏览器：ego-browser 注入探针（与 tests/dom.mjs 同款机制）
 * ──────────────────────────────────────────────────────────── */

const testsDir = join(process.cwd(), 'tests')
const appDir = join(process.cwd(), 'app')

const PROBE_SOURCE = `
import { queryXPath } from '../app/utils/xml.ts'
import { check, eq, throws } from './helpers.mjs'

export const cases = []

/* P1-1：//a n=2000 必须在宽松上限内完成（旧实现 >5s，目标 <300ms） */
let bigXml = '<r>'
for (let i = 0; i < 2000; i += 1) bigXml += '<a>' + i + '</a>'
bigXml += '</r>'
const t0 = performance.now()
const bigRes = queryXPath(bigXml, '//a')
const elapsed = performance.now() - t0
cases.push(
  check('真实浏览器 //a n=2000 在宽松上限内完成（实际 ' + elapsed.toFixed(1) + 'ms）', function () {
    return bigRes.matches.length === 2000 && elapsed < 1500
  })
)
cases.push(eq('//a n=2000 首路径 /r/a[1]', bigRes.matches[0].path, '/r/a[1]'))
cases.push(eq('//a n=2000 中位路径 /r/a[1001]', bigRes.matches[1000].path, '/r/a[1001]'))
cases.push(eq('//a n=2000 末路径 /r/a[2000]', bigRes.matches[1999].path, '/r/a[2000]'))

/* 结果路径格式与既有断言（tests/xml.browser.mjs）逐字一致 */
const catalog = '<?xml version="1.0"?><catalog><book><title>A</title></book><book><title>B</title></book></catalog>'
cases.push(
  eq(
    '路径格式与既有断言一致',
    queryXPath(catalog, '//catalog/book/title').matches.map(function (m) { return m.path }),
    ['/catalog/book[1]/title', '/catalog/book[2]/title']
  )
)

/* P2-2：标准 xml: 前缀无需调用方声明 */
const xmlLang = '<r><a xml:lang="en">1</a><b>2</b></r>'
const langRes = queryXPath(xmlLang, '//*[@xml:lang]')
cases.push(eq('//*[@xml:lang] 成功命中 1 个节点', langRes.matches.length, 1))
cases.push(eq('xml:lang 命中节点路径', langRes.matches[0].path, '/r/a'))
cases.push(eq('xml:lang 命中节点值', langRes.matches[0].value, '1'))
cases.push(
  check('xml:lang 查询不再误报「表达式无效」', function () {
    return !langRes.warnings.some(function (w) { return /无效/.test(w) })
  })
)

/* P2-2：未声明前缀抛含前缀名的中文错误，不再落到笼统「表达式无效」 */
cases.push(throws('未声明前缀 zz: 抛中文错误', function () { queryXPath(xmlLang, 'zz:x') }, /未声明的前缀/))
cases.push(throws('未声明前缀错误信息包含前缀名 zz:', function () { queryXPath(xmlLang, 'zz:x') }, /zz:/))
cases.push(throws('未声明前缀错误不含笼统「表达式无效」', function () { queryXPath(xmlLang, 'zz:x') }, /^(?!.*表达式无效).*$/))

/* 显式传入 xmlns 的能力保留 */
const nsDoc = '<r xmlns:n="urn:x"><n:a>1</n:a></r>'
cases.push(eq('显式传入 xmlns 仍可查询前缀', queryXPath(nsDoc, '//n:a', [{ prefix: 'n', uri: 'urn:x' }]).matches.length, 1))
cases.push(
  throws('未传 xmlns 时同一前缀报未声明', function () { queryXPath(nsDoc, '//n:a') }, /未声明的前缀/)
)

/* 前缀扫描不误伤：字符串字面量里的 URL、child:: 轴名都不算未声明前缀 */
cases.push(
  check('字符串字面量里的 URL 不被误判成未声明前缀', function () {
    const r = queryXPath('<r><a href="http://x">1</a></r>', "//a[contains(@href,'http://x')]")
    return r.matches.length === 1
  })
)
cases.push(eq('child:: 轴名不被误判成未声明前缀', queryXPath(xmlLang, 'child::r').matches.length, 1))
`

/** 用 esbuild 把探针打成浏览器 ESM bundle；stdin 入口避免额外文件 */
async function bundleProbe() {
  const result = await build({
    stdin: { contents: PROBE_SOURCE, resolveDir: testsDir, sourcefile: 'xpath-perf-prefix.probe.ts', loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    logLevel: 'silent',
    resolveExtensions: ['.ts', '.mjs', '.js'],
    alias: { '~': appDir }
  })
  return result.outputFiles[0].text
}

/** 把 bundle 注入 about:blank 页面求值，回传 cases（机制与 tests/dom.mjs 一致） */
function runInBrowser(code) {
  const script = [
    'const task = await taskSpace("devkit xpath perf prefix");',
    'const page = task.page("p1");',
    'await page.goto("about:blank");',
    'const raw = await page.evaluate(async (code) => {',
    '  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));',
    '  try {',
    '    const mod = await import(url);',
    '    const cases = mod.cases ?? (mod.run ? await mod.run() : []);',
    '    return JSON.stringify(cases);',
    '  } finally {',
    '    URL.revokeObjectURL(url);',
    '  }',
    '}, ' + JSON.stringify(code) + ');',
    'console.log(raw);',
    'await task.finish({ keep: [] });'
  ].join('\n')
  const proc = spawnSync('ego-browser', ['nodejs'], { input: script, encoding: 'utf8', timeout: 180000 })
  const raw = `${proc.stdout || ''}\n${proc.stderr || ''}`
  const line = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('[') && l.endsWith(']'))
    .pop()
  if (!line) throw new Error('浏览器未返回用例结果：' + raw.slice(-500))
  return JSON.parse(line)
}

try {
  const code = await bundleProbe()
  const browserCases = runInBrowser(code)
  for (const c of browserCases) cases.push(c)
} catch (e) {
  const msg = e && e.message ? e.message : String(e)
  // ego-browser 不可用时跳过浏览器用例（浏览器断言由 npm run test:dom 覆盖），
  // 避免让纯 Node 的 npm test 硬依赖本机浏览器。
  if (/ENOENT|not found|ego-browser/i.test(msg)) {
    cases.push({ name: '真实浏览器探针（ego-browser 不可用，已跳过）', ok: true })
  } else {
    cases.push({ name: '真实浏览器探针执行', ok: false, detail: msg })
  }
}

