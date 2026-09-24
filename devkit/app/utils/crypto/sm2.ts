/**
 * SM2：sm-crypto 实现（加解密、签名验签、密钥生成），工具页（t15）与流程步骤 sm2 共用。
 * 密文格式由 cipherMode 决定：1 = C1C3C2（默认，与国密标准一致），0 = C1C2C3。
 */
import smCrypto from 'sm-crypto'
import sm2utils from 'sm-crypto/src/sm2/utils'
import { BigInteger } from 'jsbn'
import { bytesToHex, hexToBytes, textToBytes } from '../bytes'

const { sm2, sm3 } = smCrypto

/** 1 = C1C3C2，0 = C1C2C3 */
export type Sm2CipherMode = 0 | 1

export interface Sm2SignOptions {
  userId: string
  /** true = DER（ASN.1），false = raw（r||s） */
  der: boolean
}

export const SM2_DEFAULT_USER_ID = '1234567812345678'
export const SM2_MIN_CIPHER_BYTES = 96

export const sm2CipherModeOptions: { value: string; label: string }[] = [
  { value: '1', label: 'C1C3C2（默认）' },
  { value: '0', label: 'C1C2C3' }
]

export const sm2SignatureFormatOptions: { value: string; label: string }[] = [
  { value: 'raw', label: 'raw（r||s）' },
  { value: 'der', label: 'DER（ASN.1）' }
]

