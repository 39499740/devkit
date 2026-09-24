/**
 * T43 XML 工具箱：解析、格式化、压缩、与 JSON 互转，以及 XPath 查询。
 * 使用浏览器原生 DOMParser / document.evaluate，不做自研 XML 解析器。
 */

export interface XmlResult {
  xml: string
  warnings: string[]
  nodes: number
  lines: number
  chars: number
}

/**
 * 把浏览器的 XML 解析错误统一翻成中文：保留可得的「第 X 行第 Y 列附近」，
 * 不回显 Chromium/Firefox 的英文原文（parsererror 文本是英文的，直接抛给用户不友好）。
 */
function localizeXmlParseError(text: string): string {
  const msg = (text || '').replace(/\s+/g, ' ').trim()
  // Chromium：error on line 2 at column 5；Firefox：Line number 1, column 5
  const at = /line\s*(?:number\s*)?(\d+)(?:\s*(?:,|at)?\s*column\s*(\d+))?/i.exec(msg)
  if (at) {
    const col = at[2] ? `第 ${at[2]} 列` : ''
    return `XML 解析失败：第 ${at[1]} 行${col}附近存在语法错误（常见于标签未闭合、属性缺引号或非法字符）`
  }
  return 'XML 解析失败：文档格式不正确（常见于标签未闭合、属性缺引号或非法字符）'
}

function parse(text: string): { doc: Document; warnings: string[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) {
    throw new Error(localizeXmlParseError(err.textContent ?? ''))
  }
  const warnings: string[] = []
  if (/^\s*<\?xml[\s\S]*?encoding=/i.test(text) && !/encoding=["']utf-8["']/i.test(text)) {
    const m = text.match(/encoding=["']([^"']+)["']/i)
    warnings.push(`文档声明编码为 ${m?.[1] ?? '非 UTF-8'}，浏览器解析时按 UTF-8 处理`)
  }
  if (doc.documentElement.tagName === 'parsererror') throw new Error('XML 文档无效')
  return { doc, warnings }
}

function countNodes(el: Element): number {
  let n = 1
  for (const child of Array.from(el.children)) n += countNodes(child)
  return n
}

/**
 * XML 元素嵌套深度上限。DOMParser 能解析极深文档，但 formatXml / minifyXml / xmlToJson 的
 * 递归序列化与遍历会随层数线性加深调用栈，约 4000 层即抛原生英文
 * `RangeError: Maximum call stack size exceeded`。这里在进入递归前做迭代预检，
 * 超过上限直接抛中文错误，避免爆栈，也不把英文原文回显给用户。
 */
export const MAX_XML_DEPTH = 2000

/** 元素节点总数上限：节点过多时提前中止，避免长时间占用主线程 */
export const MAX_XML_NODES = 200000

/**
 * 解析结果的深度 / 节点数预检。用显式栈迭代，自身不会爆栈；
 * 超过上限时抛中文错误。供 formatXml / minifyXml / xmlToJson / elementToJson
 * 在递归前调用。「元素深度」以根元素为第 1 层，单元素树深度为 1。
 */
export function assertXmlDepthWithinLimit(root: Element): void {
  const stack: Array<{ el: Element; depth: number }> = [{ el: root, depth: 1 }]
  let nodes = 0
  while (stack.length) {
    const { el, depth } = stack.pop()!
    nodes += 1
    if (depth > MAX_XML_DEPTH) {
      throw new Error(`XML 嵌套层级过深（超过 ${MAX_XML_DEPTH} 层），已中止处理，请减少嵌套层级`)
    }
    if (nodes > MAX_XML_NODES) {
      throw new Error(`XML 元素节点过多（超过 ${MAX_XML_NODES} 个），已中止处理，请减少节点数量`)
    }
    // `?? []`：真实 DOM 一定有 children；无 DOMParser 的 Node 测试替身可能缺省该成员，
    // 这里容忍缺省，避免深度预检在测试环境抛 TypeError（语义不变，仍按 0 子节点计）。
    for (const child of Array.from(el.children ?? [])) stack.push({ el: child, depth: depth + 1 })
  }
}

/** 元素自身的开标签（含属性），供高亮定位复用 */
export function openTag(el: Element): string {
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .join(' ')
  return `<${el.tagName}${attrs ? ` ${attrs}` : ''}`
}

/**
 * XML 1.0 非法控制字符：U+0000–U+0008 / U+000B / U+000C / U+000E–U+001F。
 * 直接写进文本或属性会让产物无法被 XML 解析器解析（Chromium/Firefox 报 parsererror）。
 * 这里统一替换为 `&#xFFFD;`（替换字符）；U+0009(Tab) / U+000A(LF) / U+000D(CR) 是合法字符，保持原样。
 */
const XML_INVALID_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/
const XML_INVALID_CHAR_G = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

const CONTROL_CHAR_WARNING =
  '检测到 XML 1.0 非法控制字符（U+0000–U+0008 / U+000B / U+000C / U+000E–U+001F），已替换为 &#xFFFD; 以保证输出可解析'

/** 文本转义：先转义 & < >，再替换非法控制字符（控制字符不是 &，不会被二次转义成 &amp;#xFFFD;） */
export function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(XML_INVALID_CHAR_G, '&#xFFFD;')
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}

