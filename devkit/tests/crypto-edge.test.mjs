/**
 * 加解密边界回归：AES-GCM 空明文（结果只有认证标签）往返、真正过短的密文、
 * SM2 二进制载荷按原始字节处理、SM4 错误信息中文化。
 * 全部经流程执行器（runStep + createStep）真实计算，不使用自我往返之外的伪造值。
 *
 * 说明：SM2 解密走 `output:'array'` 直接拿原始字节，因此非 UTF-8 明文也能完整往返；
 * 加密/签名/验签与 AES/SM4 一致，通过 `payloadBytes(..., 'auto')` 取原始字节。
 */
import { check, eq, throws } from './helpers.mjs'
import { bytesToHex, textToBytes } from '../app/utils/bytes.ts'
import { sm2Decrypt, sm2PrivateKeyError } from '../app/utils/crypto/sm2.ts'
import { sm4Encrypt } from '../app/utils/crypto/sm4.ts'
import { createStep, makeConsent, runStep } from '../app/utils/workflow.ts'

const h = (bytes) => bytesToHex(bytes)

// 敏感步骤（aes-gcm / sm2 / sm4）需要有效的风险确认记录才能运行
const CONSENT = makeConsent(Date.now())
const mkStep = (type, config) => ({ ...createStep(type, config), consent: CONSENT })

const AES_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const AES_IV = '101112131415161718191a1b'
const AES_SECRETS = { key: AES_KEY, iv: AES_IV, aad: '' }

// 与 crypto.test.mjs 相同的固定密钥对（复制常量，不改动该文件）
const SM2_PUB =
  '0463bb89d7efec4f2590d5486e249082c4c4ba68458ed484db2dbc3c1f6ac11187668e8c6cfed5c75c669433fb037606961bcf99a8c3ce12c6fa9e44a22d64454d'
const SM2_PRIV = '62f1724b3e02e23b38a8594f0cd01b963b1607e43631e20d75d35060464fa774'

const SM4_KEY = '0123456789abcdeffedcba9876543210'

export const cases = []

// ── AES-GCM：空明文加密结果 = 仅认证标签（128 位时 16 字节），必须能自解 ──
const aesEnc = mkStep('aes-gcm', { operation: 'encrypt', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'hex', tagLength: '128' })
const aesDec = mkStep('aes-gcm', { operation: 'decrypt', keyEncoding: 'hex', inputEncoding: 'hex', outputEncoding: 'hex', tagLength: '128' })

const encEmpty = await runStep(aesEnc, '', 0, { secrets: AES_SECRETS })
cases.push(
  check(
    'AES-GCM 空明文加密成功且结果恰为 16 字节认证标签',
    () => encEmpty.status === 'ok' && encEmpty.output.length === 32
  )
)
cases.push(eq('AES-GCM 空明文密文长度（字节）= 认证标签长度 16', encEmpty.output.length / 2, 16))
const decEmpty = await runStep(aesDec, encEmpty.output, 0, { secrets: AES_SECRETS })
cases.push(
  check(
    'AES-GCM 空明文加密→解密往返成功（16 字节密文含标签可解开）',
    () => decEmpty.status === 'ok' && decEmpty.output === '' && !!decEmpty.payload.bytes && decEmpty.payload.bytes.length === 0
  )
)

// ── AES-GCM：真正不足标签长度的密文仍明确失败 ──
const shortCt = await runStep(aesDec, '00'.repeat(8), 0, { secrets: AES_SECRETS })
cases.push(
  check(
    'AES-GCM 密文 8 字节（<16）明确失败并提示「不足认证标签长度」',
    () => shortCt.status === 'fail' && shortCt.note.includes('不足认证标签长度')
  )
)
const shortCt15 = await runStep(aesDec, '00'.repeat(15), 0, { secrets: AES_SECRETS })
cases.push(
  check(
    'AES-GCM 密文 15 字节（仍 <16）明确失败',
    () => shortCt15.status === 'fail' && shortCt15.note.includes('不足认证标签长度')
  )
)

// ── SM2：二进制载荷（kind==='bytes'）按原始字节处理，而不是 Hex 视图文本 ──
const rawText = 'SM2 二进制载荷'
const rawBytes = textToBytes(rawText) // 合法 UTF-8，但作为 kind==='bytes' 的载荷传入
const rawHex = h(rawBytes)
const bytesInput = { kind: 'bytes', text: rawHex, bytes: rawBytes }
const hexTextViewBytes = h(textToBytes(rawHex)) // 旧行为会把这段 Hex 文本当作消息

