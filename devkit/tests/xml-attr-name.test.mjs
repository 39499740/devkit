/**
 * P2-2 回归：jsonToXml 的属性名合法性。
 *
 * 背景（已实证）：utils/xml.ts 的 writeJson 对元素名做了合法性校验并回退 item，
 * 但对 `@` 前缀的属性名完全不校验。于是
 *   {"@1bad":"x"}   → <root 1bad="x">
 *   {"@a b":"x"}    → <root a b="x">
 *   {"@<script>":"x"} → <root <script>="x">
 *   {"@":"x"}       → <root ="x">
 * 全是非法 XML（浏览器 parsererror），而 jsonToXml 仍返回成功、warnings 为空。
 *
 * Node 没有 DOMParser，但 jsonToXml 是纯字符串生成，可直接测。
 * 这里自写「无 DOMParser 的良构校验」+ 属性名正则断言，不依赖浏览器。
 */
import { check, eq } from './helpers.mjs'
import { jsonToXml } from '../app/utils/xml.ts'

export const cases = []

/* ───────────────────────── 测试辅助（无 DOMParser） ───────────────────────── */

const XML_NAME_RE = /^[A-Za-z_][\w.-]*$/

/** 去掉 XML 声明，抽出所有开标签 { name, rawAttrs }（属性值里不含 < >，可安全用 [^<>]） */
function openTags(xml) {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '')
  const tags = []
  const re = /<([A-Za-z_][\w.-]*)([^<>]*)>/g
  let m
  while ((m = re.exec(body))) tags.push({ name: m[1], rawAttrs: m[2] })
  return tags
}

/**
 * 抽取属性名：`(^|\s)([^\s=]*)=` 允许捕获空名，
 * 因此 `<root ="x">` 会得到 ['']，能被良构校验识别出来（普通 ([^\s=]+)= 会漏掉空名）。
 */
function attrNames(xml) {
  const names = []
  for (const t of openTags(xml)) {
    const re = /(^|\s)([^\s=]*)=/g
    let m
    while ((m = re.exec(t.rawAttrs))) names.push(m[2])
  }
  return names
}

/** 良构校验：标签配对 + 恰好一个根元素 + 所有属性名合法非空 */
function wellFormed(xml) {
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
      if (stack.pop() !== name) return false
    } else if (selfClose) {
      if (!stack.length) rootCount += 1
    } else {
      if (!stack.length) rootCount += 1
      stack.push(name)
    }
  }
  if (stack.length !== 0 || rootCount !== 1) return false
  return attrNames(xml).every((n) => XML_NAME_RE.test(n))
}

/** 断言输出里所有属性名都合法（含非空），且不含被拒的原名 */
function noIllegalAttr(xml, rejected) {
  const names = attrNames(xml)
  const allLegal = names.every((n) => XML_NAME_RE.test(n))
  const notRejected = !names.some((n) => n === rejected)
  return allLegal && notRejected
}

const hasChinese = (s) => /[\u4e00-\u9fff]/.test(s)

/* ───────────────────────── 1. @1bad ───────────────────────── */

const bad1 = jsonToXml({ '@1bad': 'x', a: 1 }, 'root')
cases.push(
  check('@1bad：输出不再含非法属性名 1bad', () => noIllegalAttr(bad1.xml, '1bad') && !bad1.xml.includes('1bad='))
)
cases.push(check('@1bad：输出整体良构且只有一个根', () => wellFormed(bad1.xml)))
cases.push(check('@1bad：属性值被保留（落到回退属性）', () => bad1.xml.includes('attr="x"')))
cases.push(
  check('@1bad：warnings 有中文提示且说明原名非法', () =>
    bad1.warnings.some((w) => hasChinese(w) && w.includes('1bad') && /非法|不是合法/.test(w))
  )
)
cases.push(check('@1bad：不是静默成功（warnings 非空）', () => bad1.warnings.length > 0))
cases.push(check('@1bad：合法子元素 a 仍在', () => bad1.xml.includes('<a>1</a>')))
cases.push(
  eq(
    '@1bad：精确输出（原名回退为 attr）',
    bad1.xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root attr="x">\n  <a>1</a>\n</root>'
  )
)

/* ───────────────────────── 2. @a b（含空格） ───────────────────────── */

const badSpace = jsonToXml({ '@a b': 'x', a: 1 }, 'root')
cases.push(
  check('@a b：输出不再含非法属性名 a b', () =>
    noIllegalAttr(badSpace.xml, 'a b') && !/a\s+b=/.test(badSpace.xml)
  )
)
cases.push(check('@a b：输出整体良构', () => wellFormed(badSpace.xml)))
cases.push(check('@a b：值保留为 attr="x"', () => badSpace.xml.includes('attr="x"')))
cases.push(
  check('@a b：warnings 中文提示含原名 a b', () =>
    badSpace.warnings.some((w) => hasChinese(w) && w.includes('a b') && /非法|不是合法/.test(w))
  )
)

/* ───────────────────────── 3. @<script> ───────────────────────── */

