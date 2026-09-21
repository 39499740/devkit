/**
 * T43 XML 工具箱：解析、格式化、压缩、与 JSON 互转，以及 XPath 查询。
 * 使用浏览器原生 DOMParser / document.evaluate，不做自研 XML 解析器。
 */

import { errMessage } from './errors'

export interface XmlResult {
  xml: string
  warnings: string[]
  nodes: number
  lines: number
  chars: number
}

function parse(text: string): { doc: Document; warnings: string[] } {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const err = doc.querySelector('parsererror')
  if (err) {
    const msg = (err.textContent || 'XML 解析失败').replace(/\s+/g, ' ').trim()
    throw new Error(msg.length > 200 ? `${msg.slice(0, 200)}…` : msg)
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

/** 元素自身的开标签（含属性），供高亮定位复用 */
export function openTag(el: Element): string {
  const attrs = Array.from(el.attributes)
    .map((a) => `${a.name}="${a.value}"`)
    .join(' ')
  return `<${el.tagName}${attrs ? ` ${attrs}` : ''}`
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}

/** 元素是否含非空白文本（混合内容）：这类元素绝不重排空白，原样序列化 */
function hasMixedText(el: Element): boolean {
  return Array.from(el.childNodes).some(
    (n) => (n.nodeType === 3 || n.nodeType === 4) && (n.nodeValue ?? '').trim() !== ''
  )
}

/** 原文里的 XML 声明与 DOCTYPE（DOM 不保留声明文本，DOCTYPE 内部子集也会丢，这里按原文取回） */
function extractProlog(text: string): { declaration: string | null; doctype: string | null } {
  const head = text.slice(0, text.indexOf('<', text.indexOf('<') + 1) + 1)
  const scope = text.slice(0, Math.max(0, text.length))
  const decl = /^\s*<\?xml[\s\S]*?\?>/.exec(scope)
  void head
  const dt = /<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>/i.exec(scope)
  return { declaration: decl ? decl[0].trim() : null, doctype: dt ? dt[0].trim() : null }
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
  if (hasMixedText(el)) {
    if (!warnings.includes('检测到混合内容（文本与元素交错），该元素保持原样不做缩进')) {
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
  if (kids.length === 1 && kids[0]!.nodeType === 3) {
    out.push(`${pad}${head}>${escapeText((kids[0]!.nodeValue ?? '').trim())}</${el.tagName}>`)
    return
  }
  if (kids.length === 1 && kids[0]!.nodeType === 4) {
    out.push(`${pad}${head}>${serializeExact(kids[0]!)}</${el.tagName}>`)
    return
  }
  out.push(`${pad}${head}>`)
  for (const k of kids) writeNode(k, depth + 1, indent, out, warnings)
  out.push(`${pad}</${el.tagName}>`)
}

/** 格式化：只重排“纯元素内容”，混合内容原样保留；声明 / DOCTYPE / 根节点外的注释与处理指令都保留 */
export function formatXml(text: string, indentSize = 2): XmlResult {
  const { doc, warnings } = parse(text)
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
  const prolog = extractProlog(text)
  const clone = doc.documentElement.cloneNode(true) as Element
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) walk(child)
    if (hasMixedText(el)) {
      if (!warnings.includes('检测到混合内容（文本与元素交错），该元素保持原样不做压缩')) {
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
  return { value: elementToJson(doc.documentElement), warnings }
}

function elementToJson(el: Element): unknown {
  const obj: Record<string, unknown> = {}
  for (const a of Array.from(el.attributes)) obj[`@${a.name}`] = a.value
  const childEls = Array.from(el.children)
  const text = Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => (n.nodeValue ?? '').trim())
    .join('')
    .trim()
  if (!childEls.length) {
    if (!Object.keys(obj).length) return text
    if (text) obj['#text'] = text
    return obj
  }
  for (const child of childEls) {
    const key = child.tagName
    const val = elementToJson(child)
    const prev = obj[key]
    if (prev === undefined) obj[key] = val
    else if (Array.isArray(prev)) prev.push(val)
    else obj[key] = [prev, val]
  }
  if (text) obj['#text'] = text
  return obj
}

/** JSON → XML */
export function jsonToXml(value: unknown, rootName = 'root'): XmlResult {
  const warnings: string[] = []
  if (Array.isArray(value)) {
    warnings.push('顶层是数组，已用 <root> 包裹，每个元素生成一个 <item>')
  }
  const out: string[] = []
  writeJson(rootName, value, 0, out)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${out.join('\n')}`
  return { xml, warnings, nodes: out.length, lines: out.length, chars: xml.length }
}

function writeJson(tag: string, value: unknown, depth: number, out: string[]) {
  const pad = '  '.repeat(depth)
  const name = /^[A-Za-z_][\w.-]*$/.test(tag) ? tag : 'item'
  if (value === null || value === undefined) {
    out.push(`${pad}<${name}/>`)
    return
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      out.push(`${pad}<${name}/>`)
      return
    }
    for (const v of value) writeJson(name, v, depth, out)
    return
  }
  if (typeof value !== 'object') {
    out.push(`${pad}<${name}>${escapeText(String(value))}</${name}>`)
    return
  }
  const entries = Object.entries(value as Record<string, unknown>)
  const attrs: string[] = []
  const children: [string, unknown][] = []
  for (const [k, v] of entries) {
    if (k.startsWith('@')) attrs.push(`${k.slice(1)}="${escapeAttr(String(v))}"`)
    else if (k === '#text') continue
    else children.push([k, v])
  }
  const textEntry = entries.find(([k]) => k === '#text')
  const attrStr = attrs.length ? ` ${attrs.join(' ')}` : ''
  if (!children.length) {
    if (textEntry) out.push(`${pad}<${name}${attrStr}>${escapeText(String(textEntry[1]))}</${name}>`)
    else out.push(`${pad}<${name}${attrStr}/>`)
    return
  }
  out.push(`${pad}<${name}${attrStr}>`)
  if (textEntry) out.push(`${pad}  ${escapeText(String(textEntry[1]))}`)
  for (const [k, v] of children) {
    if (!/^[A-Za-z_][\w.-]*$/.test(k)) {
      writeJson('item', v, depth + 1, out)
      continue
    }
    writeJson(k, v, depth + 1, out)
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

function nodePath(node: Node): string {
  const parts: string[] = []
  let cur: Node | null = node
  while (cur && cur.nodeType !== 9) {
    if (cur.nodeType === 1) {
      const el = cur as Element
      const siblings = el.parentNode
        ? Array.from(el.parentNode.children).filter((c) => c.tagName === el.tagName)
        : [el]
      const idx = siblings.indexOf(el) + 1
      parts.unshift(siblings.length > 1 ? `${el.tagName}[${idx}]` : el.tagName)
    } else if (cur.nodeType === 2) {
      parts.push(`@${(cur as Attr).name}`)
    } else if (cur.nodeType === 3) {
      parts.push('text()')
    }
    cur = cur.parentNode
  }
  return `/${parts.join('/')}`
}

/** 在源文本中定位节点：优先用开标签，其次用文本内容 */
function locate(source: string, node: Node, cursor: number): { from: number; to: number } {
  if (node.nodeType === 1) {
    const head = openTag(node as Element)
    let at = source.indexOf(head, cursor)
    if (at === -1) at = source.indexOf(head)
    if (at === -1) return { from: -1, to: -1 }
    const close = `</${(node as Element).tagName}>`
    const end = source.indexOf(close, at)
    return { from: at, to: end === -1 ? at + head.length : end + close.length }
  }
  if (node.nodeType === 2) {
    const a = node as Attr
    let at = source.indexOf(`${a.name}="${a.value}"`, cursor)
    if (at === -1) at = source.indexOf(`${a.name}="${a.value}"`)
    return at === -1 ? { from: -1, to: -1 } : { from: at, to: at + a.name.length + a.value.length + 3 }
  }
  const text = (node.nodeValue ?? '').trim()
  if (!text) return { from: -1, to: -1 }
  let at = source.indexOf(text, cursor)
  if (at === -1) at = source.indexOf(text)
  return at === -1 ? { from: -1, to: -1 } : { from: at, to: at + text.length }
}

/** XPath 查询：支持命名空间前缀映射；查不到或表达式非法时抛出可读错误 */
export function queryXPath(
  text: string,
  expression: string,
  namespaces: { prefix: string; uri: string }[] = []
): { matches: XPathMatch[]; warnings: string[] } {
  const { doc, warnings } = parse(text)
  const expr = expression.trim()
  if (!expr) throw new Error('请输入 XPath 表达式')
  const resolver = (prefix: string) => namespaces.find((n) => n.prefix === prefix)?.uri ?? null
  const usedPrefixes = [...new Set(expr.match(/[A-Za-z_][\w.-]*:/g) ?? [])].map((p) => p.slice(0, -1))
  for (const p of usedPrefixes) {
    if (!(resolver(p) ?? (p === 'xml' ? 'http://www.w3.org/XML/1998/namespace' : null))) {
      warnings.push(`表达式用到了未声明的前缀 ${p}:，请在上方的命名空间字段里补充映射`)
    }
  }
  let result: XPathResult
  try {
    result = doc.evaluate(expr, doc, resolver as never, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
  } catch (e) {
    throw new Error(`XPath 表达式无效：${errMessage(e)}`)
  }
  if (!result.snapshotLength) {
    warnings.push('没有匹配到节点，检查路径大小写与层级')
  }
  const matches: XPathMatch[] = []
  let cursor = 0
  for (let i = 0; i < result.snapshotLength; i += 1) {
    const node = result.snapshotItem(i)
    if (!node) continue
    const type: XPathMatch['type'] =
      node.nodeType === 2 ? 'attribute' : node.nodeType === 3 ? 'text' : 'element'
    const pos = locate(text, node, cursor)
    // 游标必须推到本次匹配的结尾，否则后续匹配会重复定位到第一条
    if (pos.to >= 0) cursor = pos.to
    matches.push({
      path: nodePath(node),
      value: (node.nodeValue ?? node.textContent ?? '').trim(),
      type,
      from: pos.from,
      to: pos.to
    })
  }
  return { matches, warnings }
}

/** 表达式结果类型速览（XPath 1.0 说明用） */
export const xpathSamples = [
  '//catalog/book/title',
  "//book[@category='tech']",
  '//book/price',
  '/catalog/book[1]',
  'count(//book)'
]
