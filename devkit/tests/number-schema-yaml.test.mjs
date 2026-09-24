/**
 * 数值安全判定口径统一 / Schema 数值约束 / YAML 非字符串键 / integer 语义 / download 字节数 回归：
 * - F2：isSafeJsonNumber 与 toPlainJson 口径一致，指数大数（1e21 / 1.5e30）与下溢（1e-400）
 *   都判为不安全；jsonpath 给出「安全整数」类告警，且原文保留（1e-400 不会变成 0）。
 * - F3：schema 的 minimum / multipleOf 为大整数或指数大数时不再被 typeof === 'number' 跳过。
 * - F4：YAML 带标签/锚点的非字符串键（!!int 1: / &k 1:）抛中文错误，不产出 "[object Object]"。
 * - F5：RawNumber 的数值为整数（1.0 / 1e2 / 100.0）时按 type:integer 通过。
 * - F7：download 对二进制载荷按真实字节数（bytes.length），而非 Hex 视图长度。
 */
import { isSafeJsonNumber, loadYamlPreservingNumbers, parseJson, toPlainJson } from '../app/utils/json.ts'
import { validateInstance } from '../app/utils/jsonschema.ts'
import { createStep, runStep } from '../app/utils/workflow.ts'
import { check, eq, throws } from './helpers.mjs'

const schemaStep = (schema) => createStep('schema-validate', { schema })
const hasChinese = (s) => /[\u4e00-\u9fa5]/.test(s)

