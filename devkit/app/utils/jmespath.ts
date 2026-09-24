/**
 * T44 JMESPath（子集）：字段、下标、切片、通配、扁平化、过滤、投影、管道、
 * 多选列表 / 对象、表达式引用 &expr，以及常用内置函数。
 * 未实现的函数或语法会明确报错，不会返回错误结果。
 */

import { formatPath } from './jsonpath'

export interface JmesResult {
  matches: { path: string; value: unknown }[]
  warnings: string[]
}

type Node =
  | { t: 'current' }
  | { t: 'root' }
  | { t: 'literal'; v: unknown }
  | { t: 'chain'; base: Node; ops: Op[] }
  | { t: 'pipe'; a: Node; b: Node }
  | { t: 'or'; a: Node; b: Node }
  | { t: 'and'; a: Node; b: Node }
  | { t: 'not'; a: Node }
  | { t: 'cmp'; op: string; a: Node; b: Node }
  | { t: 'multiselect'; items: Node[] }
  | { t: 'hash'; entries: { key: string; value: Node }[] }
  | { t: 'fn'; name: string; args: Node[] }
  | { t: 'exprref'; expr: Node }

type Op =
  | { kind: 'field'; name: string }
  | { kind: 'index'; n: number }
  | { kind: 'wildcard' }
  | { kind: 'flatten' }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null }
  | { kind: 'filter'; expr: Node }

interface Tok {
  t: string
  text: string
  num?: number
}

const PUNCT = ['(', ')', '[', ']', '{', '}', ',', ':', '|', '@', '$', '.', '*', '&', '!', '?']

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (src.startsWith('&&', i) || src.startsWith('||', i) || src.startsWith('==', i) || src.startsWith('!=', i) || src.startsWith('<=', i) || src.startsWith('>=', i)) {
      toks.push({ t: 'cmp', text: src.slice(i, i + 2) })
      i += 2
      continue
    }
    if (ch === '<' || ch === '>') {
      toks.push({ t: 'cmp', text: ch })
      i += 1
      continue
    }
    if (ch === '`') {
      const close = src.indexOf('`', i + 1)
      if (close === -1) throw new Error('反引号字面量没有闭合')
      toks.push({ t: 'literal', text: src.slice(i + 1, close) })
      i = close + 1
      continue
    }
    if (ch === "'") {
      let j = i + 1
      let out = ''
      while (j < src.length) {
        if (src[j] === '\\' && src[j + 1] === "'") {
          out += "'"
          j += 2
          continue
        }
        if (src[j] === "'") break
        out += src[j]
        j += 1
      }
      if (j >= src.length) throw new Error('单引号字符串没有闭合')
      toks.push({ t: 'quoted', text: out })
      i = j + 1
      continue
    }
    if (ch === '"') {
      const close = src.indexOf('"', i + 1)
      if (close === -1) throw new Error('双引号字符串没有闭合')
      toks.push({ t: 'quoted', text: src.slice(i + 1, close) })
      i = close + 1
      continue
    }
    if (PUNCT.includes(ch)) {
      toks.push({ t: ch, text: ch })
      i += 1
      continue
    }
    const numMatch = src.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)
    if (numMatch && !/[A-Za-z_]/.test(src[i + numMatch[0].length] ?? '')) {
      toks.push({ t: 'number', text: numMatch[0], num: Number(numMatch[0]) })
      i += numMatch[0].length
      continue
    }
    const identMatch = src.slice(i).match(/^[A-Za-z_][\w]*/)
    if (identMatch) {
      toks.push({ t: 'ident', text: identMatch[0] })
      i += identMatch[0].length
      continue
    }
    throw new Error(`第 ${i + 1} 个字符处无法解析：${ch}`)
  }
  return toks
}

