/**
 * T42 SQL 格式化：词法切分 + 子句级重排（不是完整 SQL 解析器）。
 * 方言影响注释语法（MySQL 支持 #）、引用符建议与语法提示；
 * 只重排空白与关键字大小写，绝不改写字面量或标识符名称。
 */

export type SqlDialect = 'mysql' | 'postgres' | 'sqlite'

export interface SqlFormatOptions {
  dialect: SqlDialect
  indent: number
  uppercaseKeywords: boolean
}

export interface SqlFormatResult {
  sql: string
  /** 与保留字同名的标识符：只提示引用符建议，不改写原文 */
  reservedIdentifiers: string[]
  /** 方言相关提示 */
  warnings: string[]
  notes: string[]
  lines: number
  chars: number
}

type TokType = 'comment' | 'string' | 'number' | 'word' | 'op' | 'punct'

interface Tok {
  type: TokType
  text: string
}

const QUOTE: Record<SqlDialect, string> = { mysql: '`', postgres: '"', sqlite: '"' }

/** 结构关键字：参与大小写统一。子句首词交给 CLAUSES，避免把同名标识符改成大写 */
const KEYWORDS = new Set(
  `join inner left right full outer cross natural using on as and or not in is null true false all distinct exists between like ilike similar case when then else end asc desc cast over partition primary foreign references unique check default for only begin commit rollback transaction explain analyze vacuum grant revoke`
    .split(/\s+/)
    .filter(Boolean)
)

/** 固定搭配里需要统一大小写的词（这些词不在 KEYWORDS 中，例如 PRIMARY KEY 的 key） */
const PHRASE_KEYWORDS = new Set(
  `key null distinct from delete update conflict nothing do action set default character time zone by all group partition on not is`
    .split(/\s+/)
    .filter(Boolean)
)

/** 保留字：与这些同名的标识符会被提示（不改写原文） */
const RESERVED = new Set(
  `select from where group order by having limit offset join inner left right full outer cross natural on using as and or not in is null true false insert into values update set delete create table view index drop alter add primary key foreign references unique check default union all distinct exists between like case when then else end asc desc cast over partition window returning with recursive lateral intersect except grant revoke
   user key value level current date time timestamp row rows rank column constraint database schema trigger procedure function role session transaction`
    .split(/\s+/)
    .filter(Boolean)
)

/** 会换行的子句起始 */
const CLAUSES: string[][] = [
  ['select'],
  ['insert', 'into'],
  ['insert', 'ignore', 'into'],
  ['replace', 'into'],
  ['delete', 'from'],
  ['update'],
  ['set'],
  ['from'],
  ['where'],
  ['group', 'by'],
  ['order', 'by'],
  ['having'],
  ['window'],
  ['qualify'],
  ['limit'],
  ['offset'],
  ['fetch', 'first'],
  ['fetch', 'next'],
  ['returning'],
  ['values'],
  ['with'],
  ['union', 'all'],
  ['union'],
  ['intersect'],
  ['except'],
  ['create', 'table'],
  ['create', 'view'],
  ['create', 'index'],
  ['alter', 'table'],
  ['drop', 'table'],
  ['drop', 'view'],
  ['truncate', 'table']
]

/** 会换行的连接子句 */
const JOIN_CLAUSES: string[][] = [
  ['natural', 'left', 'outer', 'join'],
  ['natural', 'right', 'outer', 'join'],
  ['natural', 'full', 'outer', 'join'],
  ['natural', 'left', 'join'],
  ['natural', 'right', 'join'],
  ['natural', 'full', 'join'],
  ['left', 'outer', 'join'],
  ['right', 'outer', 'join'],
  ['full', 'outer', 'join'],
  ['left', 'join'],
  ['right', 'join'],
  ['full', 'join'],
  ['inner', 'join'],
  ['cross', 'join'],
  ['straight_join'],
  ['cross', 'apply'],
  ['outer', 'apply'],
  ['join']
]

/** 不换行的固定搭配 */
const PHRASES: string[][] = [
  ['primary', 'key'],
  ['foreign', 'key'],
  ['not', 'null'],
  ['is', 'not', 'null'],
  ['is', 'null'],
  ['is', 'not', 'distinct', 'from'],
  ['on', 'delete'],
  ['on', 'update'],
  ['on', 'conflict'],
  ['do', 'nothing'],
  ['do', 'update'],
  ['set', 'null'],
  ['set', 'default'],
  ['no', 'action'],
  ['character', 'set'],
  ['with', 'time', 'zone'],
  ['partition', 'by'],
  ['group', 'concat'],
  ['not', 'in'],
  ['not', 'exists']
]