async function buildCases() {
  const cases = []

  /* ── F2：isSafeJsonNumber 与 toPlainJson 口径一致 ── */
  cases.push(eq('isSafeJsonNumber 1e21 不安全', isSafeJsonNumber('1e21'), false))
  cases.push(eq('isSafeJsonNumber 1.5e30 不安全', isSafeJsonNumber('1.5e30'), false))
  cases.push(eq('isSafeJsonNumber 1e-400 不安全（下溢）', isSafeJsonNumber('1e-400'), false))
  cases.push(eq('isSafeJsonNumber 1.5 仍安全', isSafeJsonNumber('1.5'), true))
  cases.push(eq('isSafeJsonNumber 最大安全整数仍安全', isSafeJsonNumber('9007199254740991'), true))
  cases.push(eq('toPlainJson 1e21 保留原文（不丢精度）', toPlainJson(parseJson('{"n":1e21}').value).n, '1e21'))
  cases.push(eq('toPlainJson 1.5e30 保留原文', toPlainJson(parseJson('{"n":1.5e30}').value).n, '1.5e30'))
  cases.push(eq('toPlainJson 1e-400 保留原文（不变成 0）', toPlainJson(parseJson('{"n":1e-400}').value).n, '1e-400'))

  const jpBig = await runStep(createStep('jsonpath', { expr: '$.n' }), '{"n":1e21}', 0)
  cases.push(check('jsonpath 1e21 触发安全整数告警', () => jpBig.status === 'ok' && jpBig.note.includes('安全整数')))
  cases.push(check('jsonpath 1e21 输出保留原文而非 0', () => jpBig.output.includes('1e21') && !/"n"\s*:\s*0/.test(jpBig.output)))

  const jpUnder = await runStep(createStep('jsonpath', { expr: '$.n' }), '{"n":1e-400}', 0)
  cases.push(check('jsonpath 1e-400 触发安全整数告警', () => jpUnder.status === 'ok' && jpUnder.note.includes('安全整数')))
  cases.push(
    check('jsonpath 1e-400 保留原文（不变成 0）', () => jpUnder.output.includes('1e-400') && jpUnder.output.trim() !== '0')
  )

  /* ── F3：Schema 数值约束不再被跳过 ── */
  const minBig = await runStep(schemaStep('{"minimum":9007199254740994}'), '1', 0)
  cases.push(eq('minimum=9007199254740994 对 1 失败', minBig.status, 'fail'))
  cases.push(check('minimum 大整数失败信息含 minimum', () => minBig.note.includes('minimum')))

  const minExp = await runStep(schemaStep('{"minimum":1e21}'), '1', 0)
  cases.push(eq('minimum=1e21 对 1 失败', minExp.status, 'fail'))

  const mulExp = await runStep(schemaStep('{"multipleOf":1e300}'), '1', 0)
  cases.push(eq('multipleOf=1e300 对 1 失败', mulExp.status, 'fail'))

  cases.push(
    check('validateInstance 直接传 RawNumber schema（minimum）生效', () => {
      const inst = parseJson('1').value
      const schema = parseJson('{"minimum":9007199254740994}').value
      return validateInstance(inst, schema, { strict: true }).valid === false
    })
  )
  cases.push(
    check('数字字符串约束也生效（兼容 toPlainJson 后的 schema）', () => {
      return validateInstance(1, { minimum: '9007199254740994' }, { strict: true }).valid === false
    })
  )
  cases.push(
    check('普通 minimum 约束仍正确（10 对 5 失败、对 20 通过）', () => {
      const schema = parseJson('{"minimum":10}').value
      return (
        validateInstance(parseJson('5').value, schema, { strict: true }).valid === false &&
        validateInstance(parseJson('20').value, schema, { strict: true }).valid === true
      )
    })
  )

  /* ── F4：YAML 非字符串键（标签/锚点）兜底 ── */
  cases.push(throws('!!int 键抛中文错误', () => loadYamlPreservingNumbers('!!int 1: a'), /键|非字符串/))
  cases.push(throws('&锚点键抛中文错误', () => loadYamlPreservingNumbers('&k 1: a'), /键|非字符串/))
  for (const [label, doc] of [
    ['!!int 键', '!!int 1: a'],
    ['&锚点键', '&k 1: a']
  ]) {
    cases.push(
      check(`${label} 错误信息为中文且不产出 [object Object]`, () => {
        try {
          const r = loadYamlPreservingNumbers(doc)
          // 不应走到这里：若加载成功也绝不能把键损坏成 "[object Object]"
          return !JSON.stringify(r.value).includes('[object Object]')
        } catch (e) {
          return hasChinese(e.message) && /键/.test(e.message) && !e.message.includes('[object Object]')
        }
      })
    )
  }

  // 普通锚点别名（非键位置）与引号键不受影响
  const aliasOk = loadYamlPreservingNumbers('base: &a\n  x: 1\nref: *a')
  cases.push(check('普通锚点别名仍正常', () => JSON.stringify(toPlainJson(aliasOk.value)).includes('"x":1')))
  const quotedKey = loadYamlPreservingNumbers('"80": http')
  cases.push(check('引号包裹的数字键仍按字符串通过', () => toPlainJson(quotedKey.value)['80'] === 'http'))

  /* ── F5：RawNumber 的 integer 语义 ── */
  for (const raw of ['1.0', '1e2', '100.0']) {
    cases.push(
      check(`RawNumber ${raw} 按 type:integer 通过`, () => {
        const inst = parseJson(`{"n":${raw}}`).value
        return (
          validateInstance(inst, { type: 'object', properties: { n: { type: 'integer' } } }, { strict: true }).valid ===
          true
        )
      })
    )
  }
  for (const raw of ['1.5', '1e-2']) {
    cases.push(
      check(`RawNumber ${raw} 对 type:integer 失败`, () => {
        const inst = parseJson(`{"n":${raw}}`).value
        return (
          validateInstance(inst, { type: 'object', properties: { n: { type: 'integer' } } }, { strict: true }).valid ===
          false
        )
      })
    )
  }
  cases.push(
    check('超范围大整数仍判定为 integer', () => {
      const inst = parseJson('{"n":12345678901234567890}').value
      return validateInstance(inst, { type: 'object', properties: { n: { type: 'integer' } } }, { strict: true }).valid === true
    })
  )

  /* ── F7：download 按真实字节数 ── */
  const fiveBytes = Uint8Array.from([0x00, 0xff, 0x10, 0x80, 0x7f])
  const b64 = Buffer.from(fiveBytes).toString('base64')
  const decoded = await runStep(createStep('base64-decode'), b64, 0)
  cases.push(
    check('base64-decode 得到 5 字节二进制载荷', () => decoded.status === 'ok' && decoded.payload.bytes?.length === 5)
  )
  const dl = await runStep(createStep('download', { filename: 'x.bin' }), decoded.payload, 1)
  cases.push(
    check('download 二进制字节数为真实长度（5 B，不是 Hex 视图的 10）', () => {
      return dl.status === 'ok' && dl.note.includes('5 B') && !dl.note.includes('10 B')
    })
  )

  return cases
}

export const cases = await buildCases()