export function parseJmesPath(src: string): Node {
  const toks = lex(src.trim())
  let pos = 0
  const peek = () => toks[pos]
  const eat = (t: string) => {
    const cur = toks[pos]
    if (!cur || (cur.t !== t && !(t === 'ident' && cur.t === 'ident'))) {
      throw new Error(`JMESPath 语法错误：期望 ${t}，实际是 ${cur ? cur.text || cur.t : '表达式末尾'}`)
    }
    pos += 1
    return cur
  }

  function parsePipe(): Node {
    let left = parseOr()
    while (peek()?.t === '|') {
      eat('|')
      left = { t: 'pipe', a: left, b: parseOr() }
    }
    return left
  }
  function parseOr(): Node {
    let left = parseAnd()
    while (peek()?.t === 'cmp' && peek()?.text === '||') {
      eat('cmp')
      left = { t: 'or', a: left, b: parseAnd() }
    }
    return left
  }
  function parseAnd(): Node {
    let left = parseNot()
    while (peek()?.t === 'cmp' && peek()?.text === '&&') {
      eat('cmp')
      left = { t: 'and', a: left, b: parseNot() }
    }
    return left
  }
  function parseNot(): Node {
    if (peek()?.t === '!') {
      eat('!')
      return { t: 'not', a: parseNot() }
    }
    return parseComparison()
  }
  function parseComparison(): Node {
    const left = parsePostfix()
    const cur = peek()
    if (cur?.t === 'cmp' && ['==', '!=', '<', '<=', '>', '>='].includes(cur.text)) {
      eat('cmp')
      return { t: 'cmp', op: cur.text, a: left, b: parsePostfix() }
    }
    return left
  }

  function parsePostfix(): Node {
    let base = parseBasic()
    const ops: Op[] = []
    for (;;) {
      const cur = peek()
      if (!cur) break
      if (cur.t === '.') {
        eat('.')
        const nxt = peek()
        if (nxt?.t === '*') {
          eat('*')
          ops.push({ kind: 'wildcard' })
        } else if (nxt?.t === '{') {
          eat('{')
          const entries: { key: string; value: Node }[] = []
          for (;;) {
            const keyTok = peek()
            if (!keyTok || (keyTok.t !== 'ident' && keyTok.t !== 'quoted')) {
              throw new Error('{ } 里的键需要是字段名或字符串')
            }
            pos += 1
            eat(':')
            entries.push({ key: keyTok.text, value: parsePipe() })
            if (peek()?.t === ',') {
              eat(',')
              continue
            }
            break
          }
          eat('}')
          ops.push({ kind: 'filter', expr: { t: 'hash', entries } })
        } else if (nxt?.t === '[') {
          eat('[')
          const items: Node[] = []
          if (peek()?.t !== ']') {
            for (;;) {
              items.push(parsePipe())
              if (peek()?.t === ',') {
                eat(',')
                continue
              }
              break
            }
          }
          eat(']')
          ops.push({ kind: 'filter', expr: { t: 'multiselect', items } })
        } else if (nxt?.t === 'ident' || nxt?.t === 'quoted') {
          pos += 1
          ops.push({ kind: 'field', name: nxt.text })
        } else {
          throw new Error('“.” 后面需要字段名或 *')
        }
        continue
      }
      if (cur.t === '[') {
        eat('[')
        const inner = peek()
        if (inner?.t === ']') {
          eat(']')
          ops.push({ kind: 'flatten' })
          continue
        }
        if (inner?.t === '*') {
          eat('*')
          eat(']')
          ops.push({ kind: 'wildcard' })
          continue
        }
        if (inner?.t === '?') {
          eat('?')
          const expr = parsePipe()
          eat(']')
          ops.push({ kind: 'filter', expr })
          continue
        }
        if (inner?.t === 'number') {
          pos += 1
          const n = inner.num as number
          if (peek()?.t === ':') {
            const slice = parseSliceHead(n)
            eat(']')
            ops.push(slice)
          } else {
            eat(']')
            ops.push({ kind: 'index', n })
          }
          continue
        }
        if (inner?.t === ':') {
          const slice = parseSliceHead(null)
          eat(']')
          ops.push(slice)
          continue
        }
        // 多选列表
        const items: Node[] = []
        for (;;) {
          items.push(parsePipe())
          if (peek()?.t === ',') {
            eat(',')
            continue
          }
          break
        }
        eat(']')
        ops.push({ kind: 'filter', expr: { t: 'multiselect', items } })
        continue
      }
      break
    }
    if (!ops.length) return base
    return { t: 'chain', base, ops }
  }

  function parseSliceHead(first: number | null): Op {
    // 当前位于 ':' 之前已消费第一个值
    if (first === null) {
      // 已经吃掉了 ':' ?
    }
    eat(':')
    const step = { start: first, end: null as number | null, step: null as number | null }
    if (peek()?.t === 'number') {
      step.end = peek()!.num as number
      pos += 1
    }
    if (peek()?.t === ':') {
      eat(':')
      if (peek()?.t === 'number') {
        step.step = peek()!.num as number
        pos += 1
      }
    }
    return { kind: 'slice', ...step }
  }

  function parseBasic(): Node {
    const cur = peek()
    if (!cur) throw new Error('JMESPath 表达式不完整')
    if (cur.t === '@') {
      eat('@')
      return { t: 'current' }
    }
    if (cur.t === '$') {
      eat('$')
      return { t: 'root' }
    }
    if (cur.t === 'literal') {
      pos += 1
      const raw = cur.text.trim()
      if (raw === '') return { t: 'literal', v: null }
      try {
        return { t: 'literal', v: JSON.parse(raw) }
      } catch {
        return { t: 'literal', v: raw }
      }
    }
    if (cur.t === 'quoted') {
      pos += 1
      return { t: 'literal', v: cur.text }
    }
    if (cur.t === 'number') {
      pos += 1
      return { t: 'literal', v: cur.num }
    }
    if (cur.t === '(') {
      eat('(')
      const inner = parsePipe()
      eat(')')
      return inner
    }
    if (cur.t === '&') {
      eat('&')
      return { t: 'exprref', expr: parsePipe() }
    }
    if (cur.t === '{') {
      eat('{')
      const entries: { key: string; value: Node }[] = []
      for (;;) {
        const keyTok = peek()
        if (!keyTok || (keyTok.t !== 'ident' && keyTok.t !== 'quoted')) throw new Error('{ } 里的键需要是字段名或字符串')
        pos += 1
        eat(':')
        entries.push({ key: keyTok.text, value: parsePipe() })
        if (peek()?.t === ',') {
          eat(',')
          continue
        }
        break
      }
      eat('}')
      return { t: 'hash', entries }
    }
    if (cur.t === 'ident') {
      pos += 1
      if (peek()?.t === '(') {
        eat('(')
        const args: Node[] = []
        if (peek()?.t !== ')') {
          for (;;) {
            args.push(parsePipe())
            if (peek()?.t === ',') {
              eat(',')
              continue
            }
            break
          }
        }
        eat(')')
        return { t: 'fn', name: cur.text, args }
      }
      return { t: 'chain', base: { t: 'current' }, ops: [{ kind: 'field', name: cur.text }] }
    }
    throw new Error(`JMESPath 语法错误：无法解析 ${cur.text || cur.t}`)
  }

  const out = parsePipe()
  if (pos < toks.length) throw new Error(`JMESPath 表达式有多余内容：${toks[pos]!.text}`)
  return out
}

