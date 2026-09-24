/**
 * P1-5 / P3 回归：
 * - regexRiskReason：静态识别嵌套无界量词（灾难性回溯），不误伤常见安全结构；
 * - jsonschema：pattern / patternProperties 的危险正则在编译前就抛中文错误（不冻结）；
 * - jsonpath：`=~` 右值危险正则同样抛中文错误；
 * - 回归：正常 schema 校验、jsonpath 匹配、SM4 去填充失败文案保持中文。
 *
 * 注意：危险样例只用静态判定与「短输入」验证抛出，绝不真正触发灾难性回溯。
 */
import { regexRiskReason } from '../app/utils/regex.ts'
import { validateInstance } from '../app/utils/jsonschema.ts'
import { evalJsonPath } from '../app/utils/jsonpath.ts'
import { bytesToHex } from '../app/utils/bytes.ts'
import { sm4Encrypt } from '../app/utils/crypto/sm4.ts'
import { createStep, makeConsent, runStep } from '../app/utils/workflow.ts'
import { check, eq, throws } from './helpers.mjs'

export const cases = []

/* ─────────────── 1. regexRiskReason 静态判定 ─────────────── */

const dangerous = [
  String.raw`^(a+)+$`,
  String.raw`(a*)*`,
  String.raw`([a-z]+)*`,
  String.raw`(a+){2,}`,
  String.raw`(\d+)+`,
  String.raw`((ab)+)+`,
  String.raw`(a+)*`,
  String.raw`(?:a+)+`
]
for (const p of dangerous) {
  cases.push(check(`危险样例判定为非 null：${p}`, () => regexRiskReason(p) !== null))
}

const safe = [
  String.raw`(?:ab)+`,
  String.raw`\d+`,
  String.raw`(a|b)+`,
  String.raw`[0-9]{2,4}`,
  String.raw`(?<y>\d{4})`,
  String.raw`(\d{4})+`,
  String.raw`(a+)?`,
  String.raw`(?:a+){0,3}`,
  String.raw`\d+(?:\.\d+)?`,
  String.raw`^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$`
]
for (const p of safe) {
  cases.push(eq(`安全样例判定为 null：${p}`, regexRiskReason(p), null))
}

cases.push(eq('空串不判定为危险', regexRiskReason(''), null))
cases.push(eq('非字符串不判定为危险', regexRiskReason(undefined), null))

/* ─────────────── 2. jsonschema pattern 守卫 ─────────────── */

cases.push(
  throws(
    'schema.pattern 嵌套量词抛中文错误（不冻结）',
    () => validateInstance('aaaa', { type: 'string', pattern: '^(a+)+$' }, { strict: true }),
    /灾难性回溯/
  )
)
cases.push(
  throws(
    'patternProperties 危险正则抛中文错误',
    () => validateInstance({ aaaa: 1 }, { type: 'object', patternProperties: { '^(a+)+$': { type: 'number' } } }, { strict: true }),
    /灾难性回溯/
  )
)
cases.push(
  check('合法 pattern 正常校验（回归）', () => {
    const r = validateInstance('abc-123', { type: 'string', pattern: String.raw`^[a-z]+-\d+$` }, { strict: true })
    return r.valid === true && r.errors.length === 0
  })
)
cases.push(
  check('合法 pattern 不匹配时仍报 pattern 错误（回归）', () => {
    const r = validateInstance('ABC', { type: 'string', pattern: '^[a-z]+$' }, { strict: true })
    return r.valid === false && r.errors.some((e) => e.keyword === 'pattern')
  })
)

/* ─────────────── 3. jsonpath `=~` 守卫 ─────────────── */

const jpData = { list: [{ name: 'abc123' }, { name: 'xyz' }, { name: 'a1' }] }

cases.push(
  throws(
    'jsonpath =~ 危险正则抛中文错误',
    () => evalJsonPath(jpData, "$.list[?(@.name =~ '^(a+)+$')]"),
    /灾难性回溯/
  )
)
cases.push(
  eq(
    'jsonpath =~ 合法正则正常匹配（回归）',
    evalJsonPath(jpData, "$.list[?(@.name =~ '^[a-z]+[0-9]+$')].name").matches.map((m) => m.value),
    ['abc123', 'a1']
  )
)
cases.push(
  throws('jsonpath =~ 非法正则仍报原中文错误（回归）', () => evalJsonPath(jpData, "$.list[?(@.name =~ '(')]"), /不是合法正则/)
)

/* ─────────────── 4. SM4 错误文案回归（P3） ─────────────── */

const SM4_KEY = '0123456789abcdeffedcba9876543210'
const CONSENT = makeConsent(Date.now())
const mkStep = (type, config) => ({ ...createStep(type, config), consent: CONSENT })

// 无填充加密一段末字节 0x02、倒数第二字节 0x11 的明文，再用 PKCS#7 解密：
// sm-crypto 校验填充不一致，抛 "padding is invalid"，必须映射成中文。
const badPadPt = new Uint8Array(16).fill(0x11)
badPadPt[15] = 0x02
const badPadCt = bytesToHex(sm4Encrypt(badPadPt, SM4_KEY, { mode: 'ecb', padding: 'none' }))
const sm4Dec = mkStep('sm4', {
  operation: 'decrypt',
  mode: 'ecb',
  padding: 'pkcs#7',
  keyEncoding: 'hex',
  inputEncoding: 'hex',
  outputEncoding: 'hex'
})

const padFail = await runStep(sm4Dec, badPadCt, 0, { secrets: { key: SM4_KEY } })
cases.push(
  check(
    'SM4 去填充失败：中文提示且不含英文 padding is invalid（回归）',
    () => padFail.status === 'fail' && padFail.note.includes('去填充') && !padFail.note.includes('padding is invalid')
  )
)
