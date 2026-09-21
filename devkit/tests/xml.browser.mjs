import { formatXml, minifyXml, queryXPath, xmlToJson } from '../app/utils/xml.ts'
import { check, eq, throws } from './helpers.mjs'

// 这个文件只在真实浏览器里跑（Node 没有 DOMParser），入口是 tests/dom.mjs
const { DOMParser } = globalThis

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="b-101" category="tech">
    <title>深入理解 Java 虚拟机</title>
    <author>周志明</author>
    <price currency="CNY">99.00</price>
  </book>
  <book id="b-102" category="design">
    <title>设计中的设计</title>
    <author>原研哉</author>
    <price currency="CNY">68.00</price>
  </book>
  <book id="b-103" category="tech">
    <title>Vue.js 设计与实现</title>
    <author>霍春阳</author>
    <price currency="CNY">119.00</price>
  </book>
</catalog>`

function parse(text) {
  return new DOMParser().parseFromString(text, 'application/xml')
}

export const cases = [
  // 声明与 DOCTYPE 必须保留
  check('格式化保留 XML 声明', () => formatXml(SAMPLE, 2).xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')),
  check('压缩保留 XML 声明', () => minifyXml(SAMPLE).xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')),
  check('格式化保留 DOCTYPE', () => {
    const withDt = '<?xml version="1.0"?><!DOCTYPE catalog SYSTEM "catalog.dtd"><catalog><a/></catalog>'
    return formatXml(withDt, 2).xml.includes('<!DOCTYPE catalog SYSTEM "catalog.dtd">')
  }),
  check('压缩保留 DOCTYPE', () => {
    const withDt = '<?xml version="1.0"?><!DOCTYPE catalog SYSTEM "catalog.dtd"><catalog><a/></catalog>'
    return minifyXml(withDt).xml.includes('<!DOCTYPE catalog SYSTEM "catalog.dtd">')
  }),
  check('格式化保留根节点外的注释与处理指令', () => {
    const src = '<!-- 头注释 --><?pi data?><root><a/></root><!-- 尾注释 -->'
    const out = formatXml(src, 2).xml
    return out.includes('<!-- 头注释 -->') && out.includes('<?pi data?>') && out.includes('<!-- 尾注释 -->')
  }),

  // 混合内容：textContent 必须完全一致
  check('格式化不改变混合内容 textContent', () => {
    const src = '<p>Hello <b>world</b>!</p>'
    const out = formatXml(src, 2).xml
    return parse(out).documentElement.textContent === parse(src).documentElement.textContent
  }),
  check('压缩不改变混合内容 textContent', () => {
    const src = '<p>Hello <b>world</b>!</p>'
    const out = minifyXml(src).xml
    return parse(out).documentElement.textContent === parse(src).documentElement.textContent
  }),
  check('混合内容不插入换行', () => !formatXml('<p>Hello <b>world</b>!</p>', 2).xml.includes('\n')),
  check('格式化后混合内容仍可再解析', () => {
    const out = formatXml('<p>Hello <b>world</b>!</p>', 2).xml
    return parse(out).querySelector('parsererror') === null
  }),

  // 纯元素内容：允许重排，且结构等价
  check('纯元素内容按缩进重排', () => {
    const out = formatXml('<a><b><c/></b></a>', 2).xml
    return out === '<a>\n  <b>\n    <c/>\n  </b>\n</a>'
  }),
  check('压缩移除元素之间的空白', () => minifyXml('<a>\n  <b/>\n</a>').xml === '<a><b/></a>'),
  check('压缩后结构等价', () => {
    const src = SAMPLE
    const out = minifyXml(src).xml
    const before = parse(src).getElementsByTagName('book').length
    const after = parse(out).getElementsByTagName('book').length
    return before === 3 && after === 3
  }),
  check('格式化不丢子节点', () => parse(formatXml(SAMPLE, 2).xml).getElementsByTagName('book').length === 3),
  check('格式化保留注释节点', () => formatXml('<a><!-- x --><b/></a>', 2).xml.includes('<!-- x -->')),
  check('格式化保留 CDATA', () => formatXml('<a><![CDATA[1 < 2]]></a>', 2).xml.includes('<![CDATA[1 < 2]]>')),

  // XPath：匹配路径与源文本定位必须各自独立
  eq('XPath 命中 3 个 title', queryXPath(SAMPLE, '//catalog/book/title').matches.length, 3),
  eq(
    'XPath 路径带序号',
    queryXPath(SAMPLE, '//catalog/book/title').matches.map((m) => m.path),
    ['/catalog/book[1]/title', '/catalog/book[2]/title', '/catalog/book[3]/title']
  ),
  check('XPath 高亮区间互不重复且递增', () => {
    const ms = queryXPath(SAMPLE, '//catalog/book/title').matches
    const froms = ms.map((m) => m.from)
    return froms.every((v) => v >= 0) && new Set(froms).size === 3 && froms[1] > froms[0] && froms[2] > froms[1]
  }),
  check('XPath 每个匹配区间对应自己的文本', () => {
    const ms = queryXPath(SAMPLE, '//catalog/book/title').matches
    return ms.map((m) => SAMPLE.slice(m.from, m.to)).join('|').includes('设计中的设计')
  }),
  eq('XPath 属性匹配', queryXPath(SAMPLE, '//book/@category').matches.length, 3),
  eq('XPath 无匹配给出提示', queryXPath(SAMPLE, '//missing').warnings.length > 0, true),
  throws('XPath 非法表达式报错', () => queryXPath(SAMPLE, '//['), /XPath 表达式无效/),

  // XML → JSON 结构
  eq('XML→JSON 属性前缀', xmlToJson('<a x="1"/>').value['@x'], '1'),
  eq('XML→JSON 同名子节点合并', xmlToJson('<r><b>1</b><b>2</b></r>').value.b, ['1', '2']),
  eq('XML→JSON 纯文本直接给字符串', xmlToJson('<a>hi</a>').value, 'hi'),
  eq('XML→JSON 带属性时文本写 #text', xmlToJson('<a x="1">hi</a>').value, { '@x': '1', '#text': 'hi' }),
  throws('非法 XML 报错', () => formatXml('<a><b></a>'), /./),

  // 空白交错的混合内容同样不能改（回归：判定只看「非空白文本」时会删掉词语分隔用的空格）
  check('格式化不改纯空白交错的混合内容 textContent', () => {
    const src = '<p><em>a</em> <em>b</em></p>'
    return parse(formatXml(src, 2).xml).documentElement.textContent === parse(src).documentElement.textContent
  }),
  check('压缩不改纯空白交错的混合内容 textContent', () => {
    const src = '<p><em>a</em> <em>b</em></p>'
    return parse(minifyXml(src).xml).documentElement.textContent === parse(src).documentElement.textContent
  }),
  check('格式化保留元素后的行内空格', () => {
    const src = '<a><b>x</b> </a>'
    return parse(formatXml(src, 2).xml).documentElement.textContent === parse(src).documentElement.textContent
  }),
  check('缩进用的换行空白仍会被重排', () => minifyXml('<a>\n  <b/>\n</a>').xml === '<a><b/></a>'),

  // 叶子元素里的纯空白也是数据（回归：把「无子元素的纯空白」当可忽略，<a> </a> 被吃成 <a/>）
  eq('格式化保留叶子元素里的空白', formatXml('<a> </a>', 2).xml, '<a> </a>'),
  eq('压缩保留叶子元素里的空白', minifyXml('<a> </a>').xml, '<a> </a>'),
  eq('压缩保留叶子子元素里的空白', minifyXml('<a><b> </b><c/></a>').xml, '<a><b> </b><c/></a>'),
  check('叶子元素的空白不再误报混合内容', () =>
    formatXml('<a> </a>', 2).warnings.length === 0 &&
    minifyXml('<a> </a>').warnings.length === 0 &&
    formatXml('<a>\n</a>', 2).warnings.length === 0
  ),

  // 嵌套同名元素：每个匹配区间必须对应自己的节点（回归：开标签 → 第一个同名闭合标签会配错）
  eq(
    'XPath 嵌套同名元素各自对应自己',
    (() => {
      const src = '<r><b><b>1</b></b><b>2</b></r>'
      return queryXPath(src, '//b').matches.map((m) => src.slice(m.from, m.to))
    })(),
    ['<b><b>1</b></b>', '<b>1</b>', '<b>2</b>']
  ),
  check('XPath 嵌套同名元素区间递增不重复', () => {
    const src = '<r><b><b>1</b></b><b>2</b></r>'
    const froms = queryXPath(src, '//b').matches.map((m) => m.from)
    return froms.every((v) => v >= 0) && new Set(froms).size === froms.length && froms.every((v, i) => i === 0 || v > froms[i - 1])
  }),
  eq(
    'XPath 嵌套里的文本节点各自定位',
    (() => {
      const src = '<r><b><b>1</b></b><b>2</b></r>'
      return queryXPath(src, '//b/text()').matches.map((m) => src.slice(m.from, m.to))
    })(),
    ['1', '2']
  ),
  // 同值兄弟节点：注释 / 处理指令把文本切成两段后，第二段不能又指回第一段
  eq(
    'XPath 同值兄弟文本节点各自定位',
    (() => {
      const src = '<r>x<!--c-->x</r>'
      return queryXPath(src, '//r/text()').matches.map((m) => [m.from, m.to])
    })(),
    [[3, 4], [12, 13]]
  ),
  check('XPath 文本匹配位置互不重复且递增', () => {
    const src = '<r>one<b>one</b>one</r>'
    const froms = queryXPath(src, '//text()').matches.map((m) => m.from)
    return froms.length === 3 && froms.every((v, i) => v >= 0 && (i === 0 || v > froms[i - 1]))
  }),
  check('XPath 同值属性位置互不重复且递增', () => {
    const src = '<r><b x="1"><b x="1">1</b></b><b x="1">2</b></r>'
    const froms = queryXPath(src, '//b/@x').matches.map((m) => m.from)
    return froms.length === 3 && froms.every((v, i) => v >= 0 && (i === 0 || v > froms[i - 1]))
  }),
  eq('XML→JSON 混合内容保留词语间空格', xmlToJson('<p>Hello <b>w</b>!</p>').value, { b: 'w', '#text': 'Hello !' })
].map((c) => c)

void XMLSerializer
void XPathResult