/** 字符串里是否含 XML 1.0 非法控制字符（非全局正则，避免 lastIndex 状态） */
function hasInvalidXmlChar(s: string): boolean {
  return XML_INVALID_CHAR_RE.test(s)
}

/** 元素子节点里有没有元素（决定一段纯空白是不是「元素之间的缩进」） */
function hasElementChildren(el: Element): boolean {
  return Array.from(el.childNodes).some((n) => n.nodeType === 1)
}

/**
 * 元素是否含“有意义的文本”（即混合内容）：这类元素绝不重排空白，整段原样序列化。
 * - 含非空白文本、或含 CDATA → 有意义；
 * - 纯空白只有在「元素之间的换行缩进」时才算可重排（<a>\n  <b/>\n</a> → <a><b/></a>）；
 * - 其余纯空白一律保留：<p><em>a</em> <em>b</em></p> 里的空格是词语分隔符，
 *   而叶子元素里的空白（<a> </a>）删掉就是改数据。
 */
function hasSignificantText(el: Element): boolean {
  const hasChildren = hasElementChildren(el)
  return Array.from(el.childNodes).some((n) => {
    if (n.nodeType === 4) return true
    if (n.nodeType !== 3) return false
    const value = n.nodeValue ?? ''
    if (value.trim() !== '') return true
    return !(hasChildren && /[\r\n]/.test(value))
  })
}

/**
 * 原文里的 XML 声明与 DOCTYPE（DOM 不保留声明文本，DOCTYPE 内部子集也会丢，这里按原文取回）。
 * 只在「文档前导区域」识别：跳过前导空白 / 注释 / 处理指令 / XML 声明，遇到根元素起点即停止。
 * 因此注释或 CDATA 里的 `<!DOCTYPE …>` 不会被误当成真实声明（旧实现用整篇文本匹配会误报）。
 */
export function extractProlog(text: string): { declaration: string | null; doctype: string | null } {
  let declaration: string | null = null
  let doctype: string | null = null
  let i = 0
  const n = text.length
  while (i < n) {
    while (i < n && /\s/.test(text[i]!)) i += 1
    if (i >= n) break
    // XML 声明只能出现在最前导；`<?xml-stylesheet?>` 这类处理指令走下面的通用 PI 分支
    if (declaration === null && /^<\?xml[\s?]/.test(text.slice(i, i + 6))) {
      const end = text.indexOf('?>', i + 5)
      if (end === -1) break
      declaration = text.slice(i, end + 2).trim()
      i = end + 2
      continue
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end === -1) break
      i = end + 3
      continue
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2)
      if (end === -1) break
      i = end + 2
      continue
    }
    if (/^<!doctype/i.test(text.slice(i, i + 9))) {
      // 扫描到配对 '>'：跳过引号里的内容与内部子集 [...]（内部子集可含 '>'）
      let j = i + 9
      let inSubset = false
      let quote: string | null = null
      while (j < n) {
        const ch = text[j]!
        if (quote) {
          if (ch === quote) quote = null
        } else if (ch === '"' || ch === "'") {
          quote = ch
        } else if (ch === '[') {
          inSubset = true
        } else if (ch === ']') {
          inSubset = false
        } else if (ch === '>' && !inSubset) {
          j += 1
          break
        }
        j += 1
      }
      doctype = text.slice(i, j).trim()
      i = j
      continue
    }
    // 遇到根元素 / 其它内容：前导区域结束
    break
  }
  return { declaration, doctype }
}

function serializeExact(node: Node): string {
  return new XMLSerializer().serializeToString(node)
}

function writeNode(node: Node, depth: number, indent: string, out: string[], warnings: string[]) {
  const pad = indent.repeat(depth)
  if (node.nodeType === 8 || node.nodeType === 7) {
    out.push(pad + serializeExact(node))
    return
  }
  if (node.nodeType === 4) {
    out.push(pad + serializeExact(node))
    return
  }
  if (node.nodeType !== 1) return
  const el = node as Element

  // 混合内容：一个空白都不动、一个换行都不加，保证 textContent 与原文一致
  if (hasSignificantText(el)) {
    // 只有真「文本与元素交错」才提示；叶子元素里的空白属正常保留，不报混合内容
    if (hasElementChildren(el) && !warnings.includes('检测到混合内容（文本与元素交错），该元素保持原样不做缩进')) {
      warnings.push('检测到混合内容（文本与元素交错），该元素保持原样不做缩进')
    }
    out.push(pad + serializeExact(el))
    return
  }

  const kids = Array.from(el.childNodes).filter((n) => n.nodeType !== 3 || (n.nodeValue ?? '').trim() !== '')
  const head = openTag(el)
  if (!kids.length) {
    out.push(`${pad}${head}/>`)
    return
  }
  out.push(`${pad}${head}>`)
  for (const k of kids) writeNode(k, depth + 1, indent, out, warnings)
  out.push(`${pad}</${el.tagName}>`)
}