const NEWLINE_WORDS = new Set(['on', 'and', 'or', 'when', 'then', 'else', 'end'])
const NO_SPACE_BEFORE = new Set([',', ';', ')', '.', '::', '->', '->>', '#>', '#>>'])
const NO_SPACE_AFTER = new Set(['(', '.', '::', '->', '->>', '#>', '#>>'])

/** 字符串前缀：E' / e' / B' / b' / X' / x' / U&' / u&'（长度表示前缀字符数） */
function stringPrefixAt(sql: string, i: number): string | null {
  const two = sql.slice(i, i + 2)
  if (two === 'U&' || two === 'u&') return sql[i + 2] === "'" ? two : null
  const one = sql[i]
  if ((one === 'E' || one === 'e' || one === 'B' || one === 'b' || one === 'X' || one === 'x') && sql[i + 1] === "'") {
    return one
  }
  return null
}

/** 从引号位置读到闭合引号之后（支持 '' 与反斜杠转义），未闭合时报错 */
function readSingleQuoted(sql: string, quoteIndex: number, backslashEscapes: boolean): number {
  const n = sql.length
  let j = quoteIndex + 1
  while (j < n) {
    if (backslashEscapes && sql[j] === '\\') {
      j += 2
      continue
    }
    if (sql[j] === "'") {
      if (sql[j + 1] === "'") {
        j += 2
        continue
      }
      return j + 1
    }
    j += 1
  }
  throw new Error('单引号字符串未闭合')
}

function isWordStart(ch: string) {
  return /[A-Za-z_\u4e00-\u9fff$]/.test(ch)
}
function isWordPart(ch: string) {
  return /[A-Za-z0-9_\u4e00-\u9fff$]/.test(ch)
}

/** 词法切分：字面量未闭合直接报错，不猜测 */
export function tokenizeSql(sql: string, dialect: SqlDialect): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const n = sql.length
  while (i < n) {
    const ch = sql[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      let j = sql.indexOf('\n', i)
      if (j === -1) j = n
      toks.push({ type: 'comment', text: sql.slice(i, j).trimEnd() })
      i = j
      continue
    }
    if (ch === '#' && dialect === 'mysql') {
      let j = sql.indexOf('\n', i)
      if (j === -1) j = n
      toks.push({ type: 'comment', text: sql.slice(i, j).trimEnd() })
      i = j
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2)
      if (j === -1) throw new Error('块注释 /* 未闭合')
      toks.push({ type: 'comment', text: sql.slice(i, j + 2) })
      i = j + 2
      continue
    }
    // 带前缀的字符串字面量：E'..'（PG 转义）、B'..'、X'..'、U&'..'
    const prefix = stringPrefixAt(sql, i)
    if (prefix) {
      const end = readSingleQuoted(sql, i + prefix.length, prefix !== 'U&')
      toks.push({ type: 'string', text: sql.slice(i, end) })
      i = end
      continue
    }
    if (ch === "'") {
      const end = readSingleQuoted(sql, i, dialect === 'mysql')
      toks.push({ type: 'string', text: sql.slice(i, end) })
      i = end
      continue
    }
    // 美元引用字符串：$$...$$ 与 $tag$...$tag$（PostgreSQL）
    if (ch === '$' && dialect === 'postgres') {
      const m = /^\$([A-Za-z_\u4e00-\u9fff][\w\u4e00-\u9fff]*)?\$/.exec(sql.slice(i))
      if (m) {
        const delim = m[0]
        const end = sql.indexOf(delim, i + delim.length)
        if (end === -1) throw new Error(`${delim} 字符串未闭合`)
        toks.push({ type: 'string', text: sql.slice(i, end + delim.length) })
        i = end + delim.length
        continue
      }
    }
    if (ch === '"' || ch === '`') {
      const close = ch
      let j = i + 1
      while (j < n) {
        if (sql[j] === close) {
          if (sql[j + 1] === close) {
            j += 2
            continue
          }
          break
        }
        j += 1
      }
      if (j >= n) throw new Error(`${close === '`' ? '反引号' : '双引号'}标识符未闭合`)
      toks.push({ type: 'word', text: sql.slice(i, j + 1) })
      i = j + 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      let j = i
      if (ch === '0' && /[xXbB]/.test(sql[i + 1] ?? '')) {
        j = i + 2
        while (j < n && /[0-9a-fA-F_]/.test(sql[j]!)) j += 1
      } else {
        while (j < n && /[0-9.eE_]/.test(sql[j]!)) {
          if ((sql[j] === 'e' || sql[j] === 'E') && /[+-]/.test(sql[j + 1] ?? '')) j += 1
          j += 1
        }
      }
      toks.push({ type: 'number', text: sql.slice(i, j) })
      i = j
      continue
    }
    if (isWordStart(ch)) {
      let j = i
      while (j < n && isWordPart(sql[j]!)) j += 1
      toks.push({ type: 'word', text: sql.slice(i, j) })
      i = j
      continue
    }
    const three = sql.slice(i, i + 3)
    if (three === '->>' || three === '#>>') {
      toks.push({ type: 'op', text: three })
      i += 3
      continue
    }
    const two = sql.slice(i, i + 2)
    if (['<>', '<=', '>=', '!=', '||', '::', '->', '#>', ':=', '=>'].includes(two)) {
      toks.push({ type: 'op', text: two })
      i += 2
      continue
    }
    toks.push({ type: 'punct', text: ch })
    i += 1
  }
  return toks
}