/* ---------------- 求值 ---------------- */

export function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false
  if (v === '' || v === 0) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

function listOf(v: unknown): unknown[] {
  if (Array.isArray(v)) return v
  if (v === null || v === undefined) return []
  return [v]
}

function evalChain(base: unknown, ops: Op[], root: unknown): unknown {
  let out = base
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i]!
    if (op.kind === 'field') {
      if (out && typeof out === 'object' && !Array.isArray(out)) {
        const rec = out as Record<string, unknown>
        // 仅自身成员：不穿透到 toString/constructor/__proto__ 等原型成员
        out = Object.prototype.hasOwnProperty.call(rec, op.name) ? rec[op.name] : null
      } else {
        out = null
      }
      continue
    }
    if (op.kind === 'index') {
      if (!Array.isArray(out)) {
        out = null
        continue
      }
      const idx = op.n < 0 ? out.length + op.n : op.n
      out = idx >= 0 && idx < out.length ? out[idx] : null
      continue
    }
    // 以下都是投影：把剩余操作映射到每个元素上
    let list: unknown[]
    if (op.kind === 'wildcard') list = Array.isArray(out) ? [...out] : out && typeof out === 'object' ? Object.values(out) : []
    else if (op.kind === 'flatten') {
      list = []
      for (const el of listOf(out)) {
        if (Array.isArray(el)) list.push(...el)
        else list.push(el)
      }
    } else if (op.kind === 'slice') {
      const arr = Array.isArray(out) ? out : []
      const step = op.step ?? 1
      if (step === 0) throw new Error('切片步长不能为 0')
      const len = arr.length
      let start = op.start ?? (step > 0 ? 0 : len - 1)
      let end = op.end ?? (step > 0 ? len : -1)
      if (start < 0) start += len
      if (end < 0 && op.end !== null) end += len
      list = []
      if (step > 0) {
        for (let k = Math.max(0, start); k < Math.min(len, end); k += step) list.push(arr[k])
      } else {
        for (let k = Math.min(len - 1, start); k > Math.max(-1, end); k += step) list.push(arr[k])
      }
    } else if (op.kind === 'filter') {
      const arr = Array.isArray(out) ? out : []
      const expr = op.expr
      if (expr.t === 'multiselect' || expr.t === 'hash') {
        if (Array.isArray(out)) {
          list = arr.map((el) => evalNode(expr, el, root))
        } else {
          const rest0 = ops.slice(i + 1)
          const single = evalNode(expr, out, root)
          return rest0.length ? evalChain(single, rest0, root) : single
        }
      } else {
        list = arr.filter((el) => isTruthy(evalNode(expr, el, root)))
      }
    } else {
      list = []
    }
    const rest = ops.slice(i + 1)
    if (!rest.length) return list
    return list.map((el) => evalChain(el, rest, root))
  }
  return out
}

