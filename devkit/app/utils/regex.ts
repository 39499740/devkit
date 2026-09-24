/**
 * T11 正则测试的纯计算实现：组件（经 Web Worker 注入）与流程编排共用同一份逻辑。
 */

export interface RegexNamed {
  name: string
  value: string | null
}

export interface RegexMatch {
  index: number
  end: number
  text: string
  groups: (string | null)[]
  named: RegexNamed[] | null
}

export interface RegexResult {
  ok: boolean
  matches: RegexMatch[]
  replaced: string | null
  capped: boolean
  error?: string
}

/** JS 合法 flags：d g i m s u v y；u/v 互斥 */
const VALID_FLAGS = 'dgimsuvy'

/** 合法返回 null，非法返回中文原因（文案与组件行内提示一致） */
export function validateFlags(flags: string): string | null {
  if (!flags) return null
  const seen = new Set<string>()
  for (const ch of flags) {
    if (!VALID_FLAGS.includes(ch)) return `不支持的 flag「${ch}」（JavaScript 支持 d g i m s u v y）`
    if (seen.has(ch)) return `flag「${ch}」重复`
    seen.add(ch)
  }
  if (seen.has('u') && seen.has('v')) return 'u 与 v 不能同时使用'
  return null
}

/**
 * 把 V8 的正则语法错误翻成中文（回退中文，不回显英文原文）。
 * 传入 pattern 时会在提示中带上用户的表达式（过长截断），便于定位问题；
 * 不传 pattern 时给出独立可读的中文句子。工具页与流程执行器共用同一份映射。
 */
export function localizeRegexMessage(msg: string, pattern?: string): string {
  const p = pattern === undefined ? '' : pattern.length > 60 ? `${pattern.slice(0, 60)}…` : pattern
  const head = p ? `表达式「${p}」` : '正则表达式'
  if (/Unterminated group/i.test(msg)) return `${head}中的分组括号 ( ) 没有闭合`
  if (/Unmatched '\)'/i.test(msg) || /Unmatched \)/i.test(msg)) return `${head}中出现了多余的右括号 )`
  if (/Unterminated character class/i.test(msg)) return `${head}中的字符组 [ ] 没有闭合`
  if (/Nothing to repeat/i.test(msg)) return `${head}中的量词（* + ? {n}）前没有可重复的内容`
  if (/Lone quantifier brackets/i.test(msg)) return `${head}中的量词花括号 { } 使用不完整（缺少可重复内容或数字）`
  if (/Invalid quantifier/i.test(msg)) return `${head}中的量词写法不合法`
  if (/Duplicate capture group name/i.test(msg)) return `${head}中存在重名的命名分组`
  if (/Invalid (?:capture )?group/i.test(msg)) return `${head}中的分组语法不合法`
  if (/Invalid character class/i.test(msg)) return `${head}中的字符组写法不合法`
  if (/Invalid (?:unicode )?escape/i.test(msg)) return `${head}中包含非法的转义`
  if (/Invalid flags/i.test(msg)) return `${head}使用了不支持的标志`
  if (/Invalid regular expression/i.test(msg)) return `${head}不合法`
  return `${head}语法不正确，请检查括号、量词与转义`
}

/** 去掉分组开头的前缀（?: / ?<name> / ?= / ?! / ?<= / ?<!），只保留分组体 */
function stripGroupPrefix(body: string): string {
  if (body.startsWith('?:')) return body.slice(2)
  if (body.startsWith('?=') || body.startsWith('?!')) return body.slice(2)
  if (body.startsWith('?<=') || body.startsWith('?<!')) return body.slice(3)
  if (body.startsWith('?<')) {
    const close = body.indexOf('>')
    return close === -1 ? body : body.slice(close + 1)
  }
  return body
}