const sm2Enc = mkStep('sm2', { operation: 'encrypt', cipherMode: '1', encoding: 'hex', publicKey: SM2_PUB })
const sm2Dec = mkStep('sm2', { operation: 'decrypt', cipherMode: '1', encoding: 'hex' })

const encBytes = await runStep(sm2Enc, bytesInput, 0)
cases.push(
  check(
    'SM2 二进制载荷加密成功（密文长度 = 明文 + 96 字节开销）',
    () => encBytes.status === 'ok' && encBytes.output.length === (rawBytes.length + 96) * 2
  )
)
cases.push(
  check(
    `SM2 二进制载荷加密说明按真实消息字节数（${rawBytes.length} 字节，而非 Hex 文本的 ${rawHex.length} 字节）`,
    () => encBytes.note.includes(`明文 ${rawBytes.length} 字节`)
  )
)
const decBytes = await runStep(sm2Dec, encBytes.output, 0, { secrets: { privateKey: SM2_PRIV } })
cases.push(
  check(
    'SM2 二进制载荷加密→解密还原原始字节（hex 相同）',
    () => decBytes.status === 'ok' && h(textToBytes(decBytes.output)) === rawHex
  )
)
cases.push(
  check(
    'SM2 解密结果是原文而不是 Hex 视图文本',
    () => decBytes.status === 'ok' && decBytes.output === rawText && h(textToBytes(decBytes.output)) !== hexTextViewBytes
  )
)

// 非 UTF-8 的任意字节：用签名/验签证明加密类操作同样走原始字节分支
const binBytes = new Uint8Array([0xff, 0x00, 0x10, 0xfe, 0x7a, 0x01])
const binHex = h(binBytes)
const binInput = { kind: 'bytes', text: binHex, bytes: binBytes }

const sm2SignStep = mkStep('sm2', { operation: 'sign', userId: '1234567812345678', sigFormat: 'raw' })
const sigBytes = await runStep(sm2SignStep, binInput, 0, { secrets: { privateKey: SM2_PRIV } })
cases.push(
  check('SM2 非 UTF-8 字节载荷签名成功（raw 128 位 Hex）', () => sigBytes.status === 'ok' && /^[0-9a-f]{128}$/.test(sigBytes.output))
)
const sm2VerifyStep = mkStep('sm2', {
  operation: 'verify',
  publicKey: SM2_PUB,
  userId: '1234567812345678',
  sigFormat: 'raw',
  signature: sigBytes.output
})
const verPass = await runStep(sm2VerifyStep, binInput, 0)
cases.push(
  check('SM2 非 UTF-8 字节载荷验签通过', () => verPass.status === 'ok' && verPass.note.includes('验签通过'))
)
const verFail = await runStep(sm2VerifyStep, binHex, 0)
cases.push(
  check('SM2 用 Hex 文本（而非原始字节）验签不通过', () => verFail.status === 'fail' && verFail.note.includes('验签不通过'))
)

// 非 UTF-8 字节的完整往返（解密走 output:'array'，不再卡在 UTF-8 解码）
const encBin = await runStep(sm2Enc, binInput, 0)
const decBin = await runStep(sm2Dec, encBin.output, 0, { secrets: { privateKey: SM2_PRIV } })
cases.push(
  check(
    'SM2 非 UTF-8 字节载荷加密→解密还原原始字节（payload.bytes 相同）',
    () => decBin.status === 'ok' && !!decBin.payload.bytes && h(decBin.payload.bytes) === binHex
  )
)
cases.push(
  check(
    'SM2 非 UTF-8 解密结果是二进制载荷（kind=bytes，界面按 Hex 展示）',
    () => decBin.payload.kind === 'bytes' && decBin.output === binHex
  )
)

const encText = await runStep(sm2Enc, 'DevKit SM2 文本', 0)
const decText = await runStep(sm2Dec, encText.output, 0, { secrets: { privateKey: SM2_PRIV } })
cases.push(
  check('SM2 文本载荷仍按文本处理（回归）', () => decText.status === 'ok' && decText.output === 'DevKit SM2 文本')
)