export function evalNode(node: Node, value: unknown, root: unknown): unknown {
  switch (node.t) {
    case 'current':
      return value
    case 'root':
      return root
    case 'literal':
      return node.v
    case 'chain': {
      const base = evalNode(node.base, value, root)
      return evalChain(base, node.ops, root)
    }
    case 'pipe':
      return evalNode(node.b, evalNode(node.a, value, root), root)
    case 'or':
      return isTruthy(evalNode(node.a, value, root)) ? true : isTruthy(evalNode(node.b, value, root))
    case 'and':
      return isTruthy(evalNode(node.a, value, root)) && isTruthy(evalNode(node.b, value, root))
    case 'not':
      return !isTruthy(evalNode(node.a, value, root))
    case 'cmp': {
      const a = evalNode(node.a, value, root)
      const b = evalNode(node.b, value, root)
      if (node.op === '==') return deepEqual(a, b)
      if (node.op === '!=') return !deepEqual(a, b)
      if (typeof a === 'number' && typeof b === 'number') {
        if (node.op === '<') return a < b
        if (node.op === '<=') return a <= b
        if (node.op === '>') return a > b
        if (node.op === '>=') return a >= b
      }
      if (typeof a === 'string' && typeof b === 'string') {
        if (node.op === '<') return a < b
        if (node.op === '<=') return a <= b
        if (node.op === '>') return a > b
        if (node.op === '>=') return a >= b
      }
      return false
    }
    case 'multiselect':
      return node.items.map((it) => evalNode(it, value, root))
    case 'hash': {
      const obj: Record<string, unknown> = {}
      // defineProperty：避免 JSON 字面量键 "__proto__" 触发原型 setter 而丢失该键
      for (const e of node.entries) {
        Object.defineProperty(obj, e.key, {
          value: evalNode(e.value, value, root),
          enumerable: true,
          writable: true,
          configurable: true
        })
      }
      return obj
    }
    case 'exprref':
      return { __expr: node.expr } as unknown
    case 'fn':
      return callFn(node.name, node.args, value, root)
    default:
      return null
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]))
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a as object)
    const kb = Object.keys(b as object)
    return ka.length === kb.length && ka.every((k) => deepEqual((a as never)[k], (b as never)[k]))
  }
  return false
}

const FUNCTIONS = new Set([
  'length', 'keys', 'values', 'sort', 'sort_by', 'max', 'min', 'max_by', 'min_by', 'sum', 'avg',
  'to_string', 'to_number', 'to_array', 'join', 'contains', 'starts_with', 'ends_with', 'type',
  'not_null', 'reverse', 'first', 'last', 'merge', 'abs', 'ceil', 'floor', 'map'
])

