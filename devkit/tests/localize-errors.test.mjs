/**
 * 英文错误兜底中文化 + 大整数静默降级告警 回归测试：
 * - localizeRegexMessage：常见 V8 正则错误 → 中文，兜底为中性中文且不含英文单词；
 * - localizeJsonMessage / localizeYamlMessage：英文样例 → 中文，兜底为中文；
 * - hasUnsafeRawNumber：递归识别超出安全范围的 RawNumber；
 * - jsonpath / jmespath / json-schema-gen / schema-validate：大整数输入在 note 给出中文告警。
 */
import { localizeRegexMessage } from '../app/utils/regex.ts'
import { hasUnsafeRawNumber, localizeJsonMessage, localizeYamlMessage, parseJson } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check } from './helpers.mjs'

export const cases = []
const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)
/** 连续两个及以上拉丁字母视为「英文单词」（n、JSON 等单字母/缩写不算） */
const hasEnglishWord = (s) => /[A-Za-z]{2,}/.test(s)

/* ─────────────── localizeRegexMessage ─────────────── */
const regexSamples = [
  ['Invalid regular expression: /(/: Unterminated group', /分组|括号/],
  ["Invalid regular expression: /)/: Unmatched ')'", /右括号/],
  ['Invalid regular expression: /*/: Nothing to repeat', /量词/],
  ['Invalid regular expression: /(?/: Invalid group', /分组/],
  ['Invalid regular expression: /a{/: Lone quantifier brackets', /量词|花括号/],
  ['Invalid regular expression: /[a/: Unterminated character class', /字符组/],
  ["Invalid flags supplied to RegExp constructor 'z'", /标志/],
  ['Invalid regular expression: missing /', /不合法/]
]
for (const [raw, re] of regexSamples) {
  const out = localizeRegexMessage(raw)
  cases.push(check(`正则错误中文化：${raw}`, () => re.test(out) && hasChinese(out) && !hasEnglishWord(out)))
}
cases.push(
  check('正则错误兜底为中文且不含英文单词', () => {
    const out = localizeRegexMessage('Some totally unknown internal failure')
    return hasChinese(out) && !hasEnglishWord(out)
  })
)
cases.push(
  check('正则错误带 pattern 时保留用户表达式', () => {
    const out = localizeRegexMessage('Invalid regular expression: /(/: Unterminated group', '(abc')
    return out.includes('(abc') && hasChinese(out)
  })
)

/* ─────────────── localizeJsonMessage ─────────────── */
const jsonSamples = [
  ["Expected property name or '}' in JSON at position 1", /属性名/],
  ['Expected double-quoted property name in JSON at position 5', /双引号/],
  ["Expected ':' after property name in JSON at position 4", /冒号/],
  ["Expected ',' or ']' after array element in JSON at position 3", /数组/],
  ["Expected ',' or '}' after property value in JSON at position 3", /逗号|花括号/],
  ['Unexpected end of JSON input', /提前结束/],
  ['Unterminated string in JSON at position 2', /引号/],
  ["Unexpected token ']', \"[1,]\" is not valid JSON", /意外|不是合法/]
]
for (const [raw, re] of jsonSamples) {
  const out = localizeJsonMessage(raw)
  cases.push(check(`JSON 错误中文化：${raw}`, () => re.test(out) && hasChinese(out)))
}
cases.push(
  check('JSON 未知错误兜底为中文且不泄漏英文', () => {
    const out = localizeJsonMessage('some unknown internal error')
    return hasChinese(out) && !/unknown/.test(out)
  })
)

/* ─────────────── localizeYamlMessage ─────────────── */
cases.push(
  check('YAML 缩进错误中文化', () => {
    const out = localizeYamlMessage(new Error('bad indentation of a mapping entry at line 2, column 3'))
    return /缩进/.test(out) && hasChinese(out)
  })
)
cases.push(
  check('YAML 重复键中文化', () => {
    const out = localizeYamlMessage(new Error('duplicated mapping key'))
    return /重复/.test(out) && hasChinese(out)
  })
)
cases.push(
  check('YAML 带 mark 时补「第 X 行第 Y 列附近」', () => {
    const e = new Error('duplicated mapping key')
    e.mark = { line: 1, column: 2 }
    const out = localizeYamlMessage(e)
    return out.includes('第 2 行第 3 列附近') && /重复/.test(out)
  })
)
cases.push(
  check('YAML 未知错误兜底为中文', () => {
    const out = localizeYamlMessage(new Error('some unknown yaml failure'))
    return hasChinese(out)
  })
)

/* ─────────────── hasUnsafeRawNumber ─────────────── */
cases.push(
  check('parseJson 含超范围大整数 → true', () => hasUnsafeRawNumber(parseJson('{"id":12345678901234567890}').value))
)
cases.push(
  check('嵌套数组中的超范围大整数 → true', () => hasUnsafeRawNumber(parseJson('{"list":[{"n":1},{"n":99999999999999999999}]}').value))
)
cases.push(check('普通值 → false', () => !hasUnsafeRawNumber(parseJson('{"a":1,"b":[1,2],"c":"x","d":true,"e":null}').value)))
cases.push(check('最大安全整数 → false', () => !hasUnsafeRawNumber(parseJson('{"a":9007199254740991}').value)))
cases.push(check('非 RawNumber 输入 → false', () => !hasUnsafeRawNumber({ a: 1, b: '12345678901234567890' })))

/* ─────────────── 流程步骤大整数告警（仅告警，不改输出） ─────────────── */
async function buildCases() {
  const big = '{"id":12345678901234567890}'
  const jp = await runStep(createStep('jsonpath', { expr: '$.id' }), big, 0)
  cases.push(check('jsonpath 大整数给出中文告警', () => jp.status === 'ok' && jp.note.includes('安全整数')))

  const jm = await runStep(createStep('jmespath', { expr: 'id' }), big, 0)
  cases.push(check('jmespath 大整数给出中文告警', () => jm.status === 'ok' && jm.note.includes('安全整数')))

  const sg = await runStep(createStep('json-schema-gen'), big, 0)
  cases.push(check('json-schema-gen 大整数给出中文告警', () => sg.status === 'ok' && sg.note.includes('安全整数')))

  const sv = await runStep(createStep('schema-validate', { schema: '{"type":"object"}' }), big, 0)
  cases.push(check('schema-validate 实例大整数给出中文告警', () => sv.status === 'ok' && sv.note.includes('安全整数')))

  // 回归：普通数值不产生告警
  const jpOk = await runStep(createStep('jsonpath', { expr: '$.id' }), '{"id":42}', 0)
  cases.push(check('普通数值不产生大整数告警', () => jpOk.status === 'ok' && !jpOk.note.includes('安全整数')))

  return cases
}

await buildCases()