/** 格式化：只重排“纯元素内容”，混合内容原样保留；声明 / DOCTYPE / 根节点外的注释与处理指令都保留 */
export function formatXml(text: string, indentSize = 2): XmlResult {
  const { doc, warnings } = parse(text)
  assertXmlDepthWithinLimit(doc.documentElement)
  const prolog = extractProlog(text)
  const out: string[] = []
  if (prolog.declaration) out.push(prolog.declaration)
  if (prolog.doctype) out.push(prolog.doctype)
  for (const node of Array.from(doc.childNodes)) {
    if (node.nodeType === 1) writeNode(node, 0, ' '.repeat(indentSize), out, warnings)
    else if (node.nodeType === 8 || node.nodeType === 7) out.push(serializeExact(node))
  }
  const xml = out.join('\n')
  return { xml, warnings, nodes: countNodes(doc.documentElement), lines: out.length, chars: xml.length }
}

/** 压缩：只在“纯元素内容”里移除元素之间的空白节点；声明与 DOCTYPE 保留 */
export function minifyXml(text: string): XmlResult {
  const { doc, warnings } = parse(text)
  assertXmlDepthWithinLimit(doc.documentElement)
  const prolog = extractProlog(text)
  const clone = doc.documentElement.cloneNode(true) as Element
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) walk(child)
    if (hasSignificantText(el)) {
      if (hasElementChildren(el) && !warnings.includes('检测到混合内容（文本与元素交错），该元素保持原样不做压缩')) {
        warnings.push('检测到混合内容（文本与元素交错），该元素保持原样不做压缩')
      }
      return
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3 && !(child.nodeValue ?? '').trim()) el.removeChild(child)
    }
  }
  walk(clone)
  const body = serializeExact(clone)
  const xml = [prolog.declaration, prolog.doctype, body].filter(Boolean).join('')
  return { xml, warnings, nodes: countNodes(doc.documentElement), lines: 1, chars: xml.length }
}

/**
 * XML → JSON：
 * - 属性写成 @name
 * - 只有文本、没有属性与子元素的节点直接给字符串
 * - 既含属性/子元素又含文本时，文本放在 #text
 * - 同名子节点合并为数组
 */
export function xmlToJson(text: string): { value: unknown; warnings: string[] } {
  const { doc, warnings } = parse(text)
  assertXmlDepthWithinLimit(doc.documentElement)
  return { value: elementToJsonNode(doc.documentElement), warnings }
}

/**
 * 解析结果对象落键统一走 defineProperty：
 * 键为 `__proto__` 时 `obj[key] = …` 会触发 Object.prototype 的原型 setter，
 * 结果是该键被静默丢弃、还会把结果对象的原型改成写入值。
 */
function setOwnKey(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}

/**
 * 把子元素值并入结果对象：首次出现写自有键，已有同名兄弟合并为数组。
 * 「已存在」用 hasOwnProperty 判定，不读原型链，避免 `constructor` / `toString` /
 * `valueOf` 作为普通元素名时被误判成「已有同名兄弟」，产出 [原型成员, 值] 这类脏数组。
 */
export function assignChildValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    setOwnKey(obj, key, value)
    return
  }
  const prev = obj[key]
  if (Array.isArray(prev)) prev.push(value)
  else setOwnKey(obj, key, [prev, value])
}

/**
 * 元素 → JSON。导出以便在无 DOMParser 的 Node 环境里用等价的假 DOM 节点做单元验证
 * （只依赖 tagName / attributes / children / childNodes 四个成员）。
 * 进入递归前先做深度预检：极深树（约 4000 层）会让递归遍历爆栈，这里提前抛中文错误。
 */
export function elementToJson(el: Element): unknown {
  assertXmlDepthWithinLimit(el)
  return elementToJsonNode(el)
}

