/**
 * select 型字段的枚举白名单回归：
 * 这些值可能来自导入流程或被手改的 localStorage，非法值必须抛中文错误，
 * 不能再静默回退（HMAC keyEncoding → utf8；SM4 padding → pkcs#7、keyEncoding → utf8、
 * outputEncoding → hex；SM2 cipherMode → 1、encoding → hex、sigFormat → raw）。
 *
 * 合法 options 以 catalog.ts 各字段的 options 为准：
 * - hmac: algo SHA-256/SHA-512，keyEncoding utf8/hex，inputEncoding auto/utf8/hex/base64，outputEncoding hex/base64
 * - sm4: operation encrypt/decrypt，mode cbc/ecb，padding pkcs#7/none，keyEncoding utf8/hex，
 *        inputEncoding auto/utf8/hex/base64，outputEncoding auto/hex/base64
 * - sm2: operation encrypt/decrypt/sign/verify，cipherMode 1/0，encoding hex/base64，sigFormat raw/der
 *
 * 全部经 runStep 真实执行（敏感步骤带当前版本 consent）；不以自我往返作为唯一证据。
 */
import { check } from './helpers.mjs'
import { createStep, makeConsent, runStep, stepDef } from '../app/utils/workflow.ts'

// 敏感步骤（hmac / sm2 / sm4）需要当前版本的风险确认才能运行
const CONSENT = makeConsent(Date.now())
const mkStep = (type, config = {}) => ({ ...createStep(type, config), consent: CONSENT })

// 判定「中文报错、没有英文内部错误泄漏」：
// 说明文字本身允许出现 SM4/SM2 这类算法名，故只拦截英文错误惯用词与底层库文案。
const EN_LEAK = /error|invalid|fail|failed|failure|cannot|unexpected|undefined|null|not supported/i

const SM4_KEY = '0123456789abcdeffedcba9876543210'
const SM4_IV = '000102030405060708090a0b0c0d0e0f'
const SM2_PUB =
  '0463bb89d7efec4f2590d5486e249082c4c4ba68458ed484db2dbc3c1f6ac11187668e8c6cfed5c75c669433fb037606961bcf99a8c3ce12c6fa9e44a22d64454d'

export const cases = []

/** 断言 runStep 返回 fail，note 命中给定中文片段，且没有英文错误泄漏 */
function assertFail(name, res, fragment) {
  const ok = !!res && res.status === 'fail' && res.note.includes(fragment) && !EN_LEAK.test(res.note)
  cases.push({ name, ok, detail: ok ? '' : `status=${res && res.status} note=${res && res.note}` })
}

/** runStep 不应抛异常：异常说明执行器漏出到运行器之外 */
async function runFail(name, fn, fragment) {
  let res
  try {
    res = await fn()
  } catch (e) {
    cases.push({ name, ok: false, detail: `runStep 不应抛出：${e && e.message ? e.message : String(e)}` })
    return
  }
  assertFail(name, res, fragment)
}

const runOk = async (name, fn) => {
  let res
  try {
    res = await fn()
  } catch (e) {
    cases.push({ name, ok: false, detail: `runStep 不应抛出：${e && e.message ? e.message : String(e)}` })
    return
  }
  cases.push({ name, ok: !!res && res.status === 'ok', detail: res ? `status=${res.status} note=${res.note}` : '无结果' })
}

/* ────────────────────────────────────────────────────────────
 * HMAC：keyEncoding 非法不再静默按 utf8；input/outputEncoding 走共享校验
 * ──────────────────────────────────────────────────────────── */
const HMAC_SECRETS = { key: '0b'.repeat(20) }

await runFail(
  'HMAC algo=MD5 抛中文「不支持的 HMAC 算法」',
  () => runStep(mkStep('hmac', { algo: 'MD5', keyEncoding: 'hex' }), 'Hi There', 0, { secrets: HMAC_SECRETS }),
  '不支持的 HMAC 算法：MD5'
)
await runFail(
  'HMAC keyEncoding=bogus 抛中文「不支持的哈希密钥编码」',
  () => runStep(mkStep('hmac', { algo: 'SHA-256', keyEncoding: 'bogus' }), 'Hi There', 0, { secrets: HMAC_SECRETS }),
  '不支持的哈希密钥编码：bogus'
)
await runFail(
  'HMAC inputEncoding=bogus 抛中文「不支持的输入编码」',
  () =>
    runStep(mkStep('hmac', { algo: 'SHA-256', keyEncoding: 'hex', inputEncoding: 'bogus' }), 'Hi There', 0, {
      secrets: HMAC_SECRETS
    }),
  '不支持的输入编码：bogus'
)
await runFail(
  'HMAC outputEncoding=bogus 抛中文「不支持的输出编码」',
  () =>
    runStep(
      mkStep('hmac', { algo: 'SHA-256', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'bogus' }),
      'Hi There',
      0,
      { secrets: HMAC_SECRETS }
    ),
  '不支持的输出编码：bogus'
)
await runOk('HMAC 合法枚举（SHA-512/hex/utf8/base64）仍正常', () =>
  runStep(
    mkStep('hmac', { algo: 'SHA-512', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'base64' }),
    'Hi There',
    0,
    { secrets: HMAC_SECRETS }
  )
)