/** 在顶层（跳过转义、字符类、嵌套分组）按 | 拆分交替分支 */
function splitAlternation(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inClass = false
  let cur = ''
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!
    if (ch === '\\') {
      cur += ch + (body[i + 1] ?? '')
      i += 1
      continue
    }
    if (inClass) {
      cur += ch
      if (ch === ']') inClass = false
      continue
    }
    if (ch === '[') {
      inClass = true
      cur += ch
      continue
    }
    if (ch === '(') {
      depth += 1
      cur += ch
      continue
    }
    if (ch === ')') {
      depth -= 1
      cur += ch
      continue
    }
    if (ch === '|' && depth === 0) {
      parts.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  parts.push(cur)
  return parts
}

interface BranchToken {
  /** 规范化后的原子标识：字面字符 / \d / [a-z] / 整个嵌套分组 */
  key: string
  /** 该原子是否可省略（后跟 ? / * / {0,n}） */
  optional: boolean
  /** 是否为通配原子（. 或 \d/\w/\s 等），与任意同类原子视为前缀重合 */
  any: boolean
}

/** 把一个交替分支拆成原子序列，并记录每个原子是否可省略 */
function branchTokens(branch: string): BranchToken[] {
  const toks: BranchToken[] = []
  let i = 0
  while (i < branch.length) {
    const ch = branch[i]!
    if (ch === '^' || ch === '$') {
      i += 1 // 锚点不消费字符
      continue
    }
    let key: string
    let any = false
    let end: number
    if (ch === '\\') {
      const nxt = branch[i + 1] ?? ''
      key = `\\${nxt}`
      end = i + 2
    } else if (ch === '[') {
      let j = i + 1
      if (branch[j] === '^') j += 1
      if (branch[j] === ']') j += 1
      while (j < branch.length && branch[j] !== ']') j += 1
      key = branch.slice(i, j + 1)
      end = j + 1
    } else if (ch === '(') {
      let depth = 0
      let j = i
      for (; j < branch.length; j += 1) {
        if (branch[j] === '\\') {
          j += 1
          continue
        }
        if (branch[j] === '(') depth += 1
        else if (branch[j] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      key = branch.slice(i, j + 1)
      end = j + 1
    } else if (ch === '.') {
      key = '.'
      any = true
      end = i + 1
    } else {
      key = ch
      end = i + 1
    }
    let optional = false
    const q = branch[end]
    if (q === '?' || q === '*') {
      optional = true
      end += 1
    } else if (q === '+') {
      end += 1
    } else if (q === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(branch.slice(end))
      if (m) {
        if (Number(m[1]) === 0) optional = true
        end += m[0].length
      }
    }
    toks.push({ key, optional, any })
    i = end
  }
  return toks
}

/** 分支是否可匹配空串（所有原子都可省略，或本身为空） */
function isNullable(toks: BranchToken[]): boolean {
  return toks.every((t) => t.optional)
}

/** 两段原子序列是否「前缀重合」：较短者能作为较长者的前缀（含完全相等） */
function sharesPrefix(a: BranchToken[], b: BranchToken[]): boolean {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (!(a[i]!.key === b[i]!.key || a[i]!.any || b[i]!.any)) return false
  }
  return true
}

/**
 * 交替分支风险判定：当分组被无界量词重复时，若分支集合不是「前缀无关」的
 * （某分支是另一分支的前缀、存在相等分支，或某分支可匹配空串），引擎在匹配失败
 * 时会产生指数级回溯，例如 `(a|aa)+`、`(a|ab)*`、`(a|a?)+`。
 * 前缀无关的安全交替（`(a|b)+`、`(ab|ac)+`）不会误判。
 */
function alternationRisk(body: string): boolean {
  const branches = splitAlternation(body)
  if (branches.length < 2) return false
  const toks = branches.map(branchTokens)
  for (let i = 0; i < toks.length; i += 1) {
    if (isNullable(toks[i]!)) return true
    for (let j = i + 1; j < toks.length; j += 1) {
      if (sharesPrefix(toks[i]!, toks[j]!)) return true
    }
  }
  return false
}

/**
 * 静态风险判定：识别经典「嵌套无界量词」与「重叠交替分支」导致的灾难性回溯（ReDoS）。
 *
 * 原理：匹配失败时正则引擎会尝试不同的回溯路径；若一个分组内部含无界量词
 * （`+`、`*`、`{m,}`），而该分组本身又被无界量词重复，回溯路径会随输入长度
 * 指数级增长，例如 `^(a+)+$` 在长串 a 上会冻结主线程。这里做纯静态启发式扫描：
 *   1. 跳过转义字符与字符类内部（`[+*]` 里的 `+` 只是字面量，不算量词）；
 *   2. 用栈跟踪分组的括号层级，记录其内部是否出现过无界量词；
 *   3. 分组闭合时若紧跟一个无界量词，且组内出现过无界量词，即判定危险；
 *   4. 分组的无界性会向上传播（如 `((ab)+)+` 同样危险）。
 *
 * 除嵌套量词外，还识别「交替分支重叠」形态：分组被无界量词重复，且其顶层
 * 交替分支中存在可空前缀 / 相等分支 / 前缀关系（`(a|aa)+`、`(a|ab)*`、`(a|a?)+`）。
 * 该风险同样会向上传播（如 `((a|aa))+`）。
 *
 * 安全结构（`(?:ab)+`、`\d+`、`(a|b)+`、`[0-9]{2,4}`、`(?<y>\d{4})` 等）与无法
 * 判定的情况一律返回 null，避免误伤。即使静态判定漏判，调用方也会用 Worker 超时兜底。
 *
 * @returns 危险时返回中文原因；安全或无法判定返回 null。
 */
export function regexRiskReason(pattern: string): string | null {
  if (typeof pattern !== 'string' || !pattern) return null

  /** 在 pos 处尝试解析一个量词：返回是否无界（无上界）以及量词的结束位置 */
  const quantifierAt = (pos: number): { unbounded: boolean; end: number } | null => {
    const ch = pattern[pos]
    if (ch === '*' || ch === '+') return { unbounded: true, end: pos + 1 }
    if (ch === '?') return { unbounded: false, end: pos + 1 }
    if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(pos))
      if (!m) return null
      // {m} 与 {m,n} 有上界；{m,}（逗号后无数字）无上界
      const unbounded = m[2] !== undefined && (m[3] === undefined || m[3] === '')
      return { unbounded, end: pos + m[0].length }
    }
    return null
  }

  /** 每个未闭合分组：是否已含无界量词、是否含重叠交替风险、以及分组体起始位置 */
  const stack: { hasUnbounded: boolean; hasAltRisk: boolean; start: number }[] = []
  let inClass = false
  let i = 0
  while (i < pattern.length) {
    const ch = pattern[i]!
    if (ch === '\\') {
      i += 2 // 转义序列：下一个字符按字面量处理
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      i += 1
      continue
    }
    if (ch === '[') {
      inClass = true
      i += 1
      // 紧跟 [ 或 [^ 的 ] 是字面量，不算字符类结束
      if (pattern[i] === '^') i += 1
      if (pattern[i] === ']') i += 1
      continue
    }
    if (ch === '(') {
      stack.push({ hasUnbounded: false, hasAltRisk: false, start: i })
      i += 1
      continue
    }
    if (ch === ')') {
      const frame = stack.pop()
      const parent = stack[stack.length - 1]
      const q = quantifierAt(i + 1)
      const inner = frame ? stripGroupPrefix(pattern.slice(frame.start + 1, i)) : ''
      const alt = frame ? frame.hasAltRisk || alternationRisk(inner) : false
      if (frame && (frame.hasUnbounded || alt) && q && q.unbounded) {
        return '检测到可导致灾难性回溯的结构（嵌套无界量词或重叠交替分支），会冻结页面，请简化表达式'
      }
      // 组内含无界量词 / 重叠交替，或分组本身被无界量词重复，都会向上传播
      if (parent && ((frame && frame.hasUnbounded) || (q && q.unbounded))) parent.hasUnbounded = true
      if (parent && alt) parent.hasAltRisk = true
      if (q) {
        i = q.end
        if (pattern[i] === '?') i += 1 // 惰性量词后缀，不改变无界性
      } else {
        i += 1
      }
      continue
    }
    // 作用在普通原子（字符、字符类、\d 等）上的量词
    const q = quantifierAt(i)
    if (q) {
      if (q.unbounded && stack.length) stack[stack.length - 1]!.hasUnbounded = true
      i = q.end
      if (pattern[i] === '?') i += 1
      continue
    }
    i += 1
  }
  return null
}