/** elementToJson 的递归主体：仅由已通过预检的根节点进入，内部递归不再重复预检（避免 O(n²)） */
function elementToJsonNode(el: Element): unknown {
  const obj: Record<string, unknown> = {}
  for (const a of Array.from(el.attributes)) setOwnKey(obj, `@${a.name}`, a.value)
  const childEls = Array.from(el.children)
  // 文本节点与 CDATA 一起按出现顺序拼接（CDATA 是显式数据，即使全空白也不按「缩进」丢弃）；
  // 保留文本节点的原始值再拼接：逐个 trim 会把 <p>Hello <b>w</b>!</p> 的 "Hello " 与 "!" 粘成 "Hello!"
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 4 || (n.nodeType === 3 && (n.nodeValue ?? '').trim() !== ''))
    .map((n) => n.nodeValue ?? '')
    .join('')
    .trim()
  if (!childEls.length) {
    if (!Object.keys(obj).length) return text
    if (text) setOwnKey(obj, '#text', text)
    return obj
  }
  for (const child of childEls) {
    assignChildValue(obj, child.tagName, elementToJsonNode(child))
  }
  if (text) setOwnKey(obj, '#text', text)
  return obj
}

/**
 * JSON → XML。
 * 顶层是数组时必须额外套一层根元素，否则每个元素会各自生成一个同名根元素，
 * 产出「多个根元素」的非法 XML。这里统一用 rootName 作为外层根、数组元素用 <item>，
 * 与下方 warning 文案保持一致；对象 / 标量输入的既有行为不变。
 */
