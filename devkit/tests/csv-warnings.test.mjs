/**
 * CSV ⇄ JSON 静默丢数据告警回归：
 * - CSV → JSON：重复表头后列覆盖前列（静默丢列），必须给出中文告警；
 * - JSON → CSV：字面含 `.` 的键被当作嵌套路径（取值落空输出空单元格），必须给出中文告警。
 * 同时回归正常数据不产生这两类误报。
 */
import { check, eq } from './helpers.mjs'
import { csvToJson, jsonToCsv } from '../app/utils/csv.ts'

export const cases = []

// ── 任务 1：重复表头必须告警，且保留现有「后列覆盖前列」行为 ──
const dup = csvToJson('a,a\n1,2', { separator: ',', header: true, infer: false })
cases.push(
  check(
    '重复表头（a,a）：warnings 含中文重复列名提示',
    () => dup.warnings.some((w) => w.includes('重复列名') && w.includes('a'))
  )
)
cases.push(
  check(
    '重复表头（a,a）：提示列出重复键与列号（第 1、2 列）',
    () => dup.warnings.some((w) => w.includes('第 1、2 列') && w.includes('覆盖'))
  )
)
cases.push(eq('重复表头（a,a）：结果对象只保留后一列的值（现状）', JSON.parse(dup.json), [{ a: '2' }]))
cases.push(eq('重复表头（a,a）：columns 仍为去重前的列名数组', dup.columns, ['a', 'a']))

// 多个重复键：逐个列出，并用「等 N 个」限制展示数量（最多 3 个）
const dupMany = csvToJson('a,a,b,b\n1,2,3,4', { separator: ',', header: true, infer: false })
cases.push(
  check(
    '重复表头（a,a,b,b）：同时列出 a 与 b 两个重复列名',
    () => dupMany.warnings.some((w) => w.includes('a（第 1、2 列）') && w.includes('b（第 3、4 列）'))
  )
)
const dupCapped = csvToJson('a,a,b,b,c,c,d,d\n1,2,3,4,5,6,7,8', { separator: ',', header: true, infer: false })
cases.push(
  check(
    '重复表头超过 3 个：仅展示前 3 个并用「等 4 个重复列名」收尾',
    () => dupCapped.warnings.some((w) => w.includes('等 4 个重复列名') && !w.includes('d（第'))
  )
)

// 保留现有「列数不一致」告警行为
const ragged = csvToJson('a,b\n1,2,3', { separator: ',', header: true, infer: false })
cases.push(
  check('回归：列数不一致仍告警（不因新增逻辑丢失）', () => ragged.warnings.some((w) => w.includes('列不一致')))
)

// ── 任务 2：字面含点号的键必须告警 ──
const dotted = jsonToCsv('[{"user.name":"Ada","age":36}]', { separator: ',', header: true })
cases.push(
  check(
    '点号字面键（user.name）：warnings 含中文点号提示',
    () => dotted.warnings.some((w) => w.includes('含点号') && w.includes('user.name'))
  )
)
cases.push(
  check(
    '点号字面键（user.name）：提示说明按路径分隔符处理可能导致取值失败',
    () => dotted.warnings.some((w) => w.includes('按路径分隔符处理') && w.includes('建议改用不含点号的键名'))
  )
)
cases.push(eq('点号字面键（user.name）：取值落空输出空单元格（现状）', dotted.csv, 'user.name,age\n,36'))

// ── 回归：正常数据不产生这两类告警 ──
const normalCsv = csvToJson('a,b\n1,2', { separator: ',', header: true, infer: false })
cases.push(
  check('回归：正常 CSV（无重复表头）不产生重复列名告警', () => !normalCsv.warnings.some((w) => w.includes('重复列名')))
)
const normalJson = jsonToCsv('[{"user":{"name":"Ada"},"age":36}]', { separator: ',', header: true })
cases.push(
  check(
    '回归：正常嵌套 JSON（无字面点号键）不产生点号告警',
    () => !normalJson.warnings.some((w) => w.includes('含点号'))
  )
)
cases.push(eq('回归：正常嵌套 JSON 仍正确拍平并取值', normalJson.csv, 'user.name,age\nAda,36'))
