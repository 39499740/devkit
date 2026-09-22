/** 摘要与加解密步骤的执行器：全部调用 utils/crypto 里的共享实现，不在这里另写一份算法 */
import { bytesToHex, hexToBytes, textToBytes } from '../../utils/bytes'
import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  assertAesKey,
  isAesGcmAuthFailure,
  splitCombined,
  type AesKeyBits,
  type AesTagBits
} from '../../utils/crypto/aesgcm'
import { computeDigest, type DigestAlgo } from '../../utils/crypto/digest'
import { encodeOutput, decodeInput, hexEquals, type InputEncoding, type OutputEncoding } from '../../utils/crypto/encoding'
import { computeHmac, type HmacAlgo } from '../../utils/crypto/hmac'
import {
  cleanHex,
  sm2Decrypt,
  sm2Encrypt,
  sm2PrivateKeyError,
  sm2PublicKeyError,
  sm2Sign,
  sm2Verify,
  SM2_DEFAULT_USER_ID,
  SM2_MIN_CIPHER_BYTES,
  type Sm2CipherMode
} from '../../utils/crypto/sm2'
import { computeSm3 } from '../../utils/crypto/sm3'
import { sm4Decrypt, sm4Encrypt, type Sm4Mode, type Sm4Padding } from '../../utils/crypto/sm4'
import { configText } from '../catalog'
import { bytesPayload, payloadBytes, textPayload } from '../types'
import type { StepConfig, StepExecutor } from '../types'

const INPUT_ENCODINGS: (InputEncoding | 'auto')[] = ['auto', 'utf8', 'hex', 'base64']

function inputEncoding(config: StepConfig): InputEncoding | 'auto' {
  const v = configText(config, 'inputEncoding', 'auto')
  if (!(INPUT_ENCODINGS as string[]).includes(v)) throw new Error(`不支持的输入编码：${v}`)
  return v as InputEncoding | 'auto'
}

function outputEncoding(config: StepConfig): OutputEncoding {
  const v = configText(config, 'outputEncoding', 'hex')
  if (v !== 'hex' && v !== 'base64') throw new Error(`不支持的输出编码：${v}`)
  return v
}

function labelOf(enc: OutputEncoding): string {
  return enc === 'hex' ? 'Hex' : 'Base64'
}

function expectedNote(actualHex: string, expected: string): string {
  if (!expected.trim()) return ''
  return hexEquals(actualHex, expected)
    ? '；期望值对照：一致'
    : '；期望值对照：不一致（可在步骤参数里核对期望摘要）'
}

const digest: StepExecutor = async (input, config) => {
  const algo = configText(config, 'algo', 'SHA-256') as DigestAlgo
  if (!['MD5', 'SHA-256', 'SHA-512'].includes(algo)) throw new Error(`不支持的摘要算法：${algo}`)
  const bytes = payloadBytes(input, inputEncoding(config))
  const out = await computeDigest(algo, bytes)
  const enc = outputEncoding(config)
  return {
    payload: textPayload(encodeOutput(out, enc)),
    note: `${algo} 摘要完成（输入 ${bytes.length} 字节，输出 ${labelOf(enc)}）${expectedNote(bytesToHex(out), configText(config, 'expected'))}`
  }
}

const hmac: StepExecutor = async (input, config, secrets) => {
  const algo = configText(config, 'algo', 'SHA-256') as HmacAlgo
  if (algo !== 'SHA-256' && algo !== 'SHA-512') throw new Error(`不支持的 HMAC 算法：${algo}`)
  const keyEnc = configText(config, 'keyEncoding', 'utf8') === 'hex' ? 'hex' : 'utf8'
  const keyBytes = decodeInput(secrets.key ?? '', keyEnc, '密钥')
  if (!keyBytes.length) throw new Error('密钥为空：请填写密钥（HMAC 密钥至少需要 1 字节）')
  const bytes = payloadBytes(input, inputEncoding(config))
  const mac = await computeHmac(algo, keyBytes, bytes)
  const enc = outputEncoding(config)
  return {
    payload: textPayload(encodeOutput(mac, enc)),
    note: `HMAC-${algo} 计算完成（密钥 ${keyBytes.length} 字节，输入 ${bytes.length} 字节，输出 ${labelOf(enc)}）${expectedNote(bytesToHex(mac), configText(config, 'expected'))}`
  }
}

