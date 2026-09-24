/**
 * T44 JSONPath：支持子属性、下标、通配、递归下降、切片、联合与过滤表达式。
 * 未实现的语法会给出明确错误，不会静默返回空结果。
 */

export interface PathMatch {
  /** 规范化路径，如 $.store.book[0].title */
  path: string
  value: unknown
}

type Seg =
  | { kind: 'name'; name: string; recursive: boolean }
  | { kind: 'index'; index: number; recursive: boolean }
  | { kind: 'wildcard'; recursive: boolean }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null; recursive: boolean }
  | { kind: 'union'; items: (string | number)[]; recursive: boolean }
  | { kind: 'filter'; expr: FilterNode }

type FilterNode =
  | { t: 'lit'; v: unknown }
  | { t: 'path'; path: (string | number)[]; root: boolean }
  | { t: 'not'; a: FilterNode }
  | { t: 'and' | 'or'; a: FilterNode; b: FilterNode }
  | { t: 'cmp'; op: string; a: FilterNode; b: FilterNode }
  | { t: 'exists'; a: FilterNode }

function isIdent(name: string) {
  return /^[A-Za-z_$][\w$]*$/.test(name)
}

export function formatPath(parts: (string | number)[]): string {
  let out = '$'
  for (const p of parts) {
    if (typeof p === 'number') out += `[${p}]`
    else if (isIdent(p)) out += `.${p}`
    else out += `['${p.replace(/'/g, "\\'")}']`
  }
  return out
}

/* ---------------- 过滤表达式 ---------------- */

interface FilterTok {
  type: 'op' | 'punct' | 'num' | 'str' | 'word' | 'path'
  text: string
}

function tokenizeFilter(src: string): FilterTok[] {
  const toks: FilterTok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    const two = src.slice(i, i + 2)
    if (['==', '!=', '<=', '>=', '&&', '||', '=~'].includes(two)) {
      toks.push({ type: 'op', text: two })
      i += 2
      continue
    }
    if ('()!<>'.includes(ch)) {
      toks.push({ type: 'punct', text: ch })
      i += 1
      continue
    }
    if (ch === '@' || ch === '$') {
      let j = i + 1
      const path: string[] = []
      while (j < src.length && (src[j] === '.' || src[j] === '[')) {
        if (src[j] === '.') {
          let k = j + 1
          while (k < src.length && /[\w$]/.test(src[k]!)) k += 1
          if (k === j + 1) break
          path.push(src.slice(j + 1, k))
          j = k
        } else {
          const close = src.indexOf(']', j)
          if (close === -1) break
          const inner = src.slice(j + 1, close).trim()
          path.push(/^['"]/.test(inner) ? inner.slice(1, -1) : inner)
          j = close + 1
        }
      }
      toks.push({ type: 'path', text: `${ch}${path.map((p) => (isIdent(p) ? `.${p}` : `['${p}']`)).join('')}` })
      i = j
      continue
    }
    if (ch === "'" || ch === '"') {
      const close = src.indexOf(ch, i + 1)
      if (close === -1) throw new Error('过滤表达式里的字符串没有闭合引号')
      toks.push({ type: 'str', text: src.slice(i + 1, close) })
      i = close + 1
      continue
    }
    if (/[-\d]/.test(ch)) {
      const m = src.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)
      if (!m) throw new Error(`过滤表达式里的数字无法解析：${src.slice(i, i + 10)}`)
      toks.push({ type: 'num', text: m[0] })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = src.slice(i).match(/^[A-Za-z_][\w]*/)!
      toks.push({ type: 'word', text: m[0] })
      i += m[0].length
      continue
    }
    throw new Error(`过滤表达式里出现了不支持的字符 ${ch}`)
  }
  return toks
}