function callFn(name: string, argNodes: Node[], value: unknown, root: unknown): unknown {
  if (!FUNCTIONS.has(name)) throw new Error(`JMESPath 暂不支持函数 ${name}()`)
  const rawArgs = argNodes.map((n) => evalNode(n, value, root))
  const args = rawArgs.map((a) =>
    a && typeof a === 'object' && '__expr' in (a as object) ? (a as { __expr: Node }).__expr : a
  )
  const isRef = (i: number) => rawArgs[i] && typeof rawArgs[i] === 'object' && '__expr' in (rawArgs[i] as object)

  switch (name) {
    case 'length': {
      const a = args[0]
      if (typeof a === 'string') return a.length
      if (Array.isArray(a)) return a.length
      if (a && typeof a === 'object') return Object.keys(a as object).length
      return null
    }
    case 'keys':
      return args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? Object.keys(args[0] as object)
        : null
    case 'values':
      return args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])
        ? Object.values(args[0] as object)
        : null
    case 'sort': {
      const arr = Array.isArray(args[0]) ? [...(args[0] as unknown[])] : null
      if (!arr) return null
      return arr.sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))))
    }
    case 'sort_by': {
      const arr = Array.isArray(args[0]) ? [...(args[0] as unknown[])] : null
      if (!arr || !isRef(1)) return null
      const expr = args[1] as Node
      return arr.sort((x, y) => {
        const kx = evalNode(expr, x, root)
        const ky = evalNode(expr, y, root)
        if (typeof kx === 'number' && typeof ky === 'number') return kx - ky
        return String(kx).localeCompare(String(ky))
      })
    }
    case 'max':
      return Array.isArray(args[0]) && (args[0] as unknown[]).length
        ? (args[0] as unknown[]).reduce((a, b) => (compareValues(a, b) >= 0 ? a : b))
        : null
    case 'min':
      return Array.isArray(args[0]) && (args[0] as unknown[]).length
        ? (args[0] as unknown[]).reduce((a, b) => (compareValues(a, b) <= 0 ? a : b))
        : null
    case 'max_by':
    case 'min_by': {
      const arr = Array.isArray(args[0]) ? (args[0] as unknown[]) : null
      if (!arr || !arr.length || !isRef(1)) return null
      const expr = args[1] as Node
      return arr.reduce((best, cur) => {
        const kb = evalNode(expr, best, root)
        const kc = evalNode(expr, cur, root)
        const cmp = compareValues(kb, kc)
        if (name === 'max_by') return cmp >= 0 ? best : cur
        return cmp <= 0 ? best : cur
      })
    }
    case 'sum': {
      const arr = Array.isArray(args[0]) ? (args[0] as unknown[]) : null
      if (!arr) return null
      return arr.reduce((s: number, v) => s + (typeof v === 'number' ? v : 0), 0)
    }
    case 'avg': {
      const arr = Array.isArray(args[0]) ? (args[0] as unknown[]) : null
      if (!arr || !arr.length) return null
      const nums = arr.filter((v) => typeof v === 'number') as number[]
      return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null
    }
    case 'to_string':
      return JSON.stringify(args[0] ?? null)
    case 'to_number':
      if (typeof args[0] === 'number') return args[0]
      if (typeof args[0] === 'string' && args[0].trim() !== '' && !Number.isNaN(Number(args[0]))) return Number(args[0])
      return null
    case 'to_array':
      return Array.isArray(args[0]) ? args[0] : args[0] === undefined ? [] : [args[0]]
    case 'join': {
      if (typeof args[0] !== 'string' || !Array.isArray(args[1])) return null
      return (args[1] as unknown[]).map((v) => String(v)).join(args[0] as string)
    }
    case 'contains':
      if (typeof args[0] === 'string' && typeof args[1] === 'string') return (args[0] as string).includes(args[1] as string)
      if (Array.isArray(args[0])) return (args[0] as unknown[]).some((v) => deepEqual(v, args[1]))
      return false
    case 'starts_with':
      return typeof args[0] === 'string' && typeof args[1] === 'string' ? args[0].startsWith(args[1]) : null
    case 'ends_with':
      return typeof args[0] === 'string' && typeof args[1] === 'string' ? args[0].endsWith(args[1]) : null
    case 'type': {
      const a = args[0]
      if (a === null || a === undefined) return 'null'
      if (Array.isArray(a)) return 'array'
      if (typeof a === 'object') return 'object'
      if (typeof a === 'number') return 'number'
      if (typeof a === 'boolean') return 'boolean'
      if (typeof a === 'string') return 'string'
      return 'null'
    }
    case 'not_null':
      return args.find((a) => a !== null && a !== undefined) ?? null
    case 'reverse': {
      if (typeof args[0] === 'string') return (args[0] as string).split('').reverse().join('')
      if (Array.isArray(args[0])) return [...(args[0] as unknown[])].reverse()
      return null
    }
    case 'first':
      return Array.isArray(args[0]) ? ((args[0] as unknown[])[0] ?? null) : null
    case 'last': {
      const arr = Array.isArray(args[0]) ? (args[0] as unknown[]) : null
      return arr && arr.length ? arr[arr.length - 1] : null
    }
    case 'merge': {
      const out: Record<string, unknown> = {}
      for (const a of args) {
        if (a && typeof a === 'object' && !Array.isArray(a)) {
          for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
            Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true })
          }
        } else return null
      }
      return out
    }
    case 'abs':
      return typeof args[0] === 'number' ? Math.abs(args[0]) : null
    case 'ceil':
      return typeof args[0] === 'number' ? Math.ceil(args[0]) : null
    case 'floor':
      return typeof args[0] === 'number' ? Math.floor(args[0]) : null
    case 'map': {
      if (!isRef(0) || !Array.isArray(args[1])) return null
      const expr = args[0] as Node
      return (args[1] as unknown[]).map((v) => evalNode(expr, v, root))
    }
    default:
      throw new Error(`JMESPath 暂不支持函数 ${name}()`)
  }
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/** 求值并返回结果路径（JMESPath 本身没有路径概念，这里按结果值在文档中的位置反查最近的路径） */
export function evalJmesPath(data: unknown, expr: string): JmesResult {
  const warnings: string[] = []
  const ast = parseJmesPath(expr)
  const value = evalNode(ast, data, data)
  if (value === null || value === undefined) {
    warnings.push('表达式结果为 null：字段可能不存在，或过滤条件没有命中')
    return { matches: [], warnings }
  }
  const items = Array.isArray(value) ? value : [value]
  // 一次性建立「对象引用 → 路径」索引，替代对每个结果都从根重扫文档的 O(n²) 反查。
  // 投影 / 切片 / 扁平化都保留原对象引用，引用命中即可得到准确路径；
  // hash / multiselect 新建的对象不在索引里，回退为下标路径（与旧行为一致）。
  // 索引延迟到首个对象结果时才构建，纯标量结果（如 title 列表）完全不付出这份开销。
  let index: Map<object, string> | null = null
  const matches = items.map((v, idx) => {
    let path: string | null = null
    if (v && typeof v === 'object') {
      if (!index) index = buildPathIndex(data)
      path = index.get(v as object) ?? null
    }
    // 标量结果无法唯一反查位置，直接给根路径 / 下标，不编造具体字段
    return { path: path ?? (Array.isArray(value) ? formatPath([idx]) : '$'), value: v }
  })
  return { matches, warnings }
}

