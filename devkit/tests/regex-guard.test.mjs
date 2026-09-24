/**
 * 正则守卫与二进制载荷回归测试：
 * - 修复 1：regex-replace 改走「Worker + 超时」守卫，不再在主线程同步执行；
 *   这里验证替换 / 提取语义不变（Node 无 Worker，会自动回退同步实现）。
 * - 修复 2：base64-decode / url-decode / url-encode 遇到二进制载荷必须明确失败，
 *   不能把 Hex 视图当文本「成功」算成垃圾。
 * - 修复 3：json-format 的缩进 0 输出真正单行。
 * 注意：不构造会真正触发灾难性回溯的用例（Node 无 Worker，同步执行会卡死）。
 */
import { bytesToBase64, textToBytes } from '../app/utils/bytes.ts'
import { execRegex, execRegexWithTimeout } from '../app/utils/regex.ts'
import { bytesPayload, createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq } from './helpers.mjs'

async function buildCases() {
  const cases = []

  // ── 修复 1：正常替换与提取（回归）──
  const rx1 = await runStep(createStep('regex-replace', { pattern: '(\\d+)', flags: 'g', replacement: '#$1' }), 'a1b22', 0)
  cases.push(eq('正则替换状态 ok', rx1.status, 'ok'))
  cases.push(eq('正则替换结果与 String.replace 一致', rx1.output, 'a#1b#22'))
  const rx2 = await runStep(
    createStep('regex-replace', { mode: 'match', pattern: '(?<y>\\d{4})-(?<m>\\d{2})', flags: 'g' }),
    '2024-03 与 2025-11',
    0
  )
  cases.push(
    check('正则提取命名组', () => {
      const arr = JSON.parse(rx2.output)
      return Array.isArray(arr) && arr.length === 2 && arr[0].y === '2024' && arr[0].m === '03' && arr[1].y === '2025'
    })
  )
  // 空替换 = 删除匹配，语义必须保留（替换结果由同一次执行返回 replaced）
  const rx3 = await runStep(createStep('regex-replace', { pattern: '\\d', flags: 'g', replacement: '' }), 'a1b2c3', 0)
  cases.push(eq('空替换模板等价于删除匹配', rx3.output, 'abc'))
  cases.push(check('空替换仍带删除语义提示', () => rx3.note.includes('删除匹配')))

  // match 模式的 0 匹配与非法表达式文案保持不变
  const rx0 = await runStep(createStep('regex-replace', { mode: 'match', pattern: 'zzz', flags: 'g' }), 'abc', 0)
  cases.push(check('match 模式 0 匹配明确失败', () => rx0.status === 'fail' && rx0.note.includes('没有匹配到任何内容')))
  const rxBad = await runStep(createStep('regex-replace', { pattern: '(', flags: 'g' }), 'x', 0)
  cases.push(check('非法正则给出语法错误文案', () => rxBad.status === 'fail' && rxBad.note.includes('表达式语法错误')))

  // ── 修复 2：二进制载荷喂编码步骤必须明确失败 ──
  const bin = bytesPayload(new Uint8Array([0xff, 0x00, 0x10, 0xfe]))
  cases.push(eq('构造出的二进制载荷 kind', bin.kind, 'bytes'))
  for (const type of ['base64-decode', 'url-decode', 'url-encode']) {
    const r = await runStep(createStep(type), bin, 0)
    cases.push(eq(`${type} 对二进制载荷明确失败`, [r.status, r.note.includes('二进制')], ['fail', true]))
  }
  // 文本载荷路径不受影响
  const okDecode = await runStep(createStep('base64-decode'), bytesToBase64(textToBytes('hello')), 0)
  cases.push(check('base64-decode 文本载荷仍正常', () => okDecode.status === 'ok' && okDecode.output === 'hello'))

  // ── 修复 3：json-format 缩进 0 真正单行 ──
  const j0 = await runStep(createStep('json-format', { indent: '0' }), '{"a":1,"b":[1,2]}', 0)
  cases.push(check('json-format 缩进 0 输出不含换行', () => j0.status === 'ok' && !j0.output.includes('\n')))
  cases.push(eq('json-format 缩进 0 内容正确', j0.output, '{"a":1,"b":[1,2]}'))
  cases.push(eq('json-format 缩进 0 保持 json 载荷', j0.outputKind, 'json'))
  const j2 = await runStep(createStep('json-format', { indent: '2' }), '{"a":1,"b":[1,2]}', 0)
  cases.push(check('json-format 缩进 2 仍多行', () => j2.status === 'ok' && j2.output.includes('\n')))

  // ── 修复 4：JSON/YAML 解析失败给中文定位，不再把英文原文抛给用户 ──
  const badJson = await runStep(createStep('json-format'), '{oops', 0)
  cases.push(
    check(
      'JSON 解析失败：中文前缀 + 行列定位，不含英文 at position',
      () => badJson.status === 'fail' && badJson.note.includes('JSON 解析失败') && badJson.note.includes('行') && !badJson.note.includes('at position')
    )
  )
  const badYaml = await runStep(createStep('json-yaml', { direction: 'yaml2json' }), 'a: [1, 2', 0)
  cases.push(check('YAML 解析失败：中文前缀', () => badYaml.status === 'fail' && badYaml.note.includes('YAML 解析失败')))
  const badSchema = await runStep(createStep('schema-validate', { schema: '42' }), '{"a":1}', 0)
  cases.push(check('Schema 非对象/布尔时明确失败', () => badSchema.status === 'fail' && badSchema.note.includes('Schema')))
  const arrSchema = await runStep(createStep('schema-validate', { schema: '[1,2]' }), '{"a":1}', 0)
  cases.push(check('Schema 为数组时明确失败', () => arrSchema.status === 'fail' && arrSchema.note.includes('Schema')))
  // 常见非法 JSON 一律不得泄漏 V8 英文（at position / Unexpected / Expected / SyntaxError）
  const badJsons = ['{"a":1,}', '[1,2', '{"a" 1}', '{"a": 01}', '{oops', '"unterminated']
  for (const badInput of badJsons) {
    const r = await runStep(createStep('json-format'), badInput, 0)
    cases.push(
      check(`JSON 非法输入不泄漏英文（${badInput}）`, () => r.status === 'fail' && !/at position|Unexpected|Expected|SyntaxError/.test(r.note))
    )
  }
  const bigYaml = await runStep(createStep('json-yaml', { direction: 'json2yaml' }), '{"id":12345678901234567890}', 0)
  cases.push(check('大整数转 YAML 时给出警告（不再静默改成字符串）', () => bigYaml.status === 'ok' && bigYaml.note.includes('安全整数')))

  // ── base64 的 urlSafe 与 lineBreak 可叠加 ──
  const b64 = await runStep(createStep('base64-encode', { urlSafe: true, lineBreak: true }), 'x'.repeat(100), 0)
  cases.push(check('base64-encode：urlSafe 与 lineBreak 同时勾选都生效', () => b64.status === 'ok' && b64.output.includes('\n')))

  // ── 修复 1 守卫：无 Worker 环境回退同步实现，结果与 execRegex 一致 ──
  const g1 = await execRegexWithTimeout('(\\d+)', 'g', 'a1b22', '#$1')
  cases.push(check('execRegexWithTimeout 回退：替换正确', () => g1.ok && g1.replaced === 'a#1b#22' && g1.matches.length === 2))
  const g2 = await execRegexWithTimeout('(\\d+)', 'g', 'a1b22')
  cases.push(check('execRegexWithTimeout 回退：只提取不替换', () => g2.ok && g2.replaced === null && g2.matches.length === 2))
  const g3 = await execRegexWithTimeout('(', 'g', 'x')
  cases.push(check('execRegexWithTimeout 回退：语法错误如实返回', () => !g3.ok && typeof g3.error === 'string'))
  const direct = execRegex('(\\d+)', 'g', 'a1b22', '#$1')
  cases.push(check('execRegex 本体与守卫结果一致', () => direct.ok && direct.replaced === g1.replaced))

  return cases
}

export const cases = await buildCases()