/* ────────────────────────────────────────────────────────────
 * SM4：operation / padding / keyEncoding / outputEncoding 非法值不再静默回退
 * ──────────────────────────────────────────────────────────── */
const SM4_SECRETS = { key: SM4_KEY, iv: SM4_IV }

await runFail(
  'SM4 operation=bogus 抛中文「不支持的操作」',
  () => runStep(mkStep('sm4', { operation: 'bogus', mode: 'ecb' }), 'abc', 0, { secrets: SM4_SECRETS }),
  '不支持的操作：bogus'
)
await runFail(
  'SM4 mode=bogus 抛中文「不支持的 SM4 模式」',
  () => runStep(mkStep('sm4', { operation: 'encrypt', mode: 'bogus' }), 'abc', 0, { secrets: SM4_SECRETS }),
  '不支持的 SM4 模式：bogus'
)
await runFail(
  'SM4 padding=bogus 抛中文「不支持的 SM4 填充方式」',
  () =>
    runStep(mkStep('sm4', { operation: 'encrypt', mode: 'ecb', padding: 'bogus' }), 'abc', 0, { secrets: SM4_SECRETS }),
  '不支持的 SM4 填充方式：bogus'
)
await runFail(
  'SM4 keyEncoding=bogus 抛中文「不支持的 SM4 密钥编码」',
  () =>
    runStep(mkStep('sm4', { operation: 'encrypt', mode: 'ecb', keyEncoding: 'bogus' }), 'abc', 0, {
      secrets: SM4_SECRETS
    }),
  '不支持的 SM4 密钥编码：bogus'
)
await runFail(
  'SM4 inputEncoding=bogus 抛中文「不支持的输入编码」',
  () =>
    runStep(
      mkStep('sm4', { operation: 'encrypt', mode: 'ecb', keyEncoding: 'hex', inputEncoding: 'bogus' }),
      'abc',
      0,
      { secrets: SM4_SECRETS }
    ),
  '不支持的输入编码：bogus'
)
await runFail(
  'SM4 outputEncoding=bogus 抛中文「不支持的输出编码」',
  () =>
    runStep(
      mkStep('sm4', {
        operation: 'encrypt',
        mode: 'ecb',
        keyEncoding: 'hex',
        inputEncoding: 'utf8',
        outputEncoding: 'bogus'
      }),
      'abc',
      0,
      { secrets: SM4_SECRETS }
    ),
  '不支持的输出编码：bogus'
)
// 合法回归：GB/T 32907 标准向量（ECB 无填充）
const sm4Ok = await runStep(
  mkStep('sm4', {
    operation: 'encrypt',
    mode: 'ecb',
    padding: 'none',
    keyEncoding: 'hex',
    inputEncoding: 'hex',
    outputEncoding: 'hex'
  }),
  SM4_KEY,
  0,
  { secrets: { key: SM4_KEY } }
)
cases.push(
  check(
    'SM4 合法枚举（ecb/none/hex/hex/hex）仍命中标准向量',
    () => sm4Ok.status === 'ok' && sm4Ok.output === '681edf34d206965e86b3e94f536e4246'
  )
)
// 合法回归：outputEncoding=auto 仍是合法值
await runOk('SM4 outputEncoding=auto 合法值仍正常', () =>
  runStep(
    mkStep('sm4', {
      operation: 'encrypt',
      mode: 'ecb',
      padding: 'pkcs#7',
      keyEncoding: 'hex',
      inputEncoding: 'utf8',
      outputEncoding: 'auto'
    }),
    'abc',
    0,
    { secrets: { key: SM4_KEY } }
  )
)

/* ────────────────────────────────────────────────────────────
 * SM2：cipherMode / encoding / sigFormat 非法值不再静默回退
 * ──────────────────────────────────────────────────────────── */
