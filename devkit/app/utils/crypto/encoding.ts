/**
 * 工具页与流程步骤共用的编码层：Hex / Base64 / UTF-8 与字节互转。
 * 失败一律抛 `Error`（中文消息），由调用方决定是页面提示还是记成失败步骤。
 */
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, textToBytes } from '../bytes'

export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type OutputEncoding = 'hex' | 'base64'

/**
 * 复制成独立 ArrayBuffer。
 * WebCrypto 只接受 ArrayBuffer，且 Uint8Array 的底层 buffer 可能是 SharedArrayBuffer，
 * 直接透传在类型和运行时都可能有歧义，这里统一做一次拷贝。
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

/** 按声明编码把文本还原成字节；非法输入抛错而不是静默返回空字节 */
export function decodeInput(text: string, enc: InputEncoding, label = '输入'): Uint8Array {
  if (enc === 'hex') {
    const r = hexToBytes(text)
    if (r.error) throw new Error(`${label} Hex 非法：${r.error}`)
    return r.bytes
  }
  if (enc === 'base64') {
    const r = base64ToBytes(text)
    if (r.error) throw new Error(`${label} Base64 非法：${r.error}`)
    return r.bytes
  }
  return textToBytes(text)
}

export function encodeOutput(bytes: Uint8Array, enc: OutputEncoding): string {
  return enc === 'hex' ? bytesToHex(bytes) : bytesToBase64(bytes)
}

/** UTF-8 → 文本；不是合法 UTF-8 时返回 null，交给调用方按 Hex 展示二进制结果 */
export function tryDecodeText(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** 摘要 / 签名对照用的规范化：忽略空白并统一小写 */
export function normalizeHex(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

export function hexEquals(actualHex: string, expected: string): boolean {
  return normalizeHex(actualHex) === normalizeHex(expected)
}

export const inputEncodingOptions: { value: InputEncoding; label: string }[] = [
  { value: 'utf8', label: 'UTF-8 文本' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' }
]

export const outputEncodingOptions: { value: OutputEncoding; label: string }[] = [
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' }
]

export function encodingLabel(enc: InputEncoding | OutputEncoding): string {
  if (enc === 'hex') return 'Hex'
  if (enc === 'base64') return 'Base64'
  return 'UTF-8 文本'
}