const aesGcm: StepExecutor = async (input, config, secrets) => {
  const operation = configText(config, 'operation', 'encrypt')
  const bits = Number(configText(config, 'keyBits', '256')) as AesKeyBits
  if (![128, 192, 256].includes(bits)) throw new Error(`不支持的密钥长度：${bits}`)
  const tagLength = Number(configText(config, 'tagLength', '128')) as AesTagBits
  if (![96, 112, 128].includes(tagLength)) throw new Error(`不支持的认证标签长度：${tagLength}`)
  const keyEnc = configText(config, 'keyEncoding', 'hex') as InputEncoding
  const key = decodeInput(secrets.key ?? '', keyEnc, '密钥')
  assertAesKey(key, bits)
  const iv = decodeInput(secrets.iv ?? '', 'hex', 'IV')
  if (!iv.length) throw new Error('IV（nonce）为空：请填写 Hex IV，推荐 12 字节；同一密钥下不要重用')
  const aad = textToBytes(secrets.aad ?? '')
  const opts = { key, iv, aad, tagLength }
  const enc = outputEncoding(config)

  if (operation === 'encrypt') {
    const out = await aesGcmEncrypt(payloadBytes(input, inputEncoding(config)), opts)
    const { ciphertext, tag } = splitCombined(out, tagLength)
    return {
      payload: textPayload(encodeOutput(out, enc)),
      note: `AES-${bits}-GCM 加密成功（认证标签 ${tagLength} 位，AAD ${aad.length} 字节，密文 ${ciphertext.length} 字节 + 标签 ${tag.length} 字节，输出 ${labelOf(enc)}）；结果 = 密文||认证标签`
    }
  }

  const combined = payloadBytes(input, inputEncoding(config))
  const tagBytes = tagLength / 8
  if (combined.length <= tagBytes) {
    throw new Error(
      `密文（含认证标签）共 ${combined.length} 字节，短于认证标签长度（${tagBytes} 字节）：请确认输入是「密文||认证标签」拼接，且输入编码选择正确`
    )
  }
  try {
    const plain = await aesGcmDecrypt(combined, opts)
    const payload = bytesPayload(plain)
    return {
      payload,
      note:
        payload.kind === 'text'
          ? `AES-${bits}-GCM 解密成功（${plain.length} 字节，认证通过）`
          : `AES-${bits}-GCM 解密成功（${plain.length} 字节，认证通过），但结果不是有效 UTF-8 文本，已按 Hex 展示`
    }
  } catch (e) {
    if (isAesGcmAuthFailure(e)) {
      throw new Error('认证失败：密钥错误、密文被修改或 AAD 不一致（IV 与认证标签长度也须与加密时相同）')
    }
    throw e
  }
}

const sm3: StepExecutor = (input, config) => {
  const bytes = payloadBytes(input, inputEncoding(config))
  const hex = computeSm3(bytes)
  const enc = outputEncoding(config)
  return {
    payload: textPayload(encodeOutput(hexToBytes(hex).bytes, enc)),
    note: `SM3 摘要完成（输入 ${bytes.length} 字节，输出 ${labelOf(enc)}）${expectedNote(hex, configText(config, 'expected'))}`
  }
}

const sm4: StepExecutor = (input, config, secrets) => {
  const operation = configText(config, 'operation', 'encrypt')
  const mode = configText(config, 'mode', 'cbc') as Sm4Mode
  if (mode !== 'cbc' && mode !== 'ecb') throw new Error(`不支持的 SM4 模式：${mode}`)
  const padding = configText(config, 'padding', 'pkcs#7') === 'none' ? 'none' : ('pkcs#7' as Sm4Padding)
  const keyEnc = configText(config, 'keyEncoding', 'utf8')
  const keyBytes = decodeInput(secrets.key ?? '', keyEnc === 'hex' ? 'hex' : 'utf8', '密钥')
  if (keyBytes.length !== 16) {
    throw new Error(
      keyEnc === 'hex'
        ? `密钥解码后 ${keyBytes.length} 字节，需要 16 字节（SM4 密钥固定 128 位，32 个 Hex 字符）`
        : `密钥 UTF-8 编码后 ${keyBytes.length} 字节，需要恰好 16 字节（16 个 ASCII 字符；非 ASCII 字符多字节编码会导致超长）`
    )
  }
  const ivHex = cleanHex(secrets.iv ?? '')
  if (mode === 'cbc' && !ivHex) throw new Error('IV 为空：CBC 模式需要 16 字节 IV（32 个 Hex 字符）')
  const bytes = payloadBytes(input, inputEncoding(config))
  const opts = { mode, padding, ivHex }
  const outEnc = configText(config, 'outputEncoding', 'auto')

  if (operation === 'encrypt') {
    const out = sm4Encrypt(bytes, bytesToHex(keyBytes), opts)
    const payload =
      outEnc === 'auto' ? bytesPayload(out) : textPayload(encodeOutput(out, outEnc === 'base64' ? 'base64' : 'hex'))
    return {
      payload,
      note: `SM4 ${mode.toUpperCase()} 加密成功（${padding === 'pkcs#7' ? 'PKCS#7 填充' : '无填充'}，明文 ${bytes.length} 字节 → 密文 ${out.length} 字节）${mode === 'cbc' ? '；解密需同一密钥与 IV' : ''}`
    }
  }

  const out = sm4Decrypt(bytes, bytesToHex(keyBytes), opts)
  const payload = outEnc === 'auto' ? bytesPayload(out) : textPayload(encodeOutput(out, outEnc === 'base64' ? 'base64' : 'hex'))
  return {
    payload,
    note: `SM4 ${mode.toUpperCase()} 解密成功（${padding === 'pkcs#7' ? 'PKCS#7 去填充校验通过' : '无填充，未去除任何字节'}，输出 ${out.length} 字节）`
  }
}