await runFail(
  'SM2 operation=bogus 抛中文「不支持的 SM2 操作」',
  () => runStep(mkStep('sm2', { operation: 'bogus' }), 'abc', 0, {}),
  '不支持的 SM2 操作：bogus'
)
await runFail(
  'SM2 cipherMode=9 抛中文「不支持的 SM2 密文模式」',
  () => runStep(mkStep('sm2', { operation: 'encrypt', cipherMode: '9', publicKey: SM2_PUB }), 'abc', 0, {}),
  '不支持的 SM2 密文模式：9'
)
await runFail(
  'SM2 encoding=bogus 抛中文「不支持的 SM2 密文编码」',
  () =>
    runStep(mkStep('sm2', { operation: 'encrypt', cipherMode: '1', encoding: 'bogus', publicKey: SM2_PUB }), 'abc', 0, {}),
  '不支持的 SM2 密文编码：bogus'
)
await runFail(
  'SM2 sigFormat=bogus 抛中文「不支持的 SM2 签名格式」',
  () =>
    runStep(
      mkStep('sm2', { operation: 'encrypt', cipherMode: '1', encoding: 'hex', sigFormat: 'bogus', publicKey: SM2_PUB }),
      'abc',
      0,
      {}
    ),
  '不支持的 SM2 签名格式：bogus'
)
// 合法回归：cipherMode=0 / sigFormat=der 仍是合法值（加密正常产出密文）
await runOk('SM2 合法枚举（cipherMode=0 / encoding=base64）仍正常', () =>
  runStep(
    mkStep('sm2', { operation: 'encrypt', cipherMode: '0', encoding: 'base64', sigFormat: 'der', publicKey: SM2_PUB }),
    'abc',
    0,
    {}
  )
)

/* ────────────────────────────────────────────────────────────
 * digest / sm3：inputEncoding / outputEncoding 走共享校验（非敏感，无需 consent）
 * ──────────────────────────────────────────────────────────── */
await runFail(
  'digest algo=SHA-1 抛中文「不支持的摘要算法」',
  () => runStep(createStep('digest', { algo: 'SHA-1' }), 'abc', 0),
  '不支持的摘要算法：SHA-1'
)
await runFail(
  'digest inputEncoding=bogus 抛中文「不支持的输入编码」',
  () => runStep(createStep('digest', { algo: 'SHA-256', inputEncoding: 'bogus' }), 'abc', 0),
  '不支持的输入编码：bogus'
)
await runFail(
  'digest outputEncoding=bogus 抛中文「不支持的输出编码」',
  () => runStep(createStep('digest', { algo: 'SHA-256', inputEncoding: 'utf8', outputEncoding: 'bogus' }), 'abc', 0),
  '不支持的输出编码：bogus'
)
await runFail(
  'sm3 inputEncoding=bogus 抛中文「不支持的输入编码」',
  () => runStep(createStep('sm3', { inputEncoding: 'bogus' }), 'abc', 0),
  '不支持的输入编码：bogus'
)
await runFail(
  'sm3 outputEncoding=bogus 抛中文「不支持的输出编码」',
  () => runStep(createStep('sm3', { inputEncoding: 'utf8', outputEncoding: 'bogus' }), 'abc', 0),
  '不支持的输出编码：bogus'
)
const digestOk = await runStep(createStep('digest', { algo: 'SHA-256', inputEncoding: 'utf8', outputEncoding: 'hex' }), 'abc', 0)
cases.push(
  check(
    'digest 合法枚举仍命中 SHA-256("abc") 向量',
    () => digestOk.status === 'ok' && digestOk.output === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
)
const sm3Ok = await runStep(createStep('sm3', { inputEncoding: 'utf8', outputEncoding: 'hex' }), 'abc', 0)
cases.push(
  check(
    'sm3 合法枚举仍命中 GB/T 32905 向量',
    () => sm3Ok.status === 'ok' && sm3Ok.output === '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0'
  )
)

/* ────────────────────────────────────────────────────────────
 * 合法性来源自检：白名单必须与 catalog.ts 各字段的 options 一致，
 * 防止执行器校验的集合与界面可选值发生漂移。
 * ──────────────────────────────────────────────────────────── */
const optionValues = (type, key) =>
  (stepDef(type).fields.find((f) => f.key === key)?.options ?? []).map((o) => o.value)

const EXPECTED_OPTIONS = [
  ['hmac', 'keyEncoding', ['utf8', 'hex']],
  ['hmac', 'inputEncoding', ['auto', 'utf8', 'hex', 'base64']],
  ['hmac', 'outputEncoding', ['hex', 'base64']],
  ['sm4', 'operation', ['encrypt', 'decrypt']],
  ['sm4', 'mode', ['cbc', 'ecb']],
  ['sm4', 'padding', ['pkcs#7', 'none']],
  ['sm4', 'keyEncoding', ['utf8', 'hex']],
  ['sm4', 'outputEncoding', ['auto', 'hex', 'base64']],
  ['sm2', 'cipherMode', ['1', '0']],
  ['sm2', 'encoding', ['hex', 'base64']],
  ['sm2', 'sigFormat', ['raw', 'der']]
]

for (const [type, key, expected] of EXPECTED_OPTIONS) {
  cases.push(
    check(`catalog：${type}.${key} 的 options 与校验白名单一致`, () => {
      const actual = optionValues(type, key)
      return actual.length === expected.length && expected.every((v) => actual.includes(v))
    })
  )
}