function isQuotedIdent(t: Tok) {
  return t.type === 'word' && /^["`]/.test(t.text)
}

function matchPhrase(toks: Tok[], pos: number, phrase: string[]): number | null {
  let k = pos
  for (const want of phrase) {
    const t = toks[k]
    if (!t || t.type !== 'word' || isQuotedIdent(t) || t.text.toLowerCase() !== want) return null
    k += 1
  }
  return k
}

function firstMatch(toks: Tok[], pos: number, list: string[][]): string[] | null {
  for (const p of list) {
    if (matchPhrase(toks, pos, p) !== null) return p
  }
  return null
}

export function formatSql(sql: string, opts: SqlFormatOptions): SqlFormatResult {
  const toks = tokenizeSql(sql, opts.dialect)
  const unit = ' '.repeat(opts.indent)
  const lines: string[] = []
  const reservedIdentifiers: string[] = []
  const warnings: string[] = []
  const parenStack: { base: number; at: number; close: number }[] = []
  let innerBase = 0
  let buf = ''
  let lineIndent = 0
  let inSelectList = false
  let lastKeyword = false

  const kase = (w: string) => (opts.uppercaseKeywords ? w.toUpperCase() : w.toLowerCase())
  const clauseIndent = () => (parenStack.length ? innerBase : 0)
  const listIndent = () => clauseIndent() + 1

  function flush() {
    if (buf.trim()) lines.push(unit.repeat(lineIndent) + buf.trimEnd())
    buf = ''
  }

  function startLine(indent: number) {
    flush()
    lineIndent = Math.max(0, indent)
  }

  function put(text: string, space = true) {
    if (space && buf !== '' && !/\s$/.test(buf)) buf += ' '
    buf += text
  }

  const spaceBeforeOf = (t: Tok) => {
    if (buf.trim() === '') return false
    if (NO_SPACE_BEFORE.has(t.text)) return false
    if (NO_SPACE_AFTER.has(buf.trimEnd().slice(-1))) return false
    if (t.text === '(') return lastKeyword
    return true
  }

  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]!

    if (t.type === 'comment') {
      if (t.text.startsWith('/*')) {
        put(t.text, buf.trim() !== '')
      } else if (buf.trim()) {
        buf += ` ${t.text}`
        flush()
        lineIndent = clauseIndent()
      } else {
        startLine(clauseIndent())
        buf = t.text
        flush()
      }
      continue
    }

    if (t.type === 'punct' && t.text === '(') {
      put('(', spaceBeforeOf(t))
      parenStack.push({ base: innerBase, at: lines.length, close: lineIndent })
      innerBase = lineIndent + 1
      lastKeyword = false
      continue
    }
    if (t.type === 'punct' && t.text === ')') {
      const st = parenStack.pop()
      innerBase = st ? st.base : 0
      if (st && lines.length > st.at) {
        startLine(st.close)
        buf = ')'
      } else {
        buf = buf.trimEnd() + ')'
      }
      lastKeyword = false
      continue
    }
    if (t.type === 'punct' && t.text === ';') {
      buf = buf.trimEnd() + ';'
      flush()
      inSelectList = false
      lineIndent = 0
      lastKeyword = false
      continue
    }
    if (t.type === 'punct' && t.text === ',') {
      buf = buf.trimEnd() + ','
      if (inSelectList) startLine(listIndent())
      lastKeyword = false
      continue
    }

    if (t.type === 'word' && !isQuotedIdent(t)) {
      const w = t.text.toLowerCase()
      const join = firstMatch(toks, i, JOIN_CLAUSES)
      if (join) {
        startLine(clauseIndent())
        put(join.map(kase).join(' '), false)
        inSelectList = false
        lastKeyword = true
        i += join.length - 1
        continue
      }
      const clause = firstMatch(toks, i, CLAUSES)
      if (clause) {
        startLine(clauseIndent())
        put(clause.map(kase).join(' '), false)
        inSelectList = clause[0] === 'select'
        lastKeyword = true
        i += clause.length - 1
        continue
      }
      const phrase = firstMatch(toks, i, PHRASES)
      if (phrase) {
        put(
          phrase.map((p) => (KEYWORDS.has(p) || PHRASE_KEYWORDS.has(p) ? kase(p) : p)).join(' '),
          spaceBeforeOf(t)
        )
        lastKeyword = true
        i += phrase.length - 1
        continue
      }
      if (NEWLINE_WORDS.has(w)) {
        startLine(clauseIndent())
        put(kase(t.text), false)
        lastKeyword = true
        continue
      }
      if (KEYWORDS.has(w)) {
        put(kase(t.text), spaceBeforeOf(t))
        lastKeyword = true
        continue
      }
      if (RESERVED.has(w)) {
        reservedIdentifiers.push(t.text)
        put(t.text, spaceBeforeOf(t))
        lastKeyword = false
        continue
      }
    }

    put(t.text, spaceBeforeOf(t))
    lastKeyword = false
  }
  flush()

  const out = lines.join('\n')
  const uniqReserved = [...new Set(reservedIdentifiers)]
  const notes = [`${lines.length} 行、${out.length} 字符`]
  if (uniqReserved.length) {
    notes.push(
      `${uniqReserved.length} 个标识符与保留字同名（${opts.dialect} 的引用符是 ${QUOTE[opts.dialect]}）：${uniqReserved
        .slice(0, 4)
        .join('、')}${uniqReserved.length > 4 ? ' 等' : ''}，未改写原文`
    )
  }
  if (opts.dialect !== 'mysql' && toks.some((x) => x.type === 'comment' && x.text.startsWith('#'))) {
    warnings.push('# 行注释只有 MySQL 支持，换数据库前请改成 --')
  }
  if (opts.dialect === 'postgres' && sql.includes('`')) {
    warnings.push('PostgreSQL 不支持反引号标识符，请改用双引号')
  }
  if (opts.dialect === 'postgres' && /\[[A-Za-z_]/.test(sql)) {
    warnings.push('PostgreSQL 不支持 [ ] 标识符写法（这是 SQLite / SQL Server 语法）')
  }
  if (opts.dialect === 'mysql' && /--[^\s-]/.test(sql)) {
    warnings.push('MySQL 的 -- 注释后必须有空格，--x 会被当成减法')
  }
  if (opts.dialect === 'sqlite' && /::/.test(sql)) {
    warnings.push('SQLite 不支持 :: 类型转换写法，请改用 CAST(x AS type)')
  }
  return {
    sql: out,
    reservedIdentifiers: uniqReserved,
    warnings,
    notes,
    lines: lines.length,
    chars: out.length
  }
}

