/**
 * AES-GCM：WebCrypto 实现，工具页（t14）与流程步骤 aes-gcm 共用。
 * 密文格式统一为「密文 || 认证标签」拼接，与大多数网关（Java / Go）默认输出一致。
 */
import { toArrayBuffer } from './encoding'

export type AesKeyBits = 128 | 192 | 256
export type AesTagBits = 96 | 112 | 128

export interface AesGcmOptions {
  key: Uint8Array
  iv: Uint8Array
  aad: Uint8Array
  tagLength: AesTagBits
}

export const aesKeyBitsOptions: { value: string; label: string }[] = [
  { value: '128', label: 'AES-128' },
  { value: '192', label: 'AES-192' },
  { value: '256', label: 'AES-256' }
]

export const aesTagBitsOptions: { value: string; label: string }[] = [
  { value: '96', label: '96 位（12 字节）' },
  { value: '112', label: '112 位（14 字节）' },
  { value: '128', label: '128 位（16 字节）' }
]

export function aesKeyBytes(bits: AesKeyBits): number {
  return bits / 8
}

/** 密钥是原始字节而不是口令：长度必须精确匹配，不做任何密码派生 */
export function assertAesKey(key: Uint8Array, bits: AesKeyBits): void {
  const need = aesKeyBytes(bits)
  if (key.length !== need) {
    throw new Error(`密钥解码后 ${key.length} 字节，需要 ${need} 字节（AES-${bits}）`)
  }
}

export async function aesGcmEncrypt(plain: Uint8Array, opts: AesGcmOptions): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(opts.key), { name: 'AES-GCM' }, false, ['encrypt'])
  const out = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(opts.iv),
      additionalData: toArrayBuffer(opts.aad),
      tagLength: opts.tagLength
    },
    key,
    toArrayBuffer(plain)
  )
  return new Uint8Array(out)
}

export async function aesGcmDecrypt(combined: Uint8Array, opts: AesGcmOptions): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(opts.key), { name: 'AES-GCM' }, false, ['decrypt'])
  const out = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(opts.iv),
      additionalData: toArrayBuffer(opts.aad),
      tagLength: opts.tagLength
    },
    key,
    toArrayBuffer(combined)
  )
  return new Uint8Array(out)
}

/** GCM 认证失败与「参数格式错误」要分开提示：前者是真实结论，后者是用法问题 */
export function isAesGcmAuthFailure(e: unknown): boolean {
  return typeof DOMException !== 'undefined' && e instanceof DOMException && e.name === 'OperationError'
}

export function splitCombined(combined: Uint8Array, tagBits: AesTagBits): { ciphertext: Uint8Array; tag: Uint8Array } {
  const tagBytes = tagBits / 8
  return {
    ciphertext: combined.subarray(0, Math.max(0, combined.length - tagBytes)),
    tag: combined.subarray(Math.max(0, combined.length - tagBytes))
  }
}
