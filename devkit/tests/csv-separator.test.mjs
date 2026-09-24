/**
 * CSV / JSON 转换步骤的分隔符校验回归（盲测 P3-5）：
 * 手改 / 导入的流程 JSON 可能把 separator 写成空串或长度 > 1 的字符串（如 ''、'||'），
 * 此时 parseCsv / jsonToCsv 会把整行当作单字段静默退化。
 * 执行器必须对两个方向（csv2json / json2csv）都抛中文错误；合法的 , ; Tab 保持正常。
 */
import { check, eq } from './helpers.mjs'
import { createStep, runStep } from '../app/utils/workflow.ts'

const CJK = /[\u4e00-\u9fa5]/
const INPUT = 'a,b\n1,2'

export const cases = []

/* ── csv2json：非法分隔符必须失败且提示为中文 ── */
const csv2json = (separator, text = INPUT) =>
  runStep(createStep('csv-json', { direction: 'csv2json', header: true, infer: false, separator }), text, 0)

for (const [label, separator] of [
  ['空串', ''],
  ['多字符 ||', '||']
]) {
  const res = await csv2json(separator)
  cases.push(
    check(
      `csv2json 分隔符${label}：status=fail`,
      () => res.status === 'fail'
    )
  )
  cases.push(
    check(
      `csv2json 分隔符${label}：note 为中文且说明需单个字符`,
      () => CJK.test(res.note) && res.note.includes('分隔符') && res.note.includes('单个字符')
    )
  )
}

/* ── json2csv：非法分隔符同样必须失败 ── */
const json2csv = (separator) =>
  runStep(
    createStep('csv-json', { direction: 'json2csv', header: true, separator }),
    '[{"a":1,"b":2}]',
    0
  )

for (const [label, separator] of [
  ['空串', ''],
  ['多字符 ||', '||']
]) {
  const res = await json2csv(separator)
  cases.push(
    check(
      `json2csv 分隔符${label}：status=fail`,
      () => res.status === 'fail'
    )
  )
  cases.push(
    check(
      `json2csv 分隔符${label}：note 为中文且说明需单个字符`,
      () => CJK.test(res.note) && res.note.includes('分隔符') && res.note.includes('单个字符')
    )
  )
}

/* ── 合法分隔符（catalog 只给 , ; Tab）保持正常 ── */
const comma = await csv2json(',')
cases.push(eq('逗号分隔符：status=ok', comma.status, 'ok'))
cases.push(eq('逗号分隔符：正确转换两列', JSON.parse(comma.payload.text), [{ a: '1', b: '2' }]))

const semi = await csv2json(';', 'a;b\n1;2')
cases.push(eq('分号分隔符：status=ok', semi.status, 'ok'))
cases.push(eq('分号分隔符：正确转换两列', JSON.parse(semi.payload.text), [{ a: '1', b: '2' }]))

const tab = await csv2json('\t', 'a\tb\n1\t2')
cases.push(eq('Tab 分隔符：status=ok', tab.status, 'ok'))
cases.push(eq('Tab 分隔符：正确转换两列', JSON.parse(tab.payload.text), [{ a: '1', b: '2' }]))

// 回归：默认（未显式传 separator）走 fallback ','，不得误报
const dflt = await runStep(createStep('csv-json', { direction: 'csv2json', header: true, infer: false }), INPUT, 0)
cases.push(eq('回归：未配置 separator 时默认逗号仍工作', dflt.status, 'ok'))
cases.push(eq('回归：未配置 separator 时输出正确', JSON.parse(dflt.payload.text), [{ a: '1', b: '2' }]))