// ── SM4：已知英文错误映射成中文，未知用 errMessage 兜底 ──
// 无填充加密一段末字节 0x02、倒数第二字节 0x11 的明文，再用 PKCS#7 解密：
// sm-crypto 校验到第 2 个填充字节不一致，抛 "padding is invalid"。
const badPadPt = new Uint8Array(16).fill(0x11)
badPadPt[15] = 0x02
const badPadCt = h(sm4Encrypt(badPadPt, SM4_KEY, { mode: 'ecb', padding: 'none' }))
const sm4Dec = mkStep('sm4', { operation: 'decrypt', mode: 'ecb', padding: 'pkcs#7', keyEncoding: 'hex', inputEncoding: 'hex', outputEncoding: 'hex' })

const padFail = await runStep(sm4Dec, badPadCt, 0, { secrets: { key: SM4_KEY } })
cases.push(
  check(
    'SM4 PKCS#7 去填充失败：中文提示且不含英文 padding is invalid',
    () => padFail.status === 'fail' && padFail.note.includes('去填充') && !padFail.note.includes('padding is invalid')
  )
)

// 错误密钥：找一个会让合法密文解密失败的错误密钥（sm-crypto 是确定性实现，结果稳定）
const validCt = h(sm4Encrypt(textToBytes('{"code":1}'), SM4_KEY, { mode: 'ecb', padding: 'pkcs#7' }))
let wrongKeyRes = null
for (let i = 1; i <= 256 && !wrongKeyRes; i++) {
  const k = i.toString(16).padStart(2, '0').repeat(16)
  if (k === SM4_KEY) continue
  const r = await runStep(sm4Dec, validCt, 0, { secrets: { key: k } })
  if (r.status === 'fail') wrongKeyRes = r
}
cases.push(
  check(
    'SM4 错误密钥：中文提示且不含英文 padding is invalid',
    () => !!wrongKeyRes && wrongKeyRes.note.includes('去填充') && !wrongKeyRes.note.includes('padding is invalid')
  )
)

// 错误 IV：CBC 下 IV 长度非法（8 字节）时明确失败，且信息为中文
const sm4CbcDec = mkStep('sm4', { operation: 'decrypt', mode: 'cbc', padding: 'pkcs#7', keyEncoding: 'hex', inputEncoding: 'hex' })
const ivFail = await runStep(sm4CbcDec, badPadCt, 0, { secrets: { key: SM4_KEY, iv: '0011223344556677' } })
cases.push(
  check(
    'SM4 非法 IV 长度（8 字节）：中文提示且不含英文 iv is invalid',
    () => ivFail.status === 'fail' && ivFail.note.includes('IV') && !ivFail.note.includes('iv is invalid')
  )
)

cases.push(
  throws('SM4 无填充且长度非 16 整数倍时同步抛中文错误', () => sm4Encrypt(new Uint8Array(15), SM4_KEY, { mode: 'ecb', padding: 'none' }), /16 字节整数倍/)
)

// ── SM4：非 Hex 的 IV 必须明确失败（否则底层静默按全 0 IV 计算并报成功）──
const sm4CbcEnc = mkStep('sm4', { operation: 'encrypt', mode: 'cbc', padding: 'pkcs#7', keyEncoding: 'hex', inputEncoding: 'utf8', outputEncoding: 'hex' })
const nonHexIv = await runStep(sm4CbcEnc, 'abc', 0, { secrets: { key: SM4_KEY, iv: 'zz'.repeat(16) } })
cases.push(
  check(
    'SM4 非 Hex IV（32 字符）明确失败并提示「IV Hex 非法」，不再静默按 0 IV 计算',
    () => nonHexIv.status === 'fail' && nonHexIv.note.includes('IV Hex 非法')
  )
)

// ── SM2：私钥范围校验（d=0 / d≥n 必须被拒，且不抛英文内部错误）──
cases.push(check('SM2 私钥为 0 被拒（中文提示）', () => sm2PrivateKeyError('0'.repeat(64)).includes('私钥不能为 0')))
cases.push(check('SM2 私钥 ≥ 曲线阶 n 被拒（中文提示）', () => sm2PrivateKeyError('f'.repeat(64)).includes('范围')))
const d0Decrypt = await runStep(sm2Dec, encBytes.output, 0, { secrets: { privateKey: '0'.repeat(64) } })
cases.push(
  check(
    'SM2 d=0 解密明确失败且不含英文内部错误（Cannot read … toBigInteger）',
    () => d0Decrypt.status === 'fail' && !d0Decrypt.note.includes('Cannot read')
  )
)
cases.push(
  throws('SM2 底层 sm2Decrypt 对 d=0 也抛中文错误（不抛英文）', () => sm2Decrypt(encBytes.output, '0'.repeat(64), 1, { output: 'array' }), /私钥不能为 0/)
)