/**
 * 纯同步执行器。
 * 必须完全自包含：函数体内不引用任何模块级标识符或 import 的符号——
 * 它会被 Function.prototype.toString() 注入到 Web Worker 源码里执行。
 * cap 默认 200000：超出即 capped = true 并停止收集。
 */
export function execRegex(source: string, flags: string, text: string, replacement?: string, cap = 200000): RegexResult {
  const serialize = (m: RegExpExecArray): RegexMatch => {
    const raw = m as unknown as (string | undefined)[]
    const groups: (string | null)[] = []
    for (let i = 1; i < raw.length; i++) {
      const g = raw[i]
      groups.push(g === undefined ? null : g)
    }
    let named: RegexNamed[] | null = null
    if (m.groups) {
      const src = m.groups as Record<string, string | undefined>
      named = []
      for (const k of Object.keys(src)) {
        const v = src[k]
        named.push({ name: k, value: v === undefined ? null : v })
      }
    }
    const matched = raw[0] === undefined ? '' : raw[0]
    return { index: m.index, end: m.index + matched.length, text: matched, groups, named }
  }
  try {
    const re = new RegExp(source, flags)
    const matches: RegexMatch[] = []
    let capped = false
    if (re.global || re.sticky) {
      let m: RegExpExecArray | null
      let guard = 0
      while ((m = re.exec(text)) !== null) {
        matches.push(serialize(m))
        if (m[0] === '') re.lastIndex++
        if (++guard > cap) {
          capped = true
          break
        }
      }
    } else {
      const one = re.exec(text)
      if (one) matches.push(serialize(one))
    }
    let replaced: string | null = null
    // 只要传入了替换模板就计算：undefined 表示不做替换；空串是合法替换（等价于删除匹配）
    if (replacement !== undefined) {
      replaced = text.replace(new RegExp(source, flags), replacement)
    }
    return { ok: true, matches, replaced, capped }
  } catch (err) {
    return {
      ok: false,
      matches: [],
      replaced: null,
      capped: false,
      error: String(err && (err as Error).message ? (err as Error).message : err)
    }
  }
}