export function cleanHex(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

export function generateSm2KeyPair(): { publicKey: string; privateKey: string } {
  return sm2.generateKeyPairHex()
}

/** 公钥格式与曲线点校验；空串返回 ''（是否必填由调用方决定） */
export function sm2PublicKeyError(key: string): string {
  const k = cleanHex(key)
  if (!k) return ''
  if (!/^[0-9a-f]+$/.test(k)) return '公钥 Hex 非法：包含非十六进制字符'
  if (k.startsWith('04')) {
    if (k.length !== 130) return `公钥为 04 开头的非压缩格式，应为 130 位 Hex，当前 ${k.length} 位`
  } else if (k.startsWith('02') || k.startsWith('03')) {
    if (k.length !== 66) return `公钥为 ${k.slice(0, 2)} 开头的压缩格式，应为 66 位 Hex，当前 ${k.length} 位`
  } else {
    return '公钥应以 04 开头（非压缩，130 位 Hex）或 02/03 开头（压缩，66 位 Hex）'
  }
  if (!sm2.verifyPublicKey(k)) {
    return '公钥不是有效的 SM2 曲线点：不满足 y² = x³ + ax + b (mod p)，无法用于加密或验签，请检查公钥是否完整或属于 SM2 曲线'
  }
  return ''
}

/** SM2 曲线阶 n（用于私钥范围校验，私钥 d 必须满足 1 ≤ d < n） */
const SM2_N_HEX = 'fffffffeffffffffffffffffffffffff7203df6b21c6052b53bbf40939d54123'

/** 私钥必须是 64 位 Hex（32 字节），不带 04 前缀，且落在 (0, n) 内 */
export function sm2PrivateKeyError(key: string): string {
  const k = cleanHex(key)
  if (!k) return ''
  if (!/^[0-9a-f]+$/.test(k)) return '私钥 Hex 非法：包含非十六进制字符'
  if (k.length !== 64) return `私钥应为 64 位 Hex（32 字节），当前 ${k.length} 位`
  // 同长度小写 Hex 的字典序即数值序，无需引入大整数
  if (/^0+$/.test(k)) return '私钥不能为 0'
  if (k >= SM2_N_HEX) return '私钥超出 SM2 曲线阶 n 的取值范围（必须小于 n）'
  return ''
}

/** 待处理消息：文本按 UTF-8，字节数组原样（sm-crypto 两种输入都支持） */
export type Sm2Message = string | Uint8Array

function toMsgArg(msg: Sm2Message): string | number[] {
  return typeof msg === 'string' ? msg : Array.from(msg)
}

export function sm2Encrypt(plain: Sm2Message, publicKeyHex: string, mode: Sm2CipherMode): string {
  return sm2.doEncrypt(toMsgArg(plain), cleanHex(publicKeyHex), mode)
}

export interface Sm2DecryptOutcome {
  text: string
  /** 仅当 output='array' 时给出：原始明文字节（长度 0 表示空明文） */
  bytes?: Uint8Array
  /** C2 为 0 字节的合法密文：明文就是空字符串，不能和校验失败混为一谈 */
  empty: boolean
}

export function sm2C3FailureMessage(mode: Sm2CipherMode): string {
  return `解密失败：C3 校验未通过。常见原因：私钥与密文不匹配、密文被修改，或 cipherMode（当前 ${
    mode === 1 ? 'C1C3C2' : 'C1C2C3'
  }）与加密时不一致`
}

export function sm2Decrypt(
  cipherHex: string,
  privateKeyHex: string,
  mode: Sm2CipherMode,
  opts: { output?: 'string' | 'array' } = {}
): Sm2DecryptOutcome {
  const hex = cleanHex(cipherHex)
  const priv = cleanHex(privateKeyHex)
  // 私钥格式/范围守卫：避免 d=0 或 d≥n 在底层变成英文内部错误（如 Cannot read … toBigInteger）
  const privErr = sm2PrivateKeyError(privateKeyHex)
  if (privErr) throw new Error(privErr)
  if (opts.output === 'array') {
    // 二进制链路：拿原始字节，避免把非 UTF-8 明文卡在 UTF-8 解码上
    const arr = sm2.doDecrypt(hex, priv, mode, { output: 'array' })
    if (arr.length) return { text: '', bytes: Uint8Array.from(arr), empty: false }
    if (isEmptyPlaintextCipherValid(hex, priv, mode)) return { text: '', bytes: new Uint8Array(0), empty: true }
    throw new Error(sm2C3FailureMessage(mode))
  }
  const out = sm2.doDecrypt(hex, priv, mode)
  if (out !== '') return { text: out, empty: false }
  // doDecrypt 失败与「明文为空」都返回空串，这里独立复算 C3 才能区分
  if (isEmptyPlaintextCipherValid(hex, priv, mode)) return { text: '', empty: true }
  throw new Error(sm2C3FailureMessage(mode))
}

export function sm2Sign(message: Sm2Message, privateKeyHex: string, o: Sm2SignOptions): string {
  return sm2.doSignature(toMsgArg(message), cleanHex(privateKeyHex), { hash: true, userId: o.userId, der: o.der })
}

export function sm2Verify(message: Sm2Message, signature: string, publicKeyHex: string, o: Sm2SignOptions): boolean {
  return sm2.doVerifySignature(toMsgArg(message), cleanHex(signature), cleanHex(publicKeyHex), {
    hash: true,
    userId: o.userId,
    der: o.der
  })
}

/**
 * 独立复核空明文（C2 为 0 字节）密文的 C3 = SM3(x2 || y2)。
 * sm-crypto 的 doDecrypt 在这种输入上同样返回空串，所以必须单独算一次才能区分「失败」与「空明文」。
 */
export function isEmptyPlaintextCipherValid(cipherHex: string, privateKeyHex: string, mode: Sm2CipherMode): boolean {
  const hex = cleanHex(cipherHex)
  const priv = cleanHex(privateKeyHex)
  if (hex.length < 192 || hex.length % 2 !== 0) return false
  try {
    const c1 = sm2utils.getGlobalCurve().decodePointHex('04' + hex.slice(0, 128))
    if (!c1) return false
    const p = c1.multiply(new BigInteger(priv, 16))
    // d=0（或 d≡0 mod n）时 c1·d 是无穷远点，getX() 为 null；这类非法私钥直接判为无效
    const px = p.getX()
    const py = p.getY()
    if (!px || !py) return false
    const x2 = leftPad(px.toBigInteger().toString(16), 64)
    const y2 = leftPad(py.toBigInteger().toString(16), 64)
    const bytes: number[] = []
    for (let i = 0; i < x2.length; i += 2) bytes.push(parseInt(x2.substr(i, 2), 16))
    for (let i = 0; i < y2.length; i += 2) bytes.push(parseInt(y2.substr(i, 2), 16))
    const expected = sm3(bytes)
    const actual = mode === 0 ? hex.slice(hex.length - 64) : hex.slice(128, 192)
    return expected === actual
  } catch {
    return false
  }
}

function leftPad(s: string, n: number): string {
  return s.length >= n ? s : '0'.repeat(n - s.length) + s
}

/** SM2 密文的固定开销：C1（64 字节）+ C3（32 字节）= 96 字节，另加 C2 明文长度 */
export function sm2CipherBytesFromBytes(bytes: number): number {
  return bytes + 96
}

export { textToBytes, bytesToHex, hexToBytes }
