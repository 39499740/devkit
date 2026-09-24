/**
 * T08 逐行去重 / 整理：组件与流程编排共用同一份语义。
 * 默认不改任何空格：不 trim、不去空行、大小写敏感。
 */

export interface TidyOptions {
  caseSensitive: boolean
  removeBlank: boolean
  trim: boolean
  sort: 'keep' | 'dict'
}

export interface TidyResult {
  text: string
  inLines: number
  outLines: number
  dup: number
  blank: number
}

export function tidyText(text: string, opts: TidyOptions): TidyResult {
  // 统一换行：CRLF / 单独 CR 都规范为 LF，避免行尾残留的 \r 让重复行无法识别；
  // 输出也统一用 LF（纯 LF 输入行为不变）。
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const seen = new Set<string>()
  const result: string[] = []
  let dup = 0
  let blank = 0
  for (const raw of lines) {
    // 仅在显式勾选「trim」时才去掉行首尾空格
    const line = opts.trim ? raw.trim() : raw
    // 空行 = 只含空白字符的行；仅在显式勾选「去除空行」时删除
    if (opts.removeBlank && line.trim() === '') {
      blank++
      continue
    }
    const key = opts.caseSensitive ? line : line.toLowerCase()
    if (seen.has(key)) {
      dup++
      continue
    }
    seen.add(key)
    result.push(line)
  }
  if (opts.sort === 'dict') result.sort()
  return { text: result.join('\n'), inLines: lines.length, outLines: result.length, dup, blank }
}