/**
 * 两个 token 之间要不要留空格：与格式化同一条规则——括号只在关键字之后留
 * （IN (…) / VALUES (…)），函数调用 count(*) 后面不留；其余按标点集合判定。
 */
function needsSpaceBetween(prev: Tok, next: Tok): boolean {
  if (next.text === '(') return prev.type === 'word' && KEYWORDS.has(prev.text.toLowerCase())
  if (NO_SPACE_BEFORE.has(next.text)) return false
  if (NO_SPACE_AFTER.has(prev.text)) return false
  return true
}

/**
 * 压缩成一行：移除注释，并且只在 token 之间决定空白。
 * 字符串 / 标识符 token 一律原样输出——不对拼接后的整段文本跑空白或标点正则，
 * 否则字面量内部的空格、逗号、点号会被一起改写（'a   b' → 'a b' 这类静默改数据）。
 */
export function minifySql(sql: string, dialect: SqlDialect): SqlFormatResult {
  const toks = tokenizeSql(sql, dialect)
  const kept = toks.filter((t) => t.type !== 'comment')
  const removed = toks.length - kept.length
  let text = ''
  let prev: Tok | null = null
  for (const t of kept) {
    if (prev && needsSpaceBetween(prev, t)) text += ' '
    text += t.text
    prev = t
  }
  text = text.trim()
  const notes = [removed ? `已移除 ${removed} 处注释` : '无注释可移除']
  return {
    sql: text,
    reservedIdentifiers: [],
    warnings: [],
    notes,
    lines: 1,
    chars: text.length
  }
}

export const sqlDialects: { value: SqlDialect; label: string }[] = [
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' }
]