export function jsonToXml(value: unknown, rootName = 'root'): XmlResult {
  const warnings: string[] = []
  const out: string[] = []
  if (Array.isArray(value)) {
    if (!XML_NAME_RE.test(rootName)) {
      pushWarning(warnings, `元素名“${rootName}”不是合法的 XML 名称，已改用 root 作为根标签`)
    }
    const wrapper = XML_NAME_RE.test(rootName) ? rootName : 'root'
    warnings.push(`顶层是数组，已用 <${wrapper}> 包裹，每个元素生成一个 <item>`)
    if (!value.length) {
      out.push(`<${wrapper}/>`)
    } else {
      if (value.some((v) => Array.isArray(v))) pushWarning(warnings, nestedArrayWarning('item'))
      out.push(`<${wrapper}>`)
      for (const v of value) writeJson('item', v, 1, out, warnings)
      out.push(`</${wrapper}>`)
    }
  } else {
    writeJson(rootName, value, 0, out, warnings)
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${out.join('\n')}`
  return { xml, warnings, nodes: out.length, lines: out.length, chars: xml.length }
}

/** 合法 XML 名称（元素名与属性名共用）：首字符为字母/下划线，其后可含字母数字、下划线、点、连字符 */
const XML_NAME_RE = /^[A-Za-z_][\w.-]*$/

/** 非法属性名的回退前缀（追加数字后缀以避免与同元素内其它属性重名） */
const ATTR_FALLBACK = 'attr'

/** 仅在文案尚未出现时追加，避免同一非法名在多处出现时刷屏 */
function pushWarning(warnings: string[], message: string) {
  if (!warnings.includes(message)) warnings.push(message)
}

/**
 * 嵌套数组告警文案：JSON 数组在 XML 里只能表达为「同名重复标签」，
 * 一旦数组元素本身还是数组，内层会被平铺成同名重复标签、原始层级丢失，
 * 这里明确告警，不再静默拍平。
 */
function nestedArrayWarning(tag: string): string {
  return `检测到嵌套数组：数组元素本身还是数组，已把内层元素平铺为重复的 <${tag}> 标签，原始数组层级无法表达`
}

/** 转义文本并在含非法控制字符时追加告警（不静默丢弃） */
function escapeTextChecked(s: string, warnings: string[]): string {
  if (hasInvalidXmlChar(s)) pushWarning(warnings, CONTROL_CHAR_WARNING)
  return escapeText(s)
}

/** 转义属性值并在含非法控制字符时追加告警 */
function escapeAttrChecked(s: string, warnings: string[]): string {
  if (hasInvalidXmlChar(s)) pushWarning(warnings, CONTROL_CHAR_WARNING)
  return escapeAttr(s)
}

/**
 * 非法属性名（含 `@` 后为空）不能直接写进开标签，否则产出 `<root 1bad="x">` / `<root ="x">`
 * 这类非法 XML（浏览器 parsererror），而调用方却拿到「成功 + 无告警」的结果。
 * 这里回退为合法属性名 attr / attr2…，并在 warnings 里说明原名非法与处理方式。
 */
function safeAttrName(raw: string, used: Set<string>): string {
  let candidate = ATTR_FALLBACK
  let n = 1
  while (used.has(candidate)) {
    n += 1
    candidate = `${ATTR_FALLBACK}${n}`
  }
  used.add(candidate)
  return candidate
}

function writeJson(tag: string, value: unknown, depth: number, out: string[], warnings: string[]) {
  const pad = '  '.repeat(depth)
  const name = XML_NAME_RE.test(tag) ? tag : 'item'
  // 非法元素名同样不能静默回退：与属性名告警（safeAttrName 分支）保持一致的提示口径
  if (name !== tag) {
    pushWarning(warnings, `元素名“${tag}”不是合法的 XML 名称，已改用 item 标签承载该节点`)
  }
  if (value === null || value === undefined) {
    out.push(`${pad}<${name}/>`)
    return
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      out.push(`${pad}<${name}/>`)
      return
    }
    if (value.some((v) => Array.isArray(v))) pushWarning(warnings, nestedArrayWarning(name))
    for (const v of value) writeJson(name, v, depth, out, warnings)
    return
  }
  if (typeof value !== 'object') {
    out.push(`${pad}<${name}>${escapeTextChecked(String(value), warnings)}</${name}>`)
    return
  }
  const entries = Object.entries(value as Record<string, unknown>)
  const attrs: string[] = []
  const children: [string, unknown][] = []
  // 先登记全部合法属性名，保证非法名回退出的 attr / attr2… 不会与同元素里的合法属性撞名
  const usedAttrNames = new Set<string>()
  for (const [k] of entries) {
    if (k.startsWith('@') && XML_NAME_RE.test(k.slice(1))) usedAttrNames.add(k.slice(1))
  }
  for (const [k, v] of entries) {
    if (k.startsWith('@')) {
      const raw = k.slice(1)
      if (XML_NAME_RE.test(raw)) {
        attrs.push(`${raw}="${escapeAttrChecked(String(v), warnings)}"`)
        continue
      }
      const fallback = safeAttrName(raw, usedAttrNames)
      attrs.push(`${fallback}="${escapeAttrChecked(String(v), warnings)}"`)
      if (raw === '') {
        pushWarning(warnings, `JSON 键 "@" 的属性名为空，已改用 ${fallback} 属性承载原值`)
      } else {
        pushWarning(warnings, `属性名“${raw}”不是合法的 XML 名称，已改用 ${fallback} 属性承载原值`)
      }
      continue
    }
    if (k === '#text') continue
    children.push([k, v])
  }
  const textEntry = entries.find(([k]) => k === '#text')
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''
  if (!children.length) {
    if (textEntry) out.push(`${pad}<${name}${attrStr}>${escapeTextChecked(String(textEntry[1]), warnings)}</${name}>`)
    else out.push(`${pad}<${name}${attrStr}/>`)
    return
  }
  out.push(`${pad}<${name}${attrStr}>`)
  if (textEntry) out.push(`${pad}  ${escapeTextChecked(String(textEntry[1]), warnings)}`)
  for (const [k, v] of children) {
    // 非法元素名交给 writeJson 统一回退 item 并追加中文告警（原本这里静默回退）
    writeJson(k, v, depth + 1, out, warnings)
  }
  out.push(`${pad}</${name}>`)
}

export interface XPathMatch {
  /** 规范化路径，如 /catalog/book[1]/title */
  path: string
  /** 节点文本内容（属性为属性值） */
  value: string
  type: 'element' | 'attribute' | 'text'
  /** 源文本中的出现位置，用于高亮（-1 表示未定位到） */
  from: number
  to: number
}

/** 标量 XPath 结果类型（number / string / boolean） */
export type XPathScalarType = 'number' | 'string' | 'boolean'
/** 查询结果类型：节点集或三种标量 */
export type XPathResultKind = 'nodeset' | XPathScalarType

export interface XPathQueryResult {
  /** 节点集匹配（标量结果时为空数组），保持既有 { path, value, type, from, to } 结构 */
  matches: XPathMatch[]
  warnings: string[]
  /** 标量结果值（number / string / boolean）；节点集结果为 null */
  value: number | string | boolean | null
  /** 结果类型：节点集为 nodeset，其余为 number / string / boolean */
  type: XPathResultKind
}

/** 标量结果类型（number / string / boolean）；节点集或未知类型返回 null */
function scalarKind(result: XPathResult): XPathScalarType | null {
  if (result.resultType === XPathResult.NUMBER_TYPE) return 'number'
  if (result.resultType === XPathResult.STRING_TYPE) return 'string'
  if (result.resultType === XPathResult.BOOLEAN_TYPE) return 'boolean'
  return null
}

/** 把 XPath 节点集统一收集成数组，兼容快照 / 迭代器 / 单节点三种返回方式（ANY_TYPE 下多为迭代器） */
function collectXPathNodes(result: XPathResult): Node[] {
  const rt = result.resultType
  const nodes: Node[] = []
  if (rt === XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE || rt === XPathResult.ORDERED_NODE_SNAPSHOT_TYPE) {
    for (let i = 0; i < result.snapshotLength; i += 1) {
      const node = result.snapshotItem(i)
      if (node) nodes.push(node)
    }
    return nodes
  }
  if (rt === XPathResult.UNORDERED_NODE_ITERATOR_TYPE || rt === XPathResult.ORDERED_NODE_ITERATOR_TYPE) {
    let node = result.iterateNext()
    while (node) {
      nodes.push(node)
      node = result.iterateNext()
    }
    return nodes
  }
  if (rt === XPathResult.ANY_UNORDERED_NODE_TYPE || rt === XPathResult.FIRST_ORDERED_NODE_TYPE) {
    if (result.singleNodeValue) nodes.push(result.singleNodeValue)
  }
  return nodes
}

/** 同名兄弟中的 1-based 序号与该组总数（供 nodePath 输出 `tag[idx]` 或裸 `tag`） */
export interface SameNamePosition {
  index: number
  total: number
}

/**
 * 为根节点下的所有元素一次性预建「同名兄弟位置」索引：
 * key = 元素本身，value = 它在「同一父节点、同名 tag」分组里的 1-based 序号与组大小。
 *
 * 修复 P1-1：旧 nodePath 对每个匹配节点都 `Array.from(parent.children).filter(同名)`，
 * `//a` 在 n 个同名兄弟下退化成 O(n²)。预建索引后，每个节点的路径计算是 O(1) 查表，
 * 整次查询回到 O(n)。这里只依赖 tagName / children 两个成员，Node 侧可用假 DOM 等价单测。
 */
export function buildSameNameIndex(root: Node): Map<Node, SameNamePosition> {
  const index = new Map<Node, SameNamePosition>()
  const stack: Node[] = [root]
  while (stack.length) {
    const parent = stack.pop()!
    const children = Array.from((parent as Element).children ?? [])
    if (children.length) {
      const groups = new Map<string, Element[]>()
      for (const child of children) {
        if (child.nodeType !== 1) continue
        const group = groups.get(child.tagName)
        if (group) group.push(child)
        else groups.set(child.tagName, [child])
      }
      for (const group of groups.values()) {
        for (let i = 0; i < group.length; i += 1) index.set(group[i]!, { index: i + 1, total: group.length })
      }
      for (const child of children) {
        if (child.nodeType === 1) stack.push(child)
      }
    }
  }
  return index
}

/**
 * 元素的同名兄弟路径段：命中预建索引时 O(1)；索引用不上（未传入 / 非文档内节点）时退回
 * 旧的 O(同名兄弟数) 扫描。两者输出完全一致（`/r/a[1]`、唯一同名不带序号）。
 */
function sameNameSegment(el: Element, index: Map<Node, SameNamePosition> | undefined): string {
  const pos = index?.get(el)
  if (pos) return pos.total > 1 ? `${el.tagName}[${pos.index}]` : el.tagName
  const siblings = el.parentNode
    ? Array.from(el.parentNode.children).filter((c) => c.tagName === el.tagName)
    : [el]
  const idx = siblings.indexOf(el) + 1
  return siblings.length > 1 ? `${el.tagName}[${idx}]` : el.tagName
}

/**
 * 节点 → 规范化路径（如 `/catalog/book[1]/title`）。
 * 传入 buildSameNameIndex 的结果可把每层同名序号查询降为 O(1)；不传则退回朴素扫描。
 */
export function nodePath(node: Node, index?: Map<Node, SameNamePosition>): string {
  const parts: string[] = []
  let cur: Node | null = node
  while (cur && cur.nodeType !== 9) {
    if (cur.nodeType === 1) {
      const el = cur as Element
      parts.unshift(sameNameSegment(el, index))
    } else if (cur.nodeType === 2) {
      parts.push(`@${(cur as Attr).name}`)
    } else if (cur.nodeType === 3) {
      parts.push('text()')
    }
    cur = cur.parentNode
  }
  return `/${parts.join('/')}`
}

interface TagSpan {
  name: string
  from: number
  to: number
}

/** 找到标签的结束 '>'，跳过引号里的内容 */
function findTagEnd(source: string, lt: number): number {
  let quote: string | null = null
  for (let i = lt + 1; i < source.length; i += 1) {
    const ch = source[i]!
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '>') return i
  }
  return -1
}

/**
 * 按原文顺序扫描标签，用栈配对出每个元素的完整区间（from = 开标签起点，to = 配对闭合标签终点）。
 * 嵌套时按标签名配对，所以 <r><b><b>1</b></b><b>2</b></r> 里内层 <b> 也能拿到自己的区间，
 * 不会像「开标签 → 第一个同名闭合标签」那样把内层与外层配错。
 */
function scanTagSpans(source: string): TagSpan[] {
  const spans: TagSpan[] = []
  const stack: number[] = []
  let i = 0
  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt === -1) break
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt + 4)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9)
      i = end === -1 ? source.length : end + 3
      continue
    }
    if (source.startsWith('<?', lt)) {
      const end = source.indexOf('?>', lt + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt + 2)
      i = end === -1 ? source.length : end + 1
      continue
    }
    const gt = findTagEnd(source, lt)
    if (gt === -1) break
    const raw = source.slice(lt, gt + 1)
    i = gt + 1
    const head = /^<\s*(\/?)\s*([^\s/>]+)/.exec(raw)
    if (!head) continue
    const name = head[2]!
    if (head[1] === '/') {
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        const idx = stack[k]!
        if (spans[idx]!.name === name) {
          spans[idx]!.to = gt + 1
          stack.length = k
          break
        }
      }
      continue
    }
    const selfClosing = /\/\s*>$/.test(raw)
    spans.push({ name, from: lt, to: gt + 1 })
    if (!selfClosing) stack.push(spans.length - 1)
  }
  return spans
}