function parseFilter(src: string): FilterNode {
  const toks = tokenizeFilter(src)
  let pos = 0

  const peek = () => toks[pos]
  const next = () => toks[pos++]

  function parseOr(): FilterNode {
    let left = parseAnd()
    while (peek()?.text === '||') {
      next()
      left = { t: 'or', a: left, b: parseAnd() }
    }
    return left
  }
  function parseAnd(): FilterNode {
    let left = parseNot()
    while (peek()?.text === '&&') {
      next()
      left = { t: 'and', a: left, b: parseNot() }
    }
    return left
  }
  function parseNot(): FilterNode {
    if (peek()?.text === '!') {
      next()
      return { t: 'not', a: parseNot() }
    }
    return parseCmp()
  }
  function parseCmp(): FilterNode {
    const left = parseAtom()
    const op = peek()
    if (op && ['==', '!=', '<', '<=', '>', '>=', '=~'].includes(op.text)) {
      next()
      return { t: 'cmp', op: op.text, a: left, b: parseAtom() }
    }
    return { t: 'exists', a: left }
  }
  function parseAtom(): FilterNode {
    const t = next()
    if (!t) throw new Error('过滤表达式不完整')
    if (t.type === 'punct' && t.text === '(') {
      const inner = parseOr()
      if (peek()?.text !== ')') throw new Error('过滤表达式缺少右括号')
      next()
      return inner
    }
    if (t.type === 'num') return { t: 'lit', v: Number(t.text) }
    if (t.type === 'str') return { t: 'lit', v: t.text }
    if (t.type === 'word') {
      if (t.text === 'true') return { t: 'lit', v: true }
      if (t.text === 'false') return { t: 'lit', v: false }
      if (t.text === 'null') return { t: 'lit', v: null }
      throw new Error(`过滤表达式不支持标识符 ${t.text}（字面量请加引号）`)
    }
    if (t.type === 'path') {
      const root = t.text[0] === '$'
      const body = t.text.slice(1)
      const path: (string | number)[] = []
      const re = /\.([\w$]+)|\[(?:'([^']*)'|"([^"]*)"|(\d+))\]/g
      let m: RegExpExecArray | null
      while ((m = re.exec(body))) {
        if (m[1] !== undefined) path.push(m[1])
        else if (m[2] !== undefined) path.push(m[2])
        else if (m[3] !== undefined) path.push(m[3])
        else path.push(Number(m[4]))
      }
      return { t: 'path', path, root }
    }
    throw new Error(`过滤表达式里出现了意外的 ${t.text}`)
  }

  const out = parseOr()
  if (pos < toks.length) throw new Error(`过滤表达式有多余内容：${toks[pos]!.text}`)
  return out
}

/** 仅当属性是对象自身（非原型链）成员时才视为存在，避免穿透到 toString/constructor/__proto__ 等 */
function hasOwn(rec: object, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, name)
}

function getPath(current: unknown, root: unknown, node: { path: (string | number)[]; root: boolean }): unknown {
  let cur: unknown = node.root ? root : current
  for (const key of node.path) {
    if (cur === null || cur === undefined) return undefined
    if (typeof key === 'number') {
      if (!Array.isArray(cur)) return undefined
      cur = cur[key]
    } else {
      if (typeof cur !== 'object') return undefined
      const rec = cur as Record<string, unknown>
      if (!hasOwn(rec, key)) return undefined
      cur = rec[key]
    }
  }
  return cur
}

export function evalFilter(node: FilterNode, current: unknown, root: unknown): boolean {
  switch (node.t) {
    case 'lit':
      return Boolean(node.v)
    case 'exists':
      return evalFilterValue(node.a, current, root) !== undefined
    case 'not':
      return !evalFilter(node.a, current, root)
    case 'and':
      return evalFilter(node.a, current, root) && evalFilter(node.b, current, root)
    case 'or':
      return evalFilter(node.a, current, root) || evalFilter(node.b, current, root)
    case 'cmp': {
      const a = evalFilterValue(node.a, current, root)
      const b = evalFilterValue(node.b, current, root)
      if (node.op === '=~') {
        if (typeof a !== 'string' || typeof b !== 'string') return false
        // 不做静态 ReDoS 硬门禁：启发式会误伤合法正则（如 ^[a-z]+(\.[a-z]+)*$），
        // 而工作流/工具页的求值均经 Worker + 2s 超时兜底，主线程不会被冻结。
        try {
          return new RegExp(b).test(a)
        } catch {
          throw new Error(`=~ 右侧不是合法正则：${b}`)
        }
      }
      switch (node.op) {
        case '==':
          return a === b
        case '!=':
          return a !== b
        case '<':
          return typeof a === 'number' && typeof b === 'number' && a < b
        case '<=':
          return typeof a === 'number' && typeof b === 'number' && a <= b
        case '>':
          return typeof a === 'number' && typeof b === 'number' && a > b
        case '>=':
          return typeof a === 'number' && typeof b === 'number' && a >= b
      }
      return false
    }
    default:
      return false
  }
}