/**
 * 生成组件用的 Worker 脚本：内部注入 execRegex 本体，保证 Worker 与同步路径只有一份实现。
 * 协议：收 {source, flags, text, replacement}，回 {ok, matches, replaced, capped, error?}。
 */
export function regexWorkerSource(): string {
  return `self.onmessage = function (e) {
  var d = e.data
  var execRegex = ${execRegex.toString()}
  self.postMessage(execRegex(d.source, d.flags, d.text, d.replacement))
}
`
}

/**
 * 主线程安全守卫：能做 Blob Worker 就在 Worker 里执行并加超时，避免灾难性回溯冻结页面；
 * Worker 不可用时（Node / 测试环境）回退到同步 execRegex，返回值语义完全一致。
 * 超时、Worker 错误、消息反序列化失败都会 settle 成失败结果，绝不悬挂、也不抛出。
 */
export function execRegexWithTimeout(
  source: string,
  flags: string,
  text: string,
  replacement?: string,
  timeoutMs = 2000
): Promise<RegexResult> {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return Promise.resolve(execRegex(source, flags, text, replacement))
  }
  let worker: Worker
  let url = ''
  try {
    url = URL.createObjectURL(new Blob([regexWorkerSource()], { type: 'text/javascript' }))
    worker = new Worker(url)
  } catch {
    // 创建失败（如浏览器策略限制）时退回同步路径，宁可慢也不能让步骤直接报错
    return Promise.resolve(execRegex(source, flags, text, replacement))
  }
  return new Promise<RegexResult>((resolve) => {
    const w = worker
    let settled = false
    const settle = (result: RegexResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      w.terminate()
      if (url) URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(() => {
      settle({
        ok: false,
        matches: [],
        replaced: null,
        capped: false,
        error: `正则执行超时（超过 ${timeoutMs}ms）：表达式可能存在灾难性回溯，请简化表达式或减少输入`
      })
    }, timeoutMs)
    w.onmessage = (ev: MessageEvent<RegexResult>) => settle(ev.data)
    w.onerror = (ev: ErrorEvent) => {
      settle({ ok: false, matches: [], replaced: null, capped: false, error: `Worker 执行错误：${ev.message || '未知错误'}` })
    }
    w.onmessageerror = () => {
      settle({ ok: false, matches: [], replaced: null, capped: false, error: 'Worker 消息无法反序列化' })
    }
    w.postMessage({ source, flags, text, replacement })
  })
}