/** 把扫描出的区间按文档顺序对齐到 DOM 元素；数量或标签名对不上就返回 null（调用方回退到游标定位） */
function buildElementSpans(doc: Document, source: string): Map<Element, TagSpan> | null {
  const els = Array.from(doc.getElementsByTagName('*'))
  const spans = scanTagSpans(source)
  if (!els.length || els.length !== spans.length) return null
  const map = new Map<Element, TagSpan>()
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i]!
    const span = spans[i]!
    if (el.tagName !== span.name) return null
    map.set(el, span)
  }
  return map
}

function searchIn(source: string, needle: string, from: number, to: number): number {
  const at = source.indexOf(needle, from)
  return at >= 0 && at < to ? at : -1
}

/**
 * 在所属元素区间内定位一段内容：先从游标之后找，找不到再退回区间开头。
 * 文本 / 属性分支若总从区间开头找，同一元素里两个值相同的兄弟文本节点
 * （<r>x<!--c-->x</r>）会一起指向第一个，重复定位。
 */
function searchInSpan(source: string, needle: string, from: number, to: number, cursor: number): number {
  const afterCursor = searchIn(source, needle, Math.max(from, cursor), to)
  return afterCursor >= 0 ? afterCursor : searchIn(source, needle, from, to)
}

/**
 * 在源文本中定位节点：元素优先用扫描配对出的区间（嵌套同名也能各自对应自己），
 * 属性 / 文本节点优先在所属元素的区间内搜索，全部失败再退回原来的游标搜索。
 */
