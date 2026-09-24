/**
 * 大整数保真与空 CSV 输入回归：
 * - json-yaml(json2yaml)：超出 JS 安全范围的整数按原文输出（不带引号），安全范围内仍为数字；
 * - json2java：保留 RawNumber 做类型推断（long / String / double），嵌套对象与数组不被误判；
 * - csv-json：空 / 纯空白输入明确失败，不再返回 ok 的 []；
 * - utils/json.ts 抽取出的 YAML 保真 helper 行为正确。
 */
import { applyYamlRawMap, isSafeJsonNumber, parseJson, toYamlJsonable } from '../app/utils/json.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

async function buildCases() {
  const cases = []

  // ── 任务 1：json-yaml(json2yaml) 大整数保真 ──
  const yamlBig = await runStep(
    createStep('json-yaml', { direction: 'json2yaml' }),
    '{"id":12345678901234567890,"amount":9007199254740993}',
    0
  )
  cases.push(check('json-yaml 大整数状态 ok', () => yamlBig.status === 'ok'))
  cases.push(
    check(
      'json-yaml 大整数按原文输出（不带引号）',
      () =>
        /(^|\n)id: 12345678901234567890(\n|$)/.test(yamlBig.output) &&
        /(^|\n)amount: 9007199254740993(\n|$)/.test(yamlBig.output)
    )
  )
  cases.push(
    check(
      'json-yaml 大整数不被引号包裹',
      () => !/["']12345678901234567890["']/.test(yamlBig.output) && !/["']9007199254740993["']/.test(yamlBig.output)
    )
  )
  cases.push(
    check('json-yaml 大整数给出保真提示', () => yamlBig.note.includes('安全') && yamlBig.note.includes('原文'))
  )

  // 安全范围内数字仍为数字，字符串仍保持字符串
  const yamlSafe = await runStep(createStep('json-yaml', { direction: 'json2yaml' }), '{"count":42,"f":1.5,"s":"42"}', 0)
  cases.push(
    check(
      'json-yaml 安全数字仍为数值',
      () => /(^|\n)count: 42(\n|$)/.test(yamlSafe.output) && /(^|\n)f: 1\.5(\n|$)/.test(yamlSafe.output)
    )
  )
  cases.push(check('json-yaml 字符串仍带引号', () => /s: ["']42["']/.test(yamlSafe.output)))

  // 嵌套对象 / 数组里的大整数同样保真
  const yamlNested = await runStep(
    createStep('json-yaml', { direction: 'json2yaml' }),
    '{"list":[{"big":12345678901234567890}],"small":9007199254740993}',
    0
  )
  cases.push(
    check(
      'json-yaml 嵌套 / 数组内大整数保留原文',
      () =>
        yamlNested.output.includes('12345678901234567890') &&
        yamlNested.output.includes('9007199254740993') &&
        !/["']12345678901234567890["']/.test(yamlNested.output)
    )
  )

  // ── 任务 2：json2java 感知 RawNumber ──
  const javaLong = await runStep(createStep('json2java'), '{"amount":9007199254740993}', 0)
  cases.push(
    check('json2java 2^53+1 推断为 long', () => javaLong.status === 'ok' && javaLong.output.includes('private long amount;'))
  )
  cases.push(check('json2java 2^53+1 不按 String', () => !javaLong.output.includes('private String amount;')))

  const javaBig = await runStep(createStep('json2java'), '{"id":12345678901234567890}', 0)
  cases.push(
    check('json2java 超出 long 推断为 String', () => javaBig.status === 'ok' && javaBig.output.includes('private String id;'))
  )
  cases.push(
    check('json2java 超出 long 的 note 带警告', () => javaBig.note.includes('超出 long') && javaBig.note.includes('String'))
  )

  const javaDec = await runStep(createStep('json2java'), '{"price":128.5}', 0)
  cases.push(check('json2java 小数推断为 double', () => javaDec.output.includes('private double price;')))

  const javaMix = await runStep(
    createStep('json2java'),
    '{"user":{"name":"陈立","age":30},"tags":["a","b"],"scores":[1.5,2.5],"items":[{"sku":987654321012345678,"qty":2}]}',
    0
  )
  cases.push(
    check(
      'json2java 嵌套对象 / 数组混合仍正常',
      () =>
        javaMix.status === 'ok' &&
        javaMix.output.includes('private User user;') &&
        javaMix.output.includes('private List<String> tags;') &&
        javaMix.output.includes('private List<double> scores;') &&
        javaMix.output.includes('private List<Items> items;')
    )
  )
  cases.push(
    check('json2java 嵌套内 long 字段', () => javaMix.output.includes('private long sku;') && javaMix.output.includes('private long qty;'))
  )

  // RawNumber 不能被当成嵌套对象（数组首元素 / 对象字段）
  const javaArrBig = await runStep(createStep('json2java'), '{"ids":[12345678901234567890]}', 0)
  cases.push(
    check(
      'json2java 数组首元素为超长整数时不当作对象',
      () => javaArrBig.status === 'ok' && javaArrBig.output.includes('private List<String> ids;')
    )
  )

  // ── 任务 3：空 / 纯空白 CSV 输入明确失败 ──
  for (const [label, input] of [
    ['空', ''],
    ['纯空白', '   \n\t  \n']
  ]) {
    const r = await runStep(createStep('csv-json'), input, 0)
    cases.push(check(`csv-json ${label}输入明确失败`, () => r.status === 'fail' && r.note.includes('CSV')))
    cases.push(check(`csv-json ${label}输入不再返回空数组`, () => !(r.status === 'ok' && r.output.trim() === '[]')))
  }
  const csvNormal = await runStep(createStep('csv-json', { infer: true }), 'name,age\nAlice,30', 0)
  cases.push(
    check('csv-json 正常输入不受影响', () => csvNormal.status === 'ok' && JSON.parse(csvNormal.output)[0].name === 'Alice')
  )

  // ── 回归：抽取出的 YAML 保真 helper ──
  cases.push(eq('isSafeJsonNumber 2^53 安全', isSafeJsonNumber('9007199254740991'), true))
  cases.push(eq('isSafeJsonNumber 2^53+1 不安全', isSafeJsonNumber('9007199254740993'), false))
  cases.push(eq('isSafeJsonNumber 20 位整数不安全', isSafeJsonNumber('12345678901234567890'), false))
  cases.push(
    check('toYamlJsonable + applyYamlRawMap 回填原文', () => {
      const { value } = parseJson('{"id":12345678901234567890,"n":42}')
      const token = 'dkraw'
      const counter = { n: 0 }
      const rawMap = new Map()
      const unsafe = []
      const jsonable = toYamlJsonable(value, token, counter, rawMap, unsafe, '$')
      const dumped = `id: ${jsonable.id}\nn: ${jsonable.n}`
      const out = applyYamlRawMap(dumped, token, rawMap)
      return (
        out.includes('id: 12345678901234567890') &&
        out.includes('n: 42') &&
        unsafe.length === 1 &&
        unsafe[0] === '$.id'
      )
    })
  )
  cases.push(eq('applyYamlRawMap 空 map 原样返回', applyYamlRawMap('a: 1', 'x', new Map()), 'a: 1'))

  return cases
}

export const cases = await buildCases()
