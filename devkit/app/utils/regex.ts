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