function evalFilterValue(node: FilterNode, current: unknown, root: unknown): unknown {
  if (node.t === 'lit') return node.v
  if (node.t === 'path') return getPath(current, root, node)
  return evalFilter(node, current, root)
}

/* ---------------- 路径解析 ---------------- */

export function parseJsonPath(expr: string): Seg[] {
  const s = expr.trim()
  if (!s) throw new Error('请输入 JSONPath 表达式')
  if (s[0] !== '$') throw new Error('JSONPath 表达式必须以 $ 开头')
  const segs: Seg[] = []
  let i = 1
  while (i < s.length) {
    let recursive = false
    if (s.startsWith('..', i)) {
      recursive = true
      i += 2
      if (i >= s.length) throw new Error('递归下降 .. 后面缺少内容')
    } else if (s[i] === '.') {
      i += 1
    } else if (s[i] !== '[') {
      throw new Error(`第 ${i + 1} 个字符处期望 . 或 [，实际是 ${s[i]}`)
    }
    if (s[i] === '[') {
      const close = findBracket(s, i)
      const inner = s.slice(i + 1, close).trim()
      segs.push(parseBracket(inner, recursive))
      i = close + 1
      continue
    }
    if (s[i] === '*') {
      segs.push({ kind: 'wildcard', recursive })
      i += 1
      continue
    }
    const m = s.slice(i).match(/^[^.\[\]]+/)
    if (!m) throw new Error(`第 ${i + 1} 个字符处无法解析属性名`)
    segs.push({ kind: 'name', name: m[0], recursive })
    i += m[0].length
  }
  return segs
}

function findBracket(s: string, start: number): number {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    else if (ch === ']' && depth === 0) return i
  }
  throw new Error('JSONPath 里的 [ 没有对应的 ]')
}

function parseBracket(inner: string, recursive: boolean): Seg {
  if (!inner) throw new Error('[] 里不能为空')
  if (inner === '*') return { kind: 'wildcard', recursive }
  if (inner.startsWith('?')) {
    let body = inner.slice(1).trim()
    if (body.startsWith('(') && body.endsWith(')')) body = body.slice(1, -1)
    return { kind: 'filter', expr: parseFilter(body) }
  }
  const sliceMatch = inner.match(/^(-?\d*)\s*:\s*(-?\d*)\s*(?::\s*(-?\d*))?$/)
  if (sliceMatch) {
    return {
      kind: 'slice',
      start: sliceMatch[1] === '' ? null : Number(sliceMatch[1]),
      end: sliceMatch[2] === '' ? null : Number(sliceMatch[2]),
      step: sliceMatch[3] === undefined || sliceMatch[3] === '' ? null : Number(sliceMatch[3]),
      recursive
    }
  }
  const items = inner
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      if (/^-?\d+$/.test(p)) return Number(p)
      if (/^'.*'$/.test(p) || /^".*"$/.test(p)) return p.slice(1, -1)
      throw new Error(`[] 里不支持的内容：${p}（属性名请加引号）`)
    })
  if (!items.length) throw new Error('[] 里没有有效内容')
  if (items.length === 1) {
    return typeof items[0] === 'number'
      ? { kind: 'index', index: items[0], recursive }
      : { kind: 'name', name: items[0] as string, recursive }
  }
  return { kind: 'union', items, recursive }
}

/* ---------------- 求值 ---------------- */

function descend(node: unknown, visit: (v: unknown, path: (string | number)[]) => void, path: (string | number)[] = []) {
  visit(node, path)
  if (Array.isArray(node)) {
    node.forEach((v, idx) => descend(v, visit, [...path, idx]))
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) descend(v, visit, [...path, k])
  }
}

function childrenOf(value: unknown): { key: string | number; value: unknown }[] {
  if (Array.isArray(value)) return value.map((v, i) => ({ key: i, value: v }))
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({ key: k, value: v }))
  }
  return []
}