/**
 * 遍历文档一次，建立「对象/数组引用 → 规范化路径」映射。
 * 用显式栈而非递归，避免深层文档触发栈溢出；引用相等即可定位，无需深度比较。
 */
function buildPathIndex(root: unknown): Map<object, string> {
  const index = new Map<object, string>()
  if (!root || typeof root !== 'object') return index
  const stack: { v: object; path: (string | number)[] }[] = [{ v: root as object, path: [] }]
  while (stack.length) {
    const { v, path } = stack.pop()!
    if (index.has(v)) continue
    index.set(v, formatPath(path))
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i -= 1) {
        const child = v[i]
        if (child && typeof child === 'object') stack.push({ v: child as object, path: [...path, i] })
      }
    } else {
      const rec = v as Record<string, unknown>
      const keys = Object.keys(rec)
      for (let i = keys.length - 1; i >= 0; i -= 1) {
        const k = keys[i]!
        const child = rec[k]
        if (child && typeof child === 'object') stack.push({ v: child as object, path: [...path, k] })
      }
    }
  }
  return index
}

export const jmesPathSamples = [
  'store.book[*].title',
  'store.book[?price < `100`].title',
  'length(store.book)',
  'sort_by(store.book, &price)[*].{title: title, price: price}',
  'store.book[0:2].author'
]
