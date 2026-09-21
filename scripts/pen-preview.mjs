#!/usr/bin/env node
/**
 * design.pen → HTML 预览（只读，供人工/浏览器目视复核设计稿）
 *
 * 用法：
 *   node scripts/pen-preview.mjs                     # 渲染 A7 批次 9 张画板
 *   node scripts/pen-preview.mjs UKpmp               # 渲染指定根节点的子画板
 *   node scripts/pen-preview.mjs K9qQM --all-roots    # 直接按画板 id 渲染
 *
 * 输出：audit/preview/<id>.html（1440 宽，可直接用浏览器打开）
 * 说明：这是近似渲染（flex 布局 + 颜色变量 + 文本），用于结构复核，不等同于 Pen 的像素级渲染。
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PEN = process.env.PEN_FILE || resolve(root, 'design.pen')
const OUT_DIR = resolve(root, 'audit/preview')

const doc = JSON.parse(readFileSync(PEN, 'utf8'))
const vars = doc.variables || {}

const byId = new Map()
function index(n) {
  byId.set(n.id, n)
  for (const c of n.children || []) index(c)
}
for (const c of doc.children || []) index(c)

function color(v) {
  if (typeof v !== 'string') return null
  if (v.startsWith('$')) {
    const def = vars[v.slice(1)]
    if (!def) return null
    const list = Array.isArray(def.value) ? def.value : []
    const light = list.find((e) => e?.theme?.mode === 'light') || list[0]
    return light?.value ?? null
  }
  if (v === 'transparent' || v === 'none') return null
  return v
}

function px(v) {
  return typeof v === 'number' ? `${v}px` : null
}

function padding(v) {
  if (typeof v === 'number') return `${v}px`
  if (!Array.isArray(v)) return null
  if (v.length === 2) return `${v[0]}px ${v[1]}px`
  if (v.length === 4) return `${v[0]}px ${v[1]}px ${v[2]}px ${v[3]}px`
  return null
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function styleOf(n, overrides) {
  const st = []
  const layout = n.layout === 'vertical' ? 'column' : 'row'
  if (n.type === 'frame' || n.type === 'rectangle' || n.type === 'ref') {
    st.push(`display:flex`, `flex-direction:${layout}`)
    const g = px(n.gap)
    if (g) st.push(`gap:${g}`)
    const p = padding(n.padding)
    if (p) st.push(`padding:${p}`)
  }
  if (n.alignItems === 'center') st.push('align-items:center')
  else if (n.alignItems) st.push(`align-items:${n.alignItems}`)
  const jc = n.justifyContent
  if (jc === 'center') st.push('justify-content:center')
  else if (jc === 'end') st.push('justify-content:flex-end')
  else if (jc === 'space-between') st.push('justify-content:space-between')

  if (n.width === 'fill_container') st.push('flex:1 1 0', 'min-width:0')
  else if (typeof n.width === 'number') st.push(`width:${n.width}px`, 'flex:0 0 auto')
  if (n.height === 'fill_container') st.push('flex:1 1 0', 'min-height:0')
  else if (typeof n.height === 'number') st.push(`height:${n.height}px`, 'flex:0 0 auto')

  const fill = color(overrides?.fill ?? n.fill)
  if (fill && n.type !== 'text') st.push(`background:${fill}`)
  const stroke = color(n.stroke)
  if (stroke && n.strokeWidth) {
    const w = typeof n.strokeWidth === 'number' ? n.strokeWidth : 1
    st.push(`box-shadow:inset 0 0 0 ${w}px ${stroke}`)
  }
  const r = px(n.cornerRadius)
  if (r) st.push(`border-radius:${r}`)
  if (n.clip) st.push('overflow:hidden')
  if (n.type === 'text') {
    st.push('white-space:pre')
    const fg = color(overrides?.fill ?? n.fill)
    if (fg) st.push(`color:${fg}`)
    if (n.fontSize) st.push(`font-size:${n.fontSize}px`)
    if (n.fontWeight) st.push(`font-weight:${n.fontWeight}`)
    if (n.lineHeight && n.lineHeight !== 1) st.push(`line-height:${n.lineHeight}`)
    st.push(`font-family:var(${n.fontFamily === '$font-mono' ? '--font-mono' : '--font-ui'})`)
  }
  if (n.type === 'icon') {
    const fg = color(n.fill)
    st.push('display:block', 'flex:0 0 auto', 'border-radius:3px')
    if (fg) st.push(`background:${fg}`, 'opacity:0.85')
  }
  return st.join(';')
}

function applyOverrides(node, ov) {
  const mine = ov?.[node.id]
  const children = {}
  for (const [k, v] of Object.entries(ov || {})) {
    if (k !== node.id) children[k] = v
  }
  const content = mine?.content ?? node.content
  const fill = mine?.fill ?? node.fill
  const kids = (node.children || []).map((c) => render(c, children))
  return { content, fill, kids }
}

function render(node, ov) {
  if (node.type === 'ref') {
    const target = byId.get(node.ref)
    if (!target) return ''
    const inner = applyOverrides(target, { ...(node.descendants || {}) })
    const style = styleOf({ ...node, fill: undefined }, undefined)
    return `<div style="${style}">${inner.kids.join('')}</div>`
  }
  const { content, fill, kids } = applyOverrides(node, ov)
  const style = styleOf(node, { fill })
  if (node.type === 'text') {
    return `<span style="${style}">${esc(content ?? '')}</span>`
  }
  if (kids.length) return `<div style="${style}">${kids.join('')}</div>`
  return `<div style="${style}"></div>`
}

function page(artboard) {
  const body = (artboard.children || [])
    .map((c) => render(c, { ...(c.descendants || {}) }))
    .join('')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${esc(artboard.name)}</title>
<style>
  :root{ --font-ui:'Noto Sans SC',-apple-system,'PingFang SC',sans-serif;
         --font-mono:'JetBrains Mono',Menlo,monospace; }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#e9ecf1;display:flex;justify-content:center;padding:0}
  .art{width:${artboard.width}px;height:${artboard.height}px;overflow:hidden;display:flex;flex-direction:column;
       background:${color(artboard.fill) || '#fff'};position:relative}
</style></head><body><div class="art">${body}</div></body></html>`
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const targetId = args[0] || 'UKpmp'
const target = byId.get(targetId)
if (!target) {
  console.error(`找不到节点 ${targetId}`)
  process.exit(1)
}
const boards = target.children || []

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })
const written = []
for (const b of boards) {
  const file = resolve(OUT_DIR, `${b.id}.html`)
  writeFileSync(file, page(b), 'utf8')
  written.push({ id: b.id, name: b.name, file, width: b.width, height: b.height })
}
console.log(JSON.stringify(written, null, 2))