export function evalJsonPath(data: unknown, expr: string): { matches: PathMatch[]; warnings: string[] } {
  const segs = parseJsonPath(expr)
  const warnings: string[] = []
  let current: { path: (string | number)[]; value: unknown }[] = [{ path: [], value: data }]

  for (const seg of segs) {
    const next: { path: (string | number)[]; value: unknown }[] = []
    for (const item of current) {
      if (seg.kind === 'name' || seg.kind === 'index' || seg.kind === 'wildcard') {
        if ('recursive' in seg && seg.recursive) {
          descend(item.value, (v, rel) => {
            const base = [...item.path, ...rel]
            if (seg.kind === 'wildcard') next.push({ path: base, value: v })
            else if (seg.kind === 'name') {
              if (v && typeof v === 'object' && !Array.isArray(v)) {
                const rec = v as Record<string, unknown>
                if (hasOwn(rec, seg.name)) next.push({ path: [...base, seg.name], value: rec[seg.name] })
              }
            } else if (Array.isArray(v)) {
              const idx = seg.index < 0 ? v.length + seg.index : seg.index
              if (idx >= 0 && idx < v.length) next.push({ path: [...base, idx], value: v[idx] })
            }
          })
          continue
        }
        if (seg.kind === 'wildcard') {
          for (const c of childrenOf(item.value)) next.push({ path: [...item.path, c.key], value: c.value })
        } else if (seg.kind === 'name') {
          if (item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
            const rec = item.value as Record<string, unknown>
            if (hasOwn(rec, seg.name)) next.push({ path: [...item.path, seg.name], value: rec[seg.name] })
          }
        } else {
          if (Array.isArray(item.value)) {
            const idx = seg.index < 0 ? item.value.length + seg.index : seg.index
            if (idx >= 0 && idx < item.value.length) next.push({ path: [...item.path, idx], value: item.value[idx] })
          }
        }
        continue
      }
      if (seg.kind === 'slice') {
        const arr = Array.isArray(item.value) ? item.value : null
        if (!arr) continue
        const step = seg.step ?? 1
        if (step === 0) throw new Error('切片的步长不能为 0')
        const len = arr.length
        let start = seg.start ?? (step > 0 ? 0 : len - 1)
        let end = seg.end ?? (step > 0 ? len : -1)
        if (start < 0) start += len
        if (end < 0 && seg.end !== null) end += len
        if (step > 0) {
          for (let k = Math.max(0, start); k < Math.min(len, end); k += step) {
            next.push({ path: [...item.path, k], value: arr[k] })
          }
        } else {
          for (let k = Math.min(len - 1, start); k > Math.max(-1, end); k += step) {
            next.push({ path: [...item.path, k], value: arr[k] })
          }
        }
        continue
      }
      if (seg.kind === 'union') {
        for (const it of seg.items) {
          if (typeof it === 'number') {
            if (Array.isArray(item.value)) {
              const idx = it < 0 ? item.value.length + it : it
              if (idx >= 0 && idx < item.value.length) next.push({ path: [...item.path, idx], value: item.value[idx] })
            }
          } else if (item.value && typeof item.value === 'object' && !Array.isArray(item.value)) {
            const rec = item.value as Record<string, unknown>
            if (hasOwn(rec, it)) next.push({ path: [...item.path, it], value: rec[it] })
          }
        }
        continue
      }
      if (seg.kind === 'filter') {
        const arr = Array.isArray(item.value) ? item.value : []
        arr.forEach((el, idx) => {
          if (evalFilter(seg.expr, el, data)) next.push({ path: [...item.path, idx], value: el })
        })
        continue
      }
    }
    current = next
  }

  if (segs.some((s) => s.kind === 'filter') && !current.length) {
    warnings.push('过滤条件没有匹配项，检查字段名与运算符')
  }
  return { matches: current.map((c) => ({ path: formatPath(c.path), value: c.value })), warnings }
}

export const jsonPathSamples = [
  '$.store.book[*].title',
  '$.store.book[?(@.price < 100)].title',
  "$..author",
  '$.store.book[0:2]',
  '$.store.book[-1].title'
]