function locate(
  source: string,
  node: Node,
  cursor: number,
  spans: Map<Element, TagSpan> | null
): { from: number; to: number } {
  if (node.nodeType === 1) {
    const el = node as Element
    const span = spans?.get(el)
    if (span) return { from: span.from, to: span.to }
    const head = openTag(el)
    let at = source.indexOf(head, cursor)
    if (at === -1) at = source.indexOf(head)
    if (at === -1) return { from: -1, to: -1 }
    const close = `</${el.tagName}>`
    const end = source.indexOf(close, at)
    return { from: at, to: end === -1 ? at + head.length : end + close.length }
  }
  if (node.nodeType === 2) {
    const a = node as Attr
    const needle = `${a.name}="${a.value}"`
    const owner = a.ownerElement ? spans?.get(a.ownerElement) : undefined
    if (owner) {
      const inOwner = searchInSpan(source, needle, owner.from, owner.to, cursor)
      if (inOwner >= 0) return { from: inOwner, to: inOwner + needle.length }
    }
    let at = source.indexOf(needle, cursor)
    if (at === -1) at = source.indexOf(needle)
    return at === -1 ? { from: -1, to: -1 } : { from: at, to: at + needle.length }
  }
  const text = (node.nodeValue ?? '').trim()
  if (!text) return { from: -1, to: -1 }
  const parent = node.parentElement
  const parentSpan = parent ? spans?.get(parent) : undefined
  if (parentSpan) {
    const inParent = searchInSpan(source, text, parentSpan.from, parentSpan.to, cursor)
    if (inParent >= 0) return { from: inParent, to: inParent + text.length }
  }
  let at = source.indexOf(text, cursor)
  if (at === -1) at = source.indexOf(text)
  return at === -1 ? { from: -1, to: -1 } : { from: at, to: at + text.length }
}

/**
 * XPath 1.0 预定义的 `xml` 命名空间 URI。规范要求该前缀始终绑定到此 URI、无需调用方声明；
 * 旧 resolver 对 `xml` 返回 null，导致标准 `//*[@xml:lang]` 被 evaluate 拒绝后误报「表达式无效」。
 */
const XML_NAMESPACE_URI = 'http://www.w3.org/XML/1998/namespace'