const badScript = jsonToXml({ '@<script>': 'x', a: 1 }, 'root')
cases.push(
  check('@<script>：输出不再出现 <script> 标签或属性', () =>
    !badScript.xml.includes('<script') && noIllegalAttr(badScript.xml, '<script>')
  )
)
cases.push(check('@<script>：输出整体良构', () => wellFormed(badScript.xml)))
cases.push(check('@<script>：值保留为 attr="x"', () => badScript.xml.includes('attr="x"')))
cases.push(
  check('@<script>：warnings 中文提示含原名', () =>
    badScript.warnings.some((w) => hasChinese(w) && w.includes('<script>'))
  )
)

/* ───────────────────────── 4. @（空属性名） ───────────────────────── */

const badEmpty = jsonToXml({ '@': 'x', a: 1 }, 'root')
cases.push(
  check('@ 空名：不产出 ="x" 形式', () => !/\s="x"/.test(badEmpty.xml) && !badEmpty.xml.includes('<root ='))
)
cases.push(check('@ 空名：输出整体良构', () => wellFormed(badEmpty.xml)))
cases.push(check('@ 空名：属性名集合无空字符串', () => attrNames(badEmpty.xml).every((n) => n !== '')))
cases.push(check('@ 空名：值保留为 attr="x"', () => badEmpty.xml.includes('attr="x"')))
cases.push(
  check('@ 空名：warnings 明确中文提示「为空」', () =>
    badEmpty.warnings.some((w) => hasChinese(w) && /为空/.test(w))
  )
)
cases.push(
  eq(
    '@ 空名：精确输出',
    badEmpty.xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root attr="x">\n  <a>1</a>\n</root>'
  )
)

/* ───────────────────────── 5. 合法属性名行为不变 ───────────────────────── */

const ok = jsonToXml({ '@ok': '1', a: 2 }, 'root')
cases.push(
  eq(
    '@ok：合法属性名精确保留',
    ok.xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root ok="1">\n  <a>2</a>\n</root>'
  )
)
cases.push(eq('@ok：无任何 warning', ok.warnings, []))
cases.push(
  check('@ok：命名变体 _a / x-y.z 也保留', () => {
    const r = jsonToXml({ '@_a': '1', '@x-y.z': '2' }, 'root')
    return r.xml.includes('_a="1"') && r.xml.includes('x-y.z="2"') && r.warnings.length === 0
  })
)
cases.push(
  check('合法属性 + #text 行为不变', () =>
    jsonToXml({ '@id': '1', '#text': 'hi' }).xml.includes('<root id="1">hi</root>')
  )
)

/* ───────────────────────── 6. 回退名不与合法属性撞名 ───────────────────────── */

const collideA = jsonToXml({ '@attr': '1', '@1bad': 'x' }, 'root')
cases.push(
  check('撞名（合法 attr 在前）：非法名回退为 attr2', () =>
    collideA.xml.includes('attr="1"') && collideA.xml.includes('attr2="x"') && !collideA.xml.includes('1bad=')
  )
)
const collideB = jsonToXml({ '@1bad': 'x', '@attr': '1' }, 'root')
cases.push(
  check('撞名（非法名在前）：合法 attr 仍为 attr，非法名回退 attr2', () =>
    collideB.xml.includes('attr="1"') && collideB.xml.includes('attr2="x"') && !collideB.xml.includes('1bad=')
  )
)
const multiBad = jsonToXml({ '@1bad': 'x', '@2bad': 'y' }, 'root')
cases.push(
  check('多个非法属性名：依次回退 attr / attr2，均合法', () => {
    const names = attrNames(multiBad.xml)
    return multiBad.xml.includes('attr="x"') && multiBad.xml.includes('attr2="y"') && names.every((n) => XML_NAME_RE.test(n))
  })
)
cases.push(check('多个非法属性名：输出良构', () => wellFormed(multiBad.xml)))

/* ───────────────────────── 7. warning 去重 ───────────────────────── */

const dup = jsonToXml([{ '@1bad': 'x' }, { '@1bad': 'y' }], 'root')
cases.push(
  check('相同非法属性名重复出现：attr 警告去重为 1 条', () => {
    const attrWarnings = dup.warnings.filter((w) => w.includes('1bad'))
    return attrWarnings.length === 1
  })
)
cases.push(
  check('相同非法属性名：数组包裹警告仍保留', () =>
    dup.warnings.some((w) => w.includes('顶层是数组'))
  )
)

/* ───────────────────────── 8. 值转义仍生效 ───────────────────────── */

const esc = jsonToXml({ '@1bad': '<&"' }, 'root')
cases.push(
  check('回退属性名时属性值仍被转义', () =>
    esc.xml.includes('attr="&lt;&amp;&quot;"') && !esc.xml.includes('<&')
  )
)

/* ───────────────────────── 9. 回归：元素名回退与顶层数组不变 ───────────────────────── */

cases.push(
  eq(
    '回归：非法元素名仍回退 item（行为不变）',
    jsonToXml({ '1bad': 1 }, 'root').xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<root>\n  <item>1</item>\n</root>'
  )
)
cases.push(
  eq(
    '回归：顶层数组包裹输出不变',
    jsonToXml([{ a: 1 }, { a: 2 }], 'root').xml,
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
cases.push(eq('回归：对象输入无属性时无 warning', jsonToXml({ a: 1 }).warnings, []))
