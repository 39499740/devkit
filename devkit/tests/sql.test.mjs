import { formatSql, minifySql, tokenizeSql } from '../app/utils/sql.ts'
import { check, eq } from './helpers.mjs'

const fmt = (sql, dialect = 'postgres', indent = 2) => formatSql(sql, { dialect, indent, uppercaseKeywords: true }).sql
const min = (sql, dialect = 'postgres') => minifySql(sql, dialect).sql

export const cases = [
  // 字面量绝不被改写（回归：E'' 被拆成 E '' 、$tag$ 内部被当成子句）
  eq('E 字符串保持为一个 token', tokenizeSql("select E'line\\nnext'", 'postgres').filter((t) => t.type === 'string').length, 1),
  check('E 字符串原文保留', () => fmt("select E'line\\nnext'").includes("E'line\\nnext'")),
  check('E 与字符串之间不插空格', () => !/E\s+'/.test(fmt("select E'line\\nnext'"))),
  check('小写 e 前缀同样识别', () => fmt("select e'x'").includes("e'x'")),
  check('U& 前缀识别', () => fmt("select U&'d\\0061t\\+0000'").includes("U&'d")),
  check('B/X 位串与十六进制串识别', () => fmt("select B'1010', X'FF'").includes("B'1010'") && fmt("select B'1010', X'FF'").includes("X'FF'")),

  // 美元引用
  check('$$ 字符串整体保留', () => fmt('select $$hello from where$$ as x').includes('$$hello from where$$')),
  check('$tag$ 字符串整体保留', () => fmt('select $tag$hello from where$tag$ as x').includes('$tag$hello from where$tag$')),
  check('$tag$ 内部的 from 不换行', () => !fmt('select $tag$hello from where$tag$ as x').includes('\nFROM where$tag$')),
  check('$tag$ 内部的 where 不触发行首子句', () => {
    const out = fmt('select $tag$hello where x$tag$ from t')
    return out.split('\n').filter((l) => /^\s*WHERE/.test(l)).length === 0
  }),
  check('$tag$ 后仍然正常换行', () => fmt('select a from t where b = $q$x$q$').includes('\nWHERE b = $q$x$q$')),
  check('未闭合的 $tag$ 报错', () => {
    try {
      fmt('select $q$abc')
      return false
    } catch (e) {
      return /未闭合/.test(e.message)
    }
  }),
  check('未闭合的 E 字符串报错', () => {
    try {
      fmt("select E'abc")
      return false
    } catch (e) {
      return /未闭合/.test(e.message)
    }
  }),

  // 原有行为回归
  check('字面量里的关键字不被大写', () => fmt("select 'from where' as x").includes("'from where'")),
  check('标识符不被改写', () => fmt('select u.id, o.total from users u').includes('u.id')),
  check('保留字同名标识符只提示不改写', () => {
    const r = formatSql('select id, value from t', { dialect: 'postgres', indent: 2, uppercaseKeywords: true })
    return r.sql.includes('value') && r.reservedIdentifiers.includes('value') && !r.sql.includes('"value"')
  }),
  check('MySQL # 注释识别', () => tokenizeSql('select 1 # 注释', 'mysql').some((t) => t.type === 'comment')),
  check('PostgreSQL 下 # 不是注释', () => !tokenizeSql('select 1 # x', 'postgres').some((t) => t.type === 'comment')),
  check('MySQL 的 -- 无空格给出提示', () => {
    const r = formatSql('select 1 --x\nfrom t', { dialect: 'mysql', indent: 2, uppercaseKeywords: true })
    return r.warnings.some((w) => w.includes('--'))
  }),
  check('PostgreSQL 反引号给出提示', () => {
    const r = formatSql('select `a` from t', { dialect: 'postgres', indent: 2, uppercaseKeywords: true })
    return r.warnings.some((w) => w.includes('反引号'))
  }),
  check('子查询缩进', () => {
    const out = fmt('select a, (select max(x) from y where y.id = t.id) as m from t')
    return out.includes('  (\n    SELECT') && out.includes('  ) AS m')
  }),
  check('压缩成一行且不再有换行', () => !min('select a, b from t where c = 1').includes('\n')),
  check('压缩移除注释', () => !min('select a /* x */ from t').includes('/*')),
  check('压缩后分号紧贴结尾', () => min('select a from t ;').endsWith(';')),

  // 压缩：字面量内部一个字符都不能动（回归：token join 成整段后跑空白/标点正则会改写字面量）
  eq('压缩不改字符串内连续空格', min("SELECT 'a   b' FROM t"), "SELECT 'a   b' FROM t"),
  eq('压缩不改字符串内逗号间距', min("SELECT 'a , b' FROM t"), "SELECT 'a , b' FROM t"),
  eq('压缩不改字符串内点号', min("SELECT 'a . b' FROM t"), "SELECT 'a . b' FROM t"),
  eq('压缩不改字符串内括号', min("SELECT 'f( x )' FROM t"), "SELECT 'f( x )' FROM t"),
  eq('压缩不改 $tag$ 内空白与逗号', min('SELECT $tag$a  ,  b$tag$ FROM t'), 'SELECT $tag$a  ,  b$tag$ FROM t'),
  check('压缩保留字符串内的换行（不能为了一行而改数据）', () =>
    min("SELECT $$line1\n\nline2$$ FROM t").includes('$$line1\n\nline2$$')
  ),
  check('设计稿样例格式化结果稳定', () => {
    const sample = 'select u.id,u.name,o.total,o.created_at\nfrom users u\njoin orders o\non o.user_id=u.id\nwhere o.total>1000\nand u.status=\'active\'\norder by o.total desc\nlimit 20;'
    const out = fmt(sample, 'mysql', 2)
    return out.startsWith('SELECT u.id,') && out.includes('\nWHERE o.total > 1000') && out.endsWith('LIMIT 20;')
  })
]
void check