/**
 * 提取表达式中实际使用的前缀：
 * - 先剔除字符串字面量（'…' / "…"），避免把 `contains(@href,'http://…')` 里的 URL 误判成前缀；
 * - 只保留 `name:` 且其后不是 `:` 的形式，排除 `child::` / `namespace::` 这类轴名。
 */
function xpathUsedPrefixes(expr: string): string[] {
  const stripped = expr.replace(/'[^']*'|"[^"]*"/g, ' ')
  const re = /([A-Za-z_][\w.-]*):(?!:)/g
  const found = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) found.add(m[1]!)
  return [...found]
}

/** XPath 查询：支持命名空间前缀映射；节点集返回 matches，标量（number/string/boolean）返回 value/type；表达式非法时抛出可读错误 */
export function queryXPath(
  text: string,
  expression: string,
  namespaces: { prefix: string; uri: string }[] = []
): XPathQueryResult {
  const { doc, warnings } = parse(text)
  // 与 formatXml / minifyXml / xmlToJson 一致：进入节点遍历前先做深度 / 节点数预检，
  // 超大文档在中文错误里快速中止，而不是在后续扫描里长时间冻结主线程。
  assertXmlDepthWithinLimit(doc.documentElement)
  const expr = expression.trim()
  if (!expr) throw new Error('请输入 XPath 表达式')
  const resolver = (prefix: string) =>
    prefix === 'xml' ? XML_NAMESPACE_URI : namespaces.find((n) => n.prefix === prefix)?.uri ?? null
  // evaluate 前先算出未声明前缀：旧实现只把告警丢进 warnings，但真实引擎会先抛异常，
  // 告警永远到不了用户手里，最终只看到笼统的「表达式无效」。这里改成抛出含前缀名的中文错误。
  const undeclaredPrefixes = xpathUsedPrefixes(expr).filter((p) => !resolver(p))
  let result: XPathResult
  try {
    // ANY_TYPE：让 count()/string()/boolean() 等数值/字符串/布尔结果按真实类型返回，
    // 而不是被当成节点集（旧实现固定 ORDERED_NODE_SNAPSHOT_TYPE，标量结果 snapshotLength 为 0 → 误报「表达式无效」）
    result = doc.evaluate(expr, doc, resolver as never, XPathResult.ANY_TYPE, null)
  } catch {
    // 未声明前缀是 evaluate 抛异常的主因之一；优先给出含前缀名的中文错误，不再落到笼统文案。
    if (undeclaredPrefixes.length) {
      throw new Error(`XPath 使用了未声明的前缀：${undeclaredPrefixes[0]}:，请在命名空间字段里补充映射`)
    }
    const shown = expr.length > 60 ? `${expr.slice(0, 60)}…` : expr
    throw new Error(
      `XPath 表达式无效：请检查路径语法、括号与引号是否配对（表达式：${shown}）`
    )
  }
  // 求值引擎未因未声明前缀报错时（如无 DOMParser 的测试替身），保持既有中文告警，不静默。
  for (const p of undeclaredPrefixes) {
    warnings.push(`表达式用到了未声明的前缀 ${p}:，请在上方的命名空间字段里补充映射`)
  }

  // 标量结果：直接返回 value / type，matches 为空数组
  const kind = scalarKind(result)
  if (kind) {
    const value =
      kind === 'number' ? result.numberValue : kind === 'string' ? result.stringValue : result.booleanValue
    return { matches: [], warnings, value, type: kind }
  }

  const nodes = collectXPathNodes(result)
  if (!nodes.length) {
    warnings.push('没有匹配到节点，检查路径大小写与层级')
  }
  const spans = buildElementSpans(doc, text)
  // 一次性预建同名兄弟索引：nodePath 对每个节点 O(1) 查序号，避免同名兄弟多时退化成 O(n²)
  const sameNameIndex = nodes.length ? buildSameNameIndex(doc.documentElement) : undefined
  const matches: XPathMatch[] = []
  let cursor = 0
  for (const node of nodes) {
    const type: XPathMatch['type'] =
      node.nodeType === 2 ? 'attribute' : node.nodeType === 3 ? 'text' : 'element'
    const pos = locate(text, node, cursor, spans)
    // 游标必须推到本次匹配的结尾，否则后续匹配会重复定位到第一条
    if (pos.to >= 0) cursor = pos.to
    matches.push({
      path: nodePath(node, sameNameIndex),
      value: (node.nodeValue ?? node.textContent ?? '').trim(),
      type,
      from: pos.from,
      to: pos.to
    })
  }
  return { matches, warnings, value: null, type: 'nodeset' }
}

/** 表达式结果类型速览（XPath 1.0 说明用） */
export const xpathSamples = [
  '//catalog/book/title',
  "//book[@category='tech']",
  '//book/price',
  '/catalog/book[1]',
  'count(//book)'
]