const sm2Exec: StepExecutor = (input, config, secrets) => {
  const operation = configText(config, 'operation', 'encrypt')
  const mode: Sm2CipherMode = configText(config, 'cipherMode', '1') === '0' ? 0 : 1
  const enc = configText(config, 'encoding', 'hex') === 'base64' ? 'base64' : 'hex'
  const userId = configText(config, 'userId', SM2_DEFAULT_USER_ID)
  const der = configText(config, 'sigFormat', 'raw') === 'der'
  const publicKey = configText(config, 'publicKey')
  const privateKey = secrets.privateKey ?? ''
  const modeLabel = mode === 1 ? 'C1C3C2' : 'C1C2C3'

  const needPublicKey = (): string => {
    if (!publicKey.trim()) throw new Error('公钥为空：请填写公钥（04 开头 130 位 Hex，或 02/03 开头 66 位）')
    const err = sm2PublicKeyError(publicKey)
    if (err) throw new Error(err)
    return cleanHex(publicKey)
  }
  const needPrivateKey = (): string => {
    if (!privateKey.trim()) throw new Error('私钥为空：请填写 64 位 Hex 私钥')
    const err = sm2PrivateKeyError(privateKey)
    if (err) throw new Error(err)
    return cleanHex(privateKey)
  }
  const inputBytes = (label: string): string => {
    if (input.bytes && input.kind === 'bytes') return bytesToHex(input.bytes)
    return bytesToHex(decodeInput(input.text.trim(), enc === 'base64' ? 'base64' : 'hex', label))
  }

  if (operation === 'encrypt') {
    const hex = sm2Encrypt(input.text, needPublicKey(), mode)
    return {
      payload: textPayload(enc === 'base64' ? encodeOutput(hexToBytes(hex).bytes, 'base64') : hex),
      note: `SM2 加密成功（${modeLabel}，明文 ${textToBytes(input.text).length} 字节，密文 ${hex.length / 2} 字节，输出 ${labelOf(enc)}）；每次加密使用新的随机数 k，同参数重复加密结果不同`
    }
  }

  if (operation === 'decrypt') {
    const cipherHex = cleanHex(inputBytes('密文'))
    if (cipherHex.length < SM2_MIN_CIPHER_BYTES * 2 || cipherHex.length % 2 !== 0) {
      throw new Error(
        `密文长度异常：解码后 ${cipherHex.length / 2} 字节，SM2 密文至少 ${SM2_MIN_CIPHER_BYTES} 字节（C1 64 + C3 32 + C2 至少 0）`
      )
    }
    const out = sm2Decrypt(cipherHex, needPrivateKey(), mode)
    return {
      payload: textPayload(out.text),
      note: out.empty
        ? 'SM2 解密成功：明文为空字符串（C2 为 0 字节），C3 校验通过'
        : `SM2 解密成功（${modeLabel}，C3 校验通过，明文 ${textToBytes(out.text).length} 字节）`
    }
  }

  if (operation === 'sign') {
    const signature = sm2Sign(input.text, needPrivateKey(), { userId, der })
    return {
      payload: textPayload(signature),
      note: `SM2 签名成功（SM3 摘要 + User ID「${userId}」，${der ? 'DER' : 'raw r||s'} 编码）`
    }
  }

  if (operation === 'verify') {
    const signature = configText(config, 'signature')
    if (!signature.trim()) throw new Error('签名为空：请填写待验证的签名（raw 为 128 位 Hex，DER 为 ASN.1 Hex）')
    const sigHex = cleanHex(signature)
    if (!/^[0-9a-f]+$/.test(sigHex)) throw new Error('签名 Hex 非法：包含非十六进制字符')
    if (!der && sigHex.length !== 128) throw new Error(`raw 签名应为 128 位 Hex（r||s 各 64 位），当前 ${sigHex.length} 位`)
    const pass = sm2Verify(input.text, sigHex, needPublicKey(), { userId, der })
    // 验签不通过是真实结论，与「执行出错」区分：这里按校验类步骤的惯例中止流程并写在说明里
    if (!pass) throw new Error(`验签不通过：签名与原文、公钥、User ID「${userId}」及 ${der ? 'DER' : 'raw r||s'} 格式不匹配（这是真实计算结果，不是执行错误）`)
    return { payload: textPayload(input.text), note: `验签通过：签名与原文、公钥、User ID「${userId}」及 ${der ? 'DER' : 'raw r||s'} 格式均匹配` }
  }

  throw new Error(`不支持的 SM2 操作：${operation}`)
}

export const cryptoExecutors: Partial<Record<string, StepExecutor>> = {
  digest,
  hmac,
  'aes-gcm': aesGcm,
  sm2: sm2Exec,
  sm3,
  sm4
}